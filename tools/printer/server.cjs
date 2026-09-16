const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const root=__dirname;
const readProfile=()=>JSON.parse(fs.readFileSync(path.join(root,'printer-profile.json'),'utf8').replace(/^\uFEFF/,''));
function validateJob(job,p=readProfile()){
 if(!job||typeof job.id!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(job.id))throw Error('Invalid job id');
 if(!Array.isArray(job.codes)||job.codes.length<1||job.codes.length>500)throw Error('พิมพ์ได้ครั้งละ 1–500 ดวง');
 if(!Array.isArray(job.names)||job.names.length!==job.codes.length)throw Error('คิวไม่มีชื่อสินค้า กรุณารีเฟรช POS แล้วสร้างคิวใหม่');
 if(job.names.some(n=>typeof n!=='string'||n.length>200||/[\x00-\x1f\x7f]/.test(n)))throw Error('ชื่อสินค้าไม่ถูกต้อง');
 const m=25.4/p.dpi*p.moduleDots;
 for(const c of job.codes){
  if(typeof c!=='string'||!/^[\x20-\x7e]{1,24}$/.test(c))throw Error('รหัสต้องเป็น ASCII 1–24 ตัวอักษร');
  const count=/^(\d{2}){2,}$/.test(c)?c.length/2:c.length;
  if((35+11*count)*m*p.barcodeWidthScale+20*m>p.labelWidthMm-2)throw Error(`รหัส ${c} ยาวเกินฉลาก 32 มม. กรุณาใช้รหัสสั้นลง`);
 }
 return job;
}
async function runJob(job){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'siatoy-labels-'));
 try{
  const file=path.join(dir,'job.json');fs.writeFileSync(file,JSON.stringify(job));
  await new Promise((resolve,reject)=>{
   const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'print-labels.ps1'),'-JobPath',file],{windowsHide:true});
   let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{output=(output+b).slice(-4000);});
   child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error(output)));
  });
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
function createServer({run=runJob}={}){
 const token=crypto.randomBytes(32).toString('hex'),jobs=new Map();let busy=false;
 return http.createServer(async(req,res)=>{
  const host=`127.0.0.1:${req.socket.localPort}`,origin=`http://${host}`;
  const reply=(status,data,type='application/json')=>{res.writeHead(status,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Opener-Policy':'unsafe-none'});res.end(typeof data==='string'?data:JSON.stringify(data));};
  if(req.headers.host!==host)return reply(403,{error:'Invalid host'});
  if(req.method==='GET'&&req.url==='/session')return reply(200,{token,profile:readProfile()});
  if(req.method==='GET'&&['/','/bridge.js'].includes(req.url))return reply(200,fs.readFileSync(path.join(root,req.url==='/'?'bridge.html':'bridge.js'),'utf8'),req.url==='/'?'text/html':'text/javascript');
  if(req.method!=='POST'||req.url!=='/print')return reply(404,{error:'Not found'});
  if(req.headers.origin!==origin||req.headers['x-print-token']!==token)return reply(403,{error:'Invalid origin or token'});
  if(busy)return reply(409,{error:'กำลังส่งงานอื่น กรุณารอ'});
  busy=true;
  try{
   req.setEncoding('utf8');
   let body='';for await(const chunk of req){body+=chunk;if(body.length>524288)throw Error('Request too large');}
   const job=validateJob(JSON.parse(body));
   if(jobs.has(job.id))return reply(409,{error:'งานนี้เคยถูกส่งแล้ว ตรวจคิวเครื่องพิมพ์ก่อนสร้างงานใหม่'});
   if(jobs.size>=10000)throw Error('กรุณาเปิดตัวช่วยพิมพ์ใหม่หลังตรวจคิวงาน');
   jobs.set(job.id,'started');await run(job);jobs.set(job.id,'submitted');
   reply(200,{labels:job.codes.length,rows:Math.ceil(job.codes.length/3),message:'ส่งเข้าคิวเครื่องพิมพ์แล้ว'});
  }catch(e){reply(400,{error:e.message});}finally{busy=false;}
 });
}
if(require.main===module)createServer().listen(18767,'127.0.0.1',()=>console.log('Siatoy printer: http://127.0.0.1:18767/'));
module.exports={createServer,validateJob};
