const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/db');
const { authRequired, adminRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired, adminRequired);

// GET /api/users
router.get('/users', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, uuid, username, name, role, created_at FROM users ORDER BY id ASC'
    );
    return res.json(rows);
  } catch (err) {
    console.error('list users error:', err);
    return res.status(500).json({ error: 'Failed to load users.' });
  }
});

// POST /api/users  { username, password, name?, role? }
router.post('/users', async (req, res) => {
  try {
    const { username, password, name, role } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const userRole = role === 'admin' ? 'admin' : 'user';

    const [existing] = await pool.query('SELECT id FROM users WHERE username = ?', [
      username,
    ]);
    if (existing.length) {
      return res.status(409).json({ error: 'Username already exists.' });
    }

    const hash = await bcrypt.hash(password, 10);
    const uuid = uuidv4();
    await pool.query(
      'INSERT INTO users (uuid, username, password, name, role, image) VALUES (?, ?, ?, ?, ?, ?)',
      [
        uuid,
        username,
        hash,
        name || username,
        userRole,
        'https://via.placeholder.com/150',
      ]
    );

    return res.status(201).json({ success: true, message: 'User created.' });
  } catch (err) {
    console.error('create user error:', err);
    return res.status(500).json({ error: 'Failed to create user.' });
  }
});

module.exports = router;
