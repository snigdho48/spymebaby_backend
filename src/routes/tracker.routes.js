const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

const genCode = () => crypto.randomBytes(10).toString('hex');

// Builds the nested { ...tracker, content: [...] } shape the dashboard expects.
async function getTrackersForUser(userId) {
  const [trackers] = await pool.query(
    'SELECT id, uuid, name, description, created_at FROM trackers WHERE user_id = ? ORDER BY id ASC',
    [userId]
  );
  if (!trackers.length) return [];

  const uuids = trackers.map((t) => t.uuid);
  const [contents] = await pool.query(
    `SELECT id AS _id, uuid, tracker_uuid, name, imp_code, click_code
       FROM contents WHERE tracker_uuid IN (?) ORDER BY id ASC`,
    [uuids]
  );

  const byTracker = {};
  for (const c of contents) {
    (byTracker[c.tracker_uuid] = byTracker[c.tracker_uuid] || []).push({
      _id: c._id,
      uuid: c.uuid,
      name: c.name,
      imp_code: c.imp_code,
      click_code: c.click_code,
    });
  }

  return trackers.map((t) => ({ ...t, content: byTracker[t.uuid] || [] }));
}

// GET /api/trackers
router.get('/trackers', authRequired, async (req, res) => {
  try {
    const data = await getTrackersForUser(req.user.id);
    return res.json(data);
  } catch (err) {
    console.error('trackers error:', err);
    return res.status(500).json({ error: 'Failed to load trackers.' });
  }
});

// POST /api/tracker  { name, descriptions, contents: [string] }
router.post('/tracker', authRequired, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { name, descriptions, description, contents } = req.body || {};
    const desc = descriptions ?? description ?? '';
    if (!name) return res.status(400).json({ error: 'Tracker name is required.' });

    const list = Array.isArray(contents) ? contents.filter((c) => `${c}`.trim()) : [];
    if (!list.length) {
      return res.status(400).json({ error: 'At least one content is required.' });
    }

    await conn.beginTransaction();
    const trackerUuid = uuidv4();
    await conn.query(
      'INSERT INTO trackers (uuid, user_id, name, description) VALUES (?, ?, ?, ?)',
      [trackerUuid, req.user.id, name, desc]
    );

    for (const contentName of list) {
      await conn.query(
        'INSERT INTO contents (uuid, tracker_uuid, name, imp_code, click_code) VALUES (?, ?, ?, ?, ?)',
        [uuidv4(), trackerUuid, `${contentName}`.trim(), genCode(), genCode()]
      );
    }

    await conn.commit();
    return res.status(201).json({ success: true, uuid: trackerUuid });
  } catch (err) {
    await conn.rollback();
    console.error('create tracker error:', err);
    return res.status(500).json({ error: 'Failed to create tracker.' });
  } finally {
    conn.release();
  }
});

// POST /api/updatetracker  { uuid, name, description, content: [{ name, uuid? }] }
router.post('/updatetracker', authRequired, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { uuid, name, description, content } = req.body || {};
    if (!uuid) return res.status(400).json({ error: 'Tracker uuid is required.' });
    if (!name) return res.status(400).json({ error: 'Tracker name is required.' });

    const [owned] = await conn.query(
      'SELECT id FROM trackers WHERE uuid = ? AND user_id = ?',
      [uuid, req.user.id]
    );
    if (!owned.length) return res.status(404).json({ error: 'Tracker not found.' });

    await conn.beginTransaction();
    await conn.query(
      'UPDATE trackers SET name = ?, description = ? WHERE uuid = ? AND user_id = ?',
      [name, description ?? '', uuid, req.user.id]
    );

    const items = Array.isArray(content) ? content : [];
    for (const item of items) {
      const cName = `${item?.name ?? ''}`.trim();
      if (!cName) continue;

      if (item.uuid) {
        // Existing content: rename (tag codes are preserved).
        await conn.query(
          'UPDATE contents SET name = ? WHERE uuid = ? AND tracker_uuid = ?',
          [cName, item.uuid, uuid]
        );
      } else {
        // New content added during edit: create with fresh tag codes.
        await conn.query(
          'INSERT INTO contents (uuid, tracker_uuid, name, imp_code, click_code) VALUES (?, ?, ?, ?, ?)',
          [uuidv4(), uuid, cName, genCode(), genCode()]
        );
      }
    }

    await conn.commit();
    return res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error('update tracker error:', err);
    return res.status(500).json({ error: 'Failed to update tracker.' });
  } finally {
    conn.release();
  }
});

// DELETE /api/tracker/:uuid
router.delete('/tracker/:uuid', authRequired, async (req, res) => {
  try {
    const { uuid } = req.params;
    const [owned] = await pool.query(
      'SELECT id FROM trackers WHERE uuid = ? AND user_id = ?',
      [uuid, req.user.id]
    );
    if (!owned.length) return res.status(404).json({ error: 'Tracker not found.' });

    // Remove related events first (no FK on events), then the tracker
    // (contents cascade via FK).
    await pool.query('DELETE FROM tracking_events WHERE tracker_uuid = ?', [uuid]);
    await pool.query('DELETE FROM trackers WHERE uuid = ? AND user_id = ?', [
      uuid,
      req.user.id,
    ]);

    return res.json({ success: true });
  } catch (err) {
    console.error('delete tracker error:', err);
    return res.status(500).json({ error: 'Failed to delete tracker.' });
  }
});

module.exports = router;
