/* รายงานสรุป
 * กำไรขั้นต้นคำนวณจากต้นทุนที่บันทึกไว้ในบรรทัดบิล ณ วันขาย ไม่ใช่ต้นทุนปัจจุบัน
 * ตัวเลขย้อนหลังจึงไม่เปลี่ยนเวลามีการปรับราคาหรือรับของล็อตใหม่ที่ต้นทุนต่างไป
 */
import { money, esc, redrawPage, downloadExcel } from '../lib/util.js';
import { db } from '../lib/store.js';
import { S } from '../lib/state.js';

let range = 'today', data = null, customFrom = '', customTo = '', seller = 'all', sellers = [];

async function exportAll() {
  const ids = new Set(data.all.map(s => s.id));
  const items = (await db.sale_items.toArray()).filter(i => ids.has(i.sale_id));
  const moves = (await db.stock_moves.toArray()).filter(m => {
    const at = new Date(m.created_at);
    const b = customBounds();
    return b ? at >= b.from && at <= b.to : at >= startOf(range) && at <= new Date(8640000000000000);
  });
  const vendors = await db.vendors.toArray();
  const vendorName = id => (vendors.find(v => v.id === id) || {}).name || '-';
  downloadExcel('siatoy-report-full.xls', [
    { name: 'สรุปยอดขาย', headers: ['วันที่','ผู้ขาย','เลขบิล','ยอดขาย','ช่องทาง','สถานะ'],
      rows: data.all.map(s => [new Date(s.client_created_at).toLocaleString('th-TH'), s.created_by_name || '-', s.bill_no, s.total, s.payment, s.status]) },
    { name: 'รายการขายและต้นทุน', headers: ['เลขบิล','SKU','สินค้า','จำนวน','ราคาขาย','ต้นทุน ณ วันขาย','รวม'],
      rows: items.map(i => [(data.all.find(s => s.id === i.sale_id) || {}).bill_no || i.sale_id, i.sku, i.product_name, i.qty, i.unit_price, i.unit_cost || 0, i.line_total]) },
    { name: 'สต๊อกเคลื่อนไหว', headers: ['วันที่','สินค้า','จำนวน','ประเภท','เหตุผล','ผู้ทำรายการ','ผู้ฝากขาย','ยอดจ่ายผู้ฝาก'],
      rows: moves.map(m => [new Date(m.created_at).toLocaleString('th-TH'), m.product_id, m.qty, m.move_type, m.reason || '-', m.created_by_name || '-', vendorName(m.vendor_id), m.vendor_payout || 0]) },
    { name: 'ยอดจ่ายผู้ฝาก', headers: ['วันที่','ผู้ฝากขาย','สินค้า','จำนวน','ยอดจ่าย'],
      rows: moves.filter(m => m.move_type === 'purchase' && Number(m.vendor_payout) > 0)
        .map(m => [new Date(m.created_at).toLocaleString('th-TH'), vendorName(m.vendor_id), m.product_id, m.qty, m.vendor_payout]) },
  ]);
}

const customBounds = () => {
  if (!customFrom && !customTo) return null;
  return {
    from: customFrom ? new Date(`${customFrom}T00:00:00`) : new Date(0),
    to: customTo ? new Date(`${customTo}T23:59:59.999`) : new Date(),
  };
};

const startOf = r => {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  if (r === '7d') d.setDate(d.getDate() - 6);
  if (r === 'month') d.setDate(1);
  return d;
};

async function load() {
  const custom = customBounds();
  const from = custom ? custom.from : startOf(range);
  const to = custom ? custom.to : new Date(8640000000000000);
  const allSales = (await db.sales.toArray()).filter(s => { const at = new Date(s.client_created_at); return at >= from && at <= to; });
  sellers = [...new Set(allSales.map(s => s.created_by_name).filter(Boolean))].sort();
  const sales = seller === 'all' ? allSales : allSales.filter(s => (s.created_by_name || '') === seller);
  const ok = sales.filter(s => s.status === 'normal');
  const okIds = new Set(ok.map(s => s.id));
  const products = await db.products.toArray();

  const byPay = { cash: 0, transfer: 0, credit: 0 };
  ok.forEach(s => { if (byPay[s.payment] !== undefined) byPay[s.payment] += s.total; });

  let cost = 0, revenue = 0;
  const top = new Map();
  await db.sale_items.each(it => {
    if (!okIds.has(it.sale_id)) return;
    cost    += (it.unit_cost || 0) * it.qty;
    revenue += it.line_total;
    const t = top.get(it.product_id) || { qty: 0, amount: 0, name: it.product_name };
    t.qty += it.qty; t.amount += it.line_total;
    top.set(it.product_id, t);
  });

  data = {
    sales: ok, all: sales, byPay, cost, revenue,
    total: ok.reduce((a, s) => a + s.total, 0),
    discount: ok.reduce((a, s) => a + s.item_discount + s.bill_discount, 0),
    fee: ok.reduce((a, s) => a + s.card_fee, 0),
    voids: sales.filter(s => s.status === 'void').length,
    opens: sales.filter(s => s.status === 'open_card').length,
    top: [...top.values()].sort((a, b) => b.qty - a.qty).slice(0, 8),
    lowStock: products.length,
  };
}

export const reportPage = {
  async render() {
    await load();
    const d = data;
    const gross = d.revenue - d.cost;
    const label = customBounds() ? `ช่วง ${customFrom || 'เริ่มต้น'} ถึง ${customTo || 'ปัจจุบัน'}` : { today: 'วันนี้', '7d': '7 วันล่าสุด', month: 'เดือนนี้' }[range];
    const bar = (v, max, color) => `<div class="bar"><i style="width:${max ? Math.round(v / max * 100) : 0}%;background:${color}"></i></div>`;

    return `
    <div class="page-head">
      <div><h1>รายงานสรุป</h1><p>${label} · ${d.sales.length} บิล</p></div>
      <div class="spacer"></div>
      <select class="inp" id="reportSeller" style="width:150px;padding:8px 9px;font-size:12px">
        <option value="all" ${seller === 'all' ? 'selected' : ''}>คนขายทั้งหมด</option>
        ${sellers.map(n => `<option value="${esc(n)}" ${seller === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}
      </select>
      <button class="btn" id="reportExport">📊 Export Excel</button>
      <button class="btn gold" id="reportExportAll">📥 Export รวมทั้งหมด</button>
      <div class="date-filter">
        <input class="inp date-filter-input" type="date" id="reportFrom" value="${customFrom}">
        <span class="mini" style="align-self:center">ถึง</span>
        <input class="inp date-filter-input" type="date" id="reportTo" value="${customTo}">
        <button class="btn date-filter-button" data-custom="1">ดูช่วงวันที่</button>
        ${customBounds() ? '<button class="btn ghost date-filter-button" data-clear-date="1">ล้าง</button>' : ''}
      </div>
      <div class="seg">${[['today','วันนี้'],['7d','7 วัน'],['month','เดือนนี้']].map(([k,n]) =>
        `<button class="${range === k ? 'on' : ''}" data-r="${k}">${n}</button>`).join('')}</div>
    </div>

    <div class="grid g4" style="margin-bottom:16px">
      <div class="stat"><div class="lbl">ยอดขายรวม</div><div class="val g">฿ ${money(d.total)}</div>
        <div class="sub">${d.sales.length} บิล</div></div>
      <div class="stat"><div class="lbl">ส่วนลดที่ให้ไป</div><div class="val red">฿ ${money(d.discount)}</div>
        <div class="sub">หักออกจากยอดขายแล้ว</div></div>
      <div class="stat sup-up"><div class="lbl">กำไรขั้นต้น</div>
        <div class="val green">฿ ${money(gross)}</div>
        <div class="sub">${d.revenue ? Math.round(gross / d.revenue * 100) : 0}% ของยอดขายก่อนลดท้ายบิล</div></div>
      <div class="stat"><div class="lbl">บิลเฉลี่ยต่อใบ</div>
        <div class="val">฿ ${money(d.sales.length ? Math.round(d.total / d.sales.length) : 0)}</div>
        <div class="sub">${d.voids} บิลถูกยกเลิก</div></div>
    </div>

    <div class="grid g2" style="align-items:start">
      <div class="card">
        <div class="card-title"><span class="ic">💰</span> แยกตามช่องทางการชำระเงิน</div>
        ${[['cash','💵 เงินสด','var(--green)'],['transfer','📱 เงินโอน','var(--blue)'],
           ['credit','💳 บัตรเครดิต','var(--purple)']].map(([k, n, c]) => `
          <div style="margin-bottom:12px">
            <div class="flex" style="font-size:13px;margin-bottom:5px">${n}
              <b class="right" style="font-weight:400">฿ ${money(d.byPay[k])}</b></div>
            ${bar(d.byPay[k], d.total, c)}
          </div>`).join('')}
        ${d.fee ? `<div class="flex" style="font-size:12.5px;color:var(--muted)">
          <span>ค่าธรรมเนียมบัตรที่บวกให้ลูกค้า</span>
          <b class="right" style="font-weight:400">฿ ${money(d.fee)}</b></div>` : ''}
        <div class="hr"></div>
        <div class="flex" style="font-size:13px;color:var(--muted)">
          <span>👑 เปิดการ์ด (ไม่นับเป็นรายได้)</span>
          <b class="right" style="color:var(--purple);font-weight:400">${d.opens} รายการ</b></div>
      </div>

      <div class="card">
        <div class="card-title"><span class="ic">🔥</span> ขายดีในช่วงนี้</div>
        ${d.top.length ? d.top.map((t, i) => `
          <div class="flex" style="padding:8px 0;border-bottom:1px solid var(--line);font-size:13px">
            <span style="width:22px;color:var(--muted)">${i + 1}</span>
            <div style="flex:1;min-width:0">
              <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.name)}</div>
              ${bar(t.qty, d.top[0].qty, 'var(--gold2)')}
            </div>
            <div style="text-align:right;min-width:92px">
              <div>${t.qty} ชิ้น</div>
              <div class="mini">฿ ${money(t.amount)}</div></div>
          </div>`).join('')
          : '<div class="cart-empty"><span class="big">📊</span>ยังไม่มีการขายในช่วงนี้</div>'}
      </div>
    </div>

    ${S.role === 'admin' ? `<div class="notice info" style="margin-top:14px">🔒
      ข้อมูลกำไรและต้นทุนแสดงเฉพาะสิทธิ์หัวหน้างานขึ้นไป</div>` : ''}
    <div class="notice warn" style="margin-top:14px">📌 กำไรขั้นต้นคำนวณจากต้นทุนที่บันทึกไว้ในบิล ณ วันขาย
      การปรับราคาหรือรับของล็อตใหม่ที่ต้นทุนต่างไป จึงไม่ทำให้ตัวเลขย้อนหลังเปลี่ยน</div>`;
  },
  mount(el) {
    el.querySelector('#reportSeller').onchange = async e => { seller = e.target.value; await redrawPage(el, reportPage); };
    el.querySelector('#reportExport').onclick = () => downloadExcel('siatoy-report.xls', [{ name: 'สรุปยอดขาย', headers: ['วันที่','ผู้ขาย','ยอดรวม','ช่องทาง','สถานะ'], rows: data.all.map(s => [new Date(s.client_created_at).toLocaleString('th-TH'), s.created_by_name || '-', s.total, s.payment, s.status]) }]);
    el.querySelector('#reportExportAll').onclick = exportAll;
    el.addEventListener('click', async e => {
      const r = e.target.closest('[data-r]');
      if (r) { range = r.dataset.r; customFrom = customTo = ''; await redrawPage(el, reportPage); return; }
      if (e.target.closest('[data-custom]')) {
        customFrom = el.querySelector('#reportFrom').value; customTo = el.querySelector('#reportTo').value;
        if (customFrom && customTo && customFrom > customTo) { alert('วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด'); return; }
        range = 'custom'; await redrawPage(el, reportPage); return;
      }
      if (e.target.closest('[data-clear-date]')) { customFrom = customTo = ''; range = 'today'; await redrawPage(el, reportPage); }
    });
  },
};
