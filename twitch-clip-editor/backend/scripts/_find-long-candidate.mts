import { initDb, getDb } from "../src/db/index.js";

initDb();
const rows = getDb()
  .prepare(
    `SELECT id, vod_id, start_time, end_time, (end_time - start_time) AS dur, reason
     FROM candidates
     WHERE vod_id = 'v2820282061'
     ORDER BY dur DESC
     LIMIT 15`
  )
  .all();
console.log(JSON.stringify(rows, null, 2));
