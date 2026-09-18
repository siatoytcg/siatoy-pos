/* นำเข้าข้อมูลสินค้าตั้งต้นจากไฟล์
 *
 * ใช้ตอนเปิดระบบวันแรก หลังนับสต๊อกเสร็จ และใช้ซ้ำได้ทุกครั้งที่รับของล็อตใหญ่
 * รองรับทั้งไฟล์ CSV และการก๊อบปี้จาก Excel มาวางตรง ๆ (Excel วางมาเป็นแท็บคั่น)
 *
 * ยอดคงเหลือที่นำเข้าจะลงเป็นบรรทัด "ยอดยกมา" ในสมุดเดินของเสมอ
 * ไม่ได้ไปเขียนทับช่องคงเหลือ เพราะระบบไม่มีช่องนั้นตั้งแต่แรก
 */
import { money, esc, uuid, toast, openModal, closeModal, redrawPage } from '../lib/util.js';
import { db, currentLocation } from '../lib/store.js';
import { parseCSV, toAmount } from '../lib/csv.js';
import { S } from '../lib/state.js';

const FIELDS = [
  { k: 'sku',      n: 'รหัส / บาร์โค้ด', req: true,
    exact: ['รหัส','รหัสสินค้า','รหัส/บาร์โค้ด','บาร์โค้ด','sku','barcode','code'],
    like:  ['บาร์โค้ด','รหัส','sku','barcode'] },
  { k: 'name',     n: 'ชื่อสินค้า',      req: true,
    exact: ['ชื่อสินค้า','ชื่อ','รายการ','name','product','description'],
    like:  ['ชื่อสินค้า','ชื่อ','รายการ','product'] },
  { k: 'category', n: 'หมวดสินค้า',
    exact: ['หมวดสินค้า','หมวด','ประเภท','category','type'], like: ['หมวด','ประเภท','category'] },
  { k: 'set',      n: 'บล็อกเซต',
    exact: ['บล็อกเซต','เซต','ชุด','set','block'], like: ['บล็อกเซต','เซต','set'] },
  { k: 'vendor',   n: 'ผู้ฝากขาย',
    exact: ['ผู้ฝากขาย','ผู้จำหน่าย','เจ้าของสินค้า','vendor','supplier'],
    like:  ['ผู้ฝาก','ผู้จำหน่าย','เจ้าของ','vendor','supplier','ซัพ'] },
  { k: 'price',    n: 'ราคาขาย',         req: true,
    exact: ['ราคาขาย','ราคา','price','sellprice','unitprice'],
    like:  ['ราคาขาย','ราคาต่อหน่วย','sellprice','unitprice','price'] },
  { k: 'cost',     n: 'ต้นทุน',
    exact: ['ต้นทุน','ทุน','ราคาทุน','cost','costprice'], like: ['ต้นทุน','ราคาทุน','cost'] },
  { k: 'stock',    n: 'จำนวนคงเหลือ',
    exact: ['จำนวนคงเหลือ','คงเหลือ','จำนวน','สต๊อก','stock','qty','quantity','onhand'],
    like:  ['คงเหลือ','สต๊อก','จำนวน','stock','qty','onhand'] },
];

let rows = [], header = [], map = {}, createMissing = true, root = null;

const TEMPLATE = `รหัส/บาร์โค้ด,ชื่อสินค้า,หมวดสินค้า,บล็อกเซต,ผู้ฝากขาย,ราคาขาย,ต้นทุน,จำนวนคงเหลือ
8859001,Pokémon SV8a Terastal Festival · Booster Box,Booster Box,SV8a,003,5490,4200,6
8859002,Pokémon SV8a · Booster Pack,Booster Pack,SV8a,003,199,140,112
8859007,Pikachu ex SAR · PSA 10,การ์ดแยกใบ,GRD,002,18900,12000,1
`;

/* เดาคอลัมน์แบบสองรอบ
 * รอบแรกจับเฉพาะหัวคอลัมน์ที่ตรงกันเป๊ะ รอบสองค่อยจับแบบมีคำนั้นอยู่ข้างใน
 * และคอลัมน์ที่ถูกจับไปแล้วจะไม่ถูกจับซ้ำ
 * ถ้าไม่ทำแบบนี้ หัวคอลัมน์ "ผู้ฝากขาย" จะไปโดนคำว่า "ขาย" ของช่องราคาขาย
 * แล้วราคาสินค้าทั้งไฟล์จะเข้าผิดช่องโดยไม่มีใครทันสังเกต
 */
const norm = h => String(h).toLowerCase().replace(/[\s./_()-]/g, '');

function guessMap(hdr) {
  const m = {}, used = new Set();
  const H = hdr.map(norm);
  FIELDS.forEach(f => {
    const i = H.findIndex((h, idx) => !used.has(idx) && f.exact.some(x => h === norm(x)));
    if (i >= 0) { m[f.k] = i; used.add(i); }
  });
  FIELDS.forEach(f => {
    if (m[f.k] !== undefined) return;
    const i = H.findIndex((h, idx) => !used.has(idx) && f.like.some(x => h.includes(norm(x))));
    if (i >= 0) { m[f.k] = i; used.add(i); }
  });
  return m;
}

function loadTable(text) {
  const all = parseCSV(text);
  if (all.length < 2) { toast('ไฟล์ว่างหรืออ่านไม่ออก', 'err'); return false; }
  header = all[0];
  rows = all.slice(1);
  map = guessMap(header);
  return true;
}

/* ตรวจข้อมูลทีละแถวก่อนนำเข้าจริง เพื่อให้เห็นปัญหาทั้งหมดในรอบเดียว */
async function analyse() {
  const products = await db.products.toArray();
  const vendors  = await db.vendors.toArray();
  const sets     = await db.card_sets.toArray();
  const bySku = new Map(products.map(p => [p.sku, p]));
  const seen = new Set();
  const out = [];
  const newVendors = new Set(), newSets = new Set();

  const cell = (r, k) => map[k] === undefined ? '' : String(r[map[k]] ?? '').trim();

  rows.forEach((r, i) => {
    const sku = cell(r, 'sku'), name = cell(r, 'name');
    const price = toAmount(cell(r, 'price')), cost = toAmount(cell(r, 'cost'));
    const stock = toAmount(cell(r, 'stock'));
    const vRaw = cell(r, 'vendor'), sRaw = cell(r, 'set');
    const problems = [];

    if (!sku)  problems.push('ไม่มีรหัสสินค้า');
    if (!name) problems.push('ไม่มีชื่อสินค้า');
    if (price === null && cell(r, 'price')) problems.push('ราคาขายไม่ใช่ตัวเลข');
    if (cost === null && cell(r, 'cost'))   problems.push('ต้นทุนไม่ใช่ตัวเลข');
    if (stock === null && cell(r, 'stock')) problems.push('จำนวนคงเหลือไม่ใช่ตัวเลข');
    if (sku && seen.has(sku)) problems.push('รหัสซ้ำกันเองในไฟล์');
    if (sku) seen.add(sku);

    const vendor = vRaw ? vendors.find(v => v.code === vRaw || v.name === vRaw) : null;
    if (vRaw && !vendor) { if (createMissing) newVendors.add(vRaw); else problems.push('ไม่พบผู้ฝากขาย ' + vRaw); }
    const set = sRaw ? sets.find(x => x.code === sRaw || x.name === sRaw) : null;
    if (sRaw && !set) { if (createMissing) newSets.add(sRaw); else problems.push('ไม่พบบล็อกเซต ' + sRaw); }

    out.push({
      line: i + 2, sku, name, category: cell(r, 'category') || 'อื่น ๆ',
      price: price || 0, cost: cost || 0, stock: stock || 0,
      vendorRaw: vRaw, setRaw: sRaw,
      exists: bySku.has(sku),
      problems,
    });
  });

  return { list: out, newVendors: [...newVendors], newSets: [...newSets] };
}

async function doImport(res) {
  const loc = await currentLocation();
  const now = new Date().toISOString();
  const ok = res.list.filter(r => !r.problems.length);

  await db.transaction('rw', db.products, db.barcodes, db.vendors, db.card_sets, db.stock_moves, db.meta, async () => {
    for (const name of res.newVendors) {
      const code = name.length <= 6 ? name : 'V' + String(await db.vendors.count() + 1).padStart(3, '0');
      await db.vendors.put({ id: 'ven-' + code, code, name, tel: '-', commission_pct: 0,
        started_on: now.slice(0, 10), is_active: true });
    }
    for (const name of res.newSets) {
      const code = name.length <= 8 ? name : 'S' + String(await db.card_sets.count() + 1);
      await db.card_sets.put({ id: 'set-' + code.toLowerCase(), code, name, game: '-', is_open: true, sort_order: 0 });
    }
    const vendors = await db.vendors.toArray(), sets = await db.card_sets.toArray();
    const vId = raw => (vendors.find(v => v.code === raw || v.name === raw) || {}).id || null;
    const sId = raw => (sets.find(s => s.code === raw || s.name === raw) || {}).id || null;

    for (const r of ok) {
      const id = uuid();
      const prod = { id, sku: r.sku, name: r.name, category: r.category,
        set_id: sId(r.setRaw), vendor_id: vId(r.vendorRaw), price: r.price, cost: r.cost,
        vat_rate: 0, is_single: false, is_active: true, icon: '🃏' };
      if (r.exists) {
        const old = await db.products.get(id);
        if (old.price !== r.price || (old.cost || 0) !== r.cost) {
          await db.meta.put({ key: 'ph:' + uuid(), value: { product_id: id, from: old.price,
            price: r.price, cost: r.cost, at: now, by: S.role, reason: 'นำเข้าจากไฟล์' } });
        }
        await db.products.update(id, { ...prod, icon: old.icon || '🃏', is_single: old.is_single });
      } else {
        await db.products.put(prod);
        await db.barcodes.put({ barcode: r.sku, product_id: id, kind: 'shop' });
      }
      if (r.stock > 0 && !r.exists) {
        await db.stock_moves.put({ id: uuid(), product_id: id, location_id: loc.id, qty: r.stock,
          move_type: 'opening', ref_no: 'นำเข้าข้อมูลตั้งต้น', created_at: now });
      }
    }
  });
  return ok.length;
}

function pickFile() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.csv,.txt,.tsv,text/csv';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    if (loadTable(await f.text())) { toast('อ่านไฟล์ ' + esc(f.name) + ' แล้ว', 'ok'); await redrawPage(root, importPage); }
  };
  inp.click();
}

function pasteBox() {
  openModal(`
    <div class="modal-head"><h3>วางข้อมูลจาก Excel</h3><button class="x" id="mClose">✕</button></div>
    <div class="modal-body">
      <div class="notice info">เปิดไฟล์ใน Excel เลือกทั้งตาราง <b>รวมบรรทัดหัวตาราง</b> กด Ctrl+C
        แล้วมาวางในช่องด้านล่างด้วย Ctrl+V</div>
      <div class="field" style="margin-top:14px">
        <textarea class="inp" id="pasteArea" rows="10"
          style="font-family:monospace;font-size:12px" placeholder="วางที่นี่…"></textarea></div>
    </div>
    <div class="modal-foot"><button class="btn ghost" id="mNo">ยกเลิก</button>
      <button class="btn gold" id="mOk">อ่านข้อมูล</button></div>`, true);
  const box = document.getElementById('modalBox');
  box.querySelector('#mClose').onclick = box.querySelector('#mNo').onclick = closeModal;
  box.querySelector('#mOk').onclick = async () => {
    const t = box.querySelector('#pasteArea').value;
    if (!t.trim()) { toast('ยังไม่ได้วางข้อมูล', 'err'); return; }
    if (loadTable(t)) { closeModal(); await redrawPage(root, importPage); }
  };
}

function downloadTemplate() {
  const blob = new Blob(['﻿' + TEMPLATE], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'แบบฟอร์มนำเข้าสินค้า.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('ดาวน์โหลดแบบฟอร์มแล้ว · ส่งให้ทางร้านกรอกได้เลย', 'ok');
}

export const importPage = {
  async render() {
    const res = rows.length ? await analyse() : null;
    const good = res ? res.list.filter(r => !r.problems.length) : [];
    const bad  = res ? res.list.filter(r => r.problems.length) : [];
    const add  = good.filter(r => !r.exists), upd = good.filter(r => r.exists);

    return `
    <div class="page-head"><div><h1>นำเข้าข้อมูลสินค้า</h1>
      <p>ใส่สินค้าและยอดยกมาทีเดียวทั้งไฟล์ ใช้ตอนเปิดระบบวันแรกและตอนรับของล็อตใหญ่</p></div></div>

    ${S.role === 'admin' ? `<div class="notice red">🔒 นำเข้าข้อมูลได้เฉพาะสิทธิ์หัวหน้างานขึ้นไป</div>` : `
    <div class="card">
      <div class="card-title"><span class="ic">📄</span> เลือกข้อมูล</div>
      <div class="flex wrap" style="gap:10px">
        <button class="btn gold" id="imFile">📁 เลือกไฟล์ CSV</button>
        <button class="btn" id="imPaste">📋 วางจาก Excel</button>
        <button class="btn ghost" id="imTpl">⬇️ ดาวน์โหลดแบบฟอร์ม</button>
      </div>
      <div class="mini" style="margin-top:10px">
        คอลัมน์ที่ต้องมี : รหัส/บาร์โค้ด · ชื่อสินค้า · ราคาขาย ·
        ที่เหลือใส่หรือไม่ใส่ก็ได้ (หมวด บล็อกเซต ผู้ฝากขาย ต้นทุน จำนวนคงเหลือ)
      </div>
    </div>

    ${!rows.length ? '' : `
    <div class="card" style="margin-top:14px">
      <div class="card-title"><span class="ic">🔗</span> จับคู่คอลัมน์
        <span class="sub">${rows.length} แถว</span></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">
        ${FIELDS.map(f => `<div class="field" style="margin:0">
          <label>${f.n}${f.req ? ' *' : ''}</label>
          <select class="inp" data-map="${f.k}">
            <option value="">— ไม่ใช้ —</option>
            ${header.map((h, i) => `<option value="${i}" ${map[f.k] === i ? 'selected' : ''}>
              ${esc(String(h).slice(0, 26) || 'คอลัมน์ ' + (i + 1))}</option>`).join('')}
          </select></div>`).join('')}
      </div>
      <label class="chk" style="margin-top:12px"><input type="checkbox" id="imCreate" ${createMissing ? 'checked' : ''}>
        สร้างผู้ฝากขายและบล็อกเซตที่ยังไม่มีในระบบให้อัตโนมัติ</label>
    </div>

    <div class="grid g4" style="margin-top:14px">
      <div class="stat"><div class="lbl">เพิ่มใหม่</div><div class="val g">${add.length}</div>
        <div class="sub">รายการ</div></div>
      <div class="stat"><div class="lbl">อัปเดตของเดิม</div><div class="val">${upd.length}</div>
        <div class="sub">ชื่อ ราคา ต้นทุน หมวด</div></div>
      <div class="stat"><div class="lbl">ยอดยกมารวม</div>
        <div class="val">${money(add.reduce((a, r) => a + r.stock, 0))}</div><div class="sub">ชิ้น</div></div>
      <div class="stat"><div class="lbl">มีปัญหา</div>
        <div class="val ${bad.length ? 'red' : ''}">${bad.length}</div><div class="sub">แถวที่จะถูกข้าม</div></div>
    </div>

    ${res.newVendors.length || res.newSets.length ? `
      <div class="notice info" style="margin-top:14px">จะสร้างให้ใหม่ :
        ${res.newVendors.length ? 'ผู้ฝากขาย ' + res.newVendors.map(esc).join(', ') : ''}
        ${res.newVendors.length && res.newSets.length ? ' · ' : ''}
        ${res.newSets.length ? 'บล็อกเซต ' + res.newSets.map(esc).join(', ') : ''}</div>` : ''}

    ${bad.length ? `
      <div class="notice red" style="margin-top:14px">แถวที่มีปัญหาจะถูกข้าม ไม่นำเข้า —
        แก้ในไฟล์ต้นทางแล้วนำเข้าใหม่ได้ ระบบจะไม่สร้างของซ้ำ</div>` : ''}

    <div class="card tight" style="margin-top:14px"><div class="tbl-wrap"><table>
      <thead><tr><th>บรรทัด</th><th>รหัส</th><th>ชื่อสินค้า</th><th>หมวด</th><th>เซต</th><th>ผู้ฝากขาย</th>
        <th class="num">ราคาขาย</th><th class="num">ต้นทุน</th><th class="num">ยกมา</th><th>ผล</th></tr></thead>
      <tbody>${res.list.slice(0, 200).map(r => `
        <tr style="${r.problems.length ? 'background:rgba(224,69,59,.05)' : ''}">
          <td class="mini">${r.line}</td>
          <td class="mini">${esc(r.sku)}</td>
          <td>${esc(r.name)}</td>
          <td class="mini">${esc(r.category)}</td>
          <td class="mini">${esc(r.setRaw || '-')}</td>
          <td class="mini">${esc(r.vendorRaw || '-')}</td>
          <td class="num">${money(r.price)}</td>
          <td class="num"><span class="cost-cell">${money(r.cost)}</span></td>
          <td class="num">${r.stock || '-'}</td>
          <td>${r.problems.length
            ? '<span class="tag red">' + esc(r.problems[0]) + '</span>'
            : r.exists ? '<span class="tag">อัปเดต</span>' : '<span class="tag green">เพิ่มใหม่</span>'}</td>
        </tr>`).join('')}</tbody></table></div></div>
    ${res.list.length > 200 ? `<div class="mini" style="margin-top:8px">แสดง 200 แถวแรกจาก ${res.list.length} แถว · นำเข้าครบทุกแถว</div>` : ''}

    <div class="flex wrap" style="margin-top:14px">
      <button class="btn ghost" id="imClear">ล้างข้อมูลที่อ่านไว้</button>
      <button class="btn gold right" id="imGo" ${good.length ? '' : 'disabled'}
        style="padding:12px 22px">✓ นำเข้า ${good.length} รายการ</button>
    </div>`}`}`;
  },

  mount(el) {
    root = el;
    if (S.role === 'admin') return;
    el.querySelector('#imFile').onclick = pickFile;
    el.querySelector('#imPaste').onclick = pasteBox;
    el.querySelector('#imTpl').onclick = downloadTemplate;

    const clear = el.querySelector('#imClear');
    if (clear) clear.onclick = async () => { rows = []; header = []; map = {}; await redrawPage(el, importPage); };

    el.addEventListener('change', async e => {
      const m = e.target.closest('[data-map]');
      if (m) { const v = m.value; if (v === '') delete map[m.dataset.map]; else map[m.dataset.map] = Number(v);
        await redrawPage(el, importPage); return; }
      const c = e.target.closest('#imCreate');
      if (c) { createMissing = c.checked; await redrawPage(el, importPage); }
    });

    const go = el.querySelector('#imGo');
    if (go) go.onclick = async () => {
      go.disabled = true; go.textContent = 'กำลังนำเข้า…';
      const res = await analyse();
      const n = await doImport(res);
      rows = []; header = []; map = {};
      toast('นำเข้าสำเร็จ ' + n + ' รายการ · ยอดยกมาลงเป็นรายการในสมุดเดินของแล้ว', 'ok');
      document.dispatchEvent(new CustomEvent('siatoy:changed'));
      location.hash = '#/stock';
    };
  },
};
