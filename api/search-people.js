// This file lives in /api, which is a special folder Vercel recognizes -
// anything in here automatically becomes a small backend function, callable
// at /api/search-people from the React app.
//
// WHAT THIS DOES: given a partial name typed into a search box, asks
// Supabase for people whose name contains that text, and returns a short
// list of matches (used for both live search and disambiguating duplicate
// names, like the multiple "Nicholson" results you saw in find_path.py).

export default async function handler(req, res) {
  const { q } = req.query;

  if (!q || q.trim().length < 2) {
    return res.status(200).json({ matches: [] });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;

  const url = `${SUPABASE_URL}/rest/v1/people?select=id,name,fame_score&name=ilike.*${encodeURIComponent(
    q.trim()
  )}*&order=fame_score.desc.nullslast&limit=10`;

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
