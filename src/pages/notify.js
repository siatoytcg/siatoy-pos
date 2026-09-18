/* แจ้งเตือนอัตโนมัติ
 *
 * LINE เรียกจากหน้าเว็บตรง ๆ ไม่ได้ (เบราว์เซอร์บล็อก) และการส่งตอนตี 1
 * ก็ทำจากหน้าเว็บไม่ได้เพราะตอนนั้นไม่มีใครเปิดแอปค้างไว้
 * ทั้งสองอย่างจึงส่งผ่านฟังก์ชันฝั่งเซิร์ฟเวอร์ ส่วนหน้านี้ทำหน้าที่ตั้งค่าและดูตัวอย่าง
 * Telegram เรียกตรงจากเบราว์เซอร์ได้ จึงทดสอบได้ทันทีแม้ยังไม่ได้ต่อเซิร์ฟเวอร์
 */
import { CONFIG, hasBackend } from '../config.js';
import { esc, toast, redrawPage } from '../lib/util.js';
import { db, metaGet, metaSet, currentLocation } from '../lib/store.js';
import { buildFlexSummary, buildTextSummary } from '../../supabase/functions/_shared/flex.js';
import { renderFlex } from '../lib/flexview.js';
import { invoke, serverSetting, currentUser, canSeeCost } from '../lib/sync.js';
import { S } from '../lib/state.js';

let cfg = { channel: 'line', time: '01:00', alerts: {}, line_to: '', tg_chat: '' };
let secrets = { line_token: '', tg_token: '' };

const ALERTS = [
  ['low',   'สินค้าใกล้หมด (เหลือไม่ถึง 3 ชิ้น)'],
  ['void',  'มีการยกเลิกบิล'],
  ['disc',  'ส่วนลดเกิน 500 บาทต่อบิล'],
  ['recon', 'กระทบยอดธนาคารพบรายการไม่ตรง'],
  ['event', 'สรุปยอดงานอีเวนต์เมื่อปิดบูธ'],
];

/* สร้างสรุปยอดจากข้อมูลในเครื่อง ให้มีหน้าตาเหมือนที่ฟังก์ชัน daily_summary
   ของฐานข้อมูลส่งกลับมา ตัวอย่างที่เห็นจึงตรงกับของที่จะส่งจริง */
async function localSummary() {
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const iso = from.toISOString();
  const sales = (await db.sales.toArray()).filter(s => s.client_created_at >= iso);
  const ok = sales.filter(s => s.status === 'normal');
  const okIds = new Set(ok.map(s => s.id));
  const products = await db.products.toArray();

  const top = new Map();
  await db.sale_items.each(it => {
    if (!okIds.has(it.sale_id)) return;
    const t = top.get(it.product_id) || { name: it.product_name, qty: 0, amount: 0 };
    t.qty += it.qty; t.amount += it.line_total;
    top.set(it.product_id, t);
  });
  const bal = new Map();
  await db.stock_moves.each(m => bal.set(m.product_id, (bal.get(m.product_id) || 0) + m.qty));
  const pay = k => ok.filter(s => s.payment === k).reduce((a, s) => a + s.total, 0);

  const d = new Date(); d.setMinutes(d.getMinutes() + 420 - new Date().getTimezoneOffset() * -1);
  return {
    date: new Date().toISOString().slice(0, 10),
    sales_total: ok.reduce((a, s) => a + s.total, 0),
    bill_count: ok.length,
    discount_total: ok.reduce((a, s) => a + s.item_discount + s.bill_discount, 0),
    card_fee: ok.reduce((a, s) => a + s.card_fee, 0),
    cash: pay('cash'), transfer: pay('transfer'), credit: pay('credit'),
    void_count: sales.filter(s => s.status === 'void').length,
    open_card_count: sales.filter(s => s.status === 'open_card').length,
    stock_qty: [...bal.values()].reduce((a, q) => a + q, 0),
    low_count: products.filter(p => (bal.get(p.id) || 0) <= 3 && p.is_active !== false).length,
    top: [...top.values()].sort((a, b) => b.qty - a.qty).slice(0, 3),
  };
}

async function load() {
  cfg = { ...cfg, ...(await metaGet('notify', {})) };
  if (hasBackend() && currentUser()) {
    // โทเคนอยู่บนเซิร์ฟเวอร์ อ่านได้เฉพาะเจ้าของร้าน
    try {
      secrets.line_token = (await serverSetting('secret:line_token')) || '';
      secrets.tg_token   = (await serverSetting('secret:tg_token')) || '';
      cfg.line_to = (await serverSetting('secret:line_to')) || cfg.line_to;
      cfg.tg_chat = (await serverSetting('secret:tg_chat')) || cfg.tg_chat;
    } catch (e) { /* ไม่มีสิทธิ์อ่าน ปล่อยว่างไว้ */ }
  } else {
    secrets = { ...secrets, ...(await metaGet('notifySecrets', {})) };
  }
}

async function save() {
  await metaSet('notify', cfg);
  if (hasBackend() && currentUser()) {
    await serverSetting('secret:line_token', secrets.line_token);
    await serverSetting('secret:line_to', cfg.line_to);
    await serverSetting('secret:tg_token', secrets.tg_token);
    await serverSetting('secret:tg_chat', cfg.tg_chat);
  } else {
    await metaSet('notifySecrets', secrets);
  }
}

async function sendNow(el) {
  const btn = el.querySelector('#nfSend');
  btn.disabled = true; btn.textContent = 'กำลังส่ง…';
  try {
    // อ่านค่าจากช่องกรอกอีกครั้งก่อนบันทึกเสมอ ไม่พึ่ง event change
    // เพราะผู้ใช้อาจกดส่งทันทีขณะเคอร์เซอร์ยังอยู่ในช่องโทเค็น
    const fields = {
      lineToken: el.querySelector('#nfLineToken'), lineTo: el.querySelector('#nfLineTo'),
      tgToken: el.querySelector('#nfTgToken'), tgChat: el.querySelector('#nfTgChat'),
      time: el.querySelector('#nfTime'),
    };
    if (fields.lineToken) secrets.line_token = fields.lineToken.value.trim();
    if (fields.lineTo) cfg.line_to = fields.lineTo.value.trim();
    if (fields.tgToken) secrets.tg_token = fields.tgToken.value.trim();
    if (fields.tgChat) cfg.tg_chat = fields.tgChat.value.trim();
    if (fields.time) cfg.time = fields.time.value;
    if ((cfg.channel === 'line' || cfg.channel === 'both') && (!secrets.line_token || !cfg.line_to))
      throw new Error('กรุณาใส่ LINE Channel access token และปลายทาง (User ID หรือ Group ID) ให้ครบ');
    if ((cfg.channel === 'telegram' || cfg.channel === 'both') && (!secrets.tg_token || !cfg.tg_chat))
      throw new Error('กรุณาใส่ Telegram Bot token และ Chat ID ให้ครบ');
    await save();
    if (hasBackend() && currentUser()) {
      const r = await invoke('notify', { channel: cfg.channel });
      const bits = [];
      if (r.line)     bits.push('LINE: ' + (r.line.ok ? 'ส่งแล้ว' : (r.line.skipped || r.line.error)));
      if (r.telegram) bits.push('Telegram: ' + (r.telegram.ok ? 'ส่งแล้ว' : (r.telegram.skipped || r.telegram.error)));
      toast(bits.join('<br>') || 'ส่งแล้ว', r.line?.ok || r.telegram?.ok ? 'ok' : 'err');
    } else if (cfg.channel === 'telegram' || cfg.channel === 'both') {
      const sum = await localSummary();
      const text = buildTextSummary(sum, { shopName: CONFIG.shopName });
      if (!secrets.tg_token || !cfg.tg_chat) throw new Error('ยังไม่ได้ใส่ Bot token และ Chat ID');
      const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(secrets.tg_token)}/sendMessage`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: cfg.tg_chat, text }) });
      const j = await res.json();
      if (!j.ok) throw new Error(j.description || 'ส่งไม่สำเร็จ');
      toast('ส่งเข้า Telegram แล้ว', 'ok');
    } else {
      throw new Error('LINE ต้องต่อฐานข้อมูลกลางก่อน เบราว์เซอร์เรียก LINE ตรง ๆ ไม่ได้');
    }
  } catch (e) {
    toast(esc(e.message), 'err');
  } finally {
    btn.disabled = false; btn.textContent = '📤 ส่งสรุปของวันนี้เดี๋ยวนี้';
  }
}

export const notifyPage = {
  async render() {
    await load();
    const loc = await currentLocation();
    const sum = await localSummary();
    const flex = buildFlexSummary(sum, { shopName: CONFIG.shopName, locationName: loc.name });
    const online = hasBackend() && currentUser();
    const isLine = cfg.channel === 'line' || cfg.channel === 'both';
    const isTg   = cfg.channel === 'telegram' || cfg.channel === 'both';

    return `
    <div class="page-head"><div><h1>แจ้งเตือนอัตโนมัติ</h1>
      <p>สรุปยอดประจำวันส่งเข้า LINE เป็นการ์ดแบบ Flex หรือส่งเข้า Telegram เป็นข้อความ</p></div></div>

    <div class="grid g2" style="align-items:start">
      <div>
        <div class="card">
          <div class="card-title"><span class="ic">🔔</span> ช่องทางการส่ง</div>
          <div class="seg" id="nfCh" style="margin-bottom:14px">
            <button class="${cfg.channel === 'line' ? 'on' : ''}" data-ch="line">LINE</button>
            <button class="${cfg.channel === 'telegram' ? 'on' : ''}" data-ch="telegram">Telegram</button>
            <button class="${cfg.channel === 'both' ? 'on' : ''}" data-ch="both">ทั้งสองทาง</button>
          </div>

          ${isLine ? `
          <div class="field"><label>LINE Channel access token (จาก LINE Developers Console)</label>
            <input class="inp" id="nfLineToken" type="password" value="${esc(secrets.line_token)}"
              placeholder="วางโทเคนยาว ๆ ที่ได้จากแท็บ Messaging API"></div>
          <div class="field"><label>ปลายทางที่จะส่งเข้า (User ID หรือ Group ID)</label>
            <input class="inp" id="nfLineTo" value="${esc(cfg.line_to)}" placeholder="U1234... หรือ C1234..."></div>
          <div class="notice ${online ? 'info' : 'warn'}">
            ${online
              ? 'โทเคนถูกเก็บไว้ที่เซิร์ฟเวอร์ ไม่ถูกส่งมาที่เครื่องพนักงาน และเปิดอ่านได้เฉพาะสิทธิ์เจ้าของร้าน'
              : 'ยังไม่ได้ต่อฐานข้อมูลกลาง ตอนนี้จึงเก็บไว้ในเครื่องนี้ชั่วคราว และยังส่ง LINE จริงไม่ได้ เพราะเบราว์เซอร์เรียก LINE ตรง ๆ ไม่ได้'}
          </div>` : ''}

          ${isTg ? `
          <div class="field" style="margin-top:14px"><label>Telegram Bot token (จาก @BotFather)</label>
            <input class="inp" id="nfTgToken" type="password" value="${esc(secrets.tg_token)}"
              placeholder="123456789:AA..."></div>
          <div class="field"><label>Chat ID (จาก @userinfobot หรือกลุ่มที่เชิญบอทเข้าไป)</label>
            <input class="inp" id="nfTgChat" value="${esc(cfg.tg_chat)}" placeholder="-1001234567890"></div>` : ''}

          <div class="field"><label>เวลาส่งสรุปประจำวัน</label>
            <input class="inp" id="nfTime" type="time" value="${esc(cfg.time)}"></div>
          <button class="btn gold block" id="nfSend">📤 ส่งสรุปของวันนี้เดี๋ยวนี้</button>
          <div class="mini" style="text-align:center;margin-top:8px">
            ${online ? 'ส่งผ่านเซิร์ฟเวอร์ · โทเคนไม่ออกจากเซิร์ฟเวอร์'
                     : 'ตอนนี้ทดสอบได้เฉพาะ Telegram'}</div>
        </div>

        <div class="card" style="margin-top:14px">
          <div class="card-title"><span class="ic">⚡</span> แจ้งเตือนอื่น ๆ</div>
          ${ALERTS.map(([k, n]) => `
            <label class="flex" style="padding:9px 0;border-bottom:1px solid var(--line);font-size:13px;cursor:pointer">
              <span>${n}</span>
              <span class="right"><input type="checkbox" data-alert="${k}" ${cfg.alerts[k] ? 'checked' : ''}></span>
            </label>`).join('')}
          <div class="notice warn" style="margin-top:14px">⚠️ การส่งตามเวลาและแจ้งเตือนอัตโนมัติเหล่านี้
            ทำงานด้วยงานตั้งเวลาฝั่งเซิร์ฟเวอร์ ต้องติดตั้ง Edge Function ก่อน
            (ขั้นตอนอยู่ในไฟล์ <b>docs/edge-functions.md</b>)</div>
        </div>
      </div>

      <div>
        <div class="card">
          <div class="card-title"><span class="ic">💬</span> ตัวอย่างการ์ดที่จะได้รับใน LINE</div>
          <div class="chat-head"><div class="chat-ava">L</div>
            ${esc(CONFIG.shopName)} · ${esc(cfg.time)} น.</div>
          <div style="background:#8CABD8;padding:16px;border-radius:12px;margin-top:10px;
                      display:flex;justify-content:center">
            ${renderFlex(flex)}
          </div>
          <div class="mini" style="margin-top:10px">
            ตัวอย่างนี้วาดจากโครงสร้างการ์ดตัวจริงที่ระบบจะส่ง และใช้ยอดขายของวันนี้จริง
            แก้ที่ตัวสร้างการ์ดเมื่อไหร่ ตัวอย่างนี้เปลี่ยนตามทันที
          </div>
        </div>
      </div>
    </div>`;
  },

  mount(el) {
    const bind = (id, key, store) => {
      const e = el.querySelector('#' + id);
      if (e) e.onchange = async () => { store[key] = e.value.trim(); await save(); toast('บันทึกแล้ว', 'ok'); };
    };
    bind('nfLineToken', 'line_token', secrets);
    bind('nfTgToken',   'tg_token',   secrets);
    bind('nfLineTo',    'line_to',    cfg);
    bind('nfTgChat',    'tg_chat',    cfg);
    bind('nfTime',      'time',       cfg);

    el.querySelector('#nfCh').onclick = async e => {
      const b = e.target.closest('[data-ch]'); if (!b) return;
      cfg.channel = b.dataset.ch; await metaSet('notify', cfg);
      await redrawPage(el, notifyPage);
    };
    el.addEventListener('change', async e => {
      const a = e.target.closest('[data-alert]');
      if (a) { cfg.alerts[a.dataset.alert] = a.checked; await metaSet('notify', cfg); }
    });
    el.querySelector('#nfSend').onclick = () => sendNow(el);
  },
};
