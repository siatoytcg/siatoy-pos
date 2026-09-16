/* สร้างและพิมพ์สติกเกอร์บาร์โค้ด
 *
 * จุดที่ต่างจากเดโม : เดโมยืดบาร์โค้ดให้เต็มความกว้างดวงเสมอ ทำให้ความกว้างแท่ง
 * ไปตกที่เศษของจุดเครื่องพิมพ์ แล้วเครื่องปัดเอาเอง แท่งจึงกว้างไม่เท่ากันและ
 * ยิงไม่ติดเป็นบางดวง ที่นี่คำนวณความกว้างแท่งเป็นจำนวน "จุด" เต็ม ๆ ของเครื่อง
 * ตามค่าความละเอียดที่ตั้งไว้ แล้ววางบาร์โค้ดกึ่งกลางดวงแทน
 */
import { buildPrintJob, openNativePrinter } from '../lib/native-printer.js';
import { CONFIG } from '../config.js';
import { money, esc, uuid, toast, openModal, closeModal } from '../lib/util.js';
import { db, currentLocation } from '../lib/store.js';
import { encode128, padEven, svg128 } from '../lib/code128.js';

const SIZES = {
  '30x20': { w: 30, h: 20, n: '30 × 20 มม. (ของร้าน)' },
  '32x25': { w: 32, h: 25, n: '32 × 25 มม.' },
  '40x30': { w: 40, h: 30, n: '40 × 30 มม.' },
  '50x30': { w: 50, h: 30, n: '50 × 30 มม.' },
  '60x40': { w: 60, h: 40, n: '60 × 40 มม.' },
};

let size = '32x25', mode = 'native', pad = true, queue = [], products = [], vendors = [], root = null;
let show = { shop: true, name: true, code: true, price: true };

const QUIET = 10;                    // โมดูลว่างซ้ายขวาตามมาตรฐาน CODE128
const dotMm = () => 25.4 / CONFIG.printerDpi;

/* คำนวณความกว้างแท่งที่ลงตัวกับจุดของเครื่องพิมพ์ */
function fitBarcode(data, sizeKey) {
  const s = SIZES[sizeKey];
  const padMm = s.h <= 22 ? 0.8 : 1.2;
  const { modules } = encode128(data);
  const usable = s.w - padMm * 2;
  const maxModuleMm = usable / (modules + QUIET * 2);
  const dot = dotMm();
  const dots = Math.floor(maxModuleMm / dot);
  const moduleMm = Math.max(dots, 1) * dot;
  const widthMm = modules * moduleMm;
  let kind = 'green', text = 'คมชัดมาก';
  if (dots < 2)      { kind = 'red';  text = 'ถี่เกินไป · ใช้รหัสสั้นลงหรือดวงใหญ่ขึ้น'; }
  else if (dots < 3) { kind = 'green'; text = 'ใช้งานได้ดี'; }
  return { modules, dots, moduleMm, widthMm, usable, padMm, kind, text };
}

function labelHTML(item, sizeKey) {
  const s = SIZES[sizeKey];
  const tiny = s.h <= 22;
  const data = pad ? padEven(item.code) : String(item.code);
  const f = fitBarcode(data, sizeKey);
  const bcH = (tiny ? 0.38 : 0.30) * s.h;
  return `<div class="lbl" style="width:${s.w}mm;height:${s.h}mm;padding:${f.padMm}mm">
    ${show.shop  ? `<div class="l-shop" style="font-size:${tiny ? 4.2 : 5.2}pt">${esc(CONFIG.shopName).toUpperCase()}</div>` : ''}
    ${show.name  ? `<div class="l-nm" style="font-size:${tiny ? 5.4 : 6.4}pt;max-height:${tiny ? 1.25 : 2.4}em">${esc(item.name || 'สินค้า')}</div>` : ''}
    ${svg128(data, f.moduleMm, bcH)}
    ${show.code  ? `<div class="l-code" style="font-size:${tiny ? 5.0 : 5.8}pt">${esc(data)}</div>` : ''}
    ${show.price && item.price ? `<div class="l-price" style="font-size:${tiny ? 8 : 9.5}pt">฿ ${money(item.price)}</div>` : ''}
  </div>`;
}

const val = id => { const e = root && root.querySelector('#' + id); return e ? e.value.trim() : ''; };

function nextCode() {
  let max = 8859000;
  products.forEach(p => { const n = parseInt(p.sku, 10); if (!isNaN(n) && n > max) max = n; });
  queue.forEach(q => { const n = parseInt(q.code, 10); if (!isNaN(n) && n > max) max = n; });
  return String(max + 1);
}

function drawPreview() {
  const native = mode === 'native';
  root.querySelector('#lblSize').disabled = native;
  root.querySelectorAll('[data-show]').forEach(e => { e.disabled = native; e.closest('.field').hidden = native; });
  if (native) {
    root.querySelector('#lblPreview').textContent = 'Siatoy TCG · ชื่อสินค้า · บาร์โค้ด · รหัส';
    root.querySelector('#bcQual').innerHTML = '<span class="tag green">เครื่องร้าน · 32 × 25 มม. แถวละ 3 ใบ</span><div class="mini">ใช้โปรไฟล์ที่ปรับตำแหน่งแล้ว · ความกว้าง 90% · แสดงชื่อสินค้าเหนือบาร์โค้ด · ไม่แสดงราคา<br>ตรวจลำดับรหัสทั้งชุดในหน้าต่างตัวช่วยพิมพ์ก่อนส่งงาน</div>';
    return;
  }
  const box = root.querySelector('#lblPreview');
  const code = val('lblCode') || nextCode();
  box.innerHTML = labelHTML({ name: val('lblName') || 'ชื่อสินค้าตัวอย่าง', code,
                              price: Number(val('lblPrice')) || 0 }, size);
  const f = fitBarcode(pad ? padEven(code) : code, size);
  root.querySelector('#bcQual').innerHTML =
    `<span class="tag ${f.kind}">แท่งบางสุด ${f.dots} จุด = ${f.moduleMm.toFixed(3)} มม. · ${f.text}</span>
     <div class="mini" style="margin-top:6px">
       รหัสที่เข้ารหัสจริง <b>${esc(pad ? padEven(code) : code)}</b> · ${f.modules} โมดูล ·
       บาร์โค้ดกว้าง ${f.widthMm.toFixed(2)} มม. จากพื้นที่ ${f.usable.toFixed(1)} มม. ·
       เครื่องพิมพ์ ${CONFIG.printerDpi} dpi (1 จุด = ${dotMm().toFixed(4)} มม.)</div>`;
}

function drawQueue() {
  const box = root.querySelector('#lblQueue');
  box.innerHTML = queue.length ? queue.map((q, i) => `
    <div class="ci">
      <div class="q-no">${i + 1}</div>
      <div class="info"><div class="nm">${esc(q.name)}</div>
        <div class="meta">${esc(q.code)}${q.price ? ' · ฿' + money(q.price) : ''}</div></div>
      <div class="flex" style="gap:6px;align-self:center">
        <input class="inp" style="width:64px;padding:6px 8px;text-align:center" type="number" min="1"
          value="${q.qty}" data-qty="${i}">
        <button class="btn sm ghost" data-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn sm ghost" data-down="${i}" ${i === queue.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="x" data-del="${i}">✕</button>
      </div>
    </div>`).join('')
    : `<div class="cart-empty"><span class="big">🏷️</span>ยังไม่มีรายการในคิว<br>
       กรอกชื่อสินค้าและจำนวนดวง แล้วกดเพิ่มเข้าคิวพิมพ์</div>`;
  root.querySelector('#lblSum').innerHTML =
    `<b>${queue.length}</b> รายการ · รวม <b>${queue.reduce((a, q) => a + q.qty, 0)}</b> ดวง`;
}

async function addToQueue() {
  const name = val('lblName');
  if (!name) { toast('กรุณากรอกชื่อสินค้า', 'err'); return; }
  const code  = val('lblCode') || nextCode();
  const qty   = Math.max(1, Math.min(500, Number(val('lblQty')) || 1));
  const price = Number(val('lblPrice')) || 0;
  const cost  = Number(val('lblCost')) || 0;
  const save  = root.querySelector('#lblSave').checked;

  if (save) {
    const exists = await db.products.where('sku').equals(code).first();
    if (exists) toast('มีสินค้ารหัสนี้อยู่แล้ว ไม่ได้เพิ่มซ้ำ', 'err');
    else {
      const id = 'prd-' + code;
      const loc = await currentLocation();
      await db.products.put({ id, sku: code, name, category: val('lblCat') || 'อื่น ๆ',
        set_id: null, vendor_id: val('lblVendor') || null, price, vat_rate: 0,
        is_single: false, is_active: true, icon: '🏷️' });
      await db.barcodes.put({ barcode: code, product_id: id, kind: 'shop' });
      await db.stock_moves.put({ id: uuid(), product_id: id, location_id: loc.id, qty,
        move_type: 'purchase', ref_id: null, ref_no: 'รับเข้าพร้อมพิมพ์สติกเกอร์',
        created_at: new Date().toISOString() });
      if (cost) await db.products.update(id, { cost });
      products = await db.products.toArray();
      toast('เพิ่ม <b>' + esc(name.slice(0, 24)) + '</b> เข้าคลังแล้ว (สต๊อก ' + qty + ')', 'ok');
      document.dispatchEvent(new CustomEvent('siatoy:changed'));
    }
  }

  queue.push({ code, name, price, qty });
  ['lblName', 'lblCode', 'lblPrice', 'lblCost'].forEach(i => root.querySelector('#' + i).value = '');
  root.querySelector('#lblProd').value = '';
  root.querySelector('#lblSave').checked = false;
  drawQueue(); drawPreview();
  toast('เพิ่มเข้าคิวพิมพ์ · ลำดับที่ ' + queue.length + ' (' + qty + ' ดวง)', 'ok');
}

function sheetHTML(limitPer) {
  let html = '';
  queue.forEach(q => {
    const n = limitPer ? Math.min(q.qty, limitPer) : q.qty;
    for (let i = 0; i < n; i++) html += labelHTML(q, size);
  });
  return html;
}

function doPrint() {
  if (mode === 'native') {
    try { openNativePrinter(buildPrintJob(queue, pad), (message, kind) => toast(esc(message), kind)); }
    catch (e) { toast(esc(e.message), 'err'); }
    return;
  }
  if (!queue.length) { toast('ยังไม่มีรายการในคิวพิมพ์', 'err'); return; }
  const s = SIZES[size];
  document.getElementById('printArea').innerHTML =
    `<div class="sheet ${mode}">${sheetHTML(0)}</div>`;
  document.getElementById('pageStyle').textContent = mode === 'roll'
    ? `@page{size:${s.w}mm ${s.h}mm;margin:0}`
    : '@page{size:A4;margin:8mm}';
  toast('ส่งไปพิมพ์ ' + queue.reduce((a, q) => a + q.qty, 0) + ' ดวง ตามลำดับในคิว', 'ok');
  setTimeout(() => window.print(), 250);
}

function previewSheet() {
  if (mode === 'native') { doPrint(); return; }
  const s = SIZES[size];
  openModal(`
    <div class="modal-head"><h3>ตัวอย่างก่อนพิมพ์ · ${queue.reduce((a, q) => a + q.qty, 0)} ดวง</h3>
      <button class="x" id="mClose">✕</button></div>
    <div class="modal-body">
      <div class="notice info" style="margin-bottom:14px">เรียงตามลำดับในคิว · ขนาด ${s.n} ·
        ${mode === 'roll' ? 'สติกเกอร์ม้วน 1 ดวงต่อหน้า' : 'กระดาษ A4 เรียงเป็นตาราง'}<br>
        ตอนสั่งพิมพ์จาก Chrome ตั้ง Margins = None และ Scale = 100 ห้ามใช้ Fit to page</div>
      <div class="sheet-preview">${sheetHTML(60) || '<div class="mini">ไม่มีรายการ</div>'}</div>
    </div>
    <div class="modal-foot"><button class="btn ghost" id="mNo">ปิด</button>
      <button class="btn gold" id="mGo">🖨️ สั่งพิมพ์</button></div>`, true);
  const box = document.getElementById('modalBox');
  box.querySelector('#mClose').onclick = box.querySelector('#mNo').onclick = closeModal;
  box.querySelector('#mGo').onclick = () => { closeModal(); doPrint(); };
}

export const labelsPage = {
  async render() {
    products = await db.products.toArray();
    vendors  = await db.vendors.toArray();
    return `
    <div class="page-head"><div><h1>สร้าง &amp; พิมพ์บาร์โค้ด</h1>
      <p>สร้างรหัสให้สินค้า ใส่จำนวนดวงในล็อต แล้วสั่งพิมพ์ตามลำดับที่กรอก</p></div></div>
    <div class="grid g2" style="grid-template-columns:400px 1fr;align-items:start">
      <div>
        <div class="card">
          <div class="card-title"><span class="ic">🏷️</span> ข้อมูลสินค้า</div>
          <div class="field"><label>เลือกจากสินค้าในคลัง (หรือเว้นไว้เพื่อสร้างใหม่)</label>
            <select class="inp" id="lblProd">
              <option value="">— สินค้าใหม่ —</option>
              ${products.map(p => `<option value="${p.id}">${esc(p.sku)} · ${esc(p.name)}</option>`).join('')}
            </select></div>
          <div class="field"><label>ชื่อสินค้า *</label>
            <input class="inp" id="lblName" placeholder="เช่น Pokémon SV8a · Booster Pack"></div>
          <div class="field"><label>รหัสบาร์โค้ด (เว้นว่างให้ระบบสร้างอัตโนมัติ)</label>
            <div class="flex" style="gap:8px">
              <input class="inp" id="lblCode" placeholder="${nextCode()}">
              <button class="btn" id="lblGen">🎲 สร้าง</button></div></div>
          <div class="grid" style="grid-template-columns:1fr 1fr 1fr;gap:9px">
            <div class="field" style="margin:0"><label>ราคาขาย</label>
              <input class="inp" id="lblPrice" type="number" placeholder="0"></div>
            <div class="field sup-up" style="margin:0"><label>ต้นทุน</label>
              <input class="inp" id="lblCost" type="number" placeholder="0"></div>
            <div class="field" style="margin:0"><label>จำนวนในล็อต</label>
              <input class="inp" id="lblQty" type="number" min="1" value="10"></div>
          </div>
          <div class="grid g2" style="gap:9px;margin-top:2px">
            <div class="field" style="margin:0"><label>หมวดสินค้า</label>
              <select class="inp" id="lblCat">
                ${['Booster Box','Booster Pack','การ์ดแยกใบ','อุปกรณ์','ETB','Starter','Bundle','อื่น ๆ']
                  .map(c => `<option>${c}</option>`).join('')}</select></div>
            <div class="field" style="margin:0"><label>ผู้ฝากขาย</label>
              <select class="inp" id="lblVendor">
                ${vendors.map(v => `<option value="${v.id}">${esc(v.code)} · ${esc(v.name)}</option>`).join('')}
              </select></div>
          </div>
          <label class="chk"><input type="checkbox" id="lblSave"> บันทึกเป็นสินค้าใหม่เข้าคลังด้วย (สต๊อก = จำนวนในล็อต)</label>
          <button class="btn gold block" style="margin-top:12px;padding:12px" id="lblAdd">+ เพิ่มเข้าคิวพิมพ์</button>
        </div>

        <div class="card" style="margin-top:14px">
          <div class="card-title"><span class="ic">⚙️</span> รูปแบบสติกเกอร์</div>
          <div class="field"><label>ขนาดดวง</label>
            <select class="inp" id="lblSize">
              ${Object.entries(SIZES).map(([k, v]) =>
                `<option value="${k}" ${size === k ? 'selected' : ''}>${v.n}</option>`).join('')}
            </select></div>
          <div class="field"><label>เครื่องพิมพ์</label>
            <div class="seg" id="lblMode">
              <button class="${mode === 'native' ? 'on' : ''}" data-mode="native">เครื่องร้าน · 3 ช่อง</button>
              <button class="${mode === 'roll' ? 'on' : ''}" data-mode="roll">สติกเกอร์ม้วน</button>
              <button class="${mode === 'a4' ? 'on' : ''}" data-mode="a4">กระดาษ A4</button>
            </div></div>
          <div class="field" style="margin:0"><label>แสดงบนดวง</label>
            <div class="flex wrap" style="gap:14px">
              ${[['shop','ชื่อร้าน'],['name','ชื่อสินค้า'],['code','ตัวเลขรหัส'],['price','ราคา']].map(([k, n]) =>
                `<label class="chk" style="margin:0"><input type="checkbox" data-show="${k}"
                  ${show[k] ? 'checked' : ''}> ${n}</label>`).join('')}
            </div></div>
          <label class="chk"><input type="checkbox" id="lblPad" ${pad ? 'checked' : ''}>
            เติมเลข 0 ข้างหน้าให้เป็นเลขคู่ (บาร์โค้ดสั้นลงราว 30% · เครื่องยิงอ่านได้ทั้งสองแบบ)</label>
        </div>
      </div>

      <div>
        <div class="card">
          <div class="card-title"><span class="ic">👁️</span> ตัวอย่างดวงสติกเกอร์
            <span class="sub">${SIZES[size].n}</span></div>
          <div class="lbl-stage"><div id="lblPreview" style="transform:scale(2);transform-origin:center center"></div></div>
          <div style="text-align:center;margin-top:12px" id="bcQual"></div>
          <div class="mini" style="text-align:center;margin-top:8px">
            โหมดเครื่องร้านใช้โปรไฟล์ Windows ที่บันทึกไว้ · เปิดตัวช่วยพิมพ์ก่อนใช้งาน
            โหมดม้วน/A4 ใช้การตั้งค่าพิมพ์ผ่านเบราว์เซอร์</div>
        </div>
        <div class="card" style="margin-top:14px">
          <div class="card-title"><span class="ic">🖨️</span> คิวพิมพ์ (พิมพ์เรียงตามลำดับนี้)
            <span class="sub" id="lblSum">0 รายการ</span></div>
          <div id="lblQueue" style="max-height:330px;overflow:auto"></div>
          <div class="flex wrap" style="margin-top:12px">
            <button class="btn ghost" id="qClear">ล้างคิว</button>
            <div class="right flex wrap">
              <button class="btn" id="qPreview">👁️ ดูตัวอย่างทั้งชุด</button>
              <button class="btn gold" id="qPrint">🖨️ สั่งพิมพ์ตามลำดับ</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  },

  mount(el) {
    root = el;
    drawQueue(); drawPreview();

    const on = (id, ev, fn) => { const e = el.querySelector('#' + id); if (e) e[ev] = fn; };
    on('lblName', 'oninput', drawPreview);
    on('lblCode', 'oninput', drawPreview);
    on('lblPrice', 'oninput', drawPreview);
    on('lblGen', 'onclick', () => { el.querySelector('#lblCode').value = nextCode(); drawPreview(); });
    on('lblAdd', 'onclick', addToQueue);
    on('lblSize', 'onchange', e => { size = e.target.value; drawPreview(); });
    on('lblPad', 'onchange', e => { pad = e.target.checked; drawPreview(); });
    on('qClear', 'onclick', () => { queue = []; drawQueue(); toast('ล้างคิวพิมพ์แล้ว'); });
    on('qPreview', 'onclick', previewSheet);
    on('qPrint', 'onclick', doPrint);

    on('lblProd', 'onchange', async e => {
      const id = e.target.value;
      if (!id) { ['lblName','lblCode','lblPrice','lblCost'].forEach(k => el.querySelector('#' + k).value = ''); drawPreview(); return; }
      const p = await db.products.get(id);
      el.querySelector('#lblName').value  = p.name;
      el.querySelector('#lblCode').value  = p.sku;
      el.querySelector('#lblPrice').value = p.price;
      drawPreview();
    });

    el.addEventListener('click', e => {
      const m = e.target.closest('[data-mode]');
      if (m) { mode = m.dataset.mode;
        el.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === mode)); drawPreview(); return; }
      const up = e.target.closest('[data-up]'), dn = e.target.closest('[data-down]'),
            dl = e.target.closest('[data-del]');
      const swap = (i, j) => { const t = queue[i]; queue[i] = queue[j]; queue[j] = t; drawQueue(); };
      if (up) swap(+up.dataset.up, +up.dataset.up - 1);
      if (dn) swap(+dn.dataset.down, +dn.dataset.down + 1);
      if (dl) { queue.splice(+dl.dataset.del, 1); drawQueue(); }
    });

    el.addEventListener('change', e => {
      const s = e.target.closest('[data-show]');
      if (s) { show[s.dataset.show] = s.checked; drawPreview(); }
      const q = e.target.closest('[data-qty]');
      if (q) { queue[+q.dataset.qty].qty = Math.max(1, Math.min(500, Number(q.value) || 1)); drawQueue(); }
    });
  },
};
