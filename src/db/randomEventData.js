const { parseUserAgent } = require('../utils/ua');

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',
];

const PORTAL_URLS = [
  'https://www.prothomalo.com/',
  'https://www.bdnews24.com/',
  'https://www.thedailystar.net/',
  'https://example.com/campaign/landing',
  'https://news.yahoo.com/world',
  'https://www.bbc.com/news',
  'https://www.reddit.com/r/worldnews/',
  'https://medium.com/topic/technology',
];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomItem(list) {
  return list[randomInt(0, list.length - 1)];
}

function randomPublicIp() {
  const firstOctets = [
    [103, 48, 50, 255],
    [27, 147, 255, 255],
    [45, 114, 255, 255],
    [8, 8, 8, 255],
    [104, 16, 255, 255],
  ];
  const base = randomItem(firstOctets);
  return `${base[0]}.${randomInt(0, base[1])}.${randomInt(0, base[2])}.${randomInt(1, base[3])}`;
}

function randomDhakaCoords() {
  return {
    latitude: 23.7 + Math.random() * 0.2,
    longitude: 90.3 + Math.random() * 0.2,
  };
}

function randomTimeOnDay(date) {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  const end = new Date(day);
  end.setHours(23, 59, 59, 999);
  const ts = day.getTime() + Math.random() * (end.getTime() - day.getTime());
  return new Date(ts);
}

function formatMySqlDateTime(value) {
  const d = new Date(value);
  const pad = (n) => `${n}`.padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function subtractDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return d;
}

function randomCreatedAtBeforeFirstDay(firstDay) {
  const created = subtractDays(firstDay, 1);
  created.setHours(randomInt(0, 23), randomInt(0, 59), randomInt(0, 59), 0);
  return created;
}

function buildIpPool(size) {
  const pool = [];
  const seen = new Set();
  while (pool.length < size) {
    const ip = randomPublicIp();
    if (seen.has(ip)) continue;
    seen.add(ip);
    pool.push(ip);
  }
  return pool;
}

/**
 * YouTube-style reach: unique viewers < impressions (frequency > 1).
 * reach = impressions / avgFrequency, capped at impression count.
 */
function estimateReach(impression, avgFrequency = 2.2) {
  if (impression <= 0) return 0;
  const frequency = avgFrequency + Math.random() * 1.2;
  return Math.max(1, Math.min(impression, Math.round(impression / frequency)));
}

function estimateReachStable(impression, avgFrequency = 2.2) {
  if (impression <= 0) return 0;
  return Math.max(1, Math.min(impression, Math.round(impression / avgFrequency)));
}

function periodReachFromImpressions(totalImpressions, avgFrequency = 2.2) {
  if (totalImpressions <= 0) return 0;
  return Math.min(
    totalImpressions,
    Math.max(1, Math.round(totalImpressions / avgFrequency))
  );
}

function buildEventRow({
  trackerUuid,
  contentUuid,
  type,
  day,
  clientIp,
  userAgent: userAgentOverride,
}) {
  const userAgent = userAgentOverride || randomItem(USER_AGENTS);
  const { browser, os } = parseUserAgent(userAgent);
  const { latitude, longitude } = randomDhakaCoords();
  const createdAt = randomTimeOnDay(day);

  return [
    trackerUuid,
    contentUuid,
    type,
    browser,
    os,
    clientIp || randomPublicIp(),
    latitude,
    longitude,
    randomItem(PORTAL_URLS),
    userAgent,
    formatMySqlDateTime(createdAt),
  ];
}

module.exports = {
  buildEventRow,
  buildIpPool,
  estimateReach,
  estimateReachStable,
  periodReachFromImpressions,
  formatMySqlDateTime,
  randomCreatedAtBeforeFirstDay,
  randomItem,
  randomTimeOnDay,
  randomPublicIp,
};
