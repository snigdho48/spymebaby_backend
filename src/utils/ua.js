// Minimal, dependency-free User-Agent parser.
// Returns browser/os names that match what the dashboard UI looks for
// (Chrome / Firefox / Safari / Edge / Opera and Windows / Mac / iOS / Android).
// Order of checks matters because many UAs embed multiple tokens
// (e.g. Edge UA contains "Chrome" and "Safari").
function parseUserAgent(uaRaw = '') {
  const ua = String(uaRaw || '');

  let browser = 'Other';
  if (/Edg|Edge/i.test(ua)) browser = 'Edge';
  else if (/OPR|Opera/i.test(ua)) browser = 'Opera';
  else if (/Firefox|FxiOS/i.test(ua)) browser = 'Firefox';
  else if (/Chrome|CriOS|Chromium/i.test(ua)) browser = 'Chrome';
  else if (/Safari/i.test(ua)) browser = 'Safari';

  let os = 'Other';
  if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod|iOS|CriOS|FxiOS/i.test(ua)) os = 'iOS';
  else if (/Mac OS X|Macintosh|MacIntel/i.test(ua)) os = 'Mac';
  else if (/Linux/i.test(ua)) os = 'Linux';

  return { browser, os };
}

module.exports = { parseUserAgent };
