import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const folder=await mkdtemp(join(tmpdir(),'yann-letter-api-'));
process.env.LETTER_DATA_DIR=folder;process.env.LETTER_STORE='local';delete process.env.SUPABASE_URL;delete process.env.VERCEL;
process.env.LETTER_CONFIG_FILE=join(folder,'letter-config.json');await writeFile(process.env.LETTER_CONFIG_FILE,JSON.stringify({password:'4813'}));
const { handleLetter,MAX_IMAGE_BYTES }=await import('../server/letter-service.js');
const server=createServer(handleLetter);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const jpeg=Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAMABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDtKKKKzPsD/9k=','base64');
async function request(action,{method='GET',json,bytes,cookie,params={},source=origin}={}) {
  const response=await fetch(origin+'/api/letter?'+new URLSearchParams({action,...params}),{method,headers:{...(method==='POST'?{Origin:source}:{}),...(cookie?{Cookie:cookie}:{}),...(json!==undefined?{'Content-Type':'application/json'}:{}),...(bytes?{'Content-Type':'image/jpeg'}:{})},...(json!==undefined?{body:JSON.stringify(json)}:bytes?{body:bytes}:{})});
  const data=response.headers.get('content-type')?.includes('json')?await response.json():Buffer.from(await response.arrayBuffer());
  return {status:response.status,data,cookie:response.headers.get('set-cookie')};
}
try {
  assert.equal((await request('session')).data.verified,false);
  assert.equal((await request('comment',{method:'POST',json:{text:'绕过验证'}})).status,401);
  assert.equal((await request('upload',{method:'POST',bytes:jpeg,params:{kind:'memory'}})).status,401);
  assert.equal((await request('comment',{method:'POST',json:{text:'伪造设备'},cookie:'yann_letter_device=00000000-0000-0000-0000-000000000001.fake'})).status,401);
  assert.equal((await request('verify',{method:'POST',json:{password:'4813'},source:'https://other.example'})).status,403);
  console.log('✓ 未验证、伪造设备及跨站请求不能写入');

  const wrong=await request('verify',{method:'POST',json:{password:'0000'}});assert.equal(wrong.status,422);
  assert.equal((await request('session')).data.verified,false);
  const accepted=await request('verify',{method:'POST',json:{password:'4813'}});assert.equal(accepted.status,200);assert.match(accepted.cookie,/HttpOnly; SameSite=Strict/);
  const cookie=accepted.cookie.split(';')[0];assert.equal((await request('session',{cookie})).data.verified,true);
  await writeFile(process.env.LETTER_CONFIG_FILE,JSON.stringify({password:'2468'}));
  assert.equal((await request('verify',{method:'POST',json:{password:'4813'}})).status,422);
  assert.equal((await request('verify',{method:'POST',json:{password:'2468'}})).status,200);
  assert.equal((await request('session',{cookie})).data.verified,true);
  await writeFile(process.env.LETTER_CONFIG_FILE,JSON.stringify({password:'4813'}));
  console.log('✓ 错误密码不解锁；正确密码记住设备；修改配置后新密码生效，已验证设备仍被记住');

  assert.equal((await request('upload',{method:'POST',cookie,bytes:Buffer.from([255,216,255,217]),params:{kind:'memory'}})).status,415);
  assert.equal((await request('upload',{method:'POST',cookie,bytes:Buffer.alloc(MAX_IMAGE_BYTES+1),params:{kind:'memory'}})).status,413);
  const pending=await request('upload',{method:'POST',cookie,bytes:jpeg,params:{kind:'attachment',name:'测试留言.jpg'}});assert.equal(pending.status,201);
  assert.equal((await request('image',{params:{id:pending.data.id}})).status,404);
  assert.equal((await request('image',{cookie,params:{id:pending.data.id}})).status,200);
  const memory=await request('upload',{method:'POST',cookie,bytes:jpeg,params:{kind:'memory',name:'回忆.jpg',caption:'一起度过的一天'}});assert.equal(memory.status,201);
  assert.equal((await request('comment',{method:'POST',cookie,json:{text:'不能把相册图直接绑定留言',imageIds:[memory.data.id]}})).status,400);
  const secondCookie=(await request('verify',{method:'POST',json:{password:'4813'}})).cookie.split(';')[0];
  assert.equal((await request('comment',{method:'POST',cookie:secondCookie,json:{text:'不能占用另一设备的草稿图',imageIds:[pending.data.id]}})).status,400);
  const text='<img src=x onerror=alert(1)> 今天也想你';
  assert.equal((await request('comment',{method:'POST',cookie,json:{text,imageIds:[pending.data.id]}})).status,201);
  assert.equal((await request('comment',{method:'POST',cookie,json:{text:'不能重复绑定',imageIds:[pending.data.id]}})).status,400);
  const feed=(await request('comments')).data;assert.equal(feed.items.length,1);assert.equal(feed.items[0].text,text);assert.equal(feed.items[0].images.length,1);
  assert.equal((await request('memories')).data.items.length,1);
  assert.deepEqual((await request('image',{params:{id:pending.data.id}})).data,jpeg);
  assert.deepEqual((await request('image',{params:{id:memory.data.id}})).data,jpeg);
  console.log('✓ 图片格式/体积验证；草稿图片私有；相册与留言分离；发布后其他设备可读取');

  const rateCookie=(await request('verify',{method:'POST',json:{password:'4813'}})).cookie.split(';')[0];
  for(let i=0;i<23;i++)assert.equal((await request('comment',{method:'POST',cookie:rateCookie,json:{text:`分页 ${i}`}})).status,i<20?201:429);
  const first=(await request('comments')).data;assert.equal(first.items.length,20);assert.ok(first.nextCursor);
  const next=(await request('comments',{params:{cursor:first.nextCursor}})).data;assert.equal(next.items.length,1);assert.equal(next.nextCursor,null);assert.equal(new Set([...first.items,...next.items].map(x=>x.id)).size,21);
  assert.ok((await readFile(join(folder,'letter.sqlite'))).length>0);assert.ok((await readFile(join(folder,'session-secret'))).length>=32);
  console.log('✓ 分页无重复，留言频率受限，数据库与设备密钥已持久化');
  assert.equal((await request('verify',{method:'POST',json:{password:'0000'}})).status,422);
  assert.equal((await request('verify',{method:'POST',json:{password:'0000'}})).status,422);
  assert.equal((await request('verify',{method:'POST',json:{password:'4813'}})).status,429);
  console.log('✓ 密码尝试受服务端频率限制');
} finally {await new Promise(resolve=>server.close(resolve));await rm(folder,{recursive:true,force:true});}
