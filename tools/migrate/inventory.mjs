import fs from 'node:fs';
import { Client } from 'pg';

function loadEnv() {
  const out = {};
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([^#=]+)=(.*)$/);
    if (m) out[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}
const env = loadEnv();
const tables = ['profiles','locations','vendors','card_sets','products','product_costs','product_barcodes','price_history','stock_moves','sales','sale_items','sale_item_costs','members','point_moves','bank_lines','recon_matches','vendor_settlements','audit_log','settings','login_events','user_pins'];
const connect = (url) => new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
async function counts(client) {
  const result = {};
  for (const table of tables) {
    const { rows } = await client.query(`select count(*)::int as n from public."${table}"`);
    result[table] = rows[0].n;
  }
  return result;
}
const oldDb = connect(env.OLD_SUPABASE_DB_URL), newDb = connect(env.NEW_SUPABASE_DB_URL);
try {
  await Promise.all([oldDb.connect(), newDb.connect()]);
  const [oldCounts, newCounts] = await Promise.all([counts(oldDb), counts(newDb)]);
  console.log(JSON.stringify({ old: oldCounts, new: newCounts }, null, 2));
  const { rows: oldAuth } = await oldDb.query('select count(*)::int as n from auth.users');
  const { rows: newAuth } = await newDb.query('select count(*)::int as n from auth.users');
  console.log(`auth.users old=${oldAuth[0].n} new=${newAuth[0].n}`);
} finally { await Promise.allSettled([oldDb.end(), newDb.end()]); }
