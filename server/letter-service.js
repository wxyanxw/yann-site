import { createHmac, createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getStore, sessionSecret } from './letter-store.js';

export const MAX_IMAGE_BYTES = 1536*1024;
const UUID=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const COOKIE='yann_letter_device';
class RequestError extends Error { constructor(status,message,code=''){super(message);this.status=status;this.code=code;} }
const sign=value=>createHmac('sha256',sessionSecret()).update(value).digest('base64url');
const imageURL=id=>`/api/letter?action=image&id=${id}`;
function device(req) {
  const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  if(!token)return null;
  const [id,signature,...extra]=token.split('.');
  if(!UUID.test(id) || !signature || extra.length)return null;
  const expected=Buffer.from(sign(id)),actual=Buffer.from(signature);
  return actual.length===expected.length && timingSafeEqual(actual,expected) ? id : null;
}
function requiredDevice(req) { const id=device(req);if(!id)throw new RequestError(401,'先输入我们的密码，再留言或上传照片吧。','verification_required');return id; }
function configuredPassword() {
  const config=JSON.parse(readFileSync(process.env.LETTER_CONFIG_FILE||new URL('./letter-config.json',import.meta.url),'utf8'));
  if(typeof config.password!=='string'||!config.password.length||config.password.length>128)throw new Error('letter-config.json 需要设置 1 到 128 个字符的 password 字符串。');
  return config.password;
}
async function body(req,limit=24000) {
  if(Number(req.headers['content-length'])>limit)throw new RequestError(413,'内容太大，请减少图片或文字。');
  if(req.body!==undefined) {
    const value=Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body==='string'?req.body:JSON.stringify(req.body));
    if(value.length>limit)throw new RequestError(413,'内容太大。');return value;
  }
  const chunks=[];let size=0;
  for await(const chunk of req.iterator({destroyOnReturn:false})){size+=chunk.length;if(size>limit){req.resume();throw new RequestError(413,'图片太大，请压缩后重试。');}chunks.push(chunk);}
  return Buffer.concat(chunks);
}
async function jsonBody(req) {
  if(!req.headers['content-type']?.startsWith('application/json'))throw new RequestError(415,'需要 JSON 请求。');
  try{return JSON.parse((await body(req)).toString());}catch(error){if(error instanceof RequestError)throw error;throw new RequestError(400,'请求格式不正确。');}
}
function cursor(value) {
  if(!value)return null;
  try{const parsed=JSON.parse(Buffer.from(value,'base64url').toString());if(!UUID.test(parsed.id)||typeof parsed.date!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(parsed.date)||!Number.isFinite(Date.parse(parsed.date)))throw new Error();return {id:parsed.id,date:parsed.date};}
  catch{throw new RequestError(400,'分页参数无效。');}
}
function resultPage(rows,limit,items) {
  const more=rows.length>limit,tail=rows[limit-1];
  return {items:items.slice(0,limit),nextCursor:more?Buffer.from(JSON.stringify({id:tail.id,date:tail.created_at})).toString('base64url'):null};
}
function photo(row) { return {id:row.id,url:imageURL(row.id),name:row.data.name,caption:row.text,createdAt:row.created_at}; }
function checkJPEG(data) {
  if(data.length<12||data[0]!==255||data[1]!==216||data.at(-2)!==255||data.at(-1)!==217)throw new RequestError(415,'图片格式不正确。');
  let offset=2,frame=false;
  while(offset<data.length-2) {
    if(data[offset++]!==255)break;
    while(data[offset]===255)offset++;
    const marker=data[offset++];if(marker===218)break;
    if(offset+2>data.length)break;
    const length=data.readUInt16BE(offset);if(length<2||offset+length>data.length)break;
    if(marker>=192&&marker<=207&&![196,200,204].includes(marker)) {
      if(length<8)break;const height=data.readUInt16BE(offset+3),width=data.readUInt16BE(offset+5);
      if(!width||!height||width>4096||height>4096||width*height>8000000)throw new RequestError(415,'照片尺寸太大，请压缩后再上传。');frame=true;
    }
    offset+=length;
  }
  if(!frame)throw new RequestError(415,'没有读取到有效的 JPEG 照片。');
}
function send(res,status,data) { res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data)); }

export async function handleLetter(req,res) {
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  try {
    const url=new URL(req.url,'http://localhost');const action=url.searchParams.get('action')||'session';
    if(req.method==='POST') {
      const origin=req.headers.origin;
      const host=process.env.VERCEL ? req.headers['x-forwarded-host'] || req.headers.host : req.headers.host;
      let source;try{source=origin&&new URL(origin);}catch{}
      if(!source || source.host!==host || !['http:','https:'].includes(source.protocol))throw new RequestError(403,'请从本站页面提交。');
    }
    const store=await getStore();
    if(req.method==='GET' && action==='session')return send(res,200,{verified:!!device(req),name:device(req)?'谭笑':null});
    if(req.method==='POST' && action==='verify') {
      const ip=process.env.VERCEL ? String(req.headers['x-forwarded-for']||'').split(',')[0] : req.socket?.remoteAddress||'local';
      if(!await store.rateLimit('password:'+sign(ip),8,600)){res.setHeader('Retry-After','600');throw new RequestError(429,'试得太多啦，十分钟后再来。');}
      const data=await jsonBody(req);
      if(typeof data.password!=='string'||!data.password.length||data.password.length>128)throw new RequestError(400,'请输入密码。');
      const digest=value=>createHash('sha256').update(value).digest();
      if(!timingSafeEqual(digest(data.password),digest(configuredPassword())))throw new RequestError(422,'密码不对，再试一次吧。','password_incorrect');
      const id=randomUUID(),secure=req.socket?.encrypted || (process.env.VERCEL && req.headers['x-forwarded-proto']==='https');
      res.setHeader('Set-Cookie',`${COOKIE}=${id}.${sign(id)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=315360000${secure?'; Secure':''}`);
      return send(res,200,{verified:true,name:'谭笑'});
    }
    if(req.method==='GET' && action==='comments') {
      const limit=20,rows=await store.list('comment',cursor(url.searchParams.get('cursor')),limit+1);
      const items=await Promise.all(rows.map(async row=>({id:row.id,author:'谭笑',text:row.text,createdAt:row.created_at,images:(await Promise.all((row.data.imageIds||[]).map(id=>store.get(id)))).filter(Boolean).map(photo)})));
      return send(res,200,resultPage(rows,limit,items));
    }
    if(req.method==='GET' && action==='memories') {
      const limit=40,rows=await store.list('memory',cursor(url.searchParams.get('cursor')),limit+1);
      return send(res,200,resultPage(rows,limit,rows.map(photo)));
    }
    if(req.method==='POST' && action==='comment') {
      const owner=requiredDevice(req),data=await jsonBody(req);
      const text=typeof data.text==='string'?data.text.trim():'';
      const images=data.imageIds||[];
      if(text.length>2000 || !Array.isArray(images)||images.length>6||new Set(images).size!==images.length||!images.every(id=>typeof id==='string'&&UUID.test(id))||(!text&&!images.length))throw new RequestError(400,'留言最多 2000 字、6 张图片，不能完全空白。');
      if(!await store.rateLimit('comment:'+owner,20,600))throw new RequestError(429,'留言太快啦，稍后再试。');
      let row;try{row=await store.createComment(owner,text,images);}catch(error){if(error.message.includes('图片无效'))throw new RequestError(400,error.message);throw error;}
      return send(res,201,{id:row.id});
    }
    if(req.method==='POST' && action==='upload') {
      const owner=requiredDevice(req),kind=url.searchParams.get('kind');
      if(!['memory','attachment'].includes(kind))throw new RequestError(400,'图片用途无效。');
      if(req.headers['content-type']!=='image/jpeg')throw new RequestError(415,'请上传处理后的 JPEG 图片。');
      const data=await body(req,MAX_IMAGE_BYTES);
      checkJPEG(data);
      const name=(url.searchParams.get('name')||'照片').slice(0,120),caption=(url.searchParams.get('caption')||'').trim();
      if(caption.length>200)throw new RequestError(400,'照片说明最多 200 字。');
      if(!await store.rateLimit('upload:'+owner,60,3600))throw new RequestError(429,'上传太多啦，休息一会儿再来。');
      const key=randomUUID()+'.jpg';await store.putObject(key,data);
      try {
        const row=await store.insert({kind,owner,text:kind==='memory'?caption:'',data:{key,name,bytes:data.length,mime:'image/jpeg',attached:false}});
        return send(res,201,photo(row));
      }catch(error){await store.deleteObject(key);throw error;}
    }
    if(req.method==='GET' && action==='image') {
      const id=url.searchParams.get('id');if(!UUID.test(id||''))throw new RequestError(404,'没有这张照片。');
      const row=await store.get(id);
      if(!row||!['memory','attachment'].includes(row.kind)||(row.kind==='attachment'&&!row.data.attached&&row.owner!==device(req)))throw new RequestError(404,'没有这张照片。');
      const data=await store.getObject(row.data.key);
      res.statusCode=200;res.setHeader('Content-Type','image/jpeg');res.setHeader('Content-Length',data.length);res.setHeader('Cache-Control',row.kind==='memory'||row.data.attached?'public, max-age=86400, immutable':'private, no-store');return res.end(data);
    }
    throw new RequestError(404,'没有这个接口。');
  } catch(error) {
    if(!(error instanceof RequestError))console.error('Letter service:',error.message);
    send(res,error.status||503,{error:error.status?error.message:'留言和相册服务暂时不可用，请稍后再试。',code:error.code||'service_unavailable'});
  }
}
