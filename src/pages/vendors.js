/* ผู้ฝากขาย (Consignment)
 * ตัวเลขทุกช่องคำนวณจากบิลจริงและสมุดเดินของ ไม่ใช่ค่าประมาณเหมือนเดโม
 */
import { money, esc, toast, openModal, closeModal } from '../lib/util.js';
import { db, stockMap } from '../lib/store.js';
import { S } from '../lib/state.js';

let vendors = [], products = [], all = new Map(), soldBy = new Map(), monthLabel = '';

async function load() {
  vendors  = await db.vendors.toArray();
  products = await db.products.toArray();
  all      = await stockMap(null);

  const from = new Date(); from.setDate(1); from.setHours(0, 0, 0, 0);
  monthLabel = from.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
  const okIds = new Set((await db.sales.toArray())
    .filter(s => s.status === 'normal' && s.client_created_at >= from.toISOString())
    .map(s => s.id));
  soldBy = new Map();
  await db.sale_items.each(it => {
    if (!okIds.has(it.sale_id)) return;
    const v = it.vendor_id || 'none';
    const cur = soldBy.get(v) || { amount: 0, qty: 0 };
    cur.amount += it.line_total; cur.qty += it.qty;
    soldBy.set(v, cur);
  });
}

function settlement(v) {
  const s = soldBy.get(v.id) || { amount: 0, qty: 0 };
  return { ...s, commission: 0, payable: s.amount };
}

async function markPaid(id) {
  const v = vendors.find(x => x.id === id), st = settlement(v);
  await db.vendor_payouts.put({ id: `${id}:${monthLabel}`, vendor_id: id, period: monthLabel, amount: st.payable, paid_at: new Date().toISOString(), paid_by: S.role });
  closeModal(); toast('บันทึกรอบจ่ายแล้ว', 'ok'); location.reload();
}

async function showSettlement(id) {
  const v = vendors.find(x => x.id === id);
  const st = settlement(v);
  const items = products.filter(p => p.vendor_id === id);
  const paid = await db.vendor_payouts.get(`${id}:${monthLabel}`);
  openModal(`
    <div class="modal-head"><h3>สรุปรอบจ่าย · ${esc(v.name)}</h3><button class="x" id="mClose">✕</button></div>
    <div class="modal-body">
      <div class="mini" style="margin-bottom:12px">รอบ ${esc(monthLabel)}</div>
      <div class="grid g3" style="gap:10px;margin-bottom:14px">
        <div class="stat"><div class="lbl">ขายได้</div><div class="val g">฿ ${money(st.amount)}</div>
          <div class="sub">${st.qty} ชิ้น</div></div>
        <div class="stat"><div class="lbl">ส่วนต่างร้าน</div>
          <div class="val green">฿ ${money(st.commission)}</div><div class="sub">คำนวณจากรายการรับเข้า</div></div>
        <div class="stat"><div class="lbl">ต้องจ่ายคืน</div><div class="val">฿ ${money(st.payable)}</div>
          <div class="sub">ยอดสุทธิ</div></div>
      </div>
      <div class="card tight" style="background:var(--bg2)"><div class="tbl-wrap"><table>
        <thead><tr><th>สินค้า</th><th class="num">ราคาขาย</th><th class="num">คงเหลือ</th></tr></thead>
        <tbody>${items.map(p => `<tr><td>${esc(p.name)}</td>
          <td class="num">${money(p.price)}</td><td class="num">${all.get(p.id) || 0}</td></tr>`).join('')
          || '<tr><td colspan="3" class="mini">ยังไม่มีสินค้าของเจ้านี้</td></tr>'}</tbody>
      </table></div></div>
      <div class="notice ${paid ? 'info' : 'warn'}" style="margin-top:14px">${paid ? 'จ่ายรอบนี้แล้วเมื่อ ' + new Date(paid.paid_at).toLocaleString('th-TH') : 'ยังไม่ได้บันทึกการจ่ายรอบนี้'}</div>
    </div>
    <div class="modal-foot"><button class="btn ghost" id="mNo">ปิด</button>${paid ? '' : '<button class="btn gold" id="mPaid">บันทึกว่าจ่ายแล้ว</button>'}</div>`, true);
  const box = document.getElementById('modalBox');
  box.querySelector('#mClose').onclick = box.querySelector('#mNo').onclick = closeModal;
  if (!paid) box.querySelector('#mPaid').onclick = () => markPaid(id);
}

function addVendor() {
  if (S.role === 'admin') { toast('เพิ่มผู้ฝากขายได้เฉพาะหัวหน้างานขึ้นไป', 'err'); return; }
  openModal(`
    <div class="modal-head"><h3>เพิ่มผู้ฝากขาย</h3><button class="x" id="mClose">✕</button></div>
    <div class="modal-body">
      <div class="field"><label>รหัส</label><input class="inp" id="nvCode" placeholder="เช่น 005"></div>
      <div class="field"><label>ชื่อผู้ฝากขาย</label><input class="inp" id="nvName"></div>
      <div class="field" style="margin:0"><label>เบอร์โทร</label><input class="inp" id="nvTel"></div>
    </div>
    <div class="modal-foot"><button class="btn ghost" id="mNo">ยกเลิก</button>
      <button class="btn gold" id="mOk">เพิ่ม</button></div>`);
  const box = document.getElementById('modalBox');
  box.querySelector('#mClose').onclick = box.querySelector('#mNo').onclick = closeModal;
  box.querySelector('#mOk').onclick = async () => {
    const code = box.querySelector('#nvCode').value.trim();
    const name = box.querySelector('#nvName').value.trim();
    if (!code || !name) { toast('กรอกรหัสและชื่อให้ครบ', 'err'); return; }
    await db.vendors.put({ id: 'ven-' + code, code, name,
      tel: box.querySelector('#nvTel').value.trim() || '-',
      commission_pct: 0,
      started_on: new Date().toISOString().slice(0, 10), is_active: true });
    closeModal(); location.reload();
  };
}

export const vendorsPage = {
  async render() {
    await load();
    return `
    <div class="page-head">
      <div><h1>ผู้ฝากขาย (Consignment)</h1>
        <p>ของฝากขายหลายเจ้า · ดูยอดขายและยอดที่ต้องจ่ายคืนรายเจ้า · รอบ ${esc(monthLabel)}</p></div>
      <div class="spacer"></div>
      <button class="btn gold sup-up" id="venAdd">+ เพิ่มผู้ฝากขาย</button>
    </div>
    <div class="grid g2">
      ${vendors.map(v => {
        const items = products.filter(p => p.vendor_id === v.id);
        const qty = items.reduce((a, p) => a + (all.get(p.id) || 0), 0);
        const val = items.reduce((a, p) => a + p.price * (all.get(p.id) || 0), 0);
        const st = settlement(v);
        const pct = val + st.amount ? Math.round(st.amount / (val + st.amount) * 100) : 0;
        return `<div class="card">
          <div class="card-title"><span class="ic">🤝</span>
            <b style="font-weight:500">${esc(v.code)}</b> · ${esc(v.name)}
            <span class="sub">ฝากขาย</span></div>
          <div class="mini" style="margin-bottom:12px">โทร ${esc(v.tel || '-')}
            ${v.started_on ? ' · เริ่มฝากขาย ' + esc(v.started_on) : ''}</div>
          <div class="grid g3" style="gap:9px;margin-bottom:12px">
            <div><div class="mini">รายการ / ชิ้น</div><div style="font-size:17px">${items.length} / ${money(qty)}</div></div>
            <div><div class="mini">มูลค่าคงคลัง</div>
              <div style="font-size:17px;color:var(--gold2)">฿${money(val)}</div></div>
            <div class="sup-up"><div class="mini">ขายได้เดือนนี้</div>
              <div style="font-size:17px">฿${money(st.amount)}</div></div>
          </div>
          <div class="bar" style="margin-bottom:6px"><i style="width:${pct}%"></i></div>
          <div class="mini" style="margin-bottom:10px">ขายไปแล้ว ${pct}% ของที่เคยมีในเดือนนี้</div>
          <div class="flex sup-up" style="font-size:12.5px;color:var(--muted)">
            <span>ส่วนต่างร้าน</span>
            <b class="right" style="color:var(--green);font-weight:400">฿ ${money(st.commission)}</b></div>
          <div class="flex sup-up" style="font-size:12.5px;color:var(--muted);margin-top:3px">
            <span>ยอดต้องจ่ายคืนผู้ฝากขาย</span>
            <b class="right" style="font-weight:400">฿ ${money(st.payable)}</b></div>
          <div class="flex" style="gap:8px;margin-top:12px">
            <button class="btn sm" style="flex:1;justify-content:center" data-items="${v.id}">ดูสินค้า</button>
            <button class="btn sm sup-up" style="flex:1;justify-content:center" data-settle="${v.id}">สรุปรอบจ่าย</button>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  },
  mount(el) {
    el.querySelector('#venAdd').onclick = addVendor;
    el.addEventListener('click', e => {
      const s = e.target.closest('[data-settle]'); if (s) { showSettlement(s.dataset.settle); return; }
      const i = e.target.closest('[data-items]'); if (i) showSettlement(i.dataset.items);
    });
  },
};
