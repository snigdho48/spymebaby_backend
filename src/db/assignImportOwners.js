require('dotenv').config();
const { pool } = require('../config/db');

function parseArgs(argv) {
  for (const arg of argv) {
    if (arg.startsWith('--username=')) return arg.slice('--username='.length);
  }
  return '';
}

async function main() {
  const username =
    parseArgs(process.argv.slice(2)) || process.env.IMPORT_USERNAME || 'nusrat';

  const [users] = await pool.query('SELECT id, username FROM users WHERE username = ?', [
    username,
  ]);
  if (!users.length) {
    console.error(`[assign-import-owners] User "${username}" not found. Create the user first.`);
    process.exit(1);
  }
  const userId = users[0].id;

  const [before] = await pool.query(
    `SELECT t.uuid, t.name, u.username AS current_owner
       FROM trackers t
       JOIN data_imports di ON di.tracker_uuid = t.uuid
       JOIN users u ON u.id = t.user_id
      ORDER BY t.name ASC`
  );

  const [result] = await pool.query(
    `UPDATE trackers t
       INNER JOIN data_imports di ON di.tracker_uuid = t.uuid
       SET t.user_id = ?
     WHERE t.user_id != ?`,
    [userId, userId]
  );

  console.log(`[assign-import-owners] Target owner: ${username} (id=${userId})`);
  console.log(`[assign-import-owners] Imported trackers in DB: ${before.length}`);
  before.forEach((row) => {
    const mark = row.current_owner === username ? 'ok' : 'moved';
    console.log(`  - ${row.name} (${row.current_owner}) [${mark}]`);
  });
  console.log(`[assign-import-owners] Reassigned: ${result.affectedRows} tracker(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[assign-import-owners] Failed:', err.message);
  process.exit(1);
});
