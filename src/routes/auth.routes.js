const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/db');
const { signToken, authRequired } = require('../middleware/auth');

const router = express.Router();

// POST /api/register  { username, password }
router.post('/register', async (req, res) => {
  try {
    const { username, password, name } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

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
      [uuid, username, hash, name || username, 'user', 'https://via.placeholder.com/150']
    );

    return res.status(201).json({ success: true, message: 'Registration successful.' });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ error: 'Registration failed.' });
  }
});

// POST /api/login  { username, password }
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [
      username,
    ]);
    const user = rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const token = signToken(user);
    // Flat shape consumed directly by the frontend (response.data.token, etc.)
    return res.json({
      token,
      username: user.username,
      role: user.role,
      name: user.name,
      image: user.image,
    });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: 'Login failed.' });
  }
});

// POST /api/logout  (JWT is stateless; this is a no-op acknowledged endpoint)
router.post('/logout', authRequired, (req, res) => {
  return res.json({ success: true, message: 'Logged out.' });
});

module.exports = router;
