require('dotenv').config();
const { pool } = require('../src/config/db');

(async () => {
  const [users] = await pool.query('SELECT id, username FROM users');
  console.log('users', users);

  const [trackers] = await pool.query(
    'SELECT t.uuid, t.user_id, u.username, t.name, (SELECT COUNT(*) FROM tracking_events e WHERE e.tracker_uuid = t.uuid) AS events FROM trackers t JOIN users u ON u.id = t.user_id'
  );
  console.log('trackers', trackers);

  const [counts] = await pool.query(
    'SELECT type, COUNT(*) AS c FROM tracking_events GROUP BY type'
  );
  console.log('event types', counts);

  const [imps] = await pool.query(
    "SELECT COUNT(*) AS c FROM tracking_events WHERE type = 'imp'"
  );
  const [uniq] = await pool.query(
    "SELECT COUNT(DISTINCT client_ip) AS c FROM tracking_events WHERE type = 'imp' AND client_ip IS NOT NULL"
  );
  console.log('impressions', imps[0].c, 'unique ips', uniq[0].c);

  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
