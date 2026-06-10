require('dotenv').config();
const { pool } = require('../src/config/db');

(async () => {
  const [rows] = await pool.query(
    `SELECT t.name, e.type, COUNT(*) AS c
       FROM tracking_events e
       JOIN trackers t ON t.uuid = e.tracker_uuid
      GROUP BY t.name, e.type
      ORDER BY t.name, e.type`
  );
  console.table(rows);
  process.exit(0);
})();
