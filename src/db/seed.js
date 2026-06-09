require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/db');

// Seeds a default admin user that matches the credentials the frontend
// currently uses (snigdho / azsx1234) so login works out of the box.
async function seed() {
  const username = process.env.SEED_USERNAME || 'snigdho';
  const password = process.env.SEED_PASSWORD || 'azsx1234';
  const name = process.env.SEED_NAME || 'Snigdho';

  const [rows] = await pool.query('SELECT id FROM users WHERE username = ?', [
    username,
  ]);
  if (rows.length) {
    console.log(`Seed user "${username}" already exists, skipping.`);
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    'INSERT INTO users (uuid, username, password, name, role, image) VALUES (?, ?, ?, ?, ?, ?)',
    [
      uuidv4(),
      username,
      hash,
      name,
      'admin',
      'https://via.placeholder.com/150',
    ]
  );
  console.log(`Seeded admin user "${username}".`);
}

// Allow running standalone: `npm run seed`
if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed failed:', err.message);
      process.exit(1);
    });
}

module.exports = { seed };
