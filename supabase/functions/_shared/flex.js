/* ตัวสร้างข้อความแจ้งเตือน · ไฟล์เดียวใช้ทั้งสองที่
 *   - หน้าเว็บ import ไปแสดงตัวอย่างก่อนส่ง
 *   - Edge Function import ไปสร้างของจริงตอนส่งเข้า LINE / Telegram
 * เขียนเป็น JavaScript ล้วนไม่พึ่งอะไรเลย จะได้รันได้ทั้งในเบราว์เซอร์และบน Deno
 * ถ้าแก้ที่นี่ ทั้งตัวอย่างและของจริงเปลี่ยนตามพร้อมกัน ไม่มีทางหลุดจากกัน
 */

const B = '#111111';        // ดำ
const GOLD = '#E8B44A';
const GREEN = '#2E9E5B';
const RED = '#D14B3F';
const GREY = '#8A8A8A';

export const baht = n =>
  Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const thaiDate = d => {
  // daily_summary อาจคืน date เป็น null เมื่อยังไม่มีรายการในวันนั้น
  const dt = d ? (typeof d === 'string' ? new Date(d + 'T00:00:00') : d) : new Date();
  return dt.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
};

/* แถวข้อความซ้าย-ขวา */
const row = (label, value, color) => ({
  type: 'box', layout: 'horizontal', spacing: 'sm',
  contents: [
    { type: 'text', text: label, size: 'sm', color: GREY, flex: 5 },
    { type: 'text', text: value, size: 'sm', color: color || '#333333',
      align: 'end', weight: 'bold', flex: 4 },
  ],
});

/* ข้อความแบบ Flex สำหรับ LINE
 * sum = ผลลัพธ์จากฟังก์ชัน daily_summary ในฐานข้อมูล
 */
export function buildFlexSummary(sum, opts = {}) {
  const shop = opts.shopName || 'Siatoy TCG';
  const loc  = opts.locationName || '';
  const top  = Array.isArray(sum.top) ? sum.top : [];
  const alerts = [];
  if (Number(sum.low_count))       alerts.push(`สินค้าใกล้หมด ${sum.low_count} รายการ`);
  if (Number(sum.void_count))      alerts.push(`บิลยกเลิก ${sum.void_count} ใบ`);
  if (Number(sum.open_card_count)) alerts.push(`เปิดการ์ด ${sum.open_card_count} รายการ`);

  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: B, paddingAll: '18px', spacing: 'xs',
      contents: [
        { type: 'text', text: shop.toUpperCase(), size: 'xs', color: GOLD,
          weight: 'bold', letterSpacing: '2px' },
        { type: 'text', text: 'สรุปยอดขายประจำวัน', size: 'lg', color: '#FFFFFF', weight: 'bold' },
        { type: 'text', text: thaiDate(sum.date) + (loc ? ' · ' + loc : ''),
          size: 'xs', color: '#AAAAAA' },
      ],
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '18px',
      contents: [
        { type: 'box', layout: 'vertical', spacing: 'none', contents: [
          { type: 'text', text: 'ยอดขายรวม', size: 'xs', color: GREY },
          { type: 'box', layout: 'baseline', contents: [
            { type: 'text', text: '฿', size: 'md', color: GOLD, weight: 'bold', flex: 0 },
            { type: 'text', text: ' ' + baht(sum.sales_total), size: 'xxl',
              color: '#111111', weight: 'bold' },
          ] },
          { type: 'text', text: `${sum.bill_count} บิล · เฉลี่ยใบละ ฿ ` +
              baht(sum.bill_count ? Math.round(sum.sales_total / sum.bill_count) : 0),
            size: 'xs', color: GREY },
        ] },

        { type: 'separator', margin: 'md' },

        { type: 'box', layout: 'vertical', spacing: 'sm', margin: 'md', contents: [
          row('💵 เงินสด',   '฿ ' + baht(sum.cash)),
          row('📱 เงินโอน',  '฿ ' + baht(sum.transfer)),
          row('💳 บัตร',     '฿ ' + baht(sum.credit)),
          row('🏷️ ส่วนลดที่ให้ไป', '฿ ' + baht(sum.discount_total), RED),
        ] },

        ...(top.length ? [
          { type: 'separator', margin: 'md' },
          { type: 'text', text: 'ขายดีวันนี้', size: 'xs', color: GREY, margin: 'md' },
          { type: 'box', layout: 'vertical', spacing: 'sm', contents: top.map((t, i) => ({
            type: 'box', layout: 'horizontal', spacing: 'sm', contents: [
              { type: 'text', text: String(i + 1), size: 'sm', color: GOLD, weight: 'bold', flex: 0 },
              { type: 'text', text: t.name, size: 'sm', color: '#333333', flex: 6, wrap: false },
              { type: 'text', text: '×' + t.qty, size: 'sm', color: GREY, align: 'end', flex: 2 },
            ],
          })) },
        ] : []),

        { type: 'separator', margin: 'md' },
        { type: 'box', layout: 'vertical', spacing: 'sm', margin: 'md', contents: [
          row('📦 สต๊อกคงเหลือ', baht(sum.stock_qty) + ' ชิ้น'),
          ...(alerts.length ? [{
            type: 'box', layout: 'vertical', spacing: 'xs', margin: 'sm',
            backgroundColor: '#FDF3E7', cornerRadius: '6px', paddingAll: '10px',
            contents: alerts.map(a => ({
              type: 'text', text: '⚠️  ' + a, size: 'xs', color: '#8A5A00', wrap: true })),
          }] : [{ type: 'text', text: '✅ ไม่มีรายการที่ต้องตรวจสอบ', size: 'xs', color: GREEN }]),
        ] },
      ],
    },
    footer: {
      type: 'box', layout: 'vertical', paddingAll: '12px',
      contents: [{ type: 'text', text: 'ส่งอัตโนมัติจากระบบขายหน้าร้าน',
        size: 'xxs', color: '#BBBBBB', align: 'center' }],
    },
  };
}

/* ข้อความธรรมดา ใช้กับ Telegram และใช้เป็นข้อความสำรองของ LINE
 * (LINE ต้องมี altText เสมอ ไว้แสดงในหน้ารายการแชตและบนนาฬิกา) */
export function buildTextSummary(sum, opts = {}) {
  const shop = opts.shopName || 'Siatoy TCG';
  const top = Array.isArray(sum.top) ? sum.top : [];
  const lines = [
    `🃏 สรุปยอดขาย ${shop}`,
    `📅 ${thaiDate(sum.date)}${opts.locationName ? ' · ' + opts.locationName : ''}`,
    '',
    `💰 ยอดขายรวม  ${baht(sum.sales_total)} ฿`,
    `🧾 จำนวนบิล  ${sum.bill_count} บิล`,
    `🏷️ ส่วนลดรวม  ${baht(sum.discount_total)} ฿`,
    '',
    `💵 เงินสด  ${baht(sum.cash)} ฿`,
    `📱 เงินโอน  ${baht(sum.transfer)} ฿`,
    `💳 บัตรเครดิต  ${baht(sum.credit)} ฿`,
  ];
  if (top.length) {
    lines.push('', '🔥 ขายดีวันนี้');
    top.forEach((t, i) => lines.push(`${i + 1}. ${t.name} ×${t.qty}`));
  }
  lines.push('',
    `📦 สต๊อกคงเหลือ ${baht(sum.stock_qty)} ชิ้น`,
    `⚠️ ใกล้หมด ${sum.low_count} รายการ`,
    `🚫 บิลยกเลิก ${sum.void_count} ใบ`,
    `👑 เปิดการ์ด ${sum.open_card_count} รายการ`);
  return lines.join('\n');
}

export const altText = sum =>
  `สรุปยอดขาย ${thaiDate(sum.date)} · ${baht(sum.sales_total)} บาท · ${sum.bill_count} บิล`;
