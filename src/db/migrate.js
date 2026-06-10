const { pool } = require('../config/db');
const { syncSchema } = require('./syncSchema');

async function migrate() {
  await syncSchema(pool);
}

module.exports = { migrate };
