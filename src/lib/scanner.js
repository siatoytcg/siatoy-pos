/* การรับบาร์โค้ดเข้าระบบ มีสองทาง
 *
 * 1. เครื่องยิง USB  — มันทำตัวเป็นคีย์บอร์ด พิมพ์ตัวเลขรัว ๆ แล้วเคาะ Enter
 *    ปัญหาหน้างานจริงคือถ้าเคอร์เซอร์ไม่ได้อยู่ในช่องรับ ยิงแล้วจะไม่มีอะไรเกิดขึ้น
 *    ตรงนี้จึงดักคีย์ทั้งหน้าไว้ด้วย ถ้าตัวอักษรมารัวผิดปกติแล้วจบด้วย Enter
 *    ถือว่าเป็นการยิงบาร์โค้ด ไม่ใช่คนพิมพ์
 *
 * 2. กล้อง iPad / มือถือ — ใช้ตัวอ่านของเบราว์เซอร์ถ้ามี (Chrome/Android)
 *    ถ้าไม่มี (Safari บน iPad) ใช้ไลบรารี ZXing ที่เก็บไว้ในโปรเจกต์ จึงทำงานตอนออฟไลน์ได้
 */

import { openModal, closeModal, toast, esc } from './util.js';

const isTypingTarget = el =>
  el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ||
         el.tagName === 'SELECT' || el.isContentEditable);

/* ---------------------------------------------- เครื่องยิงแบบคีย์บอร์ด ---- */
export function attachWedge(onCode, { minLength = 4, gapMs = 120 } = {}) {
  let buf = '', last = 0;
  const onKey = e => {
    if (document.getElementById('modalBg').classList.contains('on')) return;  // มีหน้าต่างซ้อนอยู่
    if (isTypingTarget(document.activeElement)) return;                       // ช่องกรอกจัดการเอง
    if (e.key === 'Enter') {
      if (buf.length >= minLength) { e.preventDefault(); onCode(buf); }
      buf = ''; return;
    }
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    const now = Date.now();
    if (now - last > gapMs) buf = '';        // เว้นนานเกิน = คนพิมพ์ ไม่ใช่เครื่องยิง
    last = now; buf += e.key;
  };
  document.addEventListener('keydown', onKey, true);
  return () => document.removeEventListener('keydown', onKey, true);
}

/* ให้เคอร์เซอร์กลับไปอยู่ในช่องรับบาร์โค้ดเสมอ หลังกดอย่างอื่นบนหน้าจอ */
export function keepFocus(root, selector) {
  const back = e => {
    if (isTypingTarget(e.target)) return;
    if (document.getElementById('modalBg').classList.contains('on')) return;
    const inp = root.querySelector(selector);
    if (inp && window.innerWidth > 980) setTimeout(() => inp.focus(), 0);
  };
  root.addEventListener('click', back);
}

/* เสียงตอบรับตอนอ่านได้ ให้รู้ว่าติดแล้วโดยไม่ต้องละสายตาจากลูกค้า */
export function beep(ok = true) {
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)();
    const o = a.createOscillator(), g = a.createGain();
    o.connect(g); g.connect(a.destination);
    o.frequency.value = ok ? 1760 : 220;
    g.gain.setValueAtTime(0.06, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.12);
    o.start(); o.stop(a.currentTime + 0.13);
    setTimeout(() => a.close(), 300);
  } catch (e) { /* บางเบราว์เซอร์ห้ามเล่นเสียงก่อนผู้ใช้แตะจอ ปล่อยผ่าน */ }
}

/* -------------------------------------------------------------- กล้อง ---- */
let zxingLoaded = null;
function loadZXing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (zxingLoaded) return zxingLoaded;
  zxingLoaded = new Promise((res, rej) => {
    const s = document.createElement('script');
    // โฟลเดอร์ public ถูกเสิร์ฟจาก root ของเว็บ ไม่ได้มี /public อยู่ใน URL
    s.src = './vendor/zxing.js';
    s.onload = () => res(window.ZXing);
    s.onerror = () => rej(new Error('โหลดตัวอ่านบาร์โค้ดไม่สำเร็จ'));
    document.head.appendChild(s);
  });
  return zxingLoaded;
}

/* คืนฟังก์ชันสำหรับปิดกล้อง  onCode จะถูกเรียกทุกครั้งที่อ่านได้ */
export async function startCamera(videoEl, onCode) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('เบราว์เซอร์นี้เปิดกล้องไม่ได้ · ต้องเปิดหน้าเว็บผ่าน https');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false,
  });
  videoEl.srcObject = stream;
  videoEl.setAttribute('playsinline', '');          // iOS ไม่งั้นจะเด้งเป็นเต็มจอ
  await videoEl.play();

  let stop = false, lastCode = '', lastAt = 0;
  const hit = code => {
    const now = Date.now();
    if (code === lastCode && now - lastAt < 1500) return;   // กันอ่านซ้ำรัว ๆ ใบเดียว
    lastCode = code; lastAt = now;
    beep(true);
    onCode(code);
  };

  const FORMATS = ['code_128', 'ean_13', 'ean_8', 'code_39', 'upc_a', 'upc_e', 'itf', 'qr_code'];
  let loop;

  let detector = null;
  try {
    if ('BarcodeDetector' in window) detector = new window.BarcodeDetector({ formats: FORMATS });
  } catch (e) { detector = null; }

  if (detector) {
    loop = async () => {
      if (stop) return;
      try {
        const found = await detector.detect(videoEl);
        if (found && found.length) hit(found[0].rawValue);
      } catch (e) { /* เฟรมนี้อ่านไม่ได้ ข้ามไป */ }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  } else {
    const ZX = await loadZXing();
    const reader = new ZX.BrowserMultiFormatReader();
    reader.decodeFromVideoElement(videoEl, (result) => {
      if (!stop && result) hit(result.getText());
    });
    loop = () => reader.reset();
  }

  return () => {
    stop = true;
    if (typeof loop === 'function' && !detector) loop();
    stream.getTracks().forEach(t => t.stop());
    videoEl.srcObject = null;
  };
}

/* อ่านบาร์โค้ดจากรูปภาพ ใช้ตอนทดสอบว่าตัวอ่านทำงานจริง */
export async function decodeImage(img) {
  if ('BarcodeDetector' in window) {
    const det = new window.BarcodeDetector({ formats: ['code_128'] });
    const r = await det.detect(img);
    return r && r.length ? r[0].rawValue : null;
  }
  const ZX = await loadZXing();
  try { return new ZX.BrowserMultiFormatReader().decodeFromImageElement(img).then(r => r.getText()); }
  catch (e) { return null; }
}

/* -------------------------------------------------- หน้าต่างสแกนด้วยกล้อง ---- */

export function openCameraModal(onCode) {
  openModal(`
    <div class="modal-head"><h3>📷 สแกนด้วยกล้อง</h3><button class="x" id="camClose">✕</button></div>
    <div class="modal-body">
      <div class="scanner-box" style="position:relative;overflow:hidden">
        <video id="camVideo" muted playsinline
          style="width:100%;height:100%;object-fit:cover;display:block;background:#000"></video>
        <div class="frame"></div><div class="scan-line"></div>
        <div class="hint">เล็งบาร์โค้ดให้อยู่ในกรอบ · ใช้ได้ทั้ง iPad และมือถือ</div>
      </div>
      <div id="camMsg" class="mini" style="text-align:center;margin-top:12px">กำลังเปิดกล้อง…</div>
      <div id="camHits" style="margin-top:10px"></div>
    </div>
    <div class="modal-foot"><button class="btn ghost" id="camDone">ปิดกล้อง</button></div>`, true);

  const box = document.getElementById('modalBox');
  const video = box.querySelector('#camVideo');
  const msg = box.querySelector('#camMsg');
  const hits = box.querySelector('#camHits');
  let stopFn = null;

  const close = () => { if (stopFn) stopFn(); stopFn = null; closeModal(); };
  box.querySelector('#camClose').onclick = close;
  box.querySelector('#camDone').onclick = close;

  startCamera(video, code => {
    hits.insertAdjacentHTML('afterbegin',
      `<div class="ci"><div class="info"><div class="nm">อ่านได้: ${esc(code)}</div>
        <div class="meta">${new Date().toTimeString().slice(0, 8)}</div></div></div>`);
    while (hits.children.length > 4) hits.lastChild.remove();
    onCode(code);
  }).then(fn => {
    stopFn = fn;
    msg.innerHTML = 'กล้องพร้อมแล้ว · ยิงได้ต่อเนื่องหลายชิ้น ไม่ต้องปิดเปิดใหม่' +
      ('BarcodeDetector' in window ? '' : ' · ใช้ตัวอ่านสำรองในเครื่อง');
  }).catch(err => {
    msg.innerHTML = `<span style="color:var(--red)">${esc(err.message || 'เปิดกล้องไม่สำเร็จ')}</span><br>
      ถ้าเบราว์เซอร์ถามขออนุญาตใช้กล้อง ต้องกดอนุญาตก่อน · หน้าเว็บต้องเปิดผ่าน https`;
    toast('เปิดกล้องไม่สำเร็จ', 'err');
  });

  return close;
}
