/* บิลขาย / ยกเลิกบิล
 * ยกเลิกแล้วของกลับเข้าคลังจริง เพราะลงเป็นบรรทัดคืนของในสมุดเดินของ
 * ไม่ได้แค่เปลี่ยนสถานะบนหน้าจอเหมือนเดโม
 */
import { money, esc, toast, openModal, closeModal, redrawPage, downloadExcel } from '../lib/util.js';
import { db, voidSale } from '../lib/store.js';
import { S } from '../lib/state.js';

let range = 'today', root = null, bills = [], customFrom = '', customTo = '';

const customBounds = () => {
  if (!customFrom && !customTo) return null;
  const from = customFrom ? new Date(`${customFrom}T00:00:00`) : new Date(0);
  const to = customTo ? new Date(`${customTo}T23:59:59.999`) : new Date();
  return { from, to };
};

const startOf = r => {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  if (r === '7d') d.setDate(d.getDate() - 6);
  if (r === 'all') return new Date(0);
  return d;
};

async function load() {
  const custom = customBounds();
  const from = custom ? custom.from : startOf(range);
  const to = custom ? custom.to : new Date(8640000000000000);
  bills = (await db.sales.toArray())
    .filter(b => { const at = new Date(b.client_created_at); return at >= from && at <= to; })
    .sort((a, b) => b.client_created_at.localeCompare(a.client_created_at));
}

const payTag = p => ({
  cash:     '<span class="tag green">💵 เงินสด</span>',
  transfer: '<span class="tag blue">📱 โอน</span>',
  credit:   '<span class="tag purple">💳 บัตร</span>',
  none:     '<span class="tag purple">👑 เปิดการ์ด</span>',
}[p] || '<span class="tag">-</span>');

const stTag = s => ({
  normal:    '<span class="tag green">ปกติ</span>',
  void:      '<span class="tag red">ยกเลิก</span>',
  open_card: '<span class="tag purple">เปิดการ์ด</span>',
}[s]);

function askVoid(id) {
  const b = bills.find(x => x.id === id);
  if (S.role === 'admin') {
    openModal(`
      <div class="modal-head"><h3>🔒 ต้องใช้สิทธิ์หัวหน้างาน</h3><button class="x" id="mClose">✕</button></div>
      <div class="modal-body">
        <div class="notice red">พนักงานหน้าร้านมีสิทธิ์ทำบิลและรับเงินเท่านั้น
          การยกเลิกบิลต้องให้หัวหน้างานขึ้นไปเป็นผู้อนุมัติ</div>
      </div>
      <button class="btn" id="billExport">📊 Export Excel</button>
      <div class="modal-foot"><button class="btn ghost" id="mOk">ปิด</button></div>`);
    const box = document.getElementById('modalBox');
    box.querySelector('#mClose').onclick = box.querySelector('#mOk').onclick = closeModal;
    return;
  }
  openModal(`
    <div class="modal-head"><h3>ยกเลิกบิล ${esc(b.bill_no)}</h3><button class="x" id="mClose">✕</button></div>
    <div class="modal-body">
      <div class="notice warn">ระบบไม่แก้รายการในบิลเดิม แต่ยกเลิกทั้งใบแล้วทำใหม่
        เพื่อให้ตรวจย้อนหลังได้ครบ · สินค้า <b>${b.item_count} ชิ้น</b> จะถูกคืนเข้าคลังอัตโนมัติ</div>
      <div class="field" style="margin-top:14px"><label>เหตุผลการยกเลิก</label>
        <select class="inp" id="vr">
          <option>ลืมใส่ส่วนลด</option><option>คีย์ราคาผิด</option>
          <option>สแกนสินค้าผิดชิ้น</option><option>ลูกค้ายกเลิกการซื้อ</option>
          <option>รับเงินไม่ครบ</option><option>อื่น ๆ</option>
        </select></div>
    </div>
    <div class="modal-foot">
      <button class="btn ghost" id="mNo">ไม่ยกเลิก</button>
      <button class="btn danger" id="mYes">ยืนยันยกเลิกบิล</button>
    </div>`);
  const box = document.getElementById('modalBox');
  box.querySelector('#mClose').onclick = box.querySelector('#mNo').onclick = closeModal;
  box.querySelector('#mYes').onclick = async () => {
    const reason = box.querySelector('#vr').value;
    await voidSale(id, reason, { admin: 'พนักงาน', sup: 'หัวหน้า', owner: 'เจ้าของ' }[S.role]);
    closeModal();
    toast('ยกเลิกบิล ' + esc(b.bill_no) + ' แล้ว · คืนสต๊อกอัตโนมัติ', 'err');
    document.dispatchEvent(new CustomEvent('siatoy:changed'));
    location.reload();
  };
}

async function showItems(id) {
  const b = bills.find(x => x.id === id);
  const items = await db.sale_items.where('sale_id').equals(id).toArray();
  openModal(`
    <div class="modal-head"><h3>${esc(b.bill_no)}</h3><button class="x" id="mClose">✕</button></div>
    <div class="modal-body">
      <div class="mini" style="margin-bottom:12px">
        ${new Date(b.client_created_at).toLocaleString('th-TH')} ·
        ${esc(b.created_by_name || '-')} · ${payTag(b.payment)} ${stTag(b.status)}
      </div>
      <div class="bill-lines">
        ${items.map(it => `<div class="bill-line">
          <div class="q">${it.qty}×</div>
          <div class="n">${esc(it.product_name)}
            <div class="mini">${esc(it.sku)}${it.discount ? ' · ลด ' + money(it.discount) + ' ฿/ชิ้น · ' + esc(it.discount_reason || '') : ''}</div>
          </div>
          <div class="p">${money(it.line_total)}</div></div>`).join('')}
      </div>
      <div class="sum-row">ยอดรวมก่อนลด <b>${money(b.subtotal)} ฿</b></div>
      ${b.item_discount ? `<div class="sum-row disc">ส่วนลดรายชิ้น <b>-${money(b.item_discount)} ฿</b></div>` : ''}
      ${b.bill_discount ? `<div class="sum-row disc">ส่วนลดท้ายบิล <b>-${money(b.bill_discount)} ฿</b>${b.discount_reason ? ' · ' + esc(b.discount_reason) : ''}</div>` : ''}
      ${b.card_fee ? `<div class="sum-row fee">ค่าธรรมเนียมบัตร <b>+${money(b.card_fee)} ฿</b></div>` : ''}
      <div class="sum-total"><span>สุทธิ</span><b class="gold-text">฿ ${money(b.total)}</b></div>
      ${b.status === 'void' ? `<div class="notice red" style="margin-top:12px">ยกเลิกแล้ว · ${esc(b.void_reason || '')}
        · โดย ${esc(b.voided_by_name || '-')}</div>` : ''}
    </div>
    <div class="modal-foot"><button class="btn ghost" id="mOk">ปิด</button></div>`, true);
  const box = document.getElementById('modalBox');
  box.querySelector('#mClose').onclick = box.querySelector('#mOk').onclick = closeModal;
}

export const billsPage = {
  async render() {
    await load();
    const ok    = bills.filter(b => b.status === 'normal');
    const total = ok.reduce((a, b) => a + b.total, 0);
    const disc  = ok.reduce((a, b) => a + b.item_discount + b.bill_discount, 0);
    const label = customBounds() ? `ช่วง ${customFrom || 'เริ่มต้น'} ถึง ${customTo || 'ปัจจุบัน'}` : { today: 'วันนี้', '7d': '7 วันล่าสุด', all: 'ทั้งหมด' }[range];

    return `
    <div class="page-head">
      <div><h1>บิลขาย / ยกเลิกบิล</h1><p>${label} · ${bills.length} รายการ</p></div>
      <div class="spacer"></div>
      <div class="date-filter">
        <input class="inp date-filter-input" type="date" id="billFrom" value="${customFrom}">
        <span class="mini" style="align-self:center">ถึง</span>
        <input class="inp date-filter-input" type="date" id="billTo" value="${customTo}">
        <button class="btn date-filter-button" data-custom="1">ดูช่วงวันที่</button>
        ${customBounds() ? '<button class="btn ghost date-filter-button" data-clear-date="1">ล้าง</button>' : ''}
      </div>
      <div class="seg">
        ${[['today', 'วันนี้'], ['7d', '7 วัน'], ['all', 'ทั้งหมด']].map(([k, n]) =>
          `<button class="${range === k ? 'on' : ''}" data-range="${k}">${n}</button>`).join('')}
      </div>
    </div>
    <div class="grid g4" style="margin-bottom:16px">
      <div class="stat"><div class="lbl">ยอดขาย</div><div class="val g">฿ ${money(total)}</div>
        <div class="sub">${ok.length} บิล</div></div>
      <div class="stat"><div class="lbl">ส่วนลดรวม</div><div class="val red">฿ ${money(disc)}</div>
        <div class="sub">หักออกจากยอดขายแล้ว</div></div>
      <div class="stat"><div class="lbl">บิลยกเลิก</div>
        <div class="val">${bills.filter(b => b.status === 'void').length}</div>
        <div class="sub">คืนสต๊อกอัตโนมัติ</div></div>
      <div class="stat"><div class="lbl">เปิดการ์ด</div>
        <div class="val" style="color:var(--purple)">${bills.filter(b => b.status === 'open_card').length}</div>
        <div class="sub">แยกออกจากยอดขาย</div></div>
    </div>
    ${bills.length ? `
    <div class="card tight"><div class="tbl-wrap"><table>
      <thead><tr><th>เลขที่บิล</th><th>เวลา</th><th class="num">ชิ้น</th><th class="num">ยอดรวม</th>
        <th class="num">ส่วนลด</th><th class="num">สุทธิ</th><th>ชำระ</th><th>ผู้ทำรายการ</th>
        <th>สถานะ</th><th></th></tr></thead>
      <tbody>${bills.map(b => `<tr style="${b.status === 'void' ? 'opacity:.45' : ''}">
        <td><a href="#" data-open="${b.id}" style="border-bottom:1px dotted var(--line-2)">${esc(b.bill_no)}</a></td>
        <td>${new Date(b.client_created_at).toTimeString().slice(0, 5)}</td>
        <td class="num">${b.item_count}</td>
        <td class="num">${money(b.subtotal)}</td>
        <td class="num" style="color:var(--red)">${(b.item_discount + b.bill_discount) ? '-' + money(b.item_discount + b.bill_discount) : '-'}</td>
        <td class="num"><b style="font-weight:500;color:var(--gold2)">${money(b.total)}</b>
          ${b.card_fee ? `<div class="mini">+ค่าธรรมเนียม ${money(b.card_fee)}</div>` : ''}</td>
        <td>${payTag(b.payment)}</td>
        <td>${esc(b.created_by_name || '-')}</td>
        <td>${stTag(b.status)}</td>
        <td class="num">${b.status === 'normal'
          ? `<button class="btn sm danger" data-void="${b.id}">ยกเลิก</button>` : ''}</td>
      </tr>`).join('')}</tbody></table></div></div>
    <div class="notice info" style="margin-top:14px">🔒 พนักงานหน้าร้านกดยกเลิกบิลเองไม่ได้
      ต้องใช้สิทธิ์หัวหน้างานขึ้นไป — สลับสิทธิ์ที่มุมขวาบนเพื่อดูความต่าง</div>`
    : `<div class="card"><div class="cart-empty"><span class="big">🧾</span>
        ยังไม่มีบิลในช่วงนี้<br>ไปที่หน้าขายสินค้าเพื่อเริ่มทำบิล</div></div>`}`;
  },

  mount(el) {
    root = el;
    const exportBtn = el.querySelector('#billExport');
    if (exportBtn) exportBtn.onclick = async () => {
      const rows = [];
      for (const b of bills) for (const it of await db.sale_items.where('sale_id').equals(b.id).toArray())
        rows.push([b.bill_no, b.created_by_name || '-', it.sku, it.product_name, it.qty,
          it.unit_price, it.unit_cost || 0, it.line_total, b.status]);
      downloadExcel('siatoy-bills.xls', [{ name: 'รายการขาย',
        headers: ['เลขบิล','ผู้ขาย','SKU','สินค้า','จำนวน','ราคาขาย','ต้นทุน','รวม','สถานะ'], rows }]);
    };
    el.addEventListener('click', async e => {
      const r = e.target.closest('[data-range]');
      if (r) { range = r.dataset.range; customFrom = customTo = ''; await redrawPage(el, billsPage); return; }
      if (e.target.closest('[data-custom]')) {
        customFrom = el.querySelector('#billFrom').value; customTo = el.querySelector('#billTo').value;
        if (customFrom && customTo && customFrom > customTo) { toast('วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด', 'err'); return; }
        range = 'custom'; await redrawPage(el, billsPage); return;
      }
      if (e.target.closest('[data-clear-date]')) { customFrom = customTo = ''; range = 'today'; await redrawPage(el, billsPage); return; }
      const o = e.target.closest('[data-open]');
      if (o) { e.preventDefault(); showItems(o.dataset.open); return; }
      const v = e.target.closest('[data-void]');
      if (v) askVoid(v.dataset.void);
    });
  },
};
