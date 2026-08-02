// This is the JavaScript version of find_path.py, running as a Vercel
// serverless function instead of on your computer. Same bidirectional
// breadth-first search approach: search outward from both people at once,
// stop the moment the two searches meet.
//
// NOTE ON PERFORMANCE (v1): this downloads the full people + connections
// tables from Supabase on every request, same as the Python script did.
// That's fine to get things working, but it means each search takes a
// few seconds and re-downloads ~100K+ rows every time. Once the basic
// version is confirmed working, a good future upgrade is moving this
// search logic INTO Supabase itself (a Postgres function), so it doesn't
// need to move all that data over the network on every request.

const PAGE_SIZE = 1000;

async function fetchAllRows(supabaseUrl, supabaseKey, table, select) {
  let allRows = [];
  let offset = 0;
  while (true) {
    const url = `${supabaseUrl}/rest/v1/${table}?select=${select}&limit=${PAGE_SIZE}&offset=${offset}`;
    const resp = await fetch(url, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });
    if (!resp.ok) {
      throw new Error(`Failed fetching ${table}: ${await resp.text()}`);
    }
    const page = await resp.json();
    if (page.length === 0) break;
    allRows = allRows.concat(page);
    offset += PAGE_SIZE;
    if (page.length < PAGE_SIZE) break;
  }
  return allRows;
}

async function buildGraph(supabaseUrl, supabaseKey) {
  const peopleRows = await fetchAllRows(supabaseUrl, supabaseKey, 'people', 'id,name');
  const idToName = {};
  for (const row of peopleRows) {
    idToName[row.id] = row.name;
  }

  const connectionRows = await fetchAllRows(
    supabaseUrl,
    supabaseKey,
    'connections',
    'person_a_id,person_b_id,connection_type,context'
  );

  // graph: person_id -> array of [neighborId, connectionType, context]
  const graph = {};
  for (const row of connectionRows) {
    const a = row.person_a_id;
    const b = row.person_b_id;
    if (!graph[a]) graph[a] = [];
    if (!graph[b]) graph[b] = [];
    graph[a].push([b, row.connection_type, row.context]);
    graph[b].push([a, row.connection_type, row.context]);
  }

  return { idToName, graph };
}

/**
 * Returns the shortest path as an array of { id, connectionType, context }
 * steps, or null if no path exists. The first entry's connectionType/context
 * are null (it's just the starting person).
 */
function bidirectionalBFS(startId, endId, graph) {
  if (startId === endId) {
    return [{ id: startId, connectionType: null, context: null }];
  }

  const visitedFromStart = { [startId]: null };
  const visitedFromEnd = { [endId]: null };
  let frontierStart = [startId];
  let frontierEnd = [endId];
  let meetingPoint = null;

  while (frontierStart.length && frontierEnd.length && !meetingPoint) {
    if (frontierStart.length <= frontierEnd.length) {
      const nextFrontier = [];
      for (const currentId of frontierStart) {
        for (const [neighborId, ctype, context] of graph[currentId] || []) {
          if (!(neighborId in visitedFromStart)) {
            visitedFromStart[neighborId] = [currentId, ctype, context];
            nextFrontier.push(neighborId);
            if (neighborId in visitedFromEnd) {
              meetingPoint = neighborId;
              break;
            }
          }
        }
        if (meetingPoint) break;
      }
      frontierStart = nextFrontier;
    } else {
      const nextFrontier = [];
      for (const currentId of frontierEnd) {
        for (const [neighborId, ctype, context] of graph[currentId] || []) {
          if (!(neighborId in visitedFromEnd)) {
            visitedFromEnd[neighborId] = [currentId, ctype, context];
            nextFrontier.push(neighborId);
            if (neighborId in visitedFromStart) {
              meetingPoint = neighborId;
              break;
            }
          }
        }
        if (meetingPoint) break;
      }
      frontierEnd = nextFrontier;
    }
  }

  if (!meetingPoint) return null;

  // Reconstruct start -> meetingPoint
  const pathStartSide = [];
  let node = meetingPoint;
  while (node !== startId) {
    const [parentId, ctype, context] = visitedFromStart[node];
    pathStartSide.push({ id: node, connectionType: ctype, context });
    node = parentId;
  }
  pathStartSide.push({ id: startId, connectionType: null, context: null });
  pathStartSide.reverse();

  // Reconstruct meetingPoint -> end
  const pathEndSide = [];
  node = meetingPoint;
  while (node !== endId) {
    const [parentId, ctype, context] = visitedFromEnd[node];
    pathEndSide.push({ id: parentId, connectionType: ctype, context });
    node = parentId;
  }

  return pathStartSide.concat(pathEndSide);
}

export default async function handler(req, res) {
  const { a, b } = req.query;

  if (!a || !b) {
    return res.status(400).json({ error: 'Both person IDs (a and b) are required.' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;

  try {
    const { idToName, graph } = await buildGraph(SUPABASE_URL, SUPABASE_KEY);

    const startId = parseInt(a, 10);
    const endId = parseInt(b, 10);

    const rawPath = bidirectionalBFS(startId, endId, graph);

    if (!rawPath) {
      return res.status(200).json({ path: null });
    }

    const namedPath = rawPath.map((step) => ({
      id: step.id,
      name: idToName[step.id] || `[unknown person ${step.id}]`,
      connectionType: step.connectionType,
      context: step.context,
    }));

    return res.status(200).json({ path: namedPath });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
