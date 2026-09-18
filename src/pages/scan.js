/* สแกนรับเข้า / ตัดออกจากคลัง
 * ทุกการเคลื่อนไหวลงเป็นบรรทัดในสมุดเดินของพร้อมคนทำ เวลา และเหตุผล
 * การยกของไปบูธงานถือเป็น "ย้ายจุดขาย" ลงสองบรรทัด ออกจากที่หนึ่ง เข้าอีกที่หนึ่ง
 * ของจึงไม่หายไปจากระบบและรับกลับได้ครบ
 */
import { money, esc, uuid, toast, redrawPage } from '../lib/util.js';
import { db, stockMap, findByCode, currentLocation, deviceId } from '../lib/store.js';
import { S } from '../lib/state.js';
import { attachWedge, keepFocus, openCameraModal } from '../lib/scanner.js';

const OUT_REASONS = [
  { k: 'transfer', n: 'ยกไปออกบูธ / โอนไปจุดขายอื่น', type: 'transfer_out', needsDest: true },
  { k: 'damage',   n: 'สินค้าเสียหาย / ชำรุด',        type: 'damage' },
  { k: 'vendor',   n: 'คืนของให้ผู้ฝากขาย',            type: 'return_vendor' },
  { k: 'sample',   n: 'ตัวอย่าง / ของแถม',            type: 'sample' },
  { k: 'adjust',   n: 'ปรับยอดจากการนับสต๊อก',         type: 'adjust' },
];

const TYPE_NAME = {
  opening: 'ยอดยกมา', purchase: 'รับเข้า', sale: 'ขาย', sale_void: 'คืนจากบิลยกเลิก',
  open_card: 'เปิดการ์ด', transfer_out: 'ยกออกไปจุดอื่น', transfer_in: 'รับเข้าจากจุดอื่น',
  damage: 'เสียหาย', sample: 'ตัวอย่าง/ของแถม', return_vendor: 'คืนผู้ฝากขาย', adjust: 'ปรับยอด',
};

let mode = 'in', list = [], products = [], vendors = [], locs = [], stock = new Map();
let loc = null, root = null, history = [];

async function load() {
  loc      = await currentLocation();
  products = await db.products.toArray();
  vendors  = await db.vendors.toArray();
  locs     = await db.locations.toArray();
  stock    = await stockMap(loc.id);
  const moves = await db.stock_moves.orderBy('created_at').reverse().limit(20).toArray();
  history = moves.map(m => ({ ...m, name: (products.find(p => p.id === m.product_id) || {}).name || m.product_id }));
}

const pName = id => (products.find(p => p.id === id) || {}).name || id;

function drawList() {
  const box = root.querySelector('#scList');
  const sign = mode === 'in' ? 1 : -1;
  box.innerHTML = list.length ? list.map((l, i) => {
    const now = stock.get(l.id) || 0;
    const next = now + sign * l.qty;
    return `<div class="ci">
      <div style="font-size:20px;align-self:center">${(products.find(p => p.id === l.id) || {}).icon || '🃏'}</div>
      <div class="info"><div class="nm">${esc(pName(l.id))}</div>
        <div class="meta">${esc(l.sku)} · คงเหลือ ${now} →
          <b style="color:${next < 0 ? 'var(--red)' : 'var(--gold2)'}">${next}</b>
          ${next < 0 ? ' · ตัดออกเกินของที่มี' : ''}</div></div>
      <div class="flex" style="gap:6px;align-self:center">
        <input class="inp" style="width:70px;padding:6px;text-align:center" type="number" min="1"
          value="${l.qty}" data-q="${i}">
        <span class="tag ${mode === 'in' ? 'green' : 'red'}">${mode === 'in' ? '+' : '−'}${l.qty}</span>
        <button class="x" data-x="${i}">✕</button>
      </div></div>`;
  }).join('') : `<div class="cart-empty"><span class="big">📷</span>ยังไม่มีรายการ — เริ่มยิงบาร์โค้ดได้เลย</div>`;
  root.querySelector('#scCount').textContent = list.reduce((a, l) => a + l.qty, 0) + ' ชิ้น';
}

async function addCode(text) {
  const p = await findByCode(text);
  if (!p) { toast('ไม่พบสินค้า: ' + esc(text), 'err'); return; }
  const line = list.find(l => l.id === p.id);
  if (line) line.qty++; else list.push({ id: p.id, sku: p.sku, qty: 1 });
  drawList();
  toast('สแกนแล้ว: ' + esc(p.name.slice(0, 26)), 'ok');
}

async function commit() {
  if (!list.length) { toast('ยังไม่ได้สแกนสินค้า', 'err'); return; }
  const now = new Date().toISOString();
  const dev = await deviceId();
  const by  = { admin: 'พนักงาน', sup: 'หัวหน้า', owner: 'เจ้าของ' }[S.role];
  const docId = uuid();
  const moves = [];

  if (mode === 'in') {
    const ven = root.querySelector('#scVendor').value;
    const po  = root.querySelector('#scPO').value.trim() || null;
    const vendor_payout = Number(root.querySelector('#scVendorPay')?.value) || 0;
    list.forEach(l => moves.push({ id: uuid(), product_id: l.id, location_id: loc.id, qty: l.qty,
      move_type: 'purchase', ref_id: docId, ref_no: po, reason: 'รับเข้าจาก ' + ((vendors.find(v => v.id === ven) || {}).name || '-'), vendor_id: ven || null, vendor_payout,
      created_by_name: by, device_id: dev, created_at: now }));
  } else {
    const r = OUT_REASONS.find(x => x.k === root.querySelector('#scReason').value);
    const destId = r.needsDest ? root.querySelector('#scDest').value : null;
    const over = list.filter(l => (stock.get(l.id) || 0) - l.qty < 0);
    if (over.length) {
      toast('ตัดออกเกินของที่มี: ' + esc(pName(over[0].id).slice(0, 24)), 'err'); return;
    }
    list.forEach(l => {
      moves.push({ id: uuid(), product_id: l.id, location_id: loc.id, qty: -l.qty,
        move_type: r.type, ref_id: docId, ref_no: null, reason: r.n,
        created_by_name: by, device_id: dev, created_at: now });
      if (destId) moves.push({ id: uuid(), product_id: l.id, location_id: destId, qty: l.qty,
        move_type: 'transfer_in', ref_id: docId, ref_no: null, reason: 'รับจาก ' + loc.name,
        created_by_name: by, device_id: dev, created_at: now });
    });
  }

  const n = list.reduce((a, l) => a + l.qty, 0);
  await db.transaction('rw', db.stock_moves, db.outbox, async () => {
    await db.stock_moves.bulkPut(moves);
    await db.outbox.add({ kind: 'stock', at: now, payload: { moves } });
  });
  list = [];
  toast((mode === 'in' ? 'รับเข้าคลัง ' : 'ตัดออกจากคลัง ') + n + ' ชิ้น · บันทึกผู้ทำรายการและเวลาแล้ว', 'ok');
  document.dispatchEvent(new CustomEvent('siatoy:changed'));
  location.reload();
}

export const scanPage = {
  async render() {
    await load();
    const isIn = mode === 'in';
    return `
    <div class="page-head"><div><h1>สแกนรับเข้า / ตัดออกจากคลัง</h1>
      <p>ทุกการเคลื่อนไหวต้องสแกน เพื่อให้ย้อนดูได้เสมอว่าใครเอาอะไรออกไปเมื่อไหร่ ·
        จุดขาย <b>${esc(loc.name)}</b></p></div></div>
    <div class="flex wrap" style="margin-bottom:16px">
      <div class="seg" id="scMode">
        <button class="${isIn ? 'on' : ''}" data-mode="in">📥 รับสินค้าเข้าคลัง</button>
        <button class="${!isIn ? 'on' : ''}" data-mode="out">📤 ตัดสินค้าออกจากคลัง</button>
      </div>
    </div>
    <div class="grid g2" style="grid-template-columns:1fr 380px;align-items:start">
      <div>
        <div class="card">
          <div class="scan-bar" style="margin-bottom:12px">
            <input class="scan-input" id="scInput" autofocus
              placeholder="🔍 ยิงบาร์โค้ดสินค้าที่จะ${isIn ? 'รับเข้า' : 'ตัดออก'} แล้วกด Enter…">
            <button class="btn" id="scCam">📷 กล้อง</button>
          </div>
          <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px">
            ${isIn ? `
            <div class="field" style="margin:0"><label>ผู้ฝากขาย / ผู้จำหน่าย (ถ้ามี)</label>
              <select class="inp" id="scVendor"><option value="">ของร้านเอง / ไม่ใช่ฝากขาย</option>${vendors.map(v =>
                `<option value="${v.id}">${esc(v.code)} · ${esc(v.name)}</option>`).join('')}</select></div>
            <div class="field" style="margin:0"><label>เลขที่เอกสารรับเข้า (PO)</label>
              <input class="inp" id="scPO" placeholder="เช่น PO-260901-01"></div>
            <div class="field" style="margin:0;grid-column:1/-1"><label>ยอดที่ต้องจ่ายคืนผู้ฝาก (ถ้ามี)</label>
              <input class="inp" id="scVendorPay" type="number" min="0" step="0.01" placeholder="ของร้านเองเว้นว่างได้"></div>`
            : `
            <div class="field" style="margin:0"><label>เหตุผลการตัดออก</label>
              <select class="inp" id="scReason">${OUT_REASONS.map(r =>
                `<option value="${r.k}">${r.n}</option>`).join('')}</select></div>
            <div class="field" style="margin:0" id="scDestWrap"><label>ปลายทาง</label>
              <select class="inp" id="scDest">${locs.filter(l => l.id !== loc.id).map(l =>
                `<option value="${l.id}">${l.kind === 'event' ? '🎪' : '🏪'} ${esc(l.name)}</option>`).join('')}
              </select></div>`}
          </div>
        </div>
        <div class="card" style="margin-top:14px">
          <div class="card-title"><span class="ic">📋</span> รายการที่สแกนแล้ว
            <span class="sub" id="scCount">0 ชิ้น</span></div>
          <div id="scList"></div>
          <button class="btn gold block" style="margin-top:12px;padding:12px" id="scGo">
            ${isIn ? '✓ ยืนยันรับเข้าคลัง' : '✓ ยืนยันตัดออกจากคลัง'}</button>
        </div>
      </div>
      <div>
        <div class="card">
          <div class="card-title"><span class="ic">🕘</span> ประวัติล่าสุด <span class="sub">20 รายการ</span></div>
          ${history.length ? history.map(h => `
            <div class="ci"><div class="info">
              <div class="nm">${esc(h.name.slice(0, 34))}</div>
              <div class="meta">${new Date(h.created_at).toLocaleString('th-TH', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}
                · ${TYPE_NAME[h.move_type] || h.move_type}${h.ref_no ? ' · ' + esc(h.ref_no) : ''}
                ${h.created_by_name ? ' · ' + esc(h.created_by_name) : ''}</div></div>
              <div style="align-self:center" class="tag ${h.qty > 0 ? 'green' : 'red'}">
                ${h.qty > 0 ? '+' : ''}${h.qty}</div></div>`).join('')
            : '<div class="cart-empty"><span class="big">🕘</span>ยังไม่มีประวัติ</div>'}
        </div>
        <div class="notice warn" style="margin-top:14px">⚠️ บรรทัดในสมุดเดินของแก้ย้อนหลังไม่ได้
          ถ้าลงผิดให้ลงรายการกลับทางแทน ประวัติจะได้ครบว่าเกิดอะไรขึ้นบ้าง</div>
      </div>
    </div>`;
  },

  mount(el) {
    root = el;
    drawList();
    el.querySelector('#scCam').onclick = () => openCameraModal(addCode);
    const detach = attachWedge(addCode);
    keepFocus(el, '#scInput');
    el.querySelector('#scInput').onkeydown = async e => {
      if (e.key !== 'Enter') return;
      const v = e.target.value.trim(); e.target.value = '';
      if (v) await addCode(v);
    };
    el.querySelector('#scGo').onclick = commit;
    const reason = el.querySelector('#scReason');
    if (reason) {
      const sync = () => {
        const r = OUT_REASONS.find(x => x.k === reason.value);
        el.querySelector('#scDestWrap').style.display = r.needsDest ? '' : 'none';
      };
      reason.onchange = sync; sync();
    }
    el.querySelector('#scMode').onclick = async e => {
      const b = e.target.closest('[data-mode]'); if (!b) return;
      mode = b.dataset.mode; list = [];
      await redrawPage(el, scanPage);
    };
    el.addEventListener('click', e => {
      const x = e.target.closest('[data-x]');
      if (x) { list.splice(+x.dataset.x, 1); drawList(); }
    });
    el.addEventListener('change', e => {
      const q = e.target.closest('[data-q]');
      if (q) { list[+q.dataset.q].qty = Math.max(1, Number(q.value) || 1); drawList(); }
    });

    return detach;
  },
};
