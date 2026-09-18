/* ชั้นข้อมูลในเครื่อง
 *
 * กติกาเดียวกับฝั่งเซิร์ฟเวอร์ทุกข้อ :
 *   - สต๊อกอ่านจาก stock_moves เท่านั้น ไม่มีช่อง "คงเหลือ" ที่เขียนทับได้
 *   - บิลเก็บราคาและต้นทุน ณ วันขายไว้ในบรรทัดบิล
 *   - id และเลขบิลสร้างจากเครื่องนี้ ทำให้ขายตอนเน็ตหลุดได้ แล้วค่อยส่งขึ้นทีหลัง
 */
import { uuid, yymmdd } from './util.js';
import { SEED_LOCATIONS, SEED_VENDORS, SEED_SETS, SEED_PRODUCTS, SEED_MEMBERS } from './seed.js';
import { DEMO } from '../config.js';

const Dexie = globalThis.Dexie;
// โหมดเดโมใช้ที่เก็บคนละก้อน ของจริงกับของทดลองจึงไม่ปนกันแม้เปิดบนเครื่องเดียวกัน
export const db = new Dexie(DEMO ? 'siatoy-pos-demo' : 'siatoy-pos');

db.version(1).stores({
  products:    'id, sku, category, set_id, vendor_id',
  barcodes:    'barcode, product_id',
  locations:   'id, code',
  vendors:     'id, code',
  card_sets:   'id, code',
  members:     'id, code, tel',
  sales:       'id, bill_no, status, client_created_at',
  sale_items:  'id, sale_id, product_id',
  stock_moves: 'id, product_id, location_id, ref_id, created_at',
  outbox:      '++seq, kind, at',
  meta:        'key',
});

/* เพิ่มตารางกระทบยอดธนาคารในเวอร์ชัน 2 ตารางเดิมยกมาทั้งหมดโดยอัตโนมัติ */
db.version(2).stores({
  bank_lines: 'id, txn_time, amount',
  recon:      'id, bank_line_id, sale_id',
});

/* เวอร์ชัน 3 : ประวัติการเข้าใช้งานเก็บในเครื่องด้วย
   ตอนออฟไลน์ก็ยังบันทึกได้ แล้วค่อยส่งขึ้นเซิร์ฟเวอร์ทีหลัง */
db.version(3).stores({
  events: '++id, kind, at',
});

/* เวอร์ชัน 4 : รอบจ่ายผู้ฝากขายที่บันทึกแล้วในเครื่องนี้ */
db.version(4).stores({
  vendor_payouts: 'id, vendor_id, paid_at',
});

/* ---------------------------------------------------------------- meta ---- */
export async function metaGet(key, dflt = null) {
  const r = await db.meta.get(key);
  return r ? r.value : dflt;
}
export async function metaSet(key, value) { await db.meta.put({ key, value }); }

export async function deviceId() {
  let id = await metaGet('device_id');
  if (!id) { id = 'dev-' + uuid().slice(0, 8); await metaSet('device_id', id); }
  return id;
}
export async function currentLocation() {
  const id = await metaGet('location_id', 'loc-shop');
  return (await db.locations.get(id)) || (await db.locations.toCollection().first()) ||
    { id: 'loc-shop', code: 'SHOP', name: 'หน้าร้าน', kind: 'shop', is_active: true };
}
export async function setLocation(id) { await metaSet('location_id', id); }

/* ---------------------------------------------------------------- seed ---- */
export async function ensureSeeded() {
  if (await metaGet('seeded')) return;
  if (await metaGet('liveData')) return;      // ใช้ข้อมูลจริงจากเซิร์ฟเวอร์แล้ว ไม่ต้องใส่ตัวอย่าง
  await db.transaction('rw',
    db.locations, db.vendors, db.card_sets, db.products, db.barcodes,
    db.members, db.stock_moves, db.meta, async () => {
      await db.locations.bulkPut(SEED_LOCATIONS);
      await db.vendors.bulkPut(SEED_VENDORS);
      await db.card_sets.bulkPut(SEED_SETS);
      await db.members.bulkPut(SEED_MEMBERS);
      for (const p of SEED_PRODUCTS) {
        const { stock, ...prod } = p;
        await db.products.put(prod);
        await db.barcodes.put({ barcode: p.sku, product_id: p.id, kind: 'shop' });
        // ยอดยกมา ลงเป็นบรรทัดแรกของสมุดเดินของ ไม่ใช่ช่องคงเหลือ
        await db.stock_moves.put({
          id: uuid(), product_id: p.id, location_id: 'loc-shop', qty: stock,
          move_type: 'opening', ref_id: null, ref_no: 'ข้อมูลตั้งต้นสำหรับทดลองใช้',
          created_at: new Date().toISOString(),
        });
      }
      await db.meta.put({ key: 'seeded', value: true });
    });
}

/* --------------------------------------------------------------- stock ---- */
export async function stockMap(locationId) {
  const map = new Map();
  await db.stock_moves.each(m => {
    if (locationId && m.location_id !== locationId) return;
    map.set(m.product_id, (map.get(m.product_id) || 0) + m.qty);
  });
  return map;
}
export async function stockOf(productId, locationId) {
  let n = 0;
  await db.stock_moves.where('product_id').equals(productId).each(m => {
    if (!locationId || m.location_id === locationId) n += m.qty;
  });
  return n;
}

/* ------------------------------------------------------------- lookups ---- */
export async function findByCode(text) {
  const v = String(text || '').trim();
  if (!v) return null;
  const hit = await db.barcodes.get(v) || await db.barcodes.get(v.replace(/^0+/, ''));
  if (hit) return db.products.get(hit.product_id);
  const bySku = await db.products.where('sku').equals(v).first();
  if (bySku) return bySku;
  const low = v.toLowerCase();
  return (await db.products.toArray()).find(p => p.name.toLowerCase().includes(low)) || null;
}

/* ---------------------------------------------------------- เลขที่บิล ----
 * ต้องสร้างจากเครื่องเองเพื่อให้ขายตอนออฟไลน์ได้ แต่ตัวนับอยู่แยกในแต่ละเครื่อง
 * ถ้าเลขบิลมีแค่ วันที่ + จุดขาย + ลำดับ สองเครื่องที่ขายอยู่จุดเดียวกัน
 * จะออกเลขซ้ำกันตั้งแต่บิลแรกของวัน แล้วเซิร์ฟเวอร์จะปฏิเสธใบที่สอง
 * จึงใส่รหัสย่อของเครื่องคั่นไว้ด้วย   เช่น INV-260901-SHOP-7A3-0001
 */
export async function nextBillNo(prefix, locCode) {
  const day = yymmdd();
  const key = 'billseq:' + day;
  const seq = (await metaGet(key, 0)) + 1;
  await metaSet(key, seq);
  const tag = (await deviceId()).replace(/[^a-z0-9]/gi, '').slice(-3).toUpperCase();
  return `${prefix}-${day}-${locCode}-${tag}-${String(seq).padStart(4, '0')}`;
}

/* -------------------------------------------------------------- ขายบิล ---- */
/* lines: [{ product, qty, discount, discount_reason }] */
export async function commitSale({ lines, payment, billDiscount = 0, discountReason = '',
                                   cardFee = 0, member = null, isOpenCard = false, userName = '' }) {
  const loc = await currentLocation();
  const dev = await deviceId();
  const now = new Date().toISOString();
  const saleId = uuid();
  const billNo = await nextBillNo(isOpenCard ? 'OPN' : 'INV', loc.code);

  const subtotal      = lines.reduce((a, l) => a + l.product.price * l.qty, 0);
  const itemDiscount  = lines.reduce((a, l) => a + (l.discount || 0) * l.qty, 0);
  const net           = subtotal - itemDiscount - billDiscount;
  const total         = isOpenCard ? 0 : net + cardFee;

  const sale = {
    id: saleId, bill_no: billNo, location_id: loc.id,
    status: isOpenCard ? 'open_card' : 'normal',
    payment: isOpenCard ? 'none' : payment,
    subtotal, item_discount: itemDiscount, bill_discount: billDiscount,
    discount_reason: discountReason, card_fee: cardFee, vat_amount: 0, total,
    item_count: lines.reduce((a, l) => a + l.qty, 0),
    member_id: member ? member.id : null,
    created_by_name: userName, device_id: dev,
    client_created_at: now, synced: 0,
  };

  const items = lines.map(l => ({
    id: uuid(), sale_id: saleId, product_id: l.product.id,
    sku: l.product.sku, product_name: l.product.name, vendor_id: l.product.vendor_id,
    qty: l.qty, unit_price: l.product.price, unit_cost: l.product.cost,   // ราคาและต้นทุน ณ วันขาย
    discount: l.discount || 0, discount_reason: l.discount_reason || '',
    vat_rate: l.product.vat_rate || 0,
    line_total: (l.product.price - (l.discount || 0)) * l.qty,
  }));

  const moves = lines.map(l => ({
    id: uuid(), product_id: l.product.id, location_id: loc.id,
    qty: -l.qty, move_type: isOpenCard ? 'open_card' : 'sale',
    ref_id: saleId, ref_no: billNo, created_at: now, device_id: dev,
  }));

  await db.transaction('rw', db.sales, db.sale_items, db.stock_moves, db.outbox, db.meta, async () => {
    await db.sales.put(sale);
    await db.sale_items.bulkPut(items);
    await db.stock_moves.bulkPut(moves);
    await db.outbox.add({ kind: 'sale', at: now, payload: { sale, items, moves } });
  });

  return sale;
}

/* ---------------------------------------------------------- ยกเลิกบิล ---- */
export async function voidSale(saleId, reason, userName = '') {
  const sale = await db.sales.get(saleId);
  if (!sale || sale.status === 'void') return null;
  const items = await db.sale_items.where('sale_id').equals(saleId).toArray();
  const now = new Date().toISOString();
  const dev = await deviceId();

  // ไม่ลบบรรทัดเดิม แต่ลงบรรทัดคืนของกลับเข้าคลัง
  const back = items.map(it => ({
    id: uuid(), product_id: it.product_id, location_id: sale.location_id,
    qty: it.qty, move_type: 'sale_void', ref_id: saleId, ref_no: sale.bill_no,
    reason, created_at: now, device_id: dev,
  }));

  await db.transaction('rw', db.sales, db.stock_moves, db.outbox, async () => {
    await db.sales.update(saleId, { status: 'void', void_reason: reason, voided_at: now, voided_by_name: userName });
    await db.stock_moves.bulkPut(back);
    await db.outbox.add({ kind: 'void', at: now, payload: { sale_id: saleId, reason, moves: back } });
  });
  return sale;
}

export const pendingCount = () => db.outbox.count();
export const blockedItems = () => db.outbox.filter(e => !!e.blocked).toArray();

/* คิวสินค้ารุ่นเก่าที่ใช้ id แบบ prd-... ส่งเข้า Supabase ไม่ได้เพราะคอลัมน์เป็น UUID
   ล้างเฉพาะคิวรูปแบบเก่านี้ ไม่กระทบคิวบิล/สต๊อกที่สร้างด้วย UUID รุ่นปัจจุบัน */
export async function clearLegacyProductQueue() {
  const rows = await db.outbox.toArray();
  let removed = 0;
  for (const e of rows) {
    if (/prd-[a-z0-9_-]+/i.test(JSON.stringify(e.payload || {}))) {
      await db.outbox.delete(e.seq); removed++;
    }
  }
  return removed;
}

/* ------------------------------------------------------------ ตั้งค่า ---- */
/* เก็บใน meta ของเครื่องนี้ไปก่อน เมื่อต่อฐานข้อมูลแล้วย้ายไปตาราง settings */
const CFG_KEYS = ['creditFee', 'pointRate', 'printerDpi', 'shopName'];

export async function loadSettings(CONFIG) {
  for (const k of CFG_KEYS) {
    const v = await metaGet('cfg:' + k, null);
    if (v !== null && v !== undefined) CONFIG[k] = v;
  }
  return CONFIG;
}
export async function saveSetting(CONFIG, key, value) {
  CONFIG[key] = value;
  await metaSet('cfg:' + key, value);
}

/* ล้างข้อมูลทดลองทั้งหมดในเครื่องนี้ ใช้ก่อนเริ่มใช้งานจริง */
export async function wipeLocal() {
  await Promise.all(db.tables.map(t => t.clear()));
}
