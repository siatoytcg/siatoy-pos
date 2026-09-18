/* Service worker : ทำให้แอปเปิดได้ตอนไม่มีเน็ต
 * เก็บไฟล์แอปไว้ในเครื่องแบบ cache-first  ส่วนข้อมูลขายอยู่ใน IndexedDB ไม่เกี่ยวกับที่นี่
 * ขึ้นเวอร์ชันทุกครั้งที่แก้ไฟล์ในรายการ ไม่งั้นเครื่องที่เคยเปิดแล้วจะยังใช้ของเก่า
 */
const VERSION = 'siatoy-v15-logout-cache';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './src/styles.css', './src/app.js', './src/config.js',
  './src/lib/util.js', './src/lib/store.js', './src/lib/seed.js',
  './src/lib/state.js', './src/lib/code128.js', './src/lib/scanner.js',
  './src/lib/sync.js', './src/pages/login.js', './src/pages/import.js',
  './src/pages/users.js', './src/pages/help.js', './src/lib/flexview.js',
  './src/lib/lock.js', './src/lib/native-printer.js',
  './supabase/functions/_shared/flex.js',
  './public/vendor/zxing.js',
  './src/pages/pos.js', './src/pages/bills.js',
  './src/pages/labels.js', './src/pages/settings.js', './src/pages/scan.js',
  './src/pages/stock.js', './src/pages/sets.js', './src/pages/vendors.js',
  './src/pages/event.js', './src/pages/members.js', './src/pages/report.js',
  './src/pages/recon.js', './src/pages/notify.js', './src/lib/csv.js',
  './public/vendor/dexie.js', './public/vendor/supabase.js',
  './public/logo.jpg', './public/fonts.css',
  './public/fonts/kanit-thai-300-normal.woff2',
  './public/fonts/kanit-latin-300-normal.woff2',
  './public/fonts/kanit-thai-400-normal.woff2',
  './public/fonts/kanit-latin-400-normal.woff2',
  './public/fonts/kanit-thai-500-normal.woff2',
  './public/fonts/kanit-latin-500-normal.woff2',
  './public/fonts/kanit-thai-600-normal.woff2',
  './public/fonts/kanit-latin-600-normal.woff2',
  './public/fonts/kanit-thai-700-normal.woff2',
  './public/fonts/kanit-latin-700-normal.woff2',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;          // เรียกไปฐานข้อมูล ปล่อยผ่านตามปกติ
  // Keep executable app files fresh on reload; retain cached copies offline.
  if (url.pathname.endsWith('.js')) {
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(res => {
      if (!res.ok) throw new Error('Script unavailable');
      const copy = res.clone();
      e.waitUntil(caches.open(VERSION).then(c => c.put(req, copy)));
      return res;
    }).catch(() => caches.match(req).then(hit => hit || Response.error())));
    return;
  }
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
