/* สต๊อกออกงานอีเวนต์
 * บูธงานคือ "จุดขาย" อีกจุดหนึ่ง ของที่ยกไปจึงยังอยู่ในระบบ แค่ย้ายที่อยู่
 * ทำให้รู้ตลอดว่าที่บูธเหลืออะไร และรับกลับเข้าร้านได้ครบ
 */
import { money, esc, uuid, toast, openModal, closeModal, redrawPage } from '../lib/util.js';
import { db, stockMap, currentLocation, deviceId } from '../lib/store.js';
import { S } from '../lib/state.js';

let locs = [], products = [], here = null, sel = null, byLoc = {}, sales = [];

function addBooth() {
  openModal(`
    <div class="modal-head"><h3>เพิ่มจุดขายบูธงาน</h3><button class="x" id="mClose">✕</button></div>
    <div class="modal-body">
      <div class="field"><label>ชื่อบูธ / งาน</label>
        <input class="inp" id="nlName" placeholder="เช่น บูธ Bangkok TCG Fest"></div>
      <div class="field" style="margin:0"><label>รหัสสั้น (ใช้ในเลขบิล ตัวอักษรอังกฤษ/ตัวเลข)</label>
        <input class="inp" id="nlCode" placeholder="เช่น FEST02"></div>
    </div>
    <div class="modal-foot"><button class="btn ghost" id="mNo">ยกเลิก</button>
      <button class="btn gold" id="mOk">เพิ่มบูธ</button></div>`);
  const box = document.getElementById('modalBox');
  box.querySelector('#mClose').onclick = box.querySelector('#mNo').onclick = closeModal;
  box.querySelector('#mOk').onclick = async () => {
    const name = box.querySelector('#nlName').value.trim();
    const code = box.querySelector('#nlCode').value.trim().toUpperCase();
    if (!name || !code) { toast('กรอกชื่อบูธและรหัสให้ครบ', 'err'); return; }
    if (await db.locations.where('code').equals(code).first()) { toast('รหัสจุดขายนี้มีอยู่แล้ว', 'err'); return; }
    await db.locations.put({ id: 'loc-' + code.toLowerCase(), code, name, kind: 'event', is_active: true });
    closeModal(); toast('เพิ่มบูธ ' + esc(name) + ' แล้ว', 'ok'); location.reload();
  };
}

async function load() {
  here = await currentLocation();
  locs = await db.locations.toArray();
  products = await db.products.toArray();
  sales = await db.sales.toArray();
  byLoc = {};
  for (const l of locs) byLoc[l.id] = await stockMap(l.id);
  if (!sel || !locs.find(l => l.id === sel)) {
    const ev = locs.find(l => l.kind === 'event');
    sel = ev ? ev.id : locs[0].id;
  }
}

const pName = id => (products.find(p => p.id === id) || {}).name || id;
const pIcon = id => (products.find(p => p.id === id) || {}).icon || '🃏';

function locStats(id) {
  const ok = sales.filter(s => s.location_id === id && s.status === 'normal');
  return { amount: ok.reduce((a, s) => a + s.total, 0), bills: ok.length };
}

/* ของที่บูธ : ยกไปเท่าไหร่ ขายไปเท่าไหร่ เหลือเท่าไหร่ */
async function boothRows(locId) {
  const rows = new Map();
  await db.stock_moves.each(m => {
    if (m.location_id !== locId) return;
    const r = rows.get(m.product_id) || { in: 0, sold: 0, left: 0 };
    if (m.qty > 0) r.in += m.qty;
    if (m.move_type === 'sale' || m.move_type === 'open_card') r.sold += -m.qty;
    r.left += m.qty;
    rows.set(m.product_id, r);
  });
  return [...rows.entries()].filter(([, r]) => r.in > 0)
    .map(([id, r]) => ({ id, ...r }));
}

function bringBack(locId) {
  const l = locs.find(x => x.id === locId);
  const stock = byLoc[locId];
  const items = [...stock.entries()].filter(([, q]) => q > 0);
  if (!items.length) { toast('ที่ ' + l.name + ' ไม่มีของเหลือให้รับกลับ'); return; }
  openModal(`
    <div class="modal-head"><h3>รับของกลับเข้าคลัง · ${esc(l.name)}</h3>
      <button class="x" id="mClose">✕</button></div>
    <div class="modal-body">
      <div class="notice info">ของจะถูกย้ายกลับไปที่ <b>${esc(here.name)}</b>
        โดยลงเป็นสองบรรทัดในสมุดเดินของ ออกจากบูธและเข้าร้าน ยอดจึงตรงทั้งสองฝั่ง</div>
      <div style="margin-top:14px;max-height:320px;overflow:auto">
        ${items.map(([id, q]) => `<div class="ci">
          <div style="font-size:20px;align-self:center">${pIcon(id)}</div>
          <div class="info"><div class="nm">${esc(pName(id))}</div>
            <div class="meta">เหลือที่บูธ ${q} ชิ้น</div></div>
          <input class="inp" style="width:80px;padding:6px;text-align:center;align-self:center"
            type="number" min="0" max="${q}" value="${q}" data-back="${id}"></div>`).join('')}
      </div>
    </div>
    <div class="modal-foot"><button class="btn ghost" id="mNo">ยกเลิก</button>
      <button class="btn gold" id="mOk">ยืนยันรับกลับ</button></div>`, true);
  const box = document.getElementById('modalBox');
  box.querySelector('#mClose').onclick = box.querySelector('#mNo').onclick = closeModal;
  box.querySelector('#mOk').onclick = async () => {
    const now = new Date().toISOString(), dev = await deviceId(), docId = uuid();
    const by = { admin: 'พนักงาน', sup: 'หัวหน้า', owner: 'เจ้าของ' }[S.role];
    const moves = [];
    box.querySelectorAll('[data-back]').forEach(inp => {
      const qty = Math.max(0, Math.min(Number(inp.max), Number(inp.value) || 0));
      if (!qty) return;
      const pid = inp.dataset.back;
      moves.push({ id: uuid(), product_id: pid, location_id: locId, qty: -qty,
        move_type: 'transfer_out', ref_id: docId, reason: 'รับกลับเข้า ' + here.name,
        created_by_name: by, device_id: dev, created_at: now });
      moves.push({ id: uuid(), product_id: pid, location_id: here.id, qty,
        move_type: 'transfer_in', ref_id: docId, reason: 'รับกลับจาก ' + l.name,
        created_by_name: by, device_id: dev, created_at: now });
    });
    if (!moves.length) { toast('ยังไม่ได้ระบุจำนวน', 'err'); return; }
    await db.transaction('rw', db.stock_moves, db.outbox, async () => {
      await db.stock_moves.bulkPut(moves);
      await db.outbox.add({ kind: 'stock', at: now, payload: { moves } });
    });
    closeModal();
    toast('รับของกลับเข้าคลังแล้ว ' + (moves.length / 2) + ' รายการ', 'ok');
    location.reload();
  };
}

export const eventPage = {
  async render() {
    await load();
    const rows = await boothRows(sel);
    const shop = locs.find(l => l.kind === 'shop') || locs[0];
    const evs  = locs.filter(l => l.kind === 'event');
    const s = locs.find(l => l.id === sel);

    const summaryLocs = s && s.kind === 'event' ? [shop, s] : [shop];
    return `
    <div class="page-head"><div><h1>สต๊อกออกงานอีเวนต์</h1>
      <p>บูธงานคือจุดขายอีกจุดหนึ่ง ของที่ยกไปยังอยู่ในระบบและรับกลับได้ครบ</p></div></div>

    <div class="grid g2" style="margin-bottom:16px">
      ${summaryLocs.filter(Boolean).map(l => {
        const st = locStats(l.id);
        const qty = [...(byLoc[l.id] || new Map()).values()].reduce((a, q) => a + q, 0);
        return `<div class="card" ${l.kind === 'event' ? 'style="border-color:var(--gold-line)"' : ''}>
          <div class="card-title"><span class="ic">${l.kind === 'event' ? '🎪' : '🏪'}</span> ${esc(l.name)}
            <span class="sub">${l.id === here.id ? 'เครื่องนี้อยู่ที่นี่' : esc(l.code)}</span></div>
          <div class="grid g3" style="gap:10px">
            <div><div class="mini">ยอดขายสะสม</div>
              <div style="font-size:19px;color:var(--gold2)">฿ ${money(st.amount)}</div></div>
            <div><div class="mini">จำนวนบิล</div><div style="font-size:19px">${st.bills}</div></div>
            <div><div class="mini">ของคงเหลือ</div><div style="font-size:19px">${money(qty)} ชิ้น</div></div>
          </div>
        </div>`;
      }).join('')}
      ${!evs.length ? `<button class="card" id="addBooth" style="border:1px dashed var(--gold-line);cursor:pointer;text-align:left">
        <div class="card-title"><span class="ic">➕</span> เพิ่มจุดขายบูธงาน</div>
        <div class="mini">สร้างบูธใหม่เพื่อย้ายสต๊อกและแยกยอดขายจากหน้าร้าน</div></button>` : ''}
    </div>

    ${evs.length ? `
    <div class="flex wrap" style="margin-bottom:12px">
      <div class="seg">${evs.map(l =>
        `<button class="${l.id === sel ? 'on' : ''}" data-loc="${l.id}">🎪 ${esc(l.name)}</button>`).join('')}</div>
    </div>
    <div class="card tight"><div class="tbl-wrap"><table>
      <thead><tr><th>สินค้า</th><th class="num">ยกไปทั้งหมด</th><th class="num">ขายได้</th>
        <th class="num">คงเหลือที่บูธ</th><th class="num">มูลค่าที่ขายแล้ว</th><th>สถานะ</th></tr></thead>
      <tbody>${rows.length ? rows.map(r => {
        const p = products.find(x => x.id === r.id) || {};
        return `<tr><td>${pIcon(r.id)} ${esc(pName(r.id))}</td>
          <td class="num">${r.in}</td>
          <td class="num" style="color:var(--green)">${r.sold}</td>
          <td class="num">${r.left}</td>
          <td class="num" style="color:var(--gold2)">${money(r.sold * (p.price || 0))}</td>
          <td>${r.left === 0 ? '<span class="tag red">หมด</span>' : '<span class="tag green">มีของ</span>'}</td></tr>`;
      }).join('') : '<tr><td colspan="6" class="mini">ยังไม่ได้ยกของไปที่บูธนี้</td></tr>'}</tbody>
    </table></div></div>
    <div class="flex wrap" style="margin-top:14px">
      <button class="btn gold" onclick="location.hash='#/scan'">📤 สแกนยกของไปงาน</button>
      <button class="btn" data-back-btn="${sel}">📥 รับของกลับเข้าคลัง</button>
    </div>`
    : `<div class="card"><div class="cart-empty"><span class="big">🎪</span>
        ยังไม่มีจุดขายแบบบูธงาน<br>กดปุ่มเพิ่มจุดขายด้านบนเพื่อเริ่มต้น</div></div>`}`;
  },

  mount(el) {
    el.addEventListener('click', async e => {
      const l = e.target.closest('[data-loc]');
      if (l) { sel = l.dataset.loc; await redrawPage(el, eventPage); return; }
      const b = e.target.closest('[data-back-btn]');
      if (b) bringBack(b.dataset.backBtn);
      if (e.target.closest('#addBooth')) addBooth();
    });
  },
};
