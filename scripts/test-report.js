require('dotenv').config();
const { pool } = require('../src/config/db');

const ymd = (value) => {
  const d = new Date(value);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

(async () => {
  const uuid = 'a4e55a05-3dd9-4cad-8c08-cfe7877364af';
  const [events] = await pool.query(
    `SELECT e.type, e.client_ip, e.created_at, c.name AS contentname
       FROM tracking_events e
       JOIN contents c ON c.uuid = e.content_uuid
      WHERE e.tracker_uuid = ?
      ORDER BY e.created_at ASC
      LIMIT 5`,
    [uuid]
  );
  console.log('sample events', events);

  const [all] = await pool.query(
    `SELECT e.type, COUNT(*) c FROM tracking_events e WHERE e.tracker_uuid = ? GROUP BY e.type`,
    [uuid]
  );
  console.log('counts', all);

  const groups = new Map();
  const [full] = await pool.query(
    `SELECT e.type, e.client_ip, e.created_at, c.name AS contentname, c.uuid AS content_uuid
       FROM tracking_events e
       JOIN contents c ON c.uuid = e.content_uuid
      WHERE e.tracker_uuid = ?`,
    [uuid]
  );

  for (const ev of full) {
    const dateStr = ymd(ev.created_at);
    const key = `${ev.contentname}|${dateStr}`;
    if (!groups.has(key)) {
      groups.set(key, { imp: 0, click: 0, uniqueIps: new Set() });
    }
    const g = groups.get(key);
    if (ev.type === 'imp') {
      g.imp += 1;
      if (ev.client_ip) g.uniqueIps.add(ev.client_ip);
    } else if (ev.type === 'click') g.click += 1;
  }

  let totalImp = 0;
  let totalUnique = 0;
  for (const g of groups.values()) {
    totalImp += g.imp;
    totalUnique += g.uniqueIps.size;
  }
  console.log('grouped days', groups.size, 'totalImp', totalImp, 'sumDailyUnique', totalUnique);

  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
