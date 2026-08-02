-- This function does the same bidirectional breadth-first search as
-- find_path.py and find-path.js, but runs INSIDE Supabase itself,
-- directly against the connections table. This means no more downloading
-- the whole database over the network on every search - it only sends
-- back the final short path.
--
-- HOW TO USE IT (once installed):
--   SELECT * FROM find_shortest_path(123, 456);
-- where 123 and 456 are the two people's `id` values from the people table.

CREATE OR REPLACE FUNCTION find_shortest_path(start_id bigint, end_id bigint)
RETURNS TABLE(step_order int, person_id bigint, person_name text, connection_type text, context text)
LANGUAGE plpgsql
AS $$
DECLARE
  meeting_point bigint := NULL;
  frontier_start bigint[] := ARRAY[start_id];
  frontier_end bigint[] := ARRAY[end_id];
  new_ids bigint[];
  walk_id bigint;
  next_hop_id bigint;
  ctype text;
  ctx text;
  start_side_path bigint[] := ARRAY[]::bigint[];
  end_side_ids bigint[] := ARRAY[]::bigint[];
  end_side_ctypes text[] := ARRAY[]::text[];
  end_side_ctxs text[] := ARRAY[]::text[];
BEGIN
  -- Special case: searching a person against themselves
  IF start_id = end_id THEN
    RETURN QUERY
      SELECT 1, p.id, p.name, NULL::text, NULL::text
      FROM people p WHERE p.id = start_id;
    RETURN;
  END IF;

  -- These temporary tables track how we reached each person from each
  -- side, and are automatically cleaned up at the end of this call.
  CREATE TEMP TABLE visited_start (
    id bigint PRIMARY KEY,
    parent_id bigint,
    connection_type text,
    context text
  ) ON COMMIT DROP;

  CREATE TEMP TABLE visited_end (
    id bigint PRIMARY KEY,
    parent_id bigint,
    connection_type text,
    context text
  ) ON COMMIT DROP;

  INSERT INTO visited_start VALUES (start_id, NULL, NULL, NULL);
  INSERT INTO visited_end VALUES (end_id, NULL, NULL, NULL);

  -- Main search loop: each pass, expand whichever side currently has
  -- FEWER people in its frontier (keeps the search fast), one "ring"
  -- outward at a time, until the two sides meet.
  LOOP
    EXIT WHEN array_length(frontier_start, 1) IS NULL
             OR array_length(frontier_end, 1) IS NULL
             OR meeting_point IS NOT NULL;

    IF array_length(frontier_start, 1) <= array_length(frontier_end, 1) THEN
      WITH inserted AS (
        INSERT INTO visited_start (id, parent_id, connection_type, context)
        SELECT DISTINCT ON (neighbor_id) neighbor_id, current_id, conn_type, conn_context
        FROM (
          SELECT c.person_a_id AS current_id, c.person_b_id AS neighbor_id,
                 c.connection_type AS conn_type, c.context AS conn_context
          FROM connections c
          WHERE c.person_a_id = ANY(frontier_start)
          UNION ALL
          SELECT c.person_b_id AS current_id, c.person_a_id AS neighbor_id,
                 c.connection_type AS conn_type, c.context AS conn_context
          FROM connections c
          WHERE c.person_b_id = ANY(frontier_start)
        ) neighbors
        WHERE neighbor_id NOT IN (SELECT id FROM visited_start)
        ORDER BY neighbor_id
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      )
      SELECT array_agg(id) INTO new_ids FROM inserted;

      frontier_start := COALESCE(new_ids, ARRAY[]::bigint[]);

      IF new_ids IS NOT NULL THEN
        SELECT id INTO meeting_point FROM unnest(new_ids) AS id
        WHERE id IN (SELECT id FROM visited_end) LIMIT 1;
      END IF;
    ELSE
      WITH inserted AS (
        INSERT INTO visited_end (id, parent_id, connection_type, context)
        SELECT DISTINCT ON (neighbor_id) neighbor_id, current_id, conn_type, conn_context
        FROM (
          SELECT c.person_a_id AS current_id, c.person_b_id AS neighbor_id,
                 c.connection_type AS conn_type, c.context AS conn_context
          FROM connections c
          WHERE c.person_a_id = ANY(frontier_end)
          UNION ALL
          SELECT c.person_b_id AS current_id, c.person_a_id AS neighbor_id,
                 c.connection_type AS conn_type, c.context AS conn_context
          FROM connections c
          WHERE c.person_b_id = ANY(frontier_end)
        ) neighbors
        WHERE neighbor_id NOT IN (SELECT id FROM visited_end)
        ORDER BY neighbor_id
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      )
      SELECT array_agg(id) INTO new_ids FROM inserted;

      frontier_end := COALESCE(new_ids, ARRAY[]::bigint[]);

      IF new_ids IS NOT NULL THEN
        SELECT id INTO meeting_point FROM unnest(new_ids) AS id
        WHERE id IN (SELECT id FROM visited_start) LIMIT 1;
      END IF;
    END IF;
  END LOOP;

  -- No path exists between these two people
  IF meeting_point IS NULL THEN
    RETURN;
  END IF;

  -- Reconstruct the START side: walk backward from the meeting point to
  -- the start person using visited_start's parent pointers, collecting
  -- ids in order (start_id first, meeting_point last).
  walk_id := meeting_point;
  WHILE walk_id IS NOT NULL LOOP
    start_side_path := array_prepend(walk_id, start_side_path);
    SELECT vs.parent_id INTO walk_id FROM visited_start vs WHERE vs.id = walk_id;
  END LOOP;

  FOR i IN 1 .. array_length(start_side_path, 1) LOOP
    SELECT vs.connection_type, vs.context INTO ctype, ctx
    FROM visited_start vs WHERE vs.id = start_side_path[i];

    RETURN QUERY
      SELECT i, p.id, p.name,
             CASE WHEN i = 1 THEN NULL ELSE ctype END,
             CASE WHEN i = 1 THEN NULL ELSE ctx END
      FROM people p WHERE p.id = start_side_path[i];
  END LOOP;

  -- Reconstruct the END side: walk forward from the meeting point to the
  -- end person using visited_end's parent pointers (each parent_id here
  -- is the next hop TOWARD end_id, with connection_type/context describing
  -- the edge from the current node to that parent).
  walk_id := meeting_point;
  LOOP
    SELECT ve.parent_id, ve.connection_type, ve.context INTO next_hop_id, ctype, ctx
    FROM visited_end ve WHERE ve.id = walk_id;

    EXIT WHEN next_hop_id IS NULL;

    end_side_ids := array_append(end_side_ids, next_hop_id);
    end_side_ctypes := array_append(end_side_ctypes, ctype);
    end_side_ctxs := array_append(end_side_ctxs, ctx);
    walk_id := next_hop_id;
  END LOOP;

  FOR i IN 1 .. COALESCE(array_length(end_side_ids, 1), 0) LOOP
    RETURN QUERY
      SELECT array_length(start_side_path, 1) + i, p.id, p.name,
             end_side_ctypes[i], end_side_ctxs[i]
      FROM people p WHERE p.id = end_side_ids[i];
  END LOOP;

END;
$$;
