/* บล็อกเซต & การตั้งราคา
 * เปลี่ยนราคาแล้วมีผลกับของที่เหลือในสต๊อกเท่านั้น
 * บิลเก่ายังคงราคาเดิมเพราะบันทึกราคา ณ วันขายไว้ในบรรทัดบิลแล้ว
 */
import { money, esc, uuid, toast, openModal, closeModal } from '../lib/util.js';
import { db, stockMap } from '../lib/store.js';
import { S } from '../lib/state.js';

let sets = [], products = [], all = new Map();

async function load() {
  sets     = await db.card_sets.toArray();
  products = await db.products.toArray();
  all      = await stockMap(null);
}

function editPrices(setId) {
  if (S.role === 'admin') { toast('แก้ราคาได้เฉพาะหัวหน้างานขึ้นไป', 'err'); return; }
  const s = sets.find(x => x.id === setId);
  const items = products.filter(p => p.set_id === setId);
  openModal(`
    <div class="modal-head"><h3>ปรับราคาขาย · ${esc(s.name)}</h3><button class="x" id="mClose">✕</button></div>
    <div class="modal-body">
      <div class="notice warn">📌 ราคาใหม่มีผลกับ <b>สินค้าคงเหลือในเซตนี้เท่านั้น</b> —
        บิลที่ขายไปแล้วยังคงบันทึกด้วยราคาเดิม ยอดขายและกำไรย้อนหลังจึงไม่เปลี่ยน</div>
      <div style="margin-top:14px">
        ${items.map(p => `<div class="flex" style="padding:9px 0;border-bottom:1px solid var(--line)">
          <div style="flex:1"><div style="font-size:13px">${p.icon || '🃏'} ${esc(p.name)}</div>
            <div class="mini">คงเหลือ ${all.get(p.id) || 0} ชิ้น · ราคาปัจจุบัน ${money(p.price)} ฿</div></div>
          <input class="inp" style="width:110px" type="number" value="${p.price}" data-pid="${p.id}"></div>`).join('')}
      </div>
      <div class="field" style="margin-top:14px"><label>เหตุผลการปรับราคา (เก็บในประวัติ)</label>
        <select class="inp" id="prReason">
          <option>ราคาตลาดขยับขึ้น</option><option>ราคาตลาดตก</option>
          <option>ล้างสต๊อก</option><option>ปรับตามต้นทุนล็อตใหม่</option><option>อื่น ๆ</option>
        </select></div>
    </div>
    <div class="modal-foot"><button class="btn ghost" id="mNo">ยกเลิก</button>
      <button class="btn gold" id="mOk">บันทึกราคาใหม่</button></div>`, true);
  const box = document.getElementById('modalBox');
  box.querySelector('#mClose').onclick = box.querySelector('#mNo').onclick = closeModal;
  box.querySelector('#mOk').onclick = async () => {
    const reason = box.querySelector('#prReason').value;
    const now = new Date().toISOString();
    let n = 0;
    for (const inp of box.querySelectorAll('[data-pid]')) {
      const p = products.find(x => x.id === inp.dataset.pid);
      const price = Number(inp.value) || p.price;
      if (price === p.price) continue;
      await db.meta.put({ key: 'ph:' + uuid(),
        value: { product_id: p.id, from: p.price, price, at: now, by: S.role, reason } });
      await db.products.update(p.id, { price });
      n++;
    }
    closeModal();
    toast(n ? 'อัปเดตราคา ' + n + ' รายการ · เก็บประวัติราคาเดิมไว้แล้ว' : 'ไม่มีราคาที่เปลี่ยน', n ? 'ok' : '');
    if (n) location.reload();
  };
}

function addSet() {
  openModal(`
    <div class="modal-head"><h3>เพิ่มบล็อกเซต</h3><button class="x" id="mClose">✕</button></div>
    <div class="modal-body">
      <div class="field"><label>รหัสเซต</label><input class="inp" id="nsCode" placeholder="เช่น SV10"></div>
      <div class="field"><label>ชื่อเซต</label><input class="inp" id="nsName" placeholder="เช่น Destined Rivals (SV10)"></div>
      <div class="field" style="margin:0"><label>เกม</label>
        <input class="inp" id="nsGame" placeholder="เช่น Pokémon / One Piece"></div>
    </div>
    <div class="modal-foot"><button class="btn ghost" id="mNo">ยกเลิก</button>
      <button class="btn gold" id="mOk">เพิ่ม</button></div>`);
  const box = document.getElementById('modalBox');
  box.querySelector('#mClose').onclick = box.querySelector('#mNo').onclick = closeModal;
  box.querySelector('#mOk').onclick = async () => {
    const code = box.querySelector('#nsCode').value.trim();
    const name = box.querySelector('#nsName').value.trim();
    if (!code || !name) { toast('กรอกรหัสและชื่อให้ครบ', 'err'); return; }
    await db.card_sets.put({ id: 'set-' + code.toLowerCase(), code, name,
      game: box.querySelector('#nsGame').value.trim() || '-', is_open: true, sort_order: 0 });
    closeModal(); location.reload();
  };
}

export const setsPage = {
  async render() {
    await load();
    return `
    <div class="page-head">
      <div><h1>บล็อกเซต &amp; การตั้งราคา</h1>
        <p>จัดกลุ่มสินค้าเป็นเซต · เปลี่ยนราคาแล้วมีผลเฉพาะของที่เหลือในสต๊อก</p></div>
      <div class="spacer"></div>
      <button class="btn gold sup-up" id="setsAdd">+ เพิ่มเซต</button>
    </div>
    <div class="notice warn" style="margin-bottom:16px">📌 บิลที่ขายไปแล้วเก็บ “ราคา ณ วันที่ขาย”
      ไว้ในตัวบิลเสมอ การปรับราคาวันนี้จึงไม่กระทบยอดขายและกำไรย้อนหลัง</div>
    <div class="grid g2">
      ${sets.map(s => {
        const items = products.filter(p => p.set_id === s.id);
        const qty = items.reduce((a, p) => a + (all.get(p.id) || 0), 0);
        const val = items.reduce((a, p) => a + p.price * (all.get(p.id) || 0), 0);
        return `<div class="card">
          <div class="card-title"><span class="ic">🎴</span> ${esc(s.name)}<span class="sub">${esc(s.game || '-')}</span></div>
          <div class="flex wrap" style="gap:16px;margin-bottom:12px">
            <div><div class="mini">รายการ</div><div style="font-size:19px">${items.length}</div></div>
            <div><div class="mini">คงเหลือรวม</div><div style="font-size:19px">${money(qty)}</div></div>
            <div><div class="mini">มูลค่าตามราคาขาย</div>
              <div style="font-size:19px;color:var(--gold2)">฿ ${money(val)}</div></div>
          </div>
          <div style="max-height:150px;overflow:auto;margin-bottom:12px">
            ${items.length ? items.map(p => `<div class="flex" style="padding:6px 0;border-bottom:1px solid var(--line);font-size:12.5px">
              <div style="flex:1">${p.icon || '🃏'} ${esc(p.name.slice(0, 40))}</div>
              <div style="color:var(--gold2)">฿${money(p.price)}</div>
              <div class="mini" style="min-width:44px;text-align:right">×${all.get(p.id) || 0}</div></div>`).join('')
              : '<div class="mini">ยังไม่มีสินค้าในเซตนี้</div>'}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  },
  mount(el) {
    el.querySelector('#setsAdd').onclick = addSet;
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-set]'); if (b) editPrices(b.dataset.set);
    });
  },
};
