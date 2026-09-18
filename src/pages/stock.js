/* สินค้า & สต๊อกคงเหลือ
 * ยอดคงเหลือทุกตัวมาจากการบวกสมุดเดินของ ไม่มีช่อง "คงเหลือ" ให้แก้ตรง ๆ
 * ถ้านับสต๊อกแล้วไม่ตรง ให้ลงรายการปรับยอดที่หน้ารับเข้า/ตัดออก จะได้มีประวัติว่าใครปรับ
 */
import { money, esc, toast, openModal, closeModal, uuid } from '../lib/util.js';
import { db, stockMap, currentLocation } from '../lib/store.js';
import { S } from '../lib/state.js';
import { hasBackend } from '../config.js';
import { currentUser, push as syncNow } from '../lib/sync.js';

let products = [], vendors = [], sets = [], stock = new Map(), all = new Map();
let q = '', cat = 'ทั้งหมด', root = null, loc = null;

async function load() {
  loc = await currentLocation();
  products = await db.products.toArray();
  vendors  = await db.vendors.toArray();
  sets     = await db.card_sets.toArray();
  stock    = await stockMap(loc.id);
  all      = await stockMap(null);
}
const vName = id => (vendors.find(v => v.id === id) || {}).name || '-';
const sName = id => (sets.find(s => s.id === id) || {}).code || '-';

function filtered() {
  const low = q.toLowerCase();
  return products.filter(p =>
    (cat === 'ทั้งหมด' || p.category === cat) &&
    (!low || p.name.toLowerCase().includes(low) || p.sku.includes(low)));
}

function editProduct(id) {
  if (S.role === 'admin') { toast('แก้ข้อมูลสินค้าได้เฉพาะหัวหน้างานขึ้นไป', 'err'); return; }
  const p = id ? products.find(x => x.id === id) : null;
  openModal(`
    <div class="modal-head"><h3>${p ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าใหม่'}</h3>
      <button class="x" id="mClose">✕</button></div>
    <div class="modal-body">
      <div class="field"><label>ชื่อสินค้า *</label>
        <input class="inp" id="pName" value="${p ? esc(p.name) : ''}"></div>
      <div class="grid g2" style="gap:9px">
        <div class="field"><label>รหัส / บาร์โค้ด *</label>
          <input class="inp" id="pSku" value="${p ? esc(p.sku) : ''}" ${p ? 'disabled' : ''}></div>
        <div class="field"><label>หมวด</label>
          <select class="inp" id="pCat">${['Booster Box','Booster Pack','การ์ดแยกใบ','อุปกรณ์','ETB','Starter','Bundle','อื่น ๆ']
            .map(c => `<option ${p && p.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      </div>
      <div class="grid g2" style="gap:9px">
        <div class="field"><label>บล็อกเซต</label>
          <select class="inp" id="pSet"><option value="">—</option>
            ${sets.map(s => `<option value="${s.id}" ${p && p.set_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
        <div class="field"><label>ผู้ฝากขาย</label>
          <select class="inp" id="pVen"><option value="">—</option>
            ${vendors.map(v => `<option value="${v.id}" ${p && p.vendor_id === v.id ? 'selected' : ''}>${esc(v.code)} · ${esc(v.name)}</option>`).join('')}</select></div>
      </div>
      <div class="grid g2" style="gap:9px">
        <div class="field"><label>ราคาขาย</label>
          <input class="inp" id="pPrice" type="number" value="${p ? p.price : 0}"></div>
        <div class="field"><label>ต้นทุน</label>
          <input class="inp" id="pCost" type="number" value="${p ? (p.cost || 0) : 0}"></div>
      </div>
      ${p ? '' : `<div class="field" style="margin:0"><label>สต๊อกตั้งต้น (ลงเป็นรายการรับเข้า)</label>
        <input class="inp" id="pStock" type="number" value="0"></div>`}
      <label class="chk"><input type="checkbox" id="pSingle" ${p && p.is_single ? 'checked' : ''}>
        การ์ดแยกใบ (หนึ่งรายการ = หนึ่งใบ ราคาต่างกันได้ทีละใบ)</label>
    </div>
    <div class="modal-foot"><button class="btn ghost" id="mNo">ยกเลิก</button>
      <button class="btn gold" id="mOk">บันทึก</button></div>`);
  const box = document.getElementById('modalBox');
  const v = k => box.querySelector('#' + k).value.trim();
  box.querySelector('#mClose').onclick = box.querySelector('#mNo').onclick = closeModal;
  box.querySelector('#mOk').onclick = async () => {
    const name = v('pName'), sku = p ? p.sku : v('pSku');
    if (!name || !sku) { toast('กรอกชื่อและรหัสให้ครบ', 'err'); return; }
    const price = Number(v('pPrice')) || 0, cost = Number(v('pCost')) || 0;
    const now = new Date().toISOString();

    if (p) {
      const updated = { name, category: v('pCat'), set_id: v('pSet') || null,
        vendor_id: v('pVen') || null, price, cost, is_single: box.querySelector('#pSingle').checked };
      if (p.price !== price || (p.cost || 0) !== cost) {
        await db.meta.put({ key: 'ph:' + uuid(), value: { product_id: p.id, price, cost, at: now, by: S.role } });
      }
      await db.products.update(p.id, updated);
      if (hasBackend() && currentUser()) {
        await db.outbox.add({ kind: 'product_update', at: now,
          payload: { id: p.id, changes: updated, cost } });
      }
      toast('บันทึกการแก้ไขแล้ว', 'ok');
    } else {
      if (await db.products.where('sku').equals(sku).first()) { toast('มีรหัสนี้อยู่แล้ว', 'err'); return; }
      const id = 'prd-' + sku;
      const product = { id, sku, name, category: v('pCat'), set_id: v('pSet') || null,
        vendor_id: v('pVen') || null, price, cost, vat_rate: 0,
        is_single: box.querySelector('#pSingle').checked, is_active: true, icon: '🃏' };
      const barcode = { barcode: sku, product_id: id, kind: 'shop' };
      const st = Number(v('pStock')) || 0;
      const move = st ? { id: uuid(), product_id: id, location_id: loc.id, qty: st,
        move_type: 'opening', ref_no: 'สต๊อกตั้งต้นตอนเพิ่มสินค้า', created_at: now } : null;
      await db.transaction('rw', db.products, db.barcodes, db.stock_moves, db.outbox, async () => {
        await db.products.put(product);
        await db.barcodes.put(barcode);
        if (move) await db.stock_moves.put(move);
        if (hasBackend() && currentUser()) await db.outbox.add({ kind: 'product', at: now,
          payload: { product, barcode, move, cost } });
      });
      toast('เพิ่มสินค้าแล้ว', 'ok');
    }
    closeModal();
    document.dispatchEvent(new CustomEvent('siatoy:changed'));
    const synced = await syncNow();
    if (synced.failed) { toast('บันทึกขึ้น Supabase ไม่สำเร็จ: ' + synced.failed, 'err'); return; }
    location.reload();
  };
}

export const stockPage = {
  async render() {
    await load();
    const list = filtered();
    const qty  = products.reduce((a, p) => a + (all.get(p.id) || 0), 0);
    const costV = products.reduce((a, p) => a + (p.cost || 0) * (all.get(p.id) || 0), 0);
    const sellV = products.reduce((a, p) => a + p.price * (all.get(p.id) || 0), 0);
    const cats = ['ทั้งหมด', ...new Set(products.map(p => p.category).filter(Boolean))];

    return `
    <div class="page-head">
      <div><h1>สินค้า &amp; สต๊อกคงเหลือ</h1>
        <p>คงเหลือคำนวณจากสมุดเดินของทุกครั้ง · แสดงยอดรวมทุกจุดขาย และของที่ ${esc(loc.name)}</p></div>
      <div class="spacer"></div>
      <div class="flex wrap">
        <button class="btn" onclick="location.hash='#/labels'">🖨️ พิมพ์สติกเกอร์</button>
        <button class="btn gold sup-up" id="stAdd">+ เพิ่มสินค้า</button>
      </div>
    </div>
    <div class="grid g4" style="margin-bottom:16px">
      <div class="stat"><div class="lbl">จำนวนคงเหลือรวม</div><div class="val">${money(qty)}</div>
        <div class="sub">${products.length} รายการ</div></div>
      <div class="stat sup-up"><div class="lbl">มูลค่าตามต้นทุน</div><div class="val">฿ ${money(costV)}</div>
        <div class="sub">ราคารับเข้า</div></div>
      <div class="stat"><div class="lbl">มูลค่าตามราคาขาย</div><div class="val g">฿ ${money(sellV)}</div>
        <div class="sub">ถ้าขายหมดทั้งคลัง</div></div>
      <div class="stat sup-up"><div class="lbl">กำไรคาดหวัง</div>
        <div class="val green">฿ ${money(sellV - costV)}</div>
        <div class="sub">${sellV ? Math.round((sellV - costV) / sellV * 100) : 0}% ของราคาขาย</div></div>
    </div>
    ${S.role === 'admin' ? `<div class="notice info" style="margin-bottom:14px">🔒 คุณกำลังดูในสิทธิ์พนักงานหน้าร้าน
      ข้อมูลต้นทุนถูกซ่อนไว้</div>` : ''}
    <div class="flex wrap" style="margin-bottom:12px;gap:10px">
      <input class="inp" id="stQ" style="max-width:280px" placeholder="🔍 ค้นหาชื่อหรือรหัสสินค้า" value="${esc(q)}">
      <div class="seg">${cats.map(c => `<button class="${c === cat ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    </div>
    <div id="stArea">${stockPage.tableHTML()}</div>`;
  },

  tableHTML() {
    const list = filtered();
    const sName2 = sName, vName2 = vName;
    return `
    <div class="card tight"><div class="tbl-wrap"><table>
      <thead><tr><th>บาร์โค้ด</th><th>สินค้า</th><th>หมวด</th><th>เซต</th><th>ผู้ฝากขาย</th>
        <th class="num">ต้นทุน</th><th class="num">ราคาขาย</th>
        <th class="num">ที่ ${esc(loc.code)}</th><th class="num">รวมทุกจุด</th>
        <th class="num">มูลค่าขาย</th><th></th></tr></thead>
      <tbody>${list.map(p => {
        const here = stock.get(p.id) || 0, tot = all.get(p.id) || 0;
        return `<tr>
          <td class="mini">${esc(p.sku)}</td>
          <td>${p.icon || '🃏'} ${esc(p.name)}${p.is_single ? ' <span class="tag purple">ใบเดียว</span>' : ''}</td>
          <td><span class="tag">${esc(p.category || '-')}</span></td>
          <td class="mini">${esc(sName(p.set_id))}</td>
          <td class="mini">${esc(vName(p.vendor_id).slice(0, 16))}</td>
          <td class="num"><span class="cost-cell">${money(p.cost || 0)}</span></td>
          <td class="num" style="color:var(--gold2)">${money(p.price)}</td>
          <td class="num">${here <= 3 ? `<span class="tag red">${here}</span>` : here}</td>
          <td class="num">${tot}</td>
          <td class="num">${money(p.price * tot)}</td>
          <td class="num"><button class="btn sm sup-up" data-edit="${p.id}">แก้ไข</button></td>
        </tr>`; }).join('')}</tbody></table></div></div>
    ${list.length ? '' : '<div class="card" style="margin-top:12px"><div class="cart-empty"><span class="big">🔍</span>ไม่พบสินค้าที่ค้นหา</div></div>'}`;
  },

  mount(el) {
    root = el;
    // วาดใหม่เฉพาะตาราง ช่องค้นหาจึงไม่เสียโฟกัสและเคอร์เซอร์ไม่กระโดด
    const redraw = () => { el.querySelector('#stArea').innerHTML = stockPage.tableHTML(); };
    const inp = el.querySelector('#stQ');
    inp.oninput = e => { q = e.target.value; clearTimeout(inp._t); inp._t = setTimeout(redraw, 200); };
    el.querySelector('#stAdd').onclick = () => editProduct(null);
    el.addEventListener('click', e => {
      const c = e.target.closest('[data-cat]');
      if (c) {
        cat = c.dataset.cat;
        el.querySelectorAll('[data-cat]').forEach(b => b.classList.toggle('on', b.dataset.cat === cat));
        redraw(); return;
      }
      const ed = e.target.closest('[data-edit]'); if (ed) editProduct(ed.dataset.edit);
    });
  },
};
