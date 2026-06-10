const { periodReachFromImpressions } = require('../db/randomEventData');

const DEFAULT_AVG_FREQUENCY = 2.2;

async function isImportedTracker(pool, trackerUuid) {
  const [rows] = await pool.query(
    'SELECT 1 FROM data_imports WHERE tracker_uuid = ? LIMIT 1',
    [trackerUuid]
  );
  return rows.length > 0;
}

/** Spread sample proportions across a day's impression total (display only; imp unchanged). */
function distributeBreakdownToTotal(map, total) {
  if (!total || total <= 0) return {};
  const entries = Object.entries(map).filter(([, v]) => v > 0);
  if (!entries.length) return {};

  const sum = entries.reduce((s, [, v]) => s + v, 0);
  if (sum <= 0) return {};

  const result = {};
  let assigned = 0;
  entries.forEach(([key, value], index) => {
    if (index === entries.length - 1) {
      result[key] = total - assigned;
    } else {
      const portion = Math.round((value / sum) * total);
      result[key] = portion;
      assigned += portion;
    }
  });
  return result;
}

function mergeBrowserOsMaps(groups, events, ymd) {
  for (const ev of events) {
    if (ev.type !== 'imp') continue;
    const dateStr = ymd(ev.created_at);
    const key = `${ev.contentname}|${dateStr}`;
    const g = groups.get(key);
    if (!g) continue;
    if (ev.browser) {
      g.browserMap[ev.browser] = (g.browserMap[ev.browser] || 0) + 1;
    }
    if (ev.os) {
      g.osMap[ev.os] = (g.osMap[ev.os] || 0) + 1;
    }
  }
}

async function buildDateTrackingFromStats(pool, { tracker_uuid, content, ymd }) {
  const params = [tracker_uuid];
  let contentFilter = '';
  if (content) {
    contentFilter = ' AND c.name = ?';
    params.push(content);
  }

  const [statsRows] = await pool.query(
    `SELECT c.uuid AS content_uuid, c.name AS contentname,
            s.stat_date, s.impressions AS imp, s.clicks AS click, s.unique_reach AS unique_reach
       FROM campaign_daily_stats s
       JOIN contents c ON c.uuid = s.content_uuid
      WHERE s.tracker_uuid = ?${contentFilter}
      ORDER BY s.stat_date ASC`,
    params
  );

  const groups = new Map();
  let totalImp = 0;
  let totalClick = 0;

  for (const row of statsRows) {
    const dateStr =
      row.stat_date instanceof Date
        ? ymd(row.stat_date)
        : String(row.stat_date).slice(0, 10);
    const key = `${row.contentname}|${dateStr}`;
    groups.set(key, {
      uuid: row.content_uuid,
      contentname: row.contentname,
      name: row.contentname,
      created_at: `${dateStr}T00:00:00.000Z`,
      imp: Number(row.imp) || 0,
      click: Number(row.click) || 0,
      unique: Math.min(Number(row.unique_reach) || 0, Number(row.imp) || 0),
      browserMap: {},
      osMap: {},
    });
    totalImp += Number(row.imp) || 0;
    totalClick += Number(row.click) || 0;
  }

  const [events] = await pool.query(
    `SELECT c.name AS contentname, e.type, e.browser, e.os, e.created_at
       FROM tracking_events e
       JOIN contents c ON c.uuid = e.content_uuid
      WHERE e.tracker_uuid = ?${contentFilter}
      ORDER BY e.created_at ASC`,
    params
  );
  mergeBrowserOsMaps(groups, events, ymd);

  const data = Array.from(groups.values()).map((g) => ({
    uuid: g.uuid,
    contentname: g.contentname,
    name: g.name,
    created_at: g.created_at,
    imp: g.imp,
    click: g.click,
    unique: g.unique,
    browser: [distributeBreakdownToTotal(g.browserMap, g.imp)],
    os: [distributeBreakdownToTotal(g.osMap, g.imp)],
  }));

  return {
    data,
    totals: {
      imp: totalImp,
      click: totalClick,
      unique: periodReachFromImpressions(totalImp, DEFAULT_AVG_FREQUENCY),
    },
  };
}

module.exports = {
  buildDateTrackingFromStats,
  isImportedTracker,
  DEFAULT_AVG_FREQUENCY,
  periodReachFromImpressions,
};
