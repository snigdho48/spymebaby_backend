const express = require('express');
const { pool } = require('../config/db');
const { authRequired } = require('../middleware/auth');
const { parseUserAgent } = require('../utils/ua');
const { resolveIpLocation, coordKey, parseCoord } = require('../utils/geoip');
const {
  buildDateTrackingFromStats,
  isImportedTracker,
  periodReachFromImpressions,
  DEFAULT_AVG_FREQUENCY,
} = require('../utils/reportStats');
const {
  findAccessibleTracker,
  trackerOwnerFilter,
} = require('../utils/trackerAccess');

const router = express.Router();

// 1x1 transparent GIF used as the pixel response (works for both
// <img>-based tags and fetch()-based tags).
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

const ymd = (value) => {
  const d = new Date(value);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

function sendPixel(res) {
  res.set({
    'Content-Type': 'image/gif',
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0',
  });
  return res.status(200).end(PIXEL);
}

// ---------------------------------------------------------------------------
// Public tracking pixel
// GET /api/track?tracker_uuid=&tag=&portal_url=&client_ip=&userAgent=
// `tag` is either a content's imp_code (impression) or click_code (click).
// ---------------------------------------------------------------------------
router.get('/track', async (req, res) => {
  try {
    const { tracker_uuid, tag } = req.query;
    if (!tracker_uuid || !tag) return sendPixel(res);

    const [rows] = await pool.query(
      `SELECT uuid, imp_code, click_code FROM contents
        WHERE tracker_uuid = ? AND (imp_code = ? OR click_code = ?) LIMIT 1`,
      [tracker_uuid, tag, tag]
    );
    const content = rows[0];
    if (!content) return sendPixel(res);

    const type = content.imp_code === tag ? 'imp' : 'click';

    const userAgent = req.query.userAgent || req.headers['user-agent'] || '';
    const { browser, os } = parseUserAgent(userAgent);
    const clientIp =
      req.query.client_ip ||
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.socket?.remoteAddress ||
      '';
    const portalUrl = req.query.portal_url || '';
    const geo = await resolveIpLocation(clientIp);

    await pool.query(
      `INSERT INTO tracking_events
         (tracker_uuid, content_uuid, type, browser, os, client_ip, latitude, longitude, portal_url, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tracker_uuid,
        content.uuid,
        type,
        browser,
        os,
        clientIp,
        geo.latitude,
        geo.longitude,
        portalUrl,
        userAgent,
      ]
    );

    return sendPixel(res);
  } catch (err) {
    console.error('track error:', err);
    // Always answer with a pixel so the embedding page never sees an error.
    return sendPixel(res);
  }
});

// ---------------------------------------------------------------------------
// Report data
// GET /api/dateTracking?tracker_uuid=&content=
// Returns one row per content per day with browser/os breakdowns.
// ---------------------------------------------------------------------------
router.get('/dateTracking', authRequired, async (req, res) => {
  try {
    const { tracker_uuid, content } = req.query;
    if (!tracker_uuid) {
      return res.status(400).json({ error: 'tracker_uuid is required.' });
    }

    const tracker = await findAccessibleTracker(pool, tracker_uuid, req.user);
    if (!tracker) return res.status(404).json({ error: 'Tracker not found.' });

    if (await isImportedTracker(pool, tracker_uuid)) {
      return res.json(
        await buildDateTrackingFromStats(pool, { tracker_uuid, content, ymd })
      );
    }

    const params = [tracker_uuid];
    let contentFilter = '';
    if (content) {
      contentFilter = ' AND c.name = ?';
      params.push(content);
    }

    const [events] = await pool.query(
      `SELECT c.uuid AS content_uuid, c.name AS contentname, e.type,
              e.browser, e.os, e.client_ip, e.latitude, e.longitude, e.created_at
         FROM tracking_events e
         JOIN contents c ON c.uuid = e.content_uuid
        WHERE e.tracker_uuid = ?${contentFilter}
        ORDER BY e.created_at ASC`,
      params
    );

    // Group by content + day. Unique reach = distinct viewers (impression IPs only),
    // matching YouTube/Google Ads reach (always <= impressions for that day).
    const groups = new Map();
    const periodUniqueIps = new Set();
    let totalImp = 0;
    let totalClick = 0;

    for (const ev of events) {
      const dateStr = ymd(ev.created_at);
      const key = `${ev.contentname}|${dateStr}`;
      if (!groups.has(key)) {
        groups.set(key, {
          uuid: ev.content_uuid,
          contentname: ev.contentname,
          name: ev.contentname,
          created_at: `${dateStr}T00:00:00.000Z`,
          imp: 0,
          click: 0,
          uniqueIps: new Set(),
          browserMap: {},
          osMap: {},
        });
      }
      const g = groups.get(key);
      if (ev.type === 'imp') {
        g.imp += 1;
        totalImp += 1;
        if (ev.client_ip) {
          g.uniqueIps.add(ev.client_ip);
          periodUniqueIps.add(ev.client_ip);
        }
      } else if (ev.type === 'click') {
        g.click += 1;
        totalClick += 1;
      }
      if (ev.type === 'imp') {
        if (ev.browser) {
          g.browserMap[ev.browser] = (g.browserMap[ev.browser] || 0) + 1;
        }
        if (ev.os) {
          g.osMap[ev.os] = (g.osMap[ev.os] || 0) + 1;
        }
      }
    }

    const data = Array.from(groups.values()).map((g) => ({
      uuid: g.uuid,
      contentname: g.contentname,
      name: g.name,
      created_at: g.created_at,
      imp: g.imp,
      click: g.click,
      unique: Math.min(g.uniqueIps.size, g.imp),
      browser: [g.browserMap],
      os: [g.osMap],
    }));

    return res.json({
      data,
      totals: {
        imp: totalImp,
        click: totalClick,
        unique: Math.min(periodUniqueIps.size, totalImp),
      },
    });
  } catch (err) {
    console.error('dateTracking error:', err);
    return res.status(500).json({ error: 'Failed to load report data.' });
  }
});

// ---------------------------------------------------------------------------
// Location-wise report (paginated)
// GET /api/locationTracking?tracker_uuid=&content=&page=1&limit=10
// ---------------------------------------------------------------------------
router.get('/locationTracking', authRequired, async (req, res) => {
  try {
    const { tracker_uuid, content } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));

    if (!tracker_uuid) {
      return res.status(400).json({ error: 'tracker_uuid is required.' });
    }

    const tracker = await findAccessibleTracker(pool, tracker_uuid, req.user);
    if (!tracker) return res.status(404).json({ error: 'Tracker not found.' });

    const params = [tracker_uuid];
    let contentFilter = '';
    if (content) {
      contentFilter = ' AND c.name = ?';
      params.push(content);
    }

    const [events] = await pool.query(
      `SELECT e.type, e.client_ip, e.latitude, e.longitude
         FROM tracking_events e
         JOIN contents c ON c.uuid = e.content_uuid
        WHERE e.tracker_uuid = ?${contentFilter}`,
      params
    );

    const groups = new Map();
    for (const ev of events) {
      let latitude = parseCoord(ev.latitude);
      let longitude = parseCoord(ev.longitude);

      if ((latitude == null || longitude == null) && ev.client_ip) {
        const geo = await resolveIpLocation(ev.client_ip);
        latitude = geo.latitude;
        longitude = geo.longitude;
      }

      const key = coordKey(latitude, longitude);
      if (!key) continue;

      if (!groups.has(key)) {
        groups.set(key, {
          latitude,
          longitude,
          imp: 0,
          click: 0,
          uniqueIps: new Set(),
        });
      }

      const g = groups.get(key);
      if (ev.type === 'imp') {
        g.imp += 1;
        if (ev.client_ip) g.uniqueIps.add(ev.client_ip);
      } else if (ev.type === 'click') {
        g.click += 1;
      }
    }

    const allRows = Array.from(groups.values())
      .map((g) => ({
        latitude: g.latitude,
        longitude: g.longitude,
        imp: g.imp,
        click: g.click,
        unique: Math.min(g.uniqueIps.size, g.imp),
      }))
      .sort((a, b) => b.imp - a.imp);

    const total = allRows.length;
    const offset = (page - 1) * limit;
    const data = allRows.slice(offset, offset + limit);

    return res.json({
      data,
      mapPoints: allRows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (err) {
    console.error('locationTracking error:', err);
    return res.status(500).json({ error: 'Failed to load location data.' });
  }
});

// ---------------------------------------------------------------------------
// Dashboard summary
// GET /api/dashboarddata
// Returns totals across all of the user's trackers + per-day impressions.
// ---------------------------------------------------------------------------
router.get('/dashboarddata', authRequired, async (req, res) => {
  try {
    const ownerFilter = trackerOwnerFilter(req.user, 't');

    const [statRows] = await pool.query(
      `SELECT s.stat_date, s.impressions, s.clicks
         FROM campaign_daily_stats s
         JOIN trackers t ON t.uuid = s.tracker_uuid
        WHERE 1=1${ownerFilter.sql}`,
      ownerFilter.params
    );

    const [imported] = await pool.query(
      `SELECT DISTINCT di.tracker_uuid
         FROM data_imports di
         JOIN trackers t ON t.uuid = di.tracker_uuid
        WHERE 1=1${ownerFilter.sql}`,
      ownerFilter.params
    );
    const importedUuids = imported.map((r) => r.tracker_uuid);

    let Totalimp = 0;
    let Totalclick = 0;
    const perDay = new Map();

    for (const row of statRows) {
      const imp = Number(row.impressions) || 0;
      const clk = Number(row.clicks) || 0;
      Totalimp += imp;
      Totalclick += clk;
      const dateStr =
        row.stat_date instanceof Date
          ? ymd(row.stat_date)
          : String(row.stat_date).slice(0, 10);
      perDay.set(dateStr, (perDay.get(dateStr) || 0) + imp);
    }

    const uniqueIps = new Set();
    let eventImp = 0;
    let eventClick = 0;

    if (importedUuids.length) {
      const placeholders = importedUuids.map(() => '?').join(',');
      const [events] = await pool.query(
        `SELECT e.type, e.client_ip, e.created_at
           FROM tracking_events e
           JOIN trackers t ON t.uuid = e.tracker_uuid
          WHERE 1=1${ownerFilter.sql}
            AND e.tracker_uuid NOT IN (${placeholders})
          ORDER BY e.created_at ASC`,
        [...ownerFilter.params, ...importedUuids]
      );

      for (const ev of events) {
        if (ev.type === 'imp') {
          eventImp += 1;
          if (ev.client_ip) uniqueIps.add(ev.client_ip);
          const dateStr = ymd(ev.created_at);
          perDay.set(dateStr, (perDay.get(dateStr) || 0) + 1);
        } else if (ev.type === 'click') {
          eventClick += 1;
        }
      }
    } else {
      const [events] = await pool.query(
        `SELECT e.type, e.client_ip, e.created_at
           FROM tracking_events e
           JOIN trackers t ON t.uuid = e.tracker_uuid
          WHERE 1=1${ownerFilter.sql}
          ORDER BY e.created_at ASC`,
        ownerFilter.params
      );

      for (const ev of events) {
        if (ev.type === 'imp') {
          eventImp += 1;
          if (ev.client_ip) uniqueIps.add(ev.client_ip);
          const dateStr = ymd(ev.created_at);
          perDay.set(dateStr, (perDay.get(dateStr) || 0) + 1);
        } else if (ev.type === 'click') {
          eventClick += 1;
        }
      }
    }

    Totalimp += eventImp;
    Totalclick += eventClick;

    const importedUnique = periodReachFromImpressions(
      Totalimp - eventImp,
      DEFAULT_AVG_FREQUENCY
    );
    const liveUnique = Math.min(uniqueIps.size, eventImp);
    const TotalUnique =
      importedUuids.length > 0 || statRows.length > 0
        ? importedUnique + liveUnique
        : Math.min(uniqueIps.size, eventImp);

    const data = Array.from(perDay.entries())
      .sort((a, b) => new Date(a[0]) - new Date(b[0]))
      .map(([date, imp]) => ({ date, imp }));

    return res.json({
      total: {
        Totalimp,
        Totalclick,
        TotalUnique,
      },
      data,
    });
  } catch (err) {
    console.error('dashboarddata error:', err);
    return res.status(500).json({ error: 'Failed to load dashboard data.' });
  }
});

module.exports = router;
