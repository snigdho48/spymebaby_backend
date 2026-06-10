const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/db');
const {
  buildEventRow,
  buildIpPool,
  estimateReachStable,
  formatMySqlDateTime,
  randomCreatedAtBeforeFirstDay,
  randomItem,
} = require('./randomEventData');

const genCode = () => crypto.randomBytes(10).toString('hex');

function parseExcelDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return new Date(parsed.y, parsed.m - 1, parsed.d);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isEmptyCell(value) {
  return value === null || value === undefined || value === '';
}

function normalizeRow(row) {
  const normalized = {};
  for (const [key, value] of Object.entries(row)) {
    const lower = String(key).trim().toLowerCase();
    if (lower.startsWith('__empty')) {
      if (isEmptyCell(normalized.date) && !isEmptyCell(value)) {
        normalized.date = value;
      }
      continue;
    }
    if (isEmptyCell(value)) continue;
    if (!isEmptyCell(normalized[lower])) continue;
    normalized[lower] = value;
  }
  return normalized;
}

function parseCount(value) {
  if (value === null || value === undefined || value === '') return 0;
  const cleaned = String(value).replace(/,/g, '').trim();
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

function extractCounts(row) {
  const impression = parseCount(row.impression ?? row.impressions);
  const clicks = parseCount(row.clicks ?? row.click);
  return { impression, clicks };
}

function parseWorkbookRows(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const days = [];
  for (const raw of rawRows) {
    const row = normalizeRow(raw);
    const day = parseExcelDate(row.date);
    if (!day) continue;

    const { impression, clicks } = extractCounts(row);
    if (impression === 0 && clicks === 0) continue;

    days.push({ day, impression, clicks });
  }

  days.sort((a, b) => a.day - b.day);
  return days;
}

function distributeBudget(totalUnits, weights) {
  if (totalUnits <= 0 || !weights.length) return weights.map(() => 0);

  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  if (weightSum <= 0) {
    const even = Math.floor(totalUnits / weights.length);
    return weights.map((_, i) =>
      i === weights.length - 1 ? totalUnits - even * (weights.length - 1) : even
    );
  }

  const raw = weights.map((w) => (totalUnits * w) / weightSum);
  const allocated = raw.map((v) => Math.floor(v));
  let remainder = totalUnits - allocated.reduce((sum, v) => sum + v, 0);

  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);

  for (const { i } of order) {
    if (remainder <= 0) break;
    allocated[i] += 1;
    remainder -= 1;
  }

  return allocated;
}

function scaleDayCounts(days, maxTotalEvents) {
  const totalImp = days.reduce((sum, d) => sum + d.impression, 0);
  const totalClicks = days.reduce((sum, d) => sum + d.clicks, 0);
  const total = totalImp + totalClicks;
  if (!maxTotalEvents || total <= maxTotalEvents) return days;

  console.warn(
    `[import] Scaling ${total.toLocaleString()} events down to ~${maxTotalEvents.toLocaleString()} (IMPORT_MAX_TOTAL_EVENTS). Impressions and clicks are scaled proportionally.`
  );

  let impBudget = Math.round(maxTotalEvents * (totalImp / total));
  let clickBudget = maxTotalEvents - impBudget;

  if (totalImp > 0 && impBudget === 0) impBudget = 1;
  if (totalClicks > 0 && clickBudget === 0) clickBudget = 1;
  if (impBudget + clickBudget > maxTotalEvents) {
    if (impBudget >= clickBudget) impBudget -= 1;
    else clickBudget -= 1;
  }

  const impByDay = distributeBudget(
    impBudget,
    days.map((d) => d.impression)
  );
  const clickByDay = distributeBudget(
    clickBudget,
    days.map((d) => d.clicks)
  );

  return days.map((entry, index) => ({
    ...entry,
    impression: impByDay[index],
    clicks: clickByDay[index],
  }));
}

async function insertEventBatch(conn, batch) {
  if (!batch.length) return;

  const placeholders = batch.map(() => '(?,?,?,?,?,?,?,?,?,?,?)').join(',');
  const values = batch.flat();
  await conn.query(
    `INSERT INTO tracking_events
       (tracker_uuid, content_uuid, type, browser, os, client_ip, latitude, longitude, portal_url, user_agent, created_at)
     VALUES ${placeholders}`,
    values
  );
}

function formatStatDate(day) {
  const d = new Date(day);
  const pad = (n) => `${n}`.padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function upsertDailyStat(conn, {
  trackerUuid,
  contentUuid,
  day,
  impression,
  clicks,
  avgFrequency,
}) {
  const uniqueReach = estimateReachStable(impression, avgFrequency);
  await conn.query(
    `INSERT INTO campaign_daily_stats
       (tracker_uuid, content_uuid, stat_date, impressions, clicks, unique_reach)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       impressions = VALUES(impressions),
       clicks = VALUES(clicks),
       unique_reach = VALUES(unique_reach)`,
    [
      trackerUuid,
      contentUuid,
      formatStatDate(day.day),
      impression,
      clicks,
      uniqueReach,
    ]
  );
}

async function insertSampleEventsForDay(conn, {
  trackerUuid,
  contentUuid,
  day,
  impression,
  clicks,
  batchSize,
  avgFrequency,
  sampleImpPerDay,
  sampleClicksPerDay,
}) {
  const sampleImp = Math.min(impression, sampleImpPerDay);
  const sampleClicks = Math.min(clicks, sampleClicksPerDay);
  if (sampleImp === 0 && sampleClicks === 0) return 0;

  const reach = estimateReachStable(
    Math.max(impression, sampleImp),
    avgFrequency
  );
  const viewerPool = reach > 0 ? buildIpPool(Math.min(reach, sampleImp)) : [];
  const clickPool =
    sampleClicks > 0
      ? viewerPool.length
        ? viewerPool
        : buildIpPool(Math.min(sampleClicks, 20))
      : [];

  let inserted = 0;

  const insertType = async (type, count, ipPool) => {
    let remaining = count;
    while (remaining > 0) {
      const chunk = Math.min(batchSize, remaining);
      const batch = [];
      for (let i = 0; i < chunk; i += 1) {
        batch.push(
          buildEventRow({
            trackerUuid,
            contentUuid,
            type,
            day: day.day,
            clientIp: ipPool.length > 0 ? randomItem(ipPool) : undefined,
          })
        );
      }
      await insertEventBatch(conn, batch);
      inserted += batch.length;
      remaining -= chunk;
    }
  };

  await insertType('imp', sampleImp, viewerPool);
  await insertType('click', sampleClicks, clickPool);
  return inserted;
}

async function getUserId(username) {
  const [rows] = await pool.query('SELECT id FROM users WHERE username = ?', [
    username,
  ]);
  return rows[0]?.id || null;
}

async function ensureTrackerAndContent(conn, {
  userId,
  trackerName,
  contentName,
  createdAt,
}) {
  const [existingTrackers] = await conn.query(
    'SELECT uuid FROM trackers WHERE user_id = ? AND name = ? LIMIT 1',
    [userId, trackerName]
  );

  let trackerUuid;
  if (existingTrackers.length) {
    trackerUuid = existingTrackers[0].uuid;
    await conn.query(
      'UPDATE trackers SET created_at = ? WHERE uuid = ?',
      [formatMySqlDateTime(createdAt), trackerUuid]
    );
  } else {
    trackerUuid = uuidv4();
    await conn.query(
      'INSERT INTO trackers (uuid, user_id, name, description, created_at) VALUES (?, ?, ?, ?, ?)',
      [
        trackerUuid,
        userId,
        trackerName,
        `Imported from Excel on ${new Date().toISOString().slice(0, 10)}`,
        formatMySqlDateTime(createdAt),
      ]
    );
  }

  const [existingContents] = await conn.query(
    'SELECT uuid, name FROM contents WHERE tracker_uuid = ? ORDER BY created_at ASC',
    [trackerUuid]
  );

  const byName = existingContents.find((row) => row.name === contentName);
  let contentUuid;

  if (byName) {
    contentUuid = byName.uuid;
    await conn.query(
      'UPDATE contents SET created_at = ? WHERE uuid = ?',
      [formatMySqlDateTime(createdAt), contentUuid]
    );
  } else if (existingContents.length === 1) {
    contentUuid = existingContents[0].uuid;
    await conn.query(
      'UPDATE contents SET name = ?, created_at = ? WHERE uuid = ?',
      [contentName, formatMySqlDateTime(createdAt), contentUuid]
    );
  } else {
    contentUuid = uuidv4();
    await conn.query(
      'INSERT INTO contents (uuid, tracker_uuid, name, imp_code, click_code, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [
        contentUuid,
        trackerUuid,
        contentName,
        genCode(),
        genCode(),
        formatMySqlDateTime(createdAt),
      ]
    );
  }

  return { trackerUuid, contentUuid };
}

async function importExcelFile(filePath, options = {}) {
  const filename = path.basename(filePath);
  const trackerName = path.basename(filePath, path.extname(filePath));
  const contentName = options.contentName || trackerName;
  const userId = options.userId;
  const force = Boolean(options.force);
  const batchSize = options.batchSize || 1000;
  const maxTotalEvents = options.maxTotalEvents || 0;
  const avgFrequency = Number(options.avgFrequency) || 2.2;
  const sampleImpPerDay = Number(options.sampleImpPerDay) || 80;
  const sampleClicksPerDay = Number(options.sampleClicksPerDay) || 20;

  const days = parseWorkbookRows(filePath);
  if (!days.length) {
    throw new Error(`No valid dated rows found in ${filename}`);
  }

  const scaledDays = scaleDayCounts(days, maxTotalEvents);
  const plannedImpressions = scaledDays.reduce((sum, d) => sum + d.impression, 0);
  const plannedClicks = scaledDays.reduce((sum, d) => sum + d.clicks, 0);

  const [importRows] = await pool.query(
    'SELECT id FROM data_imports WHERE filename = ?',
    [filename]
  );
  if (importRows.length && !force) {
    console.log(`[import] Skipping ${filename} (already imported). Use --force to re-import.`);
    return { skipped: true, filename, plannedImpressions: 0, plannedClicks: 0, inserted: 0 };
  }

  const createdAt = randomCreatedAtBeforeFirstDay(scaledDays[0].day);
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const { trackerUuid, contentUuid } = await ensureTrackerAndContent(conn, {
      userId,
      trackerName,
      contentName,
      createdAt,
    });

    if (force) {
      await conn.query('DELETE FROM tracking_events WHERE tracker_uuid = ?', [
        trackerUuid,
      ]);
      await conn.query(
        'DELETE FROM campaign_daily_stats WHERE tracker_uuid = ?',
        [trackerUuid]
      );
      await conn.query('DELETE FROM data_imports WHERE filename = ?', [filename]);
    }

    let sampleEvents = 0;

    for (const day of scaledDays) {
      const dayLabel = formatStatDate(day.day);
      const uniqueReach = estimateReachStable(day.impression, avgFrequency);
      console.log(
        `[import] ${filename} | ${dayLabel} | imp=${day.impression.toLocaleString()} click=${day.clicks.toLocaleString()} reach=${uniqueReach.toLocaleString()}`
      );

      await upsertDailyStat(conn, {
        trackerUuid,
        contentUuid,
        day,
        impression: day.impression,
        clicks: day.clicks,
        avgFrequency,
      });

      sampleEvents += await insertSampleEventsForDay(conn, {
        trackerUuid,
        contentUuid,
        day,
        impression: day.impression,
        clicks: day.clicks,
        batchSize,
        avgFrequency,
        sampleImpPerDay,
        sampleClicksPerDay,
      });
    }

    await conn.query(
      `INSERT INTO data_imports (filename, tracker_uuid, event_count)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE tracker_uuid = VALUES(tracker_uuid), event_count = VALUES(event_count), imported_at = CURRENT_TIMESTAMP`,
      [filename, trackerUuid, plannedImpressions + plannedClicks]
    );

    await conn.commit();
    console.log(
      `[import] Done ${filename}: ${plannedImpressions.toLocaleString()} impressions, ${plannedClicks.toLocaleString()} clicks (${sampleEvents.toLocaleString()} sample events for map/browser).`
    );
    return {
      skipped: false,
      filename,
      trackerUuid,
      plannedImpressions,
      plannedClicks,
      inserted: sampleEvents,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function importAllFromDataDir(options = {}) {
  const dataDir = options.dataDir;
  if (!fs.existsSync(dataDir)) {
    throw new Error(`Data directory not found: ${dataDir}`);
  }

  const username = options.username || 'snigdho';
  const userId = await getUserId(username);
  if (!userId) {
    throw new Error(
      `User "${username}" not found. Create the user first or set IMPORT_USERNAME in .env`
    );
  }

  const files = fs
    .readdirSync(dataDir)
    .filter((name) => /\.xlsx?$/i.test(name))
    .map((name) => path.join(dataDir, name));

  if (!files.length) {
    console.log(`[import] No Excel files found in ${dataDir}`);
    return [];
  }

  const results = [];
  for (const filePath of files) {
    if (options.file && path.basename(filePath) !== options.file) continue;
    try {
      results.push(
        await importExcelFile(filePath, {
          ...options,
          userId,
        })
      );
    } catch (err) {
      console.error(`[import] Failed ${path.basename(filePath)}: ${err.message}`);
      results.push({
        skipped: false,
        failed: true,
        filename: path.basename(filePath),
        error: err.message,
      });
    }
  }

  return results;
}

module.exports = { importAllFromDataDir, importExcelFile, parseWorkbookRows };
