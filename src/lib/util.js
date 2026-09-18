export const $  = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
export const money = n => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
export const uuid  = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    }));
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
export const yymmdd = (d = new Date()) =>
  String(d.getFullYear() % 100).padStart(2,'0') +
  String(d.getMonth() + 1).padStart(2,'0') +
  String(d.getDate()).padStart(2,'0');

export function downloadExcel(filename, sheets) {
  const cell = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = sheets.map(s => `<h2>${cell(s.name)}</h2><table border="1"><thead><tr>${s.headers.map(h => `<th>${cell(h)}</th>`).join('')}</tr></thead><tbody>${s.rows.map(r => `<tr>${r.map(v => `<td>${cell(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`).join('<br>');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([`<html><meta charset="utf-8"><body>${html}</body></html>`], { type: 'application/vnd.ms-excel' })); a.download = filename.endsWith('.xls') ? filename : `${filename}.xls`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function toast(msg, kind) {
  const box = $('#toasts'); if (!box) return;
  const d = document.createElement('div');
  d.className = 'toast ' + (kind || '');
  d.innerHTML = msg;
  box.appendChild(d);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => {
    d.style.transition = '.3s'; d.style.opacity = '0'; d.style.transform = 'translateX(30px)';
    setTimeout(() => d.remove(), 300);
  }, 3200);
}

export function openModal(html, wide) {
  $('#modalBox').className = 'modal' + (wide ? ' wide' : '');
  $('#modalBox').innerHTML = html;
  $('#modalBg').classList.add('on');
}
export function closeModal() { $('#modalBg').classList.remove('on'); }

/* วาดหน้าใหม่ทั้งหน้าอย่างปลอดภัย
 * ถ้าเขียนทับ innerHTML ตอนที่มีช่องกรอกโฟกัสอยู่ เบราว์เซอร์จะโยน error
 * เพราะ blur ของช่องนั้นไปแก้ DOM ระหว่างที่กำลังถูกแทนที่พอดี */
export async function redrawPage(el, page) {
  if (document.activeElement && el.contains(document.activeElement)) document.activeElement.blur();
  const tmp = document.createElement('div');
  tmp.innerHTML = await page.render();
  el.replaceChildren(...tmp.childNodes);
  if (page.mount) page.mount(el);
}
