/* หน้าขายสินค้า
 * ต่างจากเดโมตรงที่ยอดคงเหลืออ่านจากสมุดเดินของจริง และการกดขายลงบิลจริง
 * ลงในเครื่องก่อนเสมอ แล้วเข้าคิวรอส่งขึ้นเซิร์ฟเวอร์ จึงขายต่อได้แม้เน็ตหลุด
 */
import { CONFIG } from '../config.js';
import { $, money, esc, toast, openModal, closeModal } from '../lib/util.js';
import { db, stockMap, findByCode, commitSale, currentLocation } from '../lib/store.js';
import { CATEGORIES } from '../lib/seed.js';
import { attachWedge, keepFocus, openCameraModal, beep } from '../lib/scanner.js';
import { S } from '../lib/state.js';

let products = [], stock = new Map(), members = [], loc = null;
let cart = [], pay = 'cash', billDiscount = 0, billDiscountType = 'baht',
    discountReason = '', member = null, cat = 'ทั้งหมด', root = null;

const stockOf = p => stock.get(p.id) || 0;
const inCart  = id => (cart.find(l => l.product.id === id) || {}).qty || 0;

function calc(openCard = false) {
  const sub  = cart.reduce((a, l) => a + l.product.price * l.qty, 0);
  const disc = cart.reduce((a, l) => a + (l.discount || 0) * l.qty, 0);
  let bd = billDiscountType === 'pct' ? (sub - disc) * billDiscount / 100 : billDiscount;
  bd = Math.max(0, Math.min(bd, sub - disc));
  const net = sub - disc - bd;
  const fee = (pay === 'credit' && !openCard) ? Math.round(net * CONFIG.creditFee) / 100 : 0;
  return { sub, disc, bd, net, fee, total: openCard ? 0 : net + fee,
           count: cart.reduce((a, l) => a + l.qty, 0) };
}

async function load() {
  loc = await currentLocation();
  products = (await db.products.toArray()).filter(p => p.is_active !== false);
  members  = await db.members.toArray();
  stock    = await stockMap(loc.id);
}

/* ------------------------------------------------------------- ตะกร้า ---- */
function add(product) {
  if (!product) { beep(false); toast('ไม่พบสินค้าบาร์โค้ดนี้', 'err'); return; }
  const have = stockOf(product);
  if (inCart(product.id) + 1 > have) { beep(false); toast('สต๊อกไม่พอ · เหลือ ' + have + ' ชิ้น', 'err'); return; }
  const line = cart.find(l => l.product.id === product.id);
  if (line) line.qty++; else cart.push({ product, qty: 1, discount: 0, discount_reason: '' });
  drawCart();
  toast('เพิ่ม <b>' + esc(product.name.slice(0, 28)) + '…</b>', 'ok');
}
function chQty(id, d) {
  const l = cart.find(x => x.product.id === id); if (!l) return;
  l.qty += d;
  const have = stockOf(l.product);
  if (l.qty > have) { l.qty = have; toast('สต๊อกเหลือ ' + have, 'err'); }
  if (l.qty <= 0) cart = cart.filter(x => x.product.id !== id);
  drawCart();
}

/* -------------------------------------------------------------- modal ---- */
function askLineDisc(id) {
  const l = cart.find(x => x.product.id === id); if (!l) return;
  const p = l.product;
  openModal(`
    <div class="modal-head"><h3>ส่วนลดรายชิ้น</h3><button class="x" id="mClose">✕</button></div>
    <div class="modal-body">
      <div style="font-size:13.5px;margin-bottom:14px">${esc(p.name)}<br>
        <span class="mini">ราคาปกติ ${money(p.price)} ฿ × ${l.qty}</span></div>
      <div class="field"><label>ลดต่อชิ้น (บาท)</label>
        <input class="inp" id="dcv" type="number" value="${l.discount || 0}"></div>
      <div class="flex wrap" style="gap:7px">
        ${[20, 50, 100, 200].map(v => `<button class="btn sm" data-set="${v}">-${v} ฿</button>`).join('')}
        <button class="btn sm" data-set="${Math.round(p.price * 0.1)}">-10%</button>
      </div>
      <div class="field" style="margin-top:14px"><label>เหตุผล (บันทึกลงบิล)</label>
        <select class="inp" id="dcr">
          <option>ลูกค้าประจำ</option><option>ต่อรองหน้าร้าน</option>
          <option>ซื้อยกกล่อง</option><option>สินค้ามีตำหนิ</option><option>อื่น ๆ</option>
        </select></div>
      <div class="notice warn">⚠️ ส่วนลดถูกบันทึกพร้อมชื่อผู้กด เวลา และเหตุผล ติดไปกับบิลเสมอ</div>
    </div>
    <div class="modal-foot">
      <button class="btn ghost" id="mCancel">ยกเลิก</button>
      <button class="btn gold" id="mOk">ใช้ส่วนลด</button>
    </div>`);
  const box = $('#modalBox');
  box.querySelectorAll('[data-set]').forEach(b => b.onclick = () => box.querySelector('#dcv').value = b.dataset.set);
  box.querySelector('#mClose').onclick = box.querySelector('#mCancel').onclick = closeModal;
  box.querySelector('#mOk').onclick = () => {
    l.discount = Math.max(0, Math.min(p.price, Number(box.querySelector('#dcv').value) || 0));
    l.discount_reason = box.querySelector('#dcr').value;
    closeModal(); drawCart();
  };
}

function askBillDisc() {
  openModal(`
    <div class="modal-head"><h3>ส่วนลดท้ายบิล</h3><button class="x" id="mClose">✕</button></div>
    <div class="modal-body">
      <div class="seg" style="margin-bottom:14px">
        <button id="tB" class="${billDiscountType === 'baht' ? 'on' : ''}">บาท (฿)</button>
        <button id="tP" class="${billDiscountType === 'pct' ? 'on' : ''}">เปอร์เซ็นต์ (%)</button>
      </div>
      <div class="field"><label>จำนวนส่วนลด</label>
        <input class="inp" id="bdv" type="number" value="${billDiscount}"></div>
      <div class="field"><label>เหตุผล (บันทึกในรายงาน)</label>
        <select class="inp" id="bdr">
          <option>ลูกค้าประจำ</option><option>ต่อรองหน้าร้าน</option><option>ซื้อยกกล่อง</option>
          <option>โปรโมชันงานอีเวนต์</option><option>อื่น ๆ</option>
        </select></div>
    </div>
    <div class="modal-foot">
      <button class="btn ghost" id="mClear">ล้างส่วนลด</button>
      <button class="btn gold" id="mOk">ตกลง</button>
    </div>`);
  const box = $('#modalBox');
  const seg = t => { billDiscountType = t; closeModal(); askBillDisc(); };
  box.querySelector('#tB').onclick = () => seg('baht');
  box.querySelector('#tP').onclick = () => seg('pct');
  box.querySelector('#mClose').onclick = closeModal;
  box.querySelector('#mClear').onclick = () => { billDiscount = 0; discountReason = ''; closeModal(); drawCart(); };
  box.querySelector('#mOk').onclick = () => {
    billDiscount = Number(box.querySelector('#bdv').value) || 0;
    discountReason = box.querySelector('#bdr').value;
    closeModal(); drawCart();
  };
}

function askMember() {
  openModal(`
    <div class="modal-head"><h3>ระบุสมาชิก</h3><button class="x" id="mClose">✕</button></div>
    <div class="modal-body">
      <div class="field"><label>รหัสสมาชิก หรือ เบอร์โทรศัพท์</label>
        <input class="inp" id="mkey" placeholder="เช่น M001 หรือ 0891234567" autofocus></div>
      ${members.map(m => `<div class="ci" style="cursor:pointer" data-mid="${m.id}">
        <div class="info"><div class="nm">${esc(m.name)} <span class="tag gold">${esc(m.tier)}</span></div>
        <div class="meta">${esc(m.code)} · ${esc(m.tel)} · ${money(m.points)} แต้ม</div></div>
        <div style="align-self:center">→</div></div>`).join('')}
    </div>
    <div class="modal-foot"><button class="btn ghost" id="mNone">ไม่ระบุ</button></div>`);
  const box = $('#modalBox');
  box.querySelector('#mClose').onclick = closeModal;
  box.querySelector('#mNone').onclick = () => { member = null; closeModal(); drawCart(); };
  box.querySelectorAll('[data-mid]').forEach(el => el.onclick = () => {
    member = members.find(m => m.id === el.dataset.mid);
    closeModal(); drawCart(); toast('สมาชิก: <b>' + esc(member.name) + '</b>');
  });
  const key = box.querySelector('#mkey');
  key.onkeydown = e => {
    if (e.key !== 'Enter') return;
    const v = key.value.trim().toLowerCase();
    const m = members.find(x => x.code.toLowerCase() === v || x.tel === v);
    if (m) { member = m; closeModal(); drawCart(); toast('สมาชิก: <b>' + esc(m.name) + '</b>'); }
    else toast('ไม่พบสมาชิก: ' + esc(v), 'err');
  };
}

/* ---------------------------------------------------------- ยืนยันขาย ---- */
function confirmBill(openCard) {
  if (!cart.length) { toast('ยังไม่มีสินค้าในบิล', 'err'); return; }
  if (openCard && S.role !== 'owner') { toast('เปิดการ์ดได้เฉพาะสิทธิ์เจ้าของร้าน', 'err'); return; }
  const c = calc(openCard);
  const payName = { cash: '💵 เงินสด', transfer: '📱 เงินโอน', credit: '💳 บัตรเครดิต' }[pay];
  openModal(`
    <div class="modal-head"><h3>${openCard ? '👑 เปิดการ์ด (ตัดสต๊อก ไม่รับเงิน)' : 'ตรวจสอบรายการก่อนยืนยันการขาย'}</h3>
      <button class="x" id="mClose">✕</button></div>
    <div class="modal-body">
      <div class="bill-total">
        <div class="lbl">${openCard ? 'ยอดที่ต้องชำระ' : 'ยอดรวมที่ต้องรับชำระ'}</div>
        <div class="amt gold-text">฿ ${money(c.total)}</div>
        <div class="cnt">${c.count} ชิ้น · ${openCard ? '👑 ไม่รับเงิน' : payName}${c.fee ? ' (+ค่าธรรมเนียม ' + CONFIG.creditFee + '%)' : ''}</div>
      </div>
      <div class="bill-lines">
        ${cart.map(l => {
          const net = (l.product.price - (l.discount || 0)) * l.qty;
          return `<div class="bill-line"><div class="q">${l.qty}×</div>
            <div class="n">${esc(l.product.name)}
              ${l.discount ? `<div class="mini" style="color:var(--red)">ลด ${money(l.discount)} ฿/ชิ้น · ${esc(l.discount_reason || '')}</div>` : ''}</div>
            <div class="p">${money(net)}${l.discount ? `<s>${money(l.product.price * l.qty)}</s>` : ''}</div></div>`;
        }).join('')}
      </div>
      <div class="sum-row">ยอดรวมก่อนลด <b>${money(c.sub)} ฿</b></div>
      ${c.disc ? `<div class="sum-row disc">ส่วนลดรายชิ้น <b>-${money(c.disc)} ฿</b></div>` : ''}
      ${c.bd ? `<div class="sum-row disc">ส่วนลดท้ายบิล <b>-${money(c.bd)} ฿</b></div>` : ''}
      ${c.fee ? `<div class="sum-row fee">ค่าธรรมเนียมบัตร ${CONFIG.creditFee}% <b>+${money(c.fee)} ฿</b></div>` : ''}
      ${member ? `<div class="sum-row">สมาชิก <b>${esc(member.name)} (+${Math.floor(c.total / CONFIG.pointRate)} แต้ม)</b></div>` : ''}
      ${openCard
        ? `<div class="notice" style="margin-top:14px;background:var(--purple-a);border:1px solid var(--purple-line);color:var(--purple)">
             👑 รายการนี้ตัดสต๊อกออกโดยไม่บันทึกเป็นรายได้ และถูกแยกไว้ต่างหากในรายงาน</div>`
        : `<div class="notice warn" style="margin-top:14px">⚠️ กดผิดต้อง <b>ยกเลิกบิลทั้งใบ</b> แล้วทำใหม่ ระบบไม่แก้รายการในบิลเดิม</div>`}
    </div>
    <div class="modal-foot">
      <button class="btn ghost" id="mBack">← กลับไปแก้ไข</button>
      <button class="btn gold" id="mPay" style="min-width:190px;justify-content:center;font-size:15px;padding:12px 20px">
        ${openCard ? '👑 ยืนยันตัดสต๊อก' : '✓ ยืนยันรับชำระเงิน'}</button>
    </div>`, true);
  const box = $('#modalBox');
  box.querySelector('#mClose').onclick = box.querySelector('#mBack').onclick = closeModal;
  box.querySelector('#mPay').onclick = () => doPay(openCard);
}

async function doPay(openCard) {
  const btn = $('#modalBox').querySelector('#mPay');
  if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก…'; }
  const c = calc(openCard);
  const sale = await commitSale({
    lines: cart, payment: pay, billDiscount: c.bd, discountReason,
    cardFee: c.fee, member, isOpenCard: openCard,
    userName: { admin: 'พนักงาน', sup: 'หัวหน้า', owner: 'เจ้าของ' }[S.role],
  });
  cart = []; billDiscount = 0; discountReason = ''; member = null; pay = 'cash';
  await load();
  closeModal();
  openModal(`
    <div class="modal-body" style="text-align:center;padding:34px 24px">
      <div style="font-size:56px;line-height:1">${openCard ? '👑' : '✅'}</div>
      <h2 style="margin:12px 0 4px;font-weight:500">${openCard ? 'ตัดสต๊อกเรียบร้อย' : 'ขายสำเร็จ'}</h2>
      <div class="mini">${sale.bill_no} · ${c.count} ชิ้น</div>
      <div style="font-size:34px;font-weight:600;margin:14px 0" class="gold-text">฿ ${money(sale.total)}</div>
      <div class="mini">บันทึกลงเครื่องแล้ว · รอส่งขึ้นเซิร์ฟเวอร์เมื่อออนไลน์</div>
      <div class="hr"></div>
      <button class="btn gold" id="mNew">เริ่มบิลใหม่</button>
    </div>`);
  $('#modalBox').querySelector('#mNew').onclick = closeModal;
  drawCart(); drawGrid();
  document.dispatchEvent(new CustomEvent('siatoy:changed'));
  const inp = root && root.querySelector('#scanInput'); if (inp) inp.focus();
}

/* --------------------------------------------------------------- วาด ---- */
function cardsHTML() {
  return products.filter(p => cat === 'ทั้งหมด' || p.category === cat).map(p => {
    const q = stockOf(p);
    return `<div class="prod" data-code="${p.id}">
      ${q <= 3 ? `<div class="low">เหลือ ${q}</div>` : ''}
      <div class="thumb">${p.icon || '🃏'}</div>
      <div class="nm">${esc(p.name)}</div>
      <div class="pr">฿ ${money(p.price)}</div>
      <div class="st">คงเหลือ ${q} · ${esc(p.sku)}</div>
    </div>`;
  }).join('');
}
function drawGrid() { const g = root && root.querySelector('#prodGrid'); if (g) g.innerHTML = cardsHTML(); }

function drawCart() {
  if (!root) return;
  const items = root.querySelector('#cartItems'), foot = root.querySelector('#cartFoot');
  const cnt = root.querySelector('#cartCount');
  if (!items) return;
  const c = calc();
  cnt.textContent = c.count + ' ชิ้น';
  items.innerHTML = cart.length ? cart.map(l => {
    const p = l.product, net = (p.price - (l.discount || 0)) * l.qty;
    return `<div class="ci">
      <div class="info">
        <div class="nm">${p.icon || '🃏'} ${esc(p.name)}</div>
        <div class="meta">${esc(p.sku)} · คงเหลือ ${stockOf(p)}</div>
        <div class="price-row">
          <div class="qty">
            <button data-act="minus" data-id="${p.id}">−</button><span>${l.qty}</span>
            <button data-act="plus" data-id="${p.id}">+</button></div>
          <button class="disc-btn ${l.discount ? 'act' : ''}" data-act="disc" data-id="${p.id}">
            ${l.discount ? 'ลด ' + money(l.discount) + ' ฿' : '+ ส่วนลด'}</button>
          <div class="amt"><b>${money(net)}</b>${l.discount ? `<span class="was">${money(p.price * l.qty)}</span>` : ''}</div>
        </div>
      </div>
      <button class="x" data-act="rm" data-id="${p.id}">✕</button>
    </div>`;
  }).join('') : `<div class="cart-empty"><span class="big">🛒</span>ยิงบาร์โค้ด หรือแตะสินค้าทางซ้าย<br>เพื่อเริ่มทำบิล</div>`;

  foot.innerHTML = `
    <div class="member-row">
      <button class="btn sm" style="flex:1;justify-content:center" data-act="member">
        ${member ? '👤 ' + esc(member.name) + ' · ' + money(member.points) + ' แต้ม' : '👤 ระบุสมาชิก / เบอร์โทร'}</button>
      <button class="btn sm" data-act="billdisc">🏷️ ลดท้ายบิล</button>
    </div>
    <div class="sum-row">ยอดรวม <b>${money(c.sub)} ฿</b></div>
    ${c.disc ? `<div class="sum-row disc">ส่วนลดรายชิ้น <b>-${money(c.disc)} ฿</b></div>` : ''}
    ${c.bd ? `<div class="sum-row disc">ส่วนลดท้ายบิล <b>-${money(c.bd)} ฿</b></div>` : ''}
    ${c.fee ? `<div class="sum-row fee">ค่าธรรมเนียมบัตร ${CONFIG.creditFee}% <b>+${money(c.fee)} ฿</b></div>` : ''}
    <div class="pay-grid">
      <div class="pay-btn ${pay === 'cash' ? 'on' : ''}" data-act="pay" data-v="cash"><span class="i">💵</span>เงินสด</div>
      <div class="pay-btn ${pay === 'transfer' ? 'on' : ''}" data-act="pay" data-v="transfer"><span class="i">📱</span>เงินโอน</div>
      <div class="pay-btn ${pay === 'credit' ? 'on' : ''}" data-act="pay" data-v="credit"><span class="i">💳</span>บัตร +${CONFIG.creditFee}%</div>
    </div>
    <div class="sum-total"><span>ต้องชำระ</span><b class="gold-text">฿ ${money(c.total)}</b></div>
    <button class="btn gold block" style="margin-top:12px;padding:14px;font-size:16px" data-act="confirm">✓ ยืนยันการขาย</button>
    <button class="btn block owner-only" style="margin-top:8px;border-color:var(--purple-line);color:var(--purple);background:var(--purple-a2)"
      data-act="opencard">👑 เปิดการ์ด · ตัดสต๊อกไม่รับเงิน</button>
    <div class="mini" style="text-align:center;margin-top:9px">หน้าจอนี้ไม่แสดงราคาต้นทุนให้พนักงานขายเห็น</div>`;

  // บนหน้าจอแคบ แผงบิลจะเป็น bottom sheet เมื่อมีสินค้าให้เปิดสรุปให้อัตโนมัติ
  if (cart.length && window.matchMedia('(max-width: 980px)').matches) {
    root?.querySelector('.cart-panel')?.classList.add('open');
  }
}

/* --------------------------------------------------------------- หน้า ---- */
export const posPage = {
  async render() {
    await load();
    return `
    <div class="page-head">
      <div><h1>ขายสินค้า (POS)</h1>
        <p>ยิงบาร์โค้ดด้วยเครื่องสแกน หรือใช้กล้อง iPad · จุดขาย <b>${esc(loc.name)}</b></p></div>
      <div class="spacer"></div>
      <button class="btn" id="posCam">📷 สแกนด้วยกล้อง</button>
    </div>
    <div class="pos-wrap">
      <div>
        <div class="scan-bar">
          <input class="scan-input" id="scanInput" autofocus
            placeholder="🔍 ยิงบาร์โค้ด หรือพิมพ์ชื่อสินค้า แล้วกด Enter…">
        </div>
        <div class="flex wrap" style="margin-bottom:12px">
          <div class="seg" id="catSeg">
            ${['ทั้งหมด', ...CATEGORIES].map(c =>
              `<button class="${c === cat ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}
          </div>
        </div>
        <div class="prod-grid" id="prodGrid">${cardsHTML()}</div>
      </div>
      <div class="cart-panel">
        <div class="cart-head" id="cartHead">
          🧾 <b>บิลปัจจุบัน</b><span class="tag gold" id="cartCount">0 ชิ้น</span>
          <span class="cart-toggle-hint">แตะเพื่อดูสรุป</span>
          <button class="btn sm ghost right" data-act="clear">ล้างบิล</button>
        </div>
        <div class="cart-items" id="cartItems"></div>
        <div class="cart-foot" id="cartFoot"></div>
      </div>
    </div>`;
  },

  mount(el) {
    root = el;
    drawCart();

    const cartPanel = el.querySelector('.cart-panel');
    el.querySelector('#cartHead').addEventListener('click', e => {
      // ปุ่มล้างบิลยังทำงานแยกจากการเปิด/ปิดแผง
      if (e.target.closest('[data-act="clear"]')) return;
      if (!window.matchMedia('(max-width: 980px)').matches) return;
      cartPanel.classList.toggle('open');
    });

    const takeCode = async v => { add(await findByCode(v)); };
    el.querySelector('#posCam').onclick = () => openCameraModal(takeCode);
    // เครื่องยิง USB ทำงานได้แม้เคอร์เซอร์ไม่ได้อยู่ในช่อง และเคอร์เซอร์เด้งกลับช่องเองหลังกดอย่างอื่น
    const detach = attachWedge(takeCode);
    keepFocus(el, '#scanInput');

    el.querySelector('#scanInput').onkeydown = async e => {
      if (e.key !== 'Enter') return;
      const v = e.target.value.trim(); e.target.value = '';
      if (!v) return;
      add(await findByCode(v));
    };

    el.addEventListener('click', e => {
      const seg = e.target.closest('[data-cat]');
      if (seg) {
        cat = seg.dataset.cat;
        el.querySelectorAll('[data-cat]').forEach(b => b.classList.toggle('on', b.dataset.cat === cat));
        drawGrid(); return;
      }
      const card = e.target.closest('[data-code]');
      if (card) { add(products.find(p => p.id === card.dataset.code)); return; }

      const act = e.target.closest('[data-act]');
      if (!act) return;
      const id = act.dataset.id;
      switch (act.dataset.act) {
        case 'plus':     chQty(id, 1); break;
        case 'minus':    chQty(id, -1); break;
        case 'rm':       cart = cart.filter(l => l.product.id !== id); drawCart(); break;
        case 'disc':     askLineDisc(id); break;
        case 'billdisc': askBillDisc(); break;
        case 'member':   askMember(); break;
        case 'pay':      pay = act.dataset.v; drawCart(); break;
        case 'confirm':  confirmBill(false); break;
        case 'opencard': confirmBill(true); break;
        case 'clear':    cart = []; billDiscount = 0; member = null; drawCart(); break;
      }
    });

    return detach;                 // ถอดตัวดักคีย์ออกเมื่อเปลี่ยนหน้า
  },
};
