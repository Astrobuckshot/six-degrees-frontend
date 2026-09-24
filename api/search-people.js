// This file lives in /api, which is a special folder Vercel recognizes -
// anything in here automatically becomes a small backend function, callable
// at /api/search-people from the React app.
//
// WHAT THIS DOES: given a partial name typed into a search box, asks
// Supabase for people whose name contains that text, and returns a short
// list of matches (used for both live search and disambiguating duplicate
// names, like the multiple "Nicholson" results you saw in find_path.py).
//
// UPDATE: now also returns `descriptor` (a short Wikidata-derived phrase
// like "American actor" or "footballer") so the frontend can show which
// same-named person is which -- e.g. "James Brown (singer)" vs.
// "James Brown (footballer)".
//
// UPDATE: matching used to require the WHOLE typed string to appear as one
// continuous substring in the stored name. That silently broke on anyone
// with a middle initial - "Robert Brown" never matched "Robert K. Brown"
// (the "K." sits in between, so "Robert Brown" never occurs as one block),
// and "Robert K Brown" (no period) never matched it either, for the same
// reason. Now the query is split into individual words, and each word just
// has to appear SOMEWHERE in the name, in any order - "Robert", "K", and
// "Brown" each independently match "Robert K. Brown" (since "K" is itself
// a substring of "K."), so both the missing-middle-initial and the
// missing-period cases resolve correctly without any special-case
// punctuation handling.
//
// UPDATE: was querying the raw `people` table, which includes rows with
// zero connections - e.g. the large intentional "seed batch" imported
// across many unrelated fields (philosophers, athletes, etc.) that
// deliberately isn't connected to anything yet, plus a handful of
// leftover wrong-QID rows from past data-integrity fixes (their real
// connections got moved to the correct person, but the wrong row itself
// is kept permanently per the never-delete policy, rather than deleted).
// Neither type belongs in a user-facing search result, since selecting
// them could never actually find a path to anyone. Now queries the
// `people_with_connections` view instead, which pre-filters to only
// people who have at least one row in `connections` - the underlying
// `people` rows themselves are completely unaffected, this only changes
// what's selectable from the search box.

export default async function handler(req, res) {
  const { q } = req.query;

  if (!q || q.trim().length < 2) {
    return res.status(200).json({ matches: [] });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;

  // Split on whitespace, drop empty tokens (handles extra spaces), and
  // require every token to appear somewhere in the name (order-independent).
  const words = q.trim().split(/\s+/).filter(Boolean);

  const andConditions = words
    .map((w) => `name.ilike.*${encodeURIComponent(w)}*`)
    .join(',');

  const url = `${SUPABASE_URL}/rest/v1/people_with_connections?select=id,name,fame_score,descriptor&and=(${andConditions})&order=fame_score.desc.nullslast&limit=10`;

  try {
    const resp = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });

    if (!resp.ok) {
      const text = await resp.text();
      return res.status(500).json({ error: `Supabase error: ${text}` });
    }

    const matches = await resp.json();
    return res.status(200).json({ matches });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
