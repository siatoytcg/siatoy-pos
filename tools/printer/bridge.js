'use strict';
const allowed=new Set(['https://siatoy-pos.vercel.app','https://nalatikana.github.io','http://localhost:8000','http://127.0.0.1:8000']);
const $=id=>document.getElementById(id);let session,job,senderOrigin,locked=false;
function showJob(incoming){
 if(locked||!incoming||typeof incoming.id!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(incoming.id)||!Array.isArray(incoming.codes)||incoming.codes.length<1||incoming.codes.length>500||incoming.codes.some(c=>typeof c!=='string'||!/^[\x20-\x7e]{1,24}$/.test(c)))throw Error('ข้อมูลคิวไม่ถูกต้อง');
 if(!Array.isArray(incoming.names)||incoming.names.length!==incoming.codes.length)throw Error('คิวไม่มีชื่อสินค้า กรุณารีเฟรช POS แล้วสร้างคิวใหม่');
 if(incoming.names.some(n=>typeof n!=='string'||n.length>200||/[\x00-\x1f\x7f]/.test(n)))throw Error('ชื่อสินค้าไม่ถูกต้อง');
 job=incoming;$('queue').replaceChildren();
 for(let i=0;i<job.codes.length;i+=3){const row=document.createElement('div');row.className='row';for(let j=0;j<3;j++){const item=document.createElement('div');item.className='label';item.textContent=job.codes[i+j]===undefined?'เว้นว่าง':((job.names?.[i+j]||'')+' — '+job.codes[i+j]);row.appendChild(item);}$('queue').appendChild(row);}
 $('status').textContent=`${job.codes.length} ดวง · ${Math.ceil(job.codes.length/3)} แถว พร้อมพิมพ์`;$('print').disabled=!session;
}
if(location.hash.startsWith('#job=')){try{showJob(JSON.parse(decodeURIComponent(location.hash.slice(5))));history.replaceState(null,'','/');}catch(e){$('status').textContent=e.message;}}
const notify=(type,extra={})=>{if(window.opener&&senderOrigin)window.opener.postMessage({type,id:job?.id,...extra},senderOrigin);};
window.addEventListener('message',event=>{
 if(event.source!==window.opener||!allowed.has(event.origin))return;
 if(event.data?.type==='siatoy:printer-ping'){event.source.postMessage({type:'siatoy:printer-ready'},event.origin);return;}
 if(event.data?.type!=='siatoy:printer-job'||locked)return;
 try{showJob(event.data.job);}catch{return;}senderOrigin=event.origin;
 notify('siatoy:printer-received');
});
fetch('/session').then(r=>{if(!r.ok)throw Error('อ่านโปรไฟล์ไม่สำเร็จ');return r.json();}).then(data=>{session=data;const p=data.profile;$('profile').textContent=`${p.printerName} · ${p.labelWidthMm} × ${p.labelHeightMm} มม. · ความกว้าง ${p.barcodeWidthScale*100}% · ขวา ${p.contentOffsetXmm} / ลง ${p.contentOffsetYmm} มม.`;$('print').disabled=!job;}).catch(e=>{$('status').textContent=e.message;});
$('print').onclick=async()=>{
 if(!session||!job||locked)return;locked=true;$('print').disabled=true;$('status').textContent='กำลังส่งพิมพ์…';
 try{const r=await fetch('/print',{method:'POST',headers:{'Content-Type':'application/json','X-Print-Token':session.token},body:JSON.stringify(job)});const result=await r.json();if(!r.ok)throw Error(result.error);$('status').textContent=`ส่งเข้าคิวแล้ว ${result.labels} ดวง / ${result.rows} แถว`;notify('siatoy:printer-submitted');}
 catch(e){$('status').textContent=e.message+' — ตรวจคิวเครื่องพิมพ์ก่อนสร้างงานใหม่';notify('siatoy:printer-error',{error:e.message});}
};
