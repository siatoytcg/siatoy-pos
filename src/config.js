/* ค่าตั้งต้นของระบบ
 * anon key ของ Supabase ถูกออกแบบมาให้เปิดเผยได้ ทุกเบราว์เซอร์ที่เปิดแอปจะเห็นอยู่แล้ว
 * ความปลอดภัยอยู่ที่การล็อกอินและกฎสิทธิ์ระดับแถว (RLS) ในฐานข้อมูล ไม่ใช่ที่การซ่อนคีย์
 * ห้ามเอา service_role key มาใส่ไฟล์นี้เด็ดขาด อันนั้นข้ามสิทธิ์ทั้งหมด
 */
export const CONFIG = {
  supabaseUrl:     'https://dghsrqtsgeodwjtmrwul.supabase.co',
  supabaseAnonKey: 'sb_publishable_mCNt270IDAaWFj7-EBiAtA_u5sXG3VN',
  shopName:  'Siatoy TCG',
  creditFee: 3,             // % ค่าธรรมเนียมบัตร ย้ายไปตาราง settings เมื่อต่อฐานข้อมูลแล้ว
  pointRate: 100,           // ทุกกี่บาทได้ 1 แต้ม
  printerDpi: 203,          // ความละเอียดเครื่องพิมพ์สติกเกอร์ ES-9960 (203 หรือ 300)
};

/* โหมดเดโม : เปิดด้วย ?demo=1 ท้าย URL
 * ใช้ส่งให้ลูกค้าหรือคนนอกลองเล่นโดยไม่แตะฐานข้อมูลจริง
 *   - ไม่ต่อเซิร์ฟเวอร์ ไม่ต้องล็อกอิน สลับสิทธิ์ดูได้ทั้งสามระดับ
 *   - ข้อมูลอยู่คนละที่เก็บกับของจริง ลบทิ้งได้โดยไม่กระทบร้าน
 */
export const DEMO = (() => {
  try { return new URLSearchParams(location.search).has('demo'); } catch (e) { return false; }
})();

export const hasBackend = () => !DEMO && Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
