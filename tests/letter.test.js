import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';

const folder=await mkdtemp(join(tmpdir(),'yann-letter-api-'));
process.env.LETTER_DATA_DIR=folder;process.env.LETTER_STORE='local';delete process.env.SUPABASE_URL;delete process.env.VERCEL;
const users=[{id:'tanxiao',name:'谭笑',password:'4813',theme:'pink'},{id:'zhuoyan',name:'卓言',password:'2483',theme:'blue'}];
process.env.LETTER_CONFIG_FILE=join(folder,'letter-config.json');await writeFile(process.env.LETTER_CONFIG_FILE,JSON.stringify({users}));
const { handleLetter,MAX_IMAGE_BYTES,MAX_COMMENT_IMAGES }=await import('../server/letter-service.js');
const { getStore }=await import('../server/letter-store.js');
const server=createServer(handleLetter);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const jpeg=Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAMABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDtKKKKzPsD/9k=','base64');
let readCookie;
async function request(action,{method='GET',json,bytes,cookie=method==='GET'?readCookie:undefined,params={},source=origin}={}) {
  const response=await fetch(origin+'/api/letter?'+new URLSearchParams({action,...params}),{method,headers:{...(method==='POST'?{Origin:source}:{}),...(cookie?{Cookie:cookie}:{}),...(json!==undefined?{'Content-Type':'application/json'}:{}),...(bytes?{'Content-Type':'image/jpeg'}:{})},...(json!==undefined?{body:JSON.stringify(json)}:bytes?{body:bytes}:{})});
  const data=response.headers.get('content-type')?.includes('json')?await response.json():Buffer.from(await response.arrayBuffer());
  return {status:response.status,data,cookie:response.headers.get('set-cookie')};
}
try {
  assert.equal((await request('session')).data.verified,false);
  for(const action of ['comments','dialogue','memories','image'])assert.equal((await request(action)).status,401,'入口验证前不能读取上传的内容');
  assert.equal((await request('comment',{method:'POST',json:{text:'绕过验证'}})).status,401);
  assert.equal((await request('upload',{method:'POST',bytes:jpeg,params:{kind:'memory'}})).status,401);
  assert.equal((await request('comment',{method:'POST',json:{text:'伪造设备'},cookie:'yann_letter_device=00000000-0000-0000-0000-000000000001.fake'})).status,401);
  assert.equal((await request('verify',{method:'POST',json:{password:'4813'},source:'https://other.example'})).status,403);
  console.log('✓ 未验证、伪造设备及跨站请求不能写入');

  const wrong=await request('verify',{method:'POST',json:{password:'0000'}});assert.equal(wrong.status,422);
  assert.equal((await request('session')).data.verified,false);
  const accepted=await request('verify',{method:'POST',json:{password:'4813'}});assert.equal(accepted.status,200);assert.match(accepted.cookie,/HttpOnly; SameSite=Strict/);
  const cookie=accepted.cookie.split(';')[0];assert.equal((await request('session',{cookie})).data.verified,true);
  readCookie=cookie;
  assert.deepEqual(accepted.data.profile,{id:'tanxiao',name:'谭笑',theme:'pink'});
  const legacyId=cookie.split('=')[1].split('.')[0],legacySignature=createHmac('sha256',await readFile(join(folder,'session-secret'),'utf8')).update(legacyId).digest('base64url');
  const legacyCookie=`yann_letter_device=${legacyId}.${legacySignature}`;
  assert.equal((await request('session',{cookie:legacyCookie})).data.profile.id,'tanxiao');
  assert.equal((await request('session',{cookie:legacyCookie})).data.verified,false,'旧版留言凭据需要补做一次入口验证');
  assert.equal((await request('comments',{cookie:legacyCookie})).status,401);
  const oldProfilePayload=legacyId+'.zhuoyan',oldProfileSignature=createHmac('sha256',await readFile(join(folder,'session-secret'),'utf8')).update(oldProfilePayload).digest('base64url');
  const oldProfileCookie=`yann_letter_device=${oldProfilePayload}.${oldProfileSignature}`;
  assert.equal((await request('session',{cookie:oldProfileCookie})).data.profile.id,'zhuoyan');
  assert.equal((await request('session',{cookie:oldProfileCookie})).data.verified,false);
  assert.equal((await request('session',{cookie:cookie.replace('.tanxiao.','.zhuoyan.')})).data.verified,false);
  await writeFile(process.env.LETTER_CONFIG_FILE,JSON.stringify({users:users.map(user=>user.id==='tanxiao'?{...user,password:'2468'}:user)}));
  assert.equal((await request('verify',{method:'POST',json:{password:'4813'}})).status,422);
  assert.equal((await request('verify',{method:'POST',json:{password:'2468'}})).status,200);
  assert.equal((await request('session',{cookie})).data.verified,true);
  await writeFile(process.env.LETTER_CONFIG_FILE,JSON.stringify({users}));
  console.log('✓ 双身份配置；旧设备凭据兼容；身份签名不能伪造；修改密码后已验证设备仍被记住');

  assert.equal((await request('upload',{method:'POST',cookie,bytes:Buffer.from([255,216,255,217]),params:{kind:'memory'}})).status,415);
  assert.equal((await request('upload',{method:'POST',cookie,bytes:Buffer.alloc(MAX_IMAGE_BYTES+1),params:{kind:'memory'}})).status,413);
  const pending=await request('upload',{method:'POST',cookie,bytes:jpeg,params:{kind:'attachment',name:'测试留言.jpg'}});assert.equal(pending.status,201);
  const pendingKey=(await (await getStore()).get(pending.data.id)).data.key;
  assert.equal((await request('image',{cookie:null,params:{id:pending.data.id}})).status,401);
  assert.equal((await request('image',{cookie,params:{id:pending.data.id}})).status,200);
  const memory=await request('upload',{method:'POST',cookie,bytes:jpeg,params:{kind:'memory',name:'回忆.jpg',caption:'一起度过的一天'}});assert.equal(memory.status,201);
  assert.equal((await request('comment',{method:'POST',cookie,json:{text:'不能把相册图直接绑定留言',imageIds:[memory.data.id]}})).status,400);
  const secondAccepted=await request('verify',{method:'POST',json:{password:'2483'}}),secondCookie=secondAccepted.cookie.split(';')[0];
  assert.deepEqual(secondAccepted.data.profile,{id:'zhuoyan',name:'卓言',theme:'blue'});
  assert.equal((await request('image',{cookie:secondCookie,params:{id:pending.data.id}})).status,404);
  assert.equal((await request('comment',{method:'POST',cookie:secondCookie,json:{text:'不能占用另一设备的草稿图',imageIds:[pending.data.id]}})).status,400);
  const text='<img src=x onerror=alert(1)> 今天也想你';
  const tanComment=await request('comment',{method:'POST',cookie,json:{text,imageIds:[pending.data.id],author:'卓言',theme:'blue'}});assert.equal(tanComment.status,201);
  assert.equal((await request('comment',{method:'POST',cookie,json:{text:'不能重复绑定',imageIds:[pending.data.id]}})).status,400);
  const feed=(await request('comments')).data;assert.equal(feed.items.length,1);assert.equal(feed.items[0].text,text);assert.equal(feed.items[0].images.length,1);
  assert.equal((await request('memories')).data.items.length,1);
  assert.deepEqual((await request('image',{params:{id:pending.data.id}})).data,jpeg);
  assert.deepEqual((await request('image',{params:{id:memory.data.id}})).data,jpeg);
  console.log('✓ 图片格式/体积验证；草稿图片私有；相册与留言分离；发布后其他设备可读取');

  const zhuoComment=await request('comment',{method:'POST',cookie:secondCookie,json:{text:'晚安，明天见',author:'谭笑',authorId:'tanxiao',theme:'pink'}});assert.equal(zhuoComment.status,201);
  let dialogue=(await request('dialogue')).data.items;
  assert.equal(dialogue.find(item=>item.id===tanComment.data.id).author,'谭笑');
  assert.equal(dialogue.find(item=>item.id===zhuoComment.data.id).author,'卓言');assert.equal(dialogue.find(item=>item.id===zhuoComment.data.id).theme,'blue');
  assert.equal((await request('deleteComment',{method:'POST',json:{id:tanComment.data.id}})).status,401);
  assert.equal((await request('deleteComment',{method:'POST',cookie:secondCookie,json:{id:tanComment.data.id}})).status,403);
  assert.equal((await request('deleteComment',{method:'POST',cookie,json:{id:zhuoComment.data.id}})).status,403);
  assert.equal((await request('deleteComment',{method:'POST',cookie:secondCookie,json:{id:zhuoComment.data.id}})).status,200);
  assert.equal((await request('deleteComment',{method:'POST',cookie:secondCookie,json:{id:zhuoComment.data.id}})).status,404);
  const switched=await request('verify',{method:'POST',cookie:secondCookie,json:{password:'4813'}}),sameAuthorCookie=switched.cookie.split(';')[0];
  assert.equal(switched.data.profile.id,'tanxiao');assert.equal(sameAuthorCookie.split('=')[1].split('.')[0],secondCookie.split('=')[1].split('.')[0]);
  assert.equal((await request('deleteComment',{method:'POST',cookie:sameAuthorCookie,json:{id:tanComment.data.id}})).status,200);
  assert.equal((await request('image',{params:{id:pending.data.id}})).status,404);
  await assert.rejects(readFile(join(folder,'uploads',pendingKey)),{code:'ENOENT'});
  assert.equal((await request('memories')).data.items.length,1);
  assert.equal((await request('dialogue')).data.items.length,0);
  const old=await (await getStore()).insert({kind:'comment',owner:legacyId,text:'旧版留言',data:{imageIds:[]}});
  assert.equal((await request('comments')).data.items[0].author,'谭笑');
  assert.equal((await request('deleteComment',{method:'POST',cookie:sameAuthorCookie,json:{id:old.id}})).status,200);
  console.log('✓ 留言身份由服务端决定；双方只能删除自己的留言；跨设备和旧留言兼容；删除同步到弹幕');

  const imageIds=[];
  for(let i=0;i<MAX_COMMENT_IMAGES;i++){const image=await request('upload',{method:'POST',cookie,bytes:jpeg,params:{kind:'attachment'}});assert.equal(image.status,201);imageIds.push(image.data.id);}
  assert.equal((await request('comment',{method:'POST',cookie,json:{text:'超出张数',imageIds:[...imageIds,'00000000-0000-0000-0000-000000000002']}})).status,400);
  const imageComment=await request('comment',{method:'POST',cookie,json:{text:'',imageIds}});assert.equal(imageComment.status,201);
  assert.equal((await request('comments')).data.items[0].images.length,30);
  assert.equal((await request('dialogue')).data.items.length,0,'纯图片留言不应变成空弹幕');
  assert.equal((await request('deleteComment',{method:'POST',cookie,json:{id:imageComment.data.id}})).status,200);
  assert.equal((await request('image',{params:{id:imageIds[0]}})).status,404);
  console.log('✓ 30 张图片可以发布和删除；超限被拒绝；纯图片留言不进入弹幕');

  await (await getStore()).insert({kind:'comment',owner:legacyId,text:'分页前的留言',data:{imageIds:[]}});
  const rateCookie=(await request('verify',{method:'POST',json:{password:'4813'}})).cookie.split(';')[0];
  for(let i=0;i<23;i++)assert.equal((await request('comment',{method:'POST',cookie:rateCookie,json:{text:`分页 ${i}`}})).status,i<20?201:429);
  const first=(await request('comments')).data;assert.equal(first.items.length,20);assert.ok(first.nextCursor);
  const next=(await request('comments',{params:{cursor:first.nextCursor}})).data;assert.equal(next.items.length,1);assert.equal(next.nextCursor,null);assert.equal(new Set([...first.items,...next.items].map(x=>x.id)).size,21);
  assert.ok((await readFile(join(folder,'letter.sqlite'))).length>0);assert.ok((await readFile(join(folder,'session-secret'))).length>=32);
  console.log('✓ 分页无重复，留言频率受限，数据库与设备密钥已持久化');
  assert.equal((await request('verify',{method:'POST',json:{password:'0000'}})).status,422);
  assert.equal((await request('verify',{method:'POST',json:{password:'4813'}})).status,429);
  console.log('✓ 密码尝试受服务端频率限制');
} finally {await new Promise(resolve=>server.close(resolve));await rm(folder,{recursive:true,force:true});}
