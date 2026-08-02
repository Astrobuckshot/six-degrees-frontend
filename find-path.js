// This is a much faster version of find-path.js. Instead of downloading
// the whole database and searching it here (which took ~7 seconds), this
// now just asks Supabase to run the search itself, using the
// find_shortest_path Postgres function, and sends back only the short
// final answer. Typically well under a second.

export default async function handler(req, res) {
  const { a, b } = req.query;

  if (!a || !b) {
    return res.status(400).json({ error: 'Both person IDs (a and b) are required.' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;

  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/find_shortest_path`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        start_id: parseInt(a, 10),
        end_id: parseInt(b, 10),
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return res.status(500).json({ error: `Supabase error: ${text}` });
    }

    const rows = await resp.json();

    if (!rows || rows.length === 0) {
      return res.status(200).json({ path: null });
    }

    // Sort by step_order just to be safe, then reshape to match what the
    // frontend already expects.
    const sorted = rows.slice().sort((x, y) => x.step_order - y.step_order);
    const path = sorted.map((row) => ({
      id: row.person_id,
      name: row.person_name,
      connectionType: row.connection_type,
      context: row.context,
    }));

    return res.status(200).json({ path });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
