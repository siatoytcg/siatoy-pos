/* ตั้งค่าระบบ · ตอนนี้ค่าทั้งหมดเก็บในเครื่องนี้ (ตาราง meta)
 * เมื่อต่อฐานข้อมูลกลางแล้วจะย้ายไปตาราง settings ให้ทุกเครื่องใช้ค่าเดียวกัน
 * ยกเว้น "จุดขายของเครื่องนี้" ที่ต้องแยกตามเครื่องเสมอ
 */
import { CONFIG, hasBackend } from '../config.js';
import { esc, money, toast, openModal, closeModal, uuid } from '../lib/util.js';
import { db, saveSetting, currentLocation, setLocation, deviceId, pendingCount, blockedItems, wipeLocal } from '../lib/store.js';
import { push, mfaFactors, mfaEnroll, mfaConfirm, mfaRemove, currentUser, currentProfile } from '../lib/sync.js';
import { hasPin, setPin, clearPin, setLockMinutes, lockMinutes, lockNow } from '../lib/lock.js';
import { encode128, padEven } from '../lib/code128.js';
import { S } from '../lib/state.js';

const ROLES = [
  { r: 'พนักงานหน้าร้าน', ico: '👤', key: 'admin',
    can: ['ทำบิล / รับเงิน', 'สแกนรับเข้า-ตัดออก', 'ดูสต๊อกคงเหลือ', 'พิมพ์บาร์โค้ด'],
    cant: ['ดูราคาต้นทุน', 'ยกเลิกบิล', 'ดูรายงานกำไร', 'แก้ราคาสินค้า'] },
  { r: 'หัวหน้างาน', ico: '🛡️', key: 'sup',
    can: ['ทุกอย่างของพนักงาน', 'อนุมัติยกเลิกบิล', 'ดูต้นทุนและกำไร', 'แก้ราคาและข้อมูลสินค้า', 'กระทบยอดธนาคาร'],
    cant: ['เปิดการ์ดโดยไม่รับเงิน'] },
  { r: 'เจ้าของร้าน', ico: '👑', key: 'owner',
    can: ['เห็นทุกอย่าง', 'เปิดการ์ดโดยไม่รับเงิน', 'อนุมัติขั้นสุดท้าย'], cant: [] },
];

/* ตัวอย่างผลของค่า dpi ต่อบาร์โค้ดจริง ใช้รหัสตัวอย่างความยาวเท่าของร้าน */
function dpiExample(dpi) {
  const data = padEven('8859002');
  const { modules } = encode128(data);
  const dot = 25.4 / dpi;
  const dots = Math.floor((30 - 1.6) / (modules + 20) / dot);
  return { dots, mm: dots * dot, ok: dots >= 2 };
}

export const settingsPage = {
  async render() {
    const loc = await currentLocation();
    const locs = await db.locations.toArray();
    const dev  = await deviceId();
    const pend = await pendingCount();
    const stuck = await blockedItems();
    const pinOn = await hasPin();
    const me = currentProfile();
    const canMfa = hasBackend() && currentUser() && me && me.role === 'owner';
    const factors = canMfa ? await mfaFactors() : [];
    const bills = await db.sales.count();

    return `
    <div class="page-head"><div><h1>ตั้งค่าระบบ</h1>
      <p>ค่าทั้งหมดยังเก็บในเครื่องนี้ · ย้ายขึ้นเซิร์ฟเวอร์เมื่อต่อฐานข้อมูลแล้ว</p></div></div>
    <div class="grid g2" style="align-items:start">
      <div>
        <div class="card">
          <div class="card-title"><span class="ic">🏪</span> ร้านและจุดขาย</div>
          <div class="field"><label>ชื่อร้าน (แสดงบนสติกเกอร์)</label>
            <input class="inp" id="setShop" value="${esc(CONFIG.shopName)}"></div>
          <div class="field"><label>จุดขายของเครื่องนี้</label>
            <select class="inp" id="setLoc">
              ${locs.map(l => `<option value="${l.id}" ${l.id === loc.id ? 'selected' : ''}>
                ${l.kind === 'event' ? '🎪' : '🏪'} ${esc(l.name)} (${esc(l.code)})</option>`).join('')}
            </select></div>
          <div class="notice info" style="margin:0">เครื่องแต่ละเครื่องตั้งจุดขายของตัวเอง
            บิลและการเดินของจะถูกบันทึกเข้าจุดขายนี้ ทำให้แยกยอดหน้าร้านกับบูธงานออกจากกันได้</div>
        </div>

        <div class="card" style="margin-top:14px">
          <div class="card-title"><span class="ic">🖨️</span> เครื่องพิมพ์สติกเกอร์</div>
          <div class="field"><label>ความละเอียด (ดูได้จากค่ากำหนดลักษณะการพิมพ์ของ ES-9960 ใน Windows)</label>
            <div class="seg" id="setDpi">
              ${[203, 300].map(d => `<button class="${CONFIG.printerDpi === d ? 'on' : ''}" data-dpi="${d}">${d} dpi</button>`).join('')}
            </div></div>
          <div id="dpiInfo"></div>
        </div>

        <div class="card" style="margin-top:14px">
          <div class="card-title"><span class="ic">💳</span> การชำระเงินและแต้ม</div>
          <div class="field"><label>ค่าธรรมเนียมบัตรเครดิต (%)</label>
            <input class="inp" id="setFee" type="number" step="0.5" value="${CONFIG.creditFee}"></div>
          <div class="field" style="margin:0"><label>อัตราสะสมแต้ม (ทุกกี่บาทได้ 1 แต้ม)</label>
            <input class="inp" id="setPoint" type="number" value="${CONFIG.pointRate}"></div>
        </div>
      </div>

      <div>
        <div class="card">
          <div class="card-title"><span class="ic">👥</span> สิทธิ์ผู้ใช้งาน</div>
          <div class="notice warn">ตอนนี้ปุ่มสลับสิทธิ์มุมขวาบนเป็นของชั่วคราวไว้ทดลองดูความต่าง
            ยังไม่มีการล็อกอินจริง ของจริงจะบังคับที่ฐานข้อมูลด้วย เมื่อต่อ Supabase แล้ว
            ต้นทุนจะไม่ถูกส่งมาถึงเครื่องพนักงานเลยตั้งแต่แรก</div>
          ${ROLES.map(x => `<div style="padding:12px 0;border-bottom:1px solid var(--line)">
            <div class="flex"><b style="font-weight:500;font-size:13.5px">${x.ico} ${x.r}</b>
              ${S.role === x.key ? '<span class="right tag green">กำลังใช้อยู่</span>' : ''}</div>
            <div style="margin-top:7px;display:flex;flex-wrap:wrap;gap:5px">
              ${x.can.map(c => `<span class="tag green">✓ ${c}</span>`).join('')}
              ${x.cant.map(c => `<span class="tag red">✕ ${c}</span>`).join('')}
            </div></div>`).join('')}
        </div>

        <div class="card" style="margin-top:14px">
          <div class="card-title"><span class="ic">🔐</span> ความปลอดภัย</div>

          <div class="flex" style="padding:8px 0;font-size:13.5px">
            <span>PIN ล็อกหน้าจอ</span>
            <span class="right">${pinOn ? '<span class="tag green">ตั้งไว้แล้ว</span>'
                                       : '<span class="tag warn">ยังไม่ได้ตั้ง</span>'}</span></div>
          <p style="font-size:13px;color:var(--muted);line-height:1.7;margin:0 0 10px">
            ใช้ตอนเดินออกจากเครื่องชั่วคราว กดล็อกที่ปุ่มรูปกุญแจมุมขวาบน
            แล้วปลดล็อกด้วย PIN 6 หลัก ไม่ต้องพิมพ์รหัสผ่านยาว ๆ ต่อหน้าลูกค้า
            และไม่ต้องล็อกอินใหม่ · <b>PIN ของแต่ละคนแยกกัน</b> คนอื่นเปิดดูไม่ได้แม้แต่เจ้าของร้าน</p>
          <div class="flex wrap" style="gap:8px">
            <button class="btn" id="secPin">${pinOn ? 'เปลี่ยน PIN' : 'ตั้ง PIN'}</button>
            ${pinOn ? '<button class="btn ghost" id="secPinDel">ลบ PIN</button>' : ''}
            ${pinOn ? '<button class="btn" id="secLockNow">🔒 ล็อกเดี๋ยวนี้</button>' : ''}
          </div>

          <div class="field" style="margin-top:14px"><label>ล็อกอัตโนมัติเมื่อไม่ได้แตะเครื่อง</label>
            <select class="inp" id="secMin" ${pinOn ? '' : 'disabled'}>
              ${[[0,'ไม่ล็อกอัตโนมัติ'],[1,'1 นาที'],[3,'3 นาที'],[5,'5 นาที'],
                 [10,'10 นาที'],[30,'30 นาที']].map(([v,n]) =>
                `<option value="${v}" ${lockMinutes() === v ? 'selected' : ''}>${n}</option>`).join('')}
            </select></div>
          ${pinOn ? '' : '<div class="mini">ตั้ง PIN ก่อนถึงจะเปิดล็อกอัตโนมัติได้</div>'}

          ${canMfa ? `
          <div class="hr"></div>
          <div class="flex" style="padding:8px 0;font-size:13.5px">
            <span>ยืนยันตัวตนสองชั้น</span>
            <span class="right">${factors.length ? '<span class="tag green">เปิดอยู่</span>'
                                                  : '<span class="tag warn">ยังไม่เปิด</span>'}</span></div>
          <p style="font-size:13px;color:var(--muted);line-height:1.7;margin:0 0 10px">
            บัญชีเจ้าของร้านเห็นทุกอย่างและสร้างบัญชีคนอื่นได้ ควรมีชั้นที่สอง
            เวลาล็อกอินจะถามรหัส 6 หลักจากแอปยืนยันตัวตนในมือถือเพิ่มอีกครั้ง</p>
          ${factors.length
            ? '<button class="btn danger" id="secMfaOff">ปิดยืนยันสองชั้น</button>'
            : '<button class="btn gold" id="secMfaOn">เปิดยืนยันสองชั้น</button>'}
          ` : ''}
        </div>

        <div class="card" style="margin-top:14px">
          <div class="card-title"><span class="ic">💾</span> ข้อมูลในเครื่องนี้</div>
          <div class="flex" style="padding:8px 0;border-bottom:1px solid var(--line);font-size:13px">
            <span>รหัสเครื่อง</span><b class="right" style="font-weight:400">${esc(dev)}</b></div>
          <div class="flex" style="padding:8px 0;border-bottom:1px solid var(--line);font-size:13px">
            <span>บิลที่บันทึกไว้</span><b class="right" style="font-weight:400">${bills} ใบ</b></div>
          <div class="flex" style="padding:8px 0;border-bottom:1px solid var(--line);font-size:13px">
            <span>รอส่งขึ้นเซิร์ฟเวอร์</span>
            <b class="right" style="font-weight:400;color:${pend ? 'var(--warn)' : 'var(--green)'}">${pend} รายการ</b></div>
          <div class="flex" style="padding:8px 0;font-size:13px">
            <span>ฐานข้อมูลกลาง</span>
            <b class="right" style="font-weight:400">${hasBackend() ? '<span class="tag green">ต่อแล้ว</span>' : '<span class="tag warn">ยังไม่ได้ต่อ</span>'}</b></div>
        </div>

        ${stuck.length ? `
        <div class="card" style="margin-top:14px;border-color:var(--warn)">
          <div class="card-title"><span class="ic">📮</span> ส่งขึ้นเซิร์ฟเวอร์ไม่สำเร็จ
            <span class="sub">${stuck.length} รายการ</span></div>
          <div class="notice warn">รายการเหล่านี้ถูกเซิร์ฟเวอร์ปฏิเสธ จึงหยุดลองส่งไว้ก่อน
            ไม่ให้ไปขวางรายการอื่นในคิว · แก้ต้นเหตุแล้วกดลองใหม่ได้</div>
          ${stuck.map(e => `<div class="ci"><div class="info">
            <div class="nm">${esc(e.kind)} · ${new Date(e.at).toLocaleString('th-TH')}</div>
            <div class="meta" style="color:var(--red)">${esc(e.lastError || '-')}</div></div>
            <div class="flex" style="gap:6px;align-self:center">
              <button class="btn sm" data-retry="${e.seq}">ลองใหม่</button>
              <button class="btn sm danger" data-drop="${e.seq}">ทิ้ง</button></div></div>`).join('')}
        </div>` : ''}

        <div class="card" style="margin-top:14px;border-color:var(--red)">
          <div class="card-title"><span class="ic">⚠️</span> ล้างข้อมูลทดลอง</div>
          <p style="font-size:13px;color:var(--muted);line-height:1.7;margin:0 0 12px">
            ลบทุกอย่างในเครื่องนี้แล้วเริ่มใหม่ด้วยข้อมูลตัวอย่างชุดเดิม
            ใช้ตอนจะเริ่มใช้งานจริง หรือเวลาทดลองจนข้อมูลรก
            <b>บิลที่ยังไม่ได้ส่งขึ้นเซิร์ฟเวอร์จะหายไปด้วย</b></p>
          <button class="btn danger block" id="setWipe">ล้างข้อมูลในเครื่องนี้ทั้งหมด</button>
        </div>
      </div>
    </div>`;
  },

  mount(el) {
    const drawDpi = () => {
      const e = dpiExample(CONFIG.printerDpi);
      el.querySelector('#dpiInfo').innerHTML = `
        <div class="notice ${e.ok ? 'info' : 'red'}" style="margin:0">
          ที่ ${CONFIG.printerDpi} dpi หนึ่งจุดกว้าง ${(25.4 / CONFIG.printerDpi).toFixed(4)} มม.<br>
          รหัส 7 หลักบนดวง 30 × 20 มม. จะได้แท่งบางสุด <b>${e.dots} จุด = ${e.mm.toFixed(3)} มม.</b>
          ${e.ok ? 'ซึ่งอยู่ในเกณฑ์ที่เครื่องยิงอ่านได้สบาย' : 'ซึ่งถี่เกินไป ควรใช้ดวงใหญ่ขึ้น'}
        </div>`;
    };
    drawDpi();

    el.querySelector('#setShop').onchange = async e => {
      await saveSetting(CONFIG, 'shopName', e.target.value.trim() || 'Siatoy TCG');
      toast('บันทึกชื่อร้านแล้ว', 'ok');
    };
    el.querySelector('#setFee').onchange = async e => {
      await saveSetting(CONFIG, 'creditFee', Number(e.target.value) || 0);
      toast('ค่าธรรมเนียมบัตร = ' + CONFIG.creditFee + '%', 'ok');
    };
    el.querySelector('#setPoint').onchange = async e => {
      await saveSetting(CONFIG, 'pointRate', Number(e.target.value) || 100);
      toast('ทุก ' + CONFIG.pointRate + ' บาท = 1 แต้ม', 'ok');
    };
    el.querySelector('#setLoc').onchange = async e => {
      await setLocation(e.target.value);
      toast('เปลี่ยนจุดขายของเครื่องนี้แล้ว', 'ok');
      location.reload();
    };
    el.querySelector('#setDpi').onclick = async e => {
      const b = e.target.closest('[data-dpi]'); if (!b) return;
      await saveSetting(CONFIG, 'printerDpi', Number(b.dataset.dpi));
      el.querySelectorAll('[data-dpi]').forEach(x =>
        x.classList.toggle('on', Number(x.dataset.dpi) === CONFIG.printerDpi));
      drawDpi();
      toast('ตั้งความละเอียดเครื่องพิมพ์เป็น ' + CONFIG.printerDpi + ' dpi', 'ok');
    };

    el.addEventListener('click', async e => {
      const r = e.target.closest('[data-retry]');
      if (r) { await db.outbox.update(Number(r.dataset.retry), { blocked: false, tries: 0 });
        const res = await push();
        toast(res.sent ? 'ส่งขึ้นเซิร์ฟเวอร์แล้ว' : 'ยังส่งไม่ได้ · ' + (res.failed || ''), res.sent ? 'ok' : 'err');
        location.reload(); return; }
      const d = e.target.closest('[data-drop]');
      if (d) { await db.outbox.delete(Number(d.dataset.drop)); toast('ทิ้งรายการแล้ว'); location.reload(); }
    });

    /* ---------------- PIN และการล็อกหน้าจอ ---------------- */
    const askPin = () => {
      openModal(`
        <div class="modal-head"><h3>ตั้ง PIN ล็อกหน้าจอ</h3><button class="x" id="mClose">✕</button></div>
        <div class="modal-body">
          <div class="field"><label>PIN ใหม่ (ตัวเลข 6 หลัก)</label>
            <input class="inp" id="pin1" inputmode="numeric" maxlength="6" type="password"
              style="text-align:center;font-size:24px;letter-spacing:10px" autofocus></div>
          <div class="field"><label>ใส่ซ้ำอีกครั้ง</label>
            <input class="inp" id="pin2" inputmode="numeric" maxlength="6" type="password"
              style="text-align:center;font-size:24px;letter-spacing:10px"></div>
          <div id="pinErr"></div>
          <div class="notice info">อย่าใช้เลขเดาง่ายอย่าง 123456 หรือวันเกิด
            ถ้าลืม PIN ให้กดออกจากระบบที่หน้าล็อก แล้วเข้าใหม่ด้วยรหัสผ่าน</div>
        </div>
        <div class="modal-foot"><button class="btn ghost" id="mNo">ยกเลิก</button>
          <button class="btn gold" id="mOk">บันทึก PIN</button></div>`);
      const box = document.getElementById('modalBox');
      box.querySelector('#mClose').onclick = box.querySelector('#mNo').onclick = closeModal;
      box.querySelector('#mOk').onclick = async () => {
        const a = box.querySelector('#pin1').value.trim(), b = box.querySelector('#pin2').value.trim();
        const err = box.querySelector('#pinErr');
        if (!/^\d{6}$/.test(a)) { err.innerHTML = '<div class="notice red">ต้องเป็นตัวเลข 6 หลัก</div>'; return; }
        if (a !== b) { err.innerHTML = '<div class="notice red">ใส่ไม่ตรงกัน</div>'; return; }
        if (/^(\d)\1{5}$/.test(a) || a === '123456' || a === '000000') {
          err.innerHTML = '<div class="notice red">PIN นี้เดาง่ายเกินไป ใช้เลขอื่น</div>'; return; }
        try { await setPin(a); closeModal(); toast('ตั้ง PIN แล้ว', 'ok'); location.reload(); }
        catch (e) { err.innerHTML = '<div class="notice red">' + esc(e.message) + '</div>'; }
      };
    };
    const secPin = el.querySelector('#secPin');
    if (secPin) secPin.onclick = askPin;
    const secPinDel = el.querySelector('#secPinDel');
    if (secPinDel) secPinDel.onclick = async () => {
      await clearPin(); await setLockMinutes(0);
      toast('ลบ PIN แล้ว · ล็อกอัตโนมัติถูกปิดไปด้วย'); location.reload();
    };
    const secLockNow = el.querySelector('#secLockNow');
    if (secLockNow) secLockNow.onclick = () => lockNow('กดล็อกเอง');
    const secMin = el.querySelector('#secMin');
    if (secMin) secMin.onchange = async () => {
      await setLockMinutes(Number(secMin.value));
      toast(Number(secMin.value) ? 'ล็อกอัตโนมัติหลังไม่ได้แตะ ' + secMin.value + ' นาที'
                                 : 'ปิดล็อกอัตโนมัติแล้ว', 'ok');
    };

    /* ---------------- ยืนยันตัวตนสองชั้น ---------------- */
    const mfaOn = el.querySelector('#secMfaOn');
    if (mfaOn) mfaOn.onclick = async () => {
      try {
        const f = await mfaEnroll();
        openModal(`
          <div class="modal-head"><h3>เปิดยืนยันตัวตนสองชั้น</h3><button class="x" id="mClose">✕</button></div>
          <div class="modal-body">
            <div class="notice info">ใช้แอปยืนยันตัวตนในมือถือ เช่น Google Authenticator
              หรือ Microsoft Authenticator สแกนรูปด้านล่าง</div>
            <div style="text-align:center;margin:16px 0;background:#fff;padding:14px;border-radius:10px">
              <img src="${f.totp.qr_code}" alt="QR" style="width:190px;height:190px"></div>
            <div class="field"><label>ถ้าสแกนไม่ได้ ให้พิมพ์รหัสนี้ในแอปแทน</label>
              <input class="inp" value="${esc(f.totp.secret)}" readonly
                style="font-family:monospace;font-size:13px"></div>
            <div class="field"><label>ใส่รหัส 6 หลักที่แอปแสดงอยู่เพื่อยืนยัน</label>
              <input class="inp" id="mfaCode" inputmode="numeric" maxlength="6"
                style="text-align:center;font-size:24px;letter-spacing:10px" placeholder="000000"></div>
            <div id="mfaErr"></div>
          </div>
          <div class="modal-foot"><button class="btn ghost" id="mNo">ยกเลิก</button>
            <button class="btn gold" id="mOk">ยืนยันและเปิดใช้งาน</button></div>`, true);
        const box = document.getElementById('modalBox');
        box.querySelector('#mClose').onclick = box.querySelector('#mNo').onclick = closeModal;
        box.querySelector('#mOk').onclick = async () => {
          const code = box.querySelector('#mfaCode').value.trim();
          try {
            await mfaConfirm(f.id, code);
            closeModal(); toast('เปิดยืนยันสองชั้นแล้ว', 'ok'); location.reload();
          } catch (e) {
            box.querySelector('#mfaErr').innerHTML = '<div class="notice red">' + esc(e.message) + '</div>';
          }
        };
      } catch (e) { toast(esc(e.message), 'err'); }
    };
    const mfaOff = el.querySelector('#secMfaOff');
    if (mfaOff) mfaOff.onclick = async () => {
      try {
        const fs = await mfaFactors();
        for (const f of fs) await mfaRemove(f.id);
        toast('ปิดยืนยันสองชั้นแล้ว'); location.reload();
      } catch (e) { toast(esc(e.message), 'err'); }
    };

    el.querySelector('#setWipe').onclick = () => {
      openModal(`
        <div class="modal-head"><h3>ล้างข้อมูลในเครื่องนี้</h3><button class="x" id="mClose">✕</button></div>
        <div class="modal-body">
          <div class="notice red">การกระทำนี้ย้อนกลับไม่ได้ บิลที่ยังไม่ได้ส่งขึ้นเซิร์ฟเวอร์จะหายทั้งหมด<br>
            พิมพ์คำว่า <b>ล้าง</b> ในช่องด้านล่างเพื่อยืนยัน</div>
          <div class="field" style="margin-top:14px"><input class="inp" id="wipeKey" placeholder="ล้าง"></div>
        </div>
        <div class="modal-foot"><button class="btn ghost" id="mNo">ยกเลิก</button>
          <button class="btn danger" id="mOk">ล้างข้อมูล</button></div>`);
      const box = document.getElementById('modalBox');
      box.querySelector('#mClose').onclick = box.querySelector('#mNo').onclick = closeModal;
      box.querySelector('#mOk').onclick = async () => {
        if (box.querySelector('#wipeKey').value.trim() !== 'ล้าง') {
          toast('พิมพ์คำว่า ล้าง เพื่อยืนยัน', 'err'); return;
        }
        await wipeLocal(); closeModal(); location.reload();
      };
    };
  },
};
