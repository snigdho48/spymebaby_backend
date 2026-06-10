const { tables } = require('./schema.expected');

async function syncSchema(pool) {
  for (const [tableName, definition] of Object.entries(tables)) {
    const [tableRows] = await pool.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [tableName]
    );

    if (!tableRows.length) {
      await pool.query(definition.createSql);
      console.log(`[schema] Created table: ${tableName}`);
      continue;
    }

    const [columns] = await pool.query(
      `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION`,
      [tableName]
    );

    const existing = new Map(columns.map((col) => [col.COLUMN_NAME, col]));
    const expectedNames = new Set(Object.keys(definition.columns));

    for (const [columnName, columnSql] of Object.entries(definition.columns)) {
      const current = existing.get(columnName);
      if (!current) {
        await pool.query(
          `ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${columnSql}`
        );
        console.log(`[schema] Added column: ${tableName}.${columnName}`);
        continue;
      }

    }

    const removed = definition.removedColumns || [];
    for (const legacy of removed) {
      if (existing.has(legacy)) {
        await pool.query(
          `ALTER TABLE \`${tableName}\` DROP COLUMN \`${legacy}\``
        );
        console.log(`[schema] Dropped legacy column: ${tableName}.${legacy}`);
      }
    }

    for (const columnName of existing.keys()) {
      if (expectedNames.has(columnName)) continue;
      if ((definition.removedColumns || []).includes(columnName)) continue;

      await pool.query(
        `ALTER TABLE \`${tableName}\` DROP COLUMN \`${columnName}\``
      );
      console.log(`[schema] Dropped unexpected column: ${tableName}.${columnName}`);
    }
  }
}

module.exports = { syncSchema };
