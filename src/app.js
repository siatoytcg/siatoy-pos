/* จุดเริ่มของแอป : ธีม สิทธิ์ นาฬิกา เมนู ตัวจัดเส้นทาง และแถบสถานะการซิงก์ */
import { CONFIG, hasBackend, DEMO } from './config.js';
import { $, $$, toast } from './lib/util.js';
import { S } from './lib/state.js';
import { ensureSeeded, currentLocation, pendingCount, loadSettings } from './lib/store.js';
import { posPage } from './pages/pos.js';
import { billsPage } from './pages/bills.js';
import { labelsPage } from './pages/labels.js';
import { settingsPage } from './pages/settings.js';
import { scanPage } from './pages/scan.js';
import { stockPage } from './pages/stock.js';
import { vendorsPage } from './pages/vendors.js';
import { eventPage } from './pages/event.js';
import { membersPage } from './pages/members.js';
import { reportPage } from './pages/report.js';
import { reconPage } from './pages/recon.js';
import { notifyPage } from './pages/notify.js';
import { loginPage } from './pages/login.js';
import { importPage } from './pages/import.js';
import { usersPage } from './pages/users.js';
import { openHelp, maybeShowFirstTime } from './pages/help.js';
import { lockNow, startAutoLock, hasPin } from './lib/lock.js';
import { initClient, currentProfile, currentUser, signOut, pull, push,
         startAutoSync, switchToLiveData, logEvent } from './lib/sync.js';

const ROUTES = {
  pos: posPage, bills: billsPage, labels: labelsPage, settings: settingsPage,
  scan: scanPage, stock: stockPage, vendors: vendorsPage, import: importPage,
  event: eventPage, recon: reconPage, members: membersPage,
  report: reportPage, notify: notifyPage, users: usersPage,
};

/* ---------------------------------------------------------------- ธีม ---- */
function applyTheme(t) {
  S.theme = t;
  document.documentElement.setAttribute('data-theme', t);
  $('#themeBtn').textContent = t === 'dark' ? '☀️' : '🌙';
  try { localStorage.setItem('siatoy-theme', t); } catch (e) {}
}
function initTheme() {
  let t = null;
  try { t = localStorage.getItem('siatoy-theme'); } catch (e) {}
  if (!t) t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  applyTheme(t);
}

/* -------------------------------------------------------------- สิทธิ์ ---- */
function setRole(r, rerender = true) {
  S.role = r;
  document.body.className = 'role-' + r;
  $$('.role-switch button').forEach(b => b.classList.toggle('on', b.dataset.role === r));
  try { localStorage.setItem('siatoy-role', r); } catch (e) {}
  if (rerender) render();
}

/* ------------------------------------------------------------ เส้นทาง ---- */
let disposePage = null;
let renderSeq = 0;

async function render() {
  const seq = ++renderSeq;
  if (disposePage) { disposePage(); disposePage = null; }
  const key = (location.hash.replace(/^#\/?/, '') || 'pos').split('?')[0];
  S.page = ROUTES[key] ? key : 'pos';
  $$('.nav-item').forEach(n => n.classList.toggle('on', n.dataset.page === S.page));
  $('#sidebar').classList.remove('open');

  const page = ROUTES[S.page];
  const el = document.createElement('div');
  el.className = 'page on';
  el.innerHTML = await page.render();
  if (seq !== renderSeq) return;        // มีการเปลี่ยนหน้าซ้อนเข้ามาแล้ว ทิ้งผลรอบนี้
  $('#pages').replaceChildren(el);
  if (page.mount) disposePage = page.mount(el) || null;
  $('#main').scrollTop = 0;
  const first = el.querySelector('input[autofocus]');
  if (first && window.innerWidth > 980) first.focus();
}

/* ------------------------------------------------------ แถบสถานะการส่ง ---- */
async function drawSync() {
  const n = await pendingCount();
  const chip = $('#syncChip');
  if (hasBackend() && !currentUser()) {
    chip.innerHTML = '🔒 <b>ยังไม่ได้ล็อกอิน</b>';
    chip.style.color = 'var(--warn)';
  } else if (!navigator.onLine) {
    chip.innerHTML = '📴 <b>ออฟไลน์' + (n ? ' · ค้าง ' + n : '') + '</b>';
    chip.style.color = 'var(--warn)';
  } else if (!hasBackend()) {
    chip.innerHTML = (DEMO ? '🧪 <b>เดโม · ข้อมูลตัวอย่าง' : '🧪 <b>โหมดทดลอง') + (n ? ' · ค้าง ' + n : '') + '</b>';
    chip.style.color = 'var(--muted)';
  } else if (n) {
    chip.innerHTML = '⏳ <b>รอส่ง ' + n + '</b>';
    chip.style.color = 'var(--warn)';
  } else {
    chip.innerHTML = '✅ <b>ส่งครบแล้ว</b>';
    chip.style.color = 'var(--green)';
  }
}

function tick() {
  $('#clock').innerHTML = '🕐 <b>' + new Date().toTimeString().slice(0, 5) + '</b>';
}

/* --------------------------------------------------------------- เริ่ม ---- */
async function boot() {
  initTheme();
  try { setRole(localStorage.getItem('siatoy-role') || 'owner', false); } catch (e) { setRole('owner', false); }

  $('#themeBtn').onclick = () => {
    applyTheme(S.theme === 'dark' ? 'light' : 'dark');
    toast(S.theme === 'dark' ? '🌙 โหมดกลางคืน · ธีมดำ-ทอง' : '☀️ โหมดกลางวัน · ธีมขาว-เขียว');
  };
  $('#hambBtn').onclick = () => $('#sidebar').classList.toggle('open');
  $('#helpBtn').onclick = () => openHelp();
  $('#lockBtn').onclick = async () => {
    if (await hasPin()) return lockNow('กดล็อกเอง');
    toast('ยังไม่ได้ตั้ง PIN · ตั้งได้ที่หน้าตั้งค่าระบบ', 'err');
    location.hash = '#/settings';
  };
  $('#roleSwitch').onclick = e => {
    const b = e.target.closest('[data-role]'); if (b) setRole(b.dataset.role);
  };
  $('#logoutBtn').onclick = async () => {
    const btn = $('#logoutBtn');
    btn.disabled = true;
    btn.textContent = 'กำลังออก…';
    try { await logEvent('logout', { from: 'header' }); } catch (e) {}
    try { await signOut(); } catch (e) { toast('ออกจากระบบในเครื่องแล้ว · ซิงก์เซิร์ฟเวอร์ไม่สำเร็จ', 'err'); }
    location.hash = '#/login';
    location.reload();
  };
  $('#modalBg').onclick = e => { if (e.target.id === 'modalBg') $('#modalBg').classList.remove('on'); };

  // ผูกกับฐานข้อมูลกลางถ้าตั้งค่าไว้แล้ว
  if (hasBackend()) {
    try { await initClient(); } catch (e) { toast('ต่อฐานข้อมูลไม่ได้ · ' + e.message, 'err'); }
  }
  const needLogin = hasBackend() && !currentUser();

  await ensureSeeded();
  await loadSettings(CONFIG);

  if (hasBackend() && currentUser()) {
    $('#logoutBtn').style.display = '';
    const p = currentProfile();
    if (p) {
      setRole({ staff: 'admin', supervisor: 'sup', owner: 'owner' }[p.role] || 'admin', false);
      $('#roleSwitch').style.display = 'none';           // สิทธิ์มาจากบัญชีจริงแล้ว
    }
    await logEvent('login');
    if (await switchToLiveData()) toast('เปลี่ยนมาใช้ข้อมูลจริงจากเซิร์ฟเวอร์แล้ว');
    const r = await pull();
    if (!r.ok) toast('ดึงข้อมูลจากเซิร์ฟเวอร์ไม่สำเร็จ · ' + r.reason, 'err');
    startAutoSync(res => { toast('ส่งขึ้นเซิร์ฟเวอร์แล้ว ' + res.sent + ' รายการ', 'ok'); drawSync(); });
  }
  const loc = await currentLocation();
  $('#locChip').innerHTML = '<span class="dot"></span> จุดขาย <b>' + loc.name + '</b>';

  if (needLogin) {
    $('#sidebar').style.display = 'none';
    $('#roleSwitch').style.display = 'none';
    $('#logoutBtn').style.display = 'none';
    const el = document.createElement('div');
    el.className = 'page on';
    el.innerHTML = await loginPage.render();
    $('#pages').replaceChildren(el);
    loginPage.mount(el);
    tick(); setInterval(tick, 1000);
    await drawSync();
    return;
  }

  addEventListener('hashchange', render);
  addEventListener('online',  drawSync);
  addEventListener('offline', drawSync);
  document.addEventListener('siatoy:changed', drawSync);
  setInterval(tick, 1000); tick();
  setInterval(drawSync, 15000);

  await render();
  await drawSync();
  await startAutoLock();
  await maybeShowFirstTime();

  if (!hasBackend()) {
    toast(DEMO
      ? 'เดโมสำหรับทดลองใช้ · ข้อมูลเป็นของตัวอย่าง<br><span class="mini">ยิงบาร์โค้ดเล่นได้เต็มที่ ไม่กระทบข้อมูลจริงของร้าน</span>'
      : 'โหมดทดลอง · ข้อมูลเก็บในเครื่องนี้เท่านั้น<br><span class="mini">ยังไม่ได้ต่อฐานข้อมูลกลาง</span>');
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

boot().catch(err => {
  console.error(err);
  document.getElementById('pages').innerHTML =
    '<div class="card" style="max-width:600px"><div class="card-title"><span class="ic">⚠️</span> เปิดแอปไม่สำเร็จ</div>' +
    '<pre style="white-space:pre-wrap;font-size:12px">' + String(err && err.stack || err) + '</pre></div>';
});
