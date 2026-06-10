require('dotenv').config();
const path = require('path');
const { migrate } = require('./migrate');
const { importAllFromDataDir } = require('./importExcel');
const { resetImportedData } = require('./resetImport');

function parseArgs(argv) {
  const args = { force: false, reset: false, file: '', username: '' };
  for (const arg of argv) {
    if (arg === '--force') args.force = true;
    else if (arg === '--reset') args.reset = true;
    else if (arg.startsWith('--file=')) args.file = arg.slice('--file='.length);
    else if (arg.startsWith('--username=')) args.username = arg.slice('--username='.length);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataDir =
    process.env.DATA_DIR || path.join(__dirname, '../../../data');
  const username =
    args.username || process.env.IMPORT_USERNAME || 'nusrat';
  const contentName = process.env.IMPORT_CONTENT_NAME || '';
  const batchSize = Number(process.env.IMPORT_BATCH_SIZE) || 1000;
  const maxTotalEvents = Number(process.env.IMPORT_MAX_TOTAL_EVENTS) || 0;
  const avgFrequency = Number(process.env.IMPORT_AVG_FREQUENCY) || 2.2;
  const sampleImpPerDay = Number(process.env.IMPORT_SAMPLE_IMP_PER_DAY) || 80;
  const sampleClicksPerDay =
    Number(process.env.IMPORT_SAMPLE_CLICKS_PER_DAY) || 20;

  console.log('[import] Syncing database schema...');
  await migrate();

  if (args.reset) {
    console.log(`[import] Resetting existing import data for "${username}"...`);
    await resetImportedData(username);
  }

  console.log(`[import] Reading Excel files from: ${dataDir}`);
  console.log(`[import] Owner user: ${username}`);
  if (maxTotalEvents > 0) {
    console.log(`[import] IMPORT_MAX_TOTAL_EVENTS=${maxTotalEvents} (scales Excel totals)`);
  } else {
    console.log('[import] Storing exact Excel daily totals in campaign_daily_stats');
  }

  const results = await importAllFromDataDir({
    dataDir,
    username,
    contentName: contentName || undefined,
    force: args.force || args.reset,
    file: args.file,
    batchSize,
    maxTotalEvents,
    avgFrequency,
    sampleImpPerDay,
    sampleClicksPerDay,
  });

  const imported = results.filter((r) => !r.skipped && !r.failed);
  const skipped = results.filter((r) => r.skipped);
  const failed = results.filter((r) => r.failed);
  const totalEvents = imported.reduce((sum, r) => sum + (r.inserted || 0), 0);

  console.log(
    `[import] Finished. Imported: ${imported.length}, skipped: ${skipped.length}, failed: ${failed.length}, events: ${totalEvents.toLocaleString()}`
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('[import] Failed:', err.message);
  process.exit(1);
});
