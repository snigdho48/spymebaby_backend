function isAdmin(user) {
  return user?.role === 'admin';
}

async function findAccessibleTracker(pool, trackerUuid, user) {
  if (isAdmin(user)) {
    const [rows] = await pool.query(
      'SELECT id, uuid, user_id FROM trackers WHERE uuid = ? LIMIT 1',
      [trackerUuid]
    );
    return rows[0] || null;
  }

  const [rows] = await pool.query(
    'SELECT id, uuid, user_id FROM trackers WHERE uuid = ? AND user_id = ? LIMIT 1',
    [trackerUuid, user.id]
  );
  return rows[0] || null;
}

function trackerOwnerFilter(user, alias = 't') {
  if (isAdmin(user)) {
    return { sql: '', params: [] };
  }
  return { sql: ` AND ${alias}.user_id = ?`, params: [user.id] };
}

module.exports = {
  isAdmin,
  findAccessibleTracker,
  trackerOwnerFilter,
};
