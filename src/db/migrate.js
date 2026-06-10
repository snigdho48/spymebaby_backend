const { pool } = require('../config/db');



async function migrate() {

  const [latCol] = await pool.query(

    "SHOW COLUMNS FROM tracking_events LIKE 'latitude'"

  );

  if (!latCol.length) {

    await pool.query(`

      ALTER TABLE tracking_events

        ADD COLUMN latitude DECIMAL(10, 7) NULL AFTER client_ip,

        ADD COLUMN longitude DECIMAL(10, 7) NULL AFTER latitude

    `);

    console.log('Migration: added latitude/longitude columns to tracking_events.');

  }



  const [countryCol] = await pool.query(

    "SHOW COLUMNS FROM tracking_events LIKE 'country'"

  );

  if (countryCol.length) {

    await pool.query(`

      ALTER TABLE tracking_events

        DROP COLUMN country,

        DROP COLUMN city,

        DROP COLUMN region

    `);

    console.log('Migration: removed legacy location name columns from tracking_events.');

  }

}



module.exports = { migrate };

