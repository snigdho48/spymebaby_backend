require('dotenv').config();
const { pool } = require('../config/db');
const { migrate } = require('./migrate');

async function resetImportedData(username) {
  const [users] = await pool.query('SELECT id FROM users WHERE username = ?', [
    username,
  ]);
  const userId = users[0]?.id;
  if (!userId) {
    throw new Error(`User "${username}" not found.`);
  }

  const [trackers] = await pool.query(
    'SELECT uuid FROM trackers WHERE user_id = ?',
    [userId]
  );
  const trackerUuids = trackers.map((t) => t.uuid);

  if (!trackerUuids.length) {
    console.log(`[reset] No trackers found for user "${username}".`);
    return { trackers: 0, events: 0, stats: 0 };
  }

  const placeholders = trackerUuids.map(() => '?').join(',');

  const [eventResult] = await pool.query(
    `DELETE FROM tracking_events WHERE tracker_uuid IN (${placeholders})`,
    trackerUuids
  );
  const [statsResult] = await pool.query(
    `DELETE FROM campaign_daily_stats WHERE tracker_uuid IN (${placeholders})`,
    trackerUuids
  );
  await pool.query(
    `DELETE FROM data_imports WHERE tracker_uuid IN (${placeholders})`,
    trackerUuids
  );
  await pool.query(
    `DELETE FROM contents WHERE tracker_uuid IN (${placeholders})`,
    trackerUuids
  );
  const [trackerResult] = await pool.query(
    'DELETE FROM trackers WHERE user_id = ?',
    [userId]
  );

  return {
    trackers: trackerResult.affectedRows,
    events: eventResult.affectedRows,
    stats: statsResult.affectedRows,
  };
}

async function main() {
  const username = process.env.IMPORT_USERNAME || process.env.SEED_USERNAME || 'snigdho';

  console.log('[reset] Syncing database schema...');
  await migrate();

  console.log(`[reset] Removing all trackers and import data for user "${username}"...`);
  const result = await resetImportedData(username);
  console.log(
    `[reset] Done. Removed ${result.trackers} trackers, ${result.events.toLocaleString()} events, ${result.stats.toLocaleString()} daily stat rows.`
  );
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[reset] Failed:', err.message);
    process.exit(1);
  });
}

module.exports = { resetImportedData };
