/* ส่งสรุปยอดเข้า LINE และ Telegram
 *
 * เรียกได้สองทาง
 *   1. จากหน้าเว็บ (ผู้ใช้กดส่งเดี๋ยวนี้) — ต้องแนบโทเคนล็อกอินมาด้วย และต้องเป็นหัวหน้าขึ้นไป
 *   2. จากงานตั้งเวลาตอนตี 1 — เรียกด้วยคีย์ระดับผู้ดูแลจากในฐานข้อมูลเอง
 *
 * โทเคนของ LINE และ Telegram เก็บเป็น secret ของฟังก์ชัน ไม่เคยถูกส่งมาถึงเบราว์เซอร์
 * เพราะใครได้โทเคนไปก็ส่งข้อความในนามร้านได้
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { buildFlexSummary, buildTextSummary, altText } from '../_shared/flex.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;

// ฟังก์ชันสรุปอาจคืนค่า null เมื่อยังไม่มีบิลในวันนั้น
// ทำให้ตัวสร้างการ์ดอ่าน .top ไม่ได้และหน้าเว็บเห็นข้อความ Cannot read null
const emptySummary = () => ({
  date: new Date().toISOString().slice(0, 10), sales_total: 0, bill_count: 0,
  discount_total: 0, card_fee: 0, cash: 0, transfer: 0, credit: 0,
  void_count: 0, open_card_count: 0, stock_qty: 0, low_count: 0, top: [],
});

/* โทเคนอ่านจาก secret ของฟังก์ชันก่อน ถ้าไม่มีค่อยอ่านจากตาราง settings
   ที่เจ้าของร้านกรอกไว้ในหน้าแจ้งเตือน จะได้ตั้งค่าเองได้โดยไม่ต้องใช้ CLI */
async function secret(admin: any, key: string, env: string) {
  const v = Deno.env.get(env);
  if (v) return v;
  const { data } = await admin.from('settings').select('value').eq('key', 'secret:' + key).maybeSingle();
  return data?.value ?? null;
}

async function sendLine(admin: any, flex: unknown, alt: string) {
  const token = await secret(admin, 'line_token', 'LINE_CHANNEL_TOKEN');
  const to = await secret(admin, 'line_to', 'LINE_TO');
  if (!token || !to) return { ok: false, skipped: 'ยังไม่ได้ตั้งค่า LINE' };
  const r = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ to, messages: [{ type: 'flex', altText: alt, contents: flex }] }),
  });
  return r.ok ? { ok: true } : { ok: false, error: await r.text() };
}

async function sendTelegram(admin: any, text: string) {
  const token = await secret(admin, 'tg_token', 'TELEGRAM_BOT_TOKEN');
  const chat = await secret(admin, 'tg_chat', 'TELEGRAM_CHAT_ID');
  if (!token || !chat) return { ok: false, skipped: 'ยังไม่ได้ตั้งค่า Telegram' };
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text }),
  });
  const j = await r.json();
  return j.ok ? { ok: true } : { ok: false, error: j.description };
}

function thaiNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find(p => p.type === type)?.value || '';
  return { time: `${get('hour')}:${get('minute')}`, date: new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const auth = req.headers.get('Authorization') || '';
    const admin = createClient(SB_URL, SERVICE);

    // เรียกจากงานตั้งเวลาจะใช้คีย์ผู้ดูแล  เรียกจากหน้าเว็บต้องเช็กสิทธิ์ก่อน
    const isCron = auth === 'Bearer ' + SERVICE;
    if (!isCron) {
      const asUser = createClient(SB_URL, ANON, { global: { headers: { Authorization: auth } } });
      const { data: u } = await asUser.auth.getUser();
      if (!u?.user) return json({ error: 'ต้องล็อกอินก่อน' }, 401);
      const { data: p } = await admin.from('profiles').select('role').eq('id', u.user.id).maybeSingle();
      if (!p || (p.role !== 'owner' && p.role !== 'supervisor'))
        return json({ error: 'ส่งแจ้งเตือนได้เฉพาะสิทธิ์หัวหน้างานขึ้นไป' }, 403);
    }

    const { data: rawSummary, error } = await admin.rpc('daily_summary', {
      p_date: body.date ?? null, p_location: body.location_id ?? null,
    });
    if (error) return json({ error: error.message }, 500);
    const sum = { ...emptySummary(), ...(rawSummary || {}) };
    if (!Array.isArray(sum.top)) sum.top = [];

    const { data: shopRow } = await admin.from('settings').select('value').eq('key', 'shopName').maybeSingle();
    const opts = { shopName: shopRow?.value ?? 'Siatoy TCG', locationName: body.location_name || '' };

    // งาน cron เรียกโดยไม่มี channel ส่วนการกดส่งทันทีจะส่ง channel มาเสมอ
    const { data: notifyConfig } = await admin.from('settings').select('value').eq('key', 'notify_config').maybeSingle();
    const scheduled = isCron && !body.channel;
    let channel = body.channel || notifyConfig?.value?.channel || 'line';
    if (scheduled) {
      const now = thaiNow();
      if (notifyConfig?.value?.enabled === false || (notifyConfig?.value?.time && notifyConfig.value.time !== now.time))
        return json({ ok: true, skipped: 'ยังไม่ถึงเวลาที่ตั้งไว้' });
      const { data: lastSent } = await admin.from('settings').select('value').eq('key', 'notify_last_sent').maybeSingle();
      if (lastSent?.value?.date === now.date) return json({ ok: true, skipped: 'ส่งวันนี้แล้ว' });
    }

    const flex = buildFlexSummary(sum, opts);
    const text = buildTextSummary(sum, opts);

    if (body.dry) return json({ summary: sum, flex, text, altText: altText(sum) });

    const line = channel === 'telegram' ? { skipped: 'ข้าม' } : await sendLine(admin, flex, altText(sum));
    const tg   = channel === 'line'     ? { skipped: 'ข้าม' } : await sendTelegram(admin, text);
    if (scheduled && (line.ok || tg.ok)) {
      await admin.from('settings').upsert({ key: 'notify_last_sent', value: { date: thaiNow().date } }, { onConflict: 'key' });
    }
    return json({ ok: true, summary: sum, line, telegram: tg });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
