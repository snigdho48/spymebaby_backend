require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { seed } = require('./seed');

async function init() {
  const dbName = process.env.DB_NAME || 'braincount';

  // Connect without selecting a database so we can create it if needed.
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });

  console.log(`Ensuring database \`${dbName}\` exists...`);
  await connection.query(
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await connection.query(`USE \`${dbName}\``);

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  console.log('Applying schema...');
  await connection.query(schema);
  await connection.end();

  console.log('Schema applied.');
  await seed();
  console.log('Database initialization complete.');
  process.exit(0);
}

init().catch((err) => {
  console.error('DB init failed:', err.message);
  process.exit(1);
});
