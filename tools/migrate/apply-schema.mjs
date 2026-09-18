import fs from 'node:fs';
import pg from 'pg';

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split(/\r?\n/)
  .filter(line => line && !line.trim().startsWith('#') && line.includes('='))
  .map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).trim()]; }));
const client = new pg.Client({ connectionString: env.NEW_SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
const files = ['db/001_schema.sql', 'db/002_users_and_summary.sql', 'db/003_security.sql'];
try {
  await client.connect();
  await client.query('begin');
  for (const file of files) {
    console.log(`Applying ${file}`);
    await client.query(fs.readFileSync(file, 'utf8'));
  }
  if (env.MIGRATION_DRY_RUN === 'true') {
    await client.query('rollback');
    console.log('Schema validated successfully (dry run; no changes committed).');
  } else {
    await client.query('commit');
    console.log('Schema committed to the new Supabase project.');
  }
} catch (error) {
  await client.query('rollback').catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
