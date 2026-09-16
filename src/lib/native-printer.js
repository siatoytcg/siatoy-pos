import { encode128, padEven } from './code128.js';

const ORIGIN='http://127.0.0.1:18767';
export function buildPrintJob(queue,pad=false){
 const codes=[],names=[];
 for(const item of queue){
  if(!Number.isInteger(item.qty)||item.qty<1||item.qty>500)throw Error('จำนวนดวงต้องเป็นจำนวนเต็ม 1–500');
  const code=pad?padEven(item.code):String(item.code);
  if(!/^[\x20-\x7e]{1,24}$/.test(code))throw Error('รหัสต้องเป็น ASCII 1–24 ตัวอักษร');
  const m=25.4/203*2;
  if(encode128(code).modules*m*0.9+20*m>30)throw Error(`รหัส ${code} ยาวเกินฉลาก 32 มม. กรุณาใช้รหัสสั้นลง`);
  if(codes.length+item.qty>500)throw Error('พิมพ์ได้ครั้งละไม่เกิน 500 ดวง');
  const name=String(item.name??'').trim();
  if(name.length>200||/[\x00-\x1f\x7f]/.test(name))throw Error('ชื่อสินค้าต้องไม่เกิน 200 ตัวอักษร และไม่มีอักขระควบคุม');
  for(let i=0;i<item.qty;i++){codes.push(code);names.push(name);}
 }
 if(!codes.length)throw Error('ยังไม่มีรายการในคิว');
 return {id:crypto.randomUUID(),codes,names};
}

export function openNativePrinter(job,onStatus){
 // Fragment also works in browsers that open the helper externally without opener.
 // It is never sent to the HTTP server; the helper requires a deliberate Print click.
 const popup=window.open(ORIGIN+'/#job='+encodeURIComponent(JSON.stringify(job)), '_blank','popup,width=960,height=760');
 if(!popup){onStatus('หากตัวช่วยไม่เปิด กรุณาอนุญาตป๊อปอัปและเปิด Start-Printer.cmd แล้วลองใหม่','err');return;}
 let received=false;
 const cleanup=()=>{clearInterval(ping);clearTimeout(timeout);window.removeEventListener('message',receive);};
 const receive=event=>{
  if(event.origin!==ORIGIN||event.source!==popup)return;
  const d=event.data;
  if(d?.type==='siatoy:printer-ready'&&!received)popup.postMessage({type:'siatoy:printer-job',job},ORIGIN);
  if(d?.id!==job.id)return;
  if(d.type==='siatoy:printer-received'){received=true;clearTimeout(timeout);onStatus('รับคิวแล้ว ตรวจรายการแล้วกดพิมพ์ในหน้าต่างเครื่องพิมพ์','ok');}
  if(d.type==='siatoy:printer-submitted'){onStatus(`ส่ง ${job.codes.length} ดวงเข้าคิวเครื่องพิมพ์แล้ว`,'ok');cleanup();}
  if(d.type==='siatoy:printer-error'){onStatus('ส่งพิมพ์ไม่สำเร็จ ตรวจคิวเครื่องพิมพ์ก่อนกดใหม่','err');cleanup();}
 };
 window.addEventListener('message',receive);
 const ping=setInterval(()=>{if(popup.closed){cleanup();return;}if(!received)popup.postMessage({type:'siatoy:printer-ping'},ORIGIN);},500);
 const timeout=setTimeout(()=>{onStatus('เชื่อมตัวช่วยพิมพ์ไม่ได้ เปิด tools/printer/Start-Printer.cmd บนเครื่อง Windows แล้วลองใหม่','err');cleanup();},20000);
}
