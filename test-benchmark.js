import { performance } from 'perf_hooks';
import db, { closeDb } from './src/server/db.js';
import { seedIfEmpty } from './src/server/rulesManager.js';

async function runBenchmark() {
  // Clear rules table
  await db.execute('DELETE FROM rules');

  // create dummy rules
  const startTime = performance.now();
  await seedIfEmpty();
  const endTime = performance.now();

  console.log(`Time to seed rules: ${endTime - startTime} ms`);
  closeDb();
}

runBenchmark().catch(console.error);
