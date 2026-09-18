/* การซิงก์กับฐานข้อมูลกลาง
 *
 * หลักคิด : เครื่องขายทำงานกับข้อมูลในเครื่องเสมอ การซิงก์เป็นงานเบื้องหลัง
 * ไม่มีหน้าจอไหนรอผลจากเซิร์ฟเวอร์ก่อนถึงจะขายได้ ดังนั้นเน็ตหลุดก็ขายต่อได้
 *
 * ขาออก (push) : บิลและการเดินของที่ค้างในคิว ส่งขึ้นทีละรายการตามลำดับ
 *   ส่งด้วยวิธี "ถ้ามีอยู่แล้วให้ข้าม" ทุกครั้ง ส่งซ้ำกี่รอบก็ไม่เกิดบิลซ้ำ
 * ขาเข้า (pull) : สินค้า ราคา ผู้ฝากขาย สมาชิก จุดขาย ดึงมาเก็บไว้ในเครื่อง
 *   เพื่อให้ตอนออฟไลน์ยังค้นหาสินค้าและคิดราคาได้
 */
import { CONFIG, hasBackend } from '../config.js';
import { db, metaGet, metaSet, nextBillNo } from './store.js';

let sb = null, user = null, profile = null, busy = false, timer = null;

export const client = () => sb;
export const currentUser = () => user;
export const currentProfile = () => profile;
export const canSeeCost = () => !!profile && (profile.role === 'supervisor' || profile.role === 'owner');
export const isOwner = () => !!profile && profile.role === 'owner';

/* บันทึกเหตุการณ์การเข้าใช้งาน  ลงเครื่องเสมอ และส่งขึ้นเซิร์ฟเวอร์ถ้าต่ออยู่
 * ห้ามให้การบันทึกล้มเหลวไปขวางการทำงานของผู้ใช้เด็ดขาด จึงกลืน error ทั้งหมด */
export async function logEvent(kind, detail) {
  const at = new Date().toISOString();
  let device_id = null, device_name = null;
  try {
    const { deviceId, currentLocation } = await import('./store.js');
    device_id = await deviceId();
    device_name = (await currentLocation() || {}).name || null;
  } catch (e) {}
  try { await db.events.add({ kind, at, device_id, device_name, detail: detail || null }); } catch (e) {}
  if (sb && user) {
    try {
      await sb.from('login_events').insert({
        user_id: user.id, kind, device_id, device_name, at, detail: detail || null });
    } catch (e) {}
  }
}

/* เรียกฟังก์ชันฝั่งเซิร์ฟเวอร์ (Edge Function) พร้อมโทเคนล็อกอินของผู้ใช้ปัจจุบัน */
export async function invoke(name, body) {
  if (!sb) throw new Error('ยังไม่ได้ต่อฐานข้อมูลกลาง');
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch (e) {}
    throw new Error(msg);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}

/* อ่าน/เขียนค่าตั้งค่าบนเซิร์ฟเวอร์ (ใช้กับโทเคนแจ้งเตือน ที่ต้องไม่อยู่ในเครื่องพนักงาน) */
export async function serverSetting(key, value) {
  if (!sb || !user) return null;
  if (value === undefined) {
    const { data, error } = await sb.from('settings').select('value').eq('key', key).maybeSingle();
    if (error) throw new Error('อ่านค่าตั้งค่าไม่ได้: ' + error.message);
    return data ? data.value : null;
  }
  const { error } = await sb.from('settings').upsert({ key, value, updated_by: user.id }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
  return value;
}

/* ------------------------------------------- ยืนยันสองชั้น (TOTP/MFA) ---- */
/* ใช้กับบัญชีเจ้าของร้านเป็นหลัก เพราะเป็นบัญชีเดียวที่เห็นทุกอย่างและสร้างบัญชีคนอื่นได้
 * ส่วนพนักงานไม่ควรบังคับ จะกลายเป็นภาระตอนเปิดร้าน */
export async function mfaFactors() {
  if (!sb || !user) return [];
  const { data, error } = await sb.auth.mfa.listFactors();
  if (error) return [];
  return (data.totp || []).filter(f => f.status === 'verified');
}

export async function mfaEnroll() {
  const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Siatoy POS' });
  if (error) throw new Error(error.message);
  return data;                       // { id, totp: { qr_code, secret, uri } }
}

export async function mfaConfirm(factorId, code) {
  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code: String(code).trim() });
  if (error) throw new Error(/invalid/i.test(error.message) ? 'รหัสไม่ถูกต้อง ลองใหม่อีกครั้ง' : error.message);
  return true;
}

export async function mfaRemove(factorId) {
  const { error } = await sb.auth.mfa.unenroll({ factorId });
  if (error) throw new Error(error.message);
}

/* หลังใส่รหัสผ่านถูกแล้ว ถ้าบัญชีเปิดยืนยันสองชั้นไว้ ต้องใส่รหัสจากแอปอีกชั้น */
export async function mfaPending() {
  if (!sb) return null;
  try {
    const { data, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !data) return null;
    if (data.nextLevel !== 'aal2' || data.currentLevel === 'aal2') return null;
    const { data: f } = await sb.auth.mfa.listFactors();
    const factor = (f && f.totp || []).find(x => x.status === 'verified');
    return factor ? factor.id : null;
  } catch (e) { return null; }
}

export async function mfaSubmit(factorId, code) {
  const { data: ch, error: cErr } = await sb.auth.mfa.challenge({ factorId });
  if (cErr) throw new Error(cErr.message);
  const { error } = await sb.auth.mfa.verify({ factorId, challengeId: ch.id, code: String(code).trim() });
  if (error) throw new Error(/invalid/i.test(error.message) ? 'รหัสไม่ถูกต้อง ลองใหม่อีกครั้ง' : error.message);
  const { data: sess } = await sb.auth.getSession();
  if (sess && sess.session) await adoptSession(sess.session);
  return true;
}

/* ------------------------------------------------------------ เริ่มต้น ---- */
export async function initClient() {
  if (!hasBackend()) return null;
  if (sb) return sb;
  const lib = globalThis.supabase;
  if (!lib || !lib.createClient) throw new Error('ไม่พบไลบรารีของฐานข้อมูล');
  sb = lib.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'siatoy-auth' },
  });
  const { data } = await sb.auth.getSession();
  if (data && data.session) await adoptSession(data.session);
  sb.auth.onAuthStateChange((_e, s) => { if (s) adoptSession(s); else { user = null; profile = null; } });
  return sb;
}

async function adoptSession(session) {
  user = session.user;
  const { data } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  profile = data || null;
}

export async function signIn(email, password) {
  await initClient();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(mapAuthError(error.message));
  await adoptSession(data.session);
  return profile;
}
export async function signOut() {
  let error = null;
  if (sb) {
    try {
      const result = await sb.auth.signOut({ scope: 'local' });
      error = result && result.error;
    } catch (e) { error = e; }
  }
  // ล้างสถานะในหน่วยความจำและ storage เองด้วย เพื่อไม่ให้หน้าเดิมกลับเข้า session เก่า
  user = null;
  profile = null;
  try { localStorage.removeItem('siatoy-auth'); } catch (e) {}
  try { sessionStorage.removeItem('siatoy-auth'); } catch (e) {}
  if (error) throw new Error(error.message || String(error));
}

function mapAuthError(m) {
  const s = String(m || '');
  if (/Invalid login credentials/i.test(s)) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
  if (/Email not confirmed/i.test(s))       return 'อีเมลนี้ยังไม่ได้ยืนยัน';
  if (/network|fetch/i.test(s))             return 'ต่อเซิร์ฟเวอร์ไม่ได้ · ตรวจอินเทอร์เน็ต';
  return s;
}

/* -------------------------------------------------------------- ขาเข้า ---- */
const REF_TABLES = [
  ['locations',        'locations'],
  ['vendors',          'vendors'],
  ['card_sets',        'card_sets'],
  ['products',         'products'],
  ['product_barcodes', 'barcodes'],
  ['members',          'members'],
];

export async function pull() {
  if (!sb || !user) return { ok: false, reason: 'ยังไม่ได้ล็อกอิน' };
  const counts = {};
  for (const [remote, local] of REF_TABLES) {
    const { data, error } = await sb.from(remote).select('*');
    if (error) return { ok: false, reason: error.message };
    const rows = remote === 'product_barcodes'
      ? data.map(r => ({ barcode: r.barcode, product_id: r.product_id, kind: r.kind }))
      : data;
    await db.table(local).clear();
    if (rows.length) await db.table(local).bulkPut(rows);
    counts[local] = rows.length;
  }
  // ต้นทุนดึงได้เฉพาะสิทธิ์ที่อ่านได้ พนักงานจะได้ [] กลับมาเอง ไม่ต้องเช็กฝั่งนี้
  const { data: costs } = await sb.from('product_costs').select('product_id,cost');
  if (costs && costs.length) {
    for (const c of costs) await db.products.update(c.product_id, { cost: Number(c.cost) });
    counts.costs = costs.length;
  }
  // สมุดเดินของ ดึงมาเท่าที่จำเป็นเพื่อคำนวณยอดคงเหลือ
  const { data: moves, error: mErr } = await sb.from('stock_moves')
    .select('id,product_id,location_id,qty,move_type,ref_id,ref_no,reason,created_at')
    .order('created_at', { ascending: true });
  if (mErr) return { ok: false, reason: mErr.message };
  await db.stock_moves.clear();
  if (moves.length) await db.stock_moves.bulkPut(moves);
  counts.stock_moves = moves.length;

  // บิลและรายการสินค้าในบิลต้องดึงมาด้วย ไม่เช่นนั้นเครื่องใหม่จะเห็นสต๊อก
  // แต่หน้าบิลขายและรายงานว่างเปล่า แม้ข้อมูลจะอยู่บนเซิร์ฟเวอร์แล้ว
  const { data: sales, error: sErr } = await sb.from('sales').select('*')
    .order('client_created_at', { ascending: true });
  if (sErr) return { ok: false, reason: sErr.message };
  const { data: saleItems, error: iErr } = await sb.from('sale_items').select('*');
  if (iErr) return { ok: false, reason: iErr.message };
  const { data: itemCosts } = await sb.from('sale_item_costs').select('sale_item_id,unit_cost');
  const costsByItem = new Map((itemCosts || []).map(c => [c.sale_item_id, Number(c.unit_cost)]));
  const localItems = (saleItems || []).map(it => ({
    ...it,
    ...(costsByItem.has(it.id) ? { unit_cost: costsByItem.get(it.id) } : {}),
  }));
  await db.sales.clear();
  await db.sale_items.clear();
  if (sales && sales.length) await db.sales.bulkPut(sales);
  if (localItems.length) await db.sale_items.bulkPut(localItems);
  counts.sales = (sales || []).length;
  counts.sale_items = localItems.length;

  await metaSet('lastPull', new Date().toISOString());
  return { ok: true, counts };
}

/* แก้ข้อมูลตั้งต้นที่ถูกสร้างซ้ำจากคิวรุ่นเก่า ใช้ครั้งเดียวกับสินค้า 8859001 */
export async function normalizeInitialStock(barcode, qty) {
  if (!sb || !user) return false;
  const { data: product } = await sb.from('products').select('id,sku').eq('sku', barcode).maybeSingle();
  if (!product) return false;
  const { data: moves, error } = await sb.from('stock_moves').select('id,location_id,move_type,qty,ref_no')
    .eq('product_id', product.id);
  if (error || !moves || moves.length < 2) return false;
  if (moves.some(m => m.ref_no === 'ยอดตั้งต้น (รีเซ็ตเป็น 260)')) return false;
  const target = Number(qty);
  const total = moves.reduce((n, m) => n + Number(m.qty || 0), 0);
  if (total === target) return false;
  const locationId = moves[0].location_id;
  const del = await sb.from('stock_moves').delete().eq('product_id', product.id);
  if (del.error) throw new Error(del.error.message);
  const ins = await sb.from('stock_moves').insert({
    id: crypto.randomUUID(), product_id: product.id, location_id: locationId,
    qty: target, move_type: 'opening', ref_no: 'ยอดตั้งต้น (รีเซ็ตเป็น 260)',
    created_at: new Date().toISOString(), created_by: user.id,
  });
  if (ins.error) throw new Error(ins.error.message);
  return true;
}

/* -------------------------------------------------------------- ขาออก ---- */
/* ตัดฟิลด์ที่มีเฉพาะฝั่งเครื่องออก ไม่งั้น PostgREST จะปฏิเสธทั้งก้อน */
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));

const SALE_COLS = ['id','bill_no','location_id','status','payment','subtotal','item_discount',
  'bill_discount','discount_reason','card_fee','vat_amount','total','member_id','slip_path',
  'note','device_id','client_created_at'];
const ITEM_COLS = ['id','sale_id','product_id','sku','product_name','vendor_id','qty',
  'unit_price','discount','discount_reason','vat_rate','line_total'];
const MOVE_COLS = ['id','product_id','location_id','qty','move_type','ref_id','ref_no',
  'reason','note','device_id','created_at'];
const PRODUCT_COLS = ['id','sku','name','category','set_id','vendor_id','price','vat_rate',
  'is_single','is_active','icon'];
const isUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ''));

async function pushEntry(e) {
  const by = user ? user.id : null;
  const ins = (table, rows) => sb.from(table).upsert(rows, { onConflict: 'id', ignoreDuplicates: true });

  if (e.kind === 'product') {
    const { product, barcode, move, cost } = e.payload;
    // รุ่นเก่าเคยสร้าง id เป็น prd-8859001 ซึ่ง Supabase รับไม่ได้เพราะคอลัมน์เป็น UUID
    // แปลงรายการค้างครั้งเดียวก่อนส่ง เพื่อไม่ให้คิวเดิมค้างตลอด
    if (!isUuid(product.id)) {
      const oldId = product.id, newId = crypto.randomUUID();
      product.id = newId; barcode.product_id = newId;
      if (move) move.product_id = newId;
      const old = await db.products.get(oldId);
      if (old) { await db.products.put({ ...old, id: newId }); await db.products.delete(oldId); }
      await db.barcodes.where('product_id').equals(oldId).modify({ product_id: newId });
      await db.stock_moves.where('product_id').equals(oldId).modify({ product_id: newId });
      const pending = await db.outbox.toArray();
      for (const item of pending) {
        const raw = JSON.stringify(item.payload || {}).replaceAll(oldId, newId);
        await db.outbox.update(item.seq, { payload: JSON.parse(raw) });
      }
    }
    let r = await ins('products', [pick(product, PRODUCT_COLS)]);
    if (r.error) return r.error;
    r = await sb.from('product_barcodes').upsert([barcode], { onConflict: 'barcode', ignoreDuplicates: true });
    if (r.error) return r.error;
    if (move) {
      r = await ins('stock_moves', [{ ...pick(move, MOVE_COLS), created_by: by }]);
      if (r.error) return r.error;
    }
    if (cost != null) {
      r = await sb.from('product_costs').upsert([{ product_id: product.id, cost }],
        { onConflict: 'product_id', ignoreDuplicates: true });
      if (r.error) return r.error;
    }
    return null;
  }

  if (e.kind === 'product_update') {
    const { id, changes, cost } = e.payload;
    const r = await sb.from('products').update(pick(changes, PRODUCT_COLS)).eq('id', id);
    if (r.error) return r.error;
    if (cost != null) {
      const c = await sb.from('product_costs').upsert([{ product_id: id, cost }],
        { onConflict: 'product_id', ignoreDuplicates: false });
      if (c.error) return c.error;
    }
    return null;
  }

  if (e.kind === 'sale') {
    const { sale, items, moves } = e.payload;
    let r = await ins('sales', [{ ...pick(sale, SALE_COLS), created_by: by }]);
    // เลขบิลชนกับเครื่องอื่น (เกิดได้ถ้าเคยตั้งเครื่องใหม่แล้วตัวนับเริ่มที่หนึ่งอีกรอบ)
    // ออกเลขใหม่ให้แล้วส่งอีกครั้ง ดีกว่าปล่อยให้บิลค้างไม่ขึ้นเซิร์ฟเวอร์ตลอดไป
    if (r.error && r.error.code === '23505' && /bill_no/.test(r.error.message || '')) {
      const fresh = await nextBillNo(sale.status === 'open_card' ? 'OPN' : 'INV',
                                     (sale.bill_no.split('-')[2] || 'SHOP'));
      await db.sales.update(sale.id, { bill_no: fresh, renamed_from: sale.bill_no });
      sale.bill_no = fresh;
      await db.outbox.update(e.seq, { payload: e.payload });
      r = await ins('sales', [{ ...pick(sale, SALE_COLS), created_by: by }]);
    }
    if (r.error) return r.error;
    r = await ins('sale_items', items.map(i => pick(i, ITEM_COLS)));
    if (r.error) return r.error;
    const costs = items.filter(i => i.unit_cost != null)
      .map(i => ({ sale_item_id: i.id, unit_cost: i.unit_cost }));
    if (costs.length) {
      // พนักงานไม่มีสิทธิ์อ่านตารางต้นทุน แต่เขียนได้ ถ้าเขียนไม่ได้ก็ไม่ให้ล้มทั้งบิล
      const c = await sb.from('sale_item_costs').upsert(costs, { onConflict: 'sale_item_id', ignoreDuplicates: true });
      if (c.error) console.warn('บันทึกต้นทุนในบิลไม่สำเร็จ:', c.error.message);
    }
    r = await ins('stock_moves', moves.map(m => ({ ...pick(m, MOVE_COLS), created_by: by })));
    return r.error || null;
  }

  if (e.kind === 'void') {
    const { sale_id, reason, moves } = e.payload;
    let r = await sb.from('sales').update({ status: 'void', void_reason: reason,
      voided_by: by, voided_at: new Date().toISOString() }).eq('id', sale_id);
    if (r.error) return r.error;
    r = await ins('stock_moves', moves.map(m => ({ ...pick(m, MOVE_COLS), created_by: by })));
    return r.error || null;
  }

  if (e.kind === 'stock') {
    const r = await ins('stock_moves', e.payload.moves.map(m => ({ ...pick(m, MOVE_COLS), created_by: by })));
    return r.error || null;
  }

  return null;      // ชนิดที่ยังไม่รองรับ ข้ามไปก่อน ไม่ให้คิวตัน
}

export async function push() {
  if (!sb || !user || busy || !navigator.onLine) return { sent: 0, left: await db.outbox.count() };
  busy = true;
  let sent = 0, failed = null;
  try {
    const queue = await db.outbox.orderBy('seq').toArray();
    for (const e of queue) {
      const err = await pushEntry(e);
      if (err) {
        // ข้อผิดพลาดถาวร (ข้อมูลผิดรูป/ถูกปฏิเสธสิทธิ์) อย่าให้ตันคิวตลอดไป
        const permanent = err.code && /^(22|23|42|P0)/.test(String(err.code));
        await db.outbox.update(e.seq, {
          tries: (e.tries || 0) + 1,
          lastError: err.message || String(err),
          blocked: permanent || (e.tries || 0) + 1 >= 5,
        });
        failed = err.message || String(err);
        if (!permanent) break;          // ปัญหาชั่วคราว หยุดไว้ก่อน รักษาลำดับ
        continue;                        // ปัญหาถาวร ข้ามใบนี้ไปทำใบอื่นต่อ
      }
      await db.outbox.delete(e.seq);
      sent++;
    }
  } finally { busy = false; }
  const left = await db.outbox.count();
  if (sent) await metaSet('lastPush', new Date().toISOString());
  return { sent, left, failed };
}

/* ให้ push ทำงานเองเป็นระยะ และทันทีที่เน็ตกลับมา */
export function startAutoSync(onChange) {
  const run = async () => {
    if (!sb || !user) return;
    const r = await push();
    if (r.sent && onChange) onChange(r);
  };
  addEventListener('online', run);
  document.addEventListener('siatoy:changed', run);
  if (timer) clearInterval(timer);
  timer = setInterval(run, 20000);
  run();
  return () => { clearInterval(timer); removeEventListener('online', run); };
}

/* ครั้งแรกที่ต่อฐานข้อมูลได้ ข้อมูลตัวอย่างในเครื่องต้องถูกแทนที่ด้วยของจริง */
export async function switchToLiveData() {
  if (await metaGet('liveData')) return false;
  const wasDemo = await metaGet('seeded');
  if (wasDemo) {
    await db.transaction('rw', db.tables, async () => {
      for (const t of ['products','barcodes','locations','vendors','card_sets','members',
                       'sales','sale_items','stock_moves','outbox']) await db.table(t).clear();
    });
  }
  await metaSet('seeded', false);
  await metaSet('liveData', true);
  return true;
}
