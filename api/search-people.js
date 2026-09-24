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
// UPDATE: matching used to miss anyone with an accented name unless the
// accent was typed exactly right - searching "Celine Dion" (no accent)
// found nothing, because the stored name is "Céline Dion" (with an
// accent) and a plain substring match is accent-sensitive. Postgres has
// an unaccent() function that fixes this, but PostgREST's ilike filter
// (the *word* syntax below) operates directly on a column and can't wrap
// that column in a function through the query string. So the fix has two
// sides: a generated column `name_unaccent` was added to the people table
// (Postgres keeps it automatically in sync with `name`, including for
// future imports - no extra pipeline work needed), and this file now (1)
// strips accents from the typed-in query the same way before building the
// filter, and (2) searches `name_unaccent` instead of `name`. Both sides
// end up accent-free, so "Celine Dion" and "René Angélil" now match
// correctly regardless of whether the person typing includes the accent.
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
// what's selectable from the search box. The view also exposes
// `name_unaccent` (alongside the other columns) so the accent-insensitive
// search above still works on the filtered result set.

// Strips diacritics (accent marks) from a string using the same
// decomposition approach as Postgres's unaccent(): NFD normalization
// splits an accented character into its base letter plus a separate
// combining-accent character, then the accent characters are removed,
// leaving just the base letters.
function stripAccents(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export default async function handler(req, res) {
  const { q } = req.query;

  if (!q || q.trim().length < 2) {
    return res.status(200).json({ matches: [] });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;

  // Split on whitespace, drop empty tokens (handles extra spaces), and
  // require every token to appear somewhere in the name (order-independent).
  // Each word also has its accents stripped so it matches name_unaccent
  // correctly regardless of whether the typed word itself has accents.
  const words = q.trim().split(/\s+/).filter(Boolean).map(stripAccents);

  const andConditions = words
    .map((w) => `name_unaccent.ilike.*${encodeURIComponent(w)}*`)
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
