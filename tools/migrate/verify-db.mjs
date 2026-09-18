import fs from 'node:fs';
import pg from 'pg';

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split(/\r?\n/)
  .filter(line => line && !line.trim().startsWith('#') && line.includes('='))
  .map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).trim()]; }));

for (const name of ['OLD_SUPABASE_DB_URL', 'NEW_SUPABASE_DB_URL']) {
  const value = env[name];
  if (!value || value.includes('[YOUR-PASSWORD]')) throw new Error(`${name} is missing`);
  const client = new pg.Client({ connectionString: value, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    const { rows } = await client.query('select current_database() as database, current_user as username');
    console.log(`${name}: connected database=${rows[0].database} user=${rows[0].username}`);
  } finally {
    await client.end().catch(() => {});
  }
}
