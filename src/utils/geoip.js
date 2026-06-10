const cache = new Map();



function isPrivateIp(ip = '') {

  const value = String(ip).trim();

  if (!value || value === '127.0.0.1' || value === '::1') return true;

  if (value.startsWith('10.') || value.startsWith('192.168.')) return true;

  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(value)) return true;

  return false;

}



function parseCoord(value) {

  const num = parseFloat(value);

  return Number.isFinite(num) ? num : null;

}



async function resolveIpLocation(ip) {

  const clientIp = String(ip || '').trim();

  if (!clientIp || isPrivateIp(clientIp)) {

    return { latitude: null, longitude: null };

  }



  if (cache.has(clientIp)) return cache.get(clientIp);



  try {

    const response = await fetch(

      `https://get.geojs.io/v1/ip/geo/${encodeURIComponent(clientIp)}.json`

    );

    const data = await response.json();

    const location = {

      latitude: parseCoord(data.latitude),

      longitude: parseCoord(data.longitude),

    };



    cache.set(clientIp, location);

    return location;

  } catch (err) {

    console.error('geoip lookup failed:', err.message);

    return { latitude: null, longitude: null };

  }

}



function coordKey(latitude, longitude) {

  if (latitude == null || longitude == null) return null;

  return `${latitude.toFixed(4)},${longitude.toFixed(4)}`;

}



module.exports = { resolveIpLocation, coordKey, isPrivateIp, parseCoord };

