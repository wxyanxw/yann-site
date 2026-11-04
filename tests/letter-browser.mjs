import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { chromium }=await import(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const folder=await mkdtemp(join(tmpdir(),'yann-letter-browser-'));
const config=join(folder,'letter-config.json');await writeFile(config,JSON.stringify({users:[{id:'tanxiao',name:'谭笑',password:'4813',theme:'pink'},{id:'zhuoyan',name:'卓言',password:'2483',theme:'blue'}]}));
const artifacts=process.env.ARTIFACTS_DIR||'/tmp/yann-letter-community-checks';await mkdir(artifacts,{recursive:true});
let child,browser;
async function startServer(){
  child=spawn(process.execPath,['server/dev.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0',LETTER_DATA_DIR:folder,LETTER_CONFIG_FILE:config,LETTER_STORE:'local',SUPABASE_URL:'',VERCEL:''},stdio:['ignore','pipe','pipe']});
  return new Promise((resolve,reject)=>{let output='';child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});child.on('error',reject);child.on('exit',code=>reject(new Error('本地测试服务退出：'+code)));});
}
async function openLetter(page,origin){await page.goto(origin+'/letter.html');await page.locator('#envelope').click();await page.waitForFunction(()=>document.querySelector('#main').classList.contains('show'));}
async function enterPassword(page,wrong=false,password='4813'){
  await page.locator('#identitySubmit').waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.querySelector('#identitySubmit').disabled);
  await page.locator('#identityPassword').fill(wrong?'0000':password);
  await page.locator('#identitySubmit').click();
}
const errors=[];
function observe(page){page.on('pageerror',error=>errors.push(error.message));page.on('dialog',async dialog=>{errors.push('意外弹窗：'+dialog.message());await dialog.dismiss();});}
try {
  let origin=await startServer();
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
  const first=await browser.newContext({viewport:{width:1100,height:900},reducedMotion:'reduce'}),page=await first.newPage();observe(page);
  await openLetter(page,origin);
  assert.equal((await page.request.get(origin+'/server/letter-service.js')).status(),404);
  assert.equal((await page.request.get(origin+'/server/letter-config.json')).status(),404);
  assert.equal((await page.request.get(origin+'/.letter-data/session-secret')).status(),404);
  assert.equal((await page.request.get(origin+'/信件留言与相册配置说明.md')).status(),404);
  assert.equal((await page.request.get(origin+'/public/server/letter-config.json')).status(),404);
  await page.locator('#commentBtn').click();await page.locator('#commentText').fill('<img src=x onerror=alert(1)> 今天也想你');await page.locator('#commentPublish').click();
  await enterPassword(page,true);await page.waitForFunction(()=>document.querySelector('#identityError').textContent.includes('密码不对'));
  assert.equal(await page.locator('#identityDialog').isVisible(),true);
  await page.locator('#identityDialog').screenshot({path:join(artifacts,'verification-desktop.png')});
  await enterPassword(page);await page.waitForFunction(()=>!document.querySelector('#identityDialog').open&&document.querySelectorAll('.letter-comment').length===1);
  assert.equal(await page.locator('.letter-comment-text').innerText(),'<img src=x onerror=alert(1)> 今天也想你');assert.equal(await page.locator('.letter-comment-text img').count(),0);
  assert.equal(await page.locator('.letter-comment').getAttribute('data-theme'),'pink');assert.equal(await page.locator('.letter-comment-delete').count(),1);
  await page.waitForFunction(()=>document.querySelectorAll('.letter-danmaku-item').length>0);
  assert.equal(await page.locator('.letter-danmaku-item img').count(),0);
  assert.equal(await page.locator('#commentIdentity').innerText(),'以谭笑的名字留言');
  console.log('✓ 错误密码不解锁，正确密码后自动发布；配置文件无法从网页访问；留言按纯文本显示');

  const png=Buffer.from((await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=160;canvas.height=120;const c=canvas.getContext('2d');c.fillStyle='#ff8fab';c.fillRect(0,0,160,120);c.fillStyle='#fff7fb';c.fillRect(35,25,90,70);return canvas.toDataURL('image/png');})).split(',')[1],'base64');
  let uploads=0;page.on('request',request=>{if(request.url().includes('action=upload'))uploads++;});
  await page.locator('#commentText').fill('带图留言');await page.locator('#commentFiles').setInputFiles(Array.from({length:7},(_,i)=>({name:`留言照片${i}.png`,mimeType:'image/png',buffer:png})));
  await page.waitForFunction(()=>document.querySelectorAll('#commentPreviews img').length===7&&!document.querySelector('#commentAddImage').disabled);
  await page.route('**/api/letter?action=comment',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'模拟保存失败，请重试。'})}));
  await page.locator('#commentPublish').click();await page.waitForFunction(()=>document.querySelector('#commentError').textContent.includes('模拟保存失败'));
  assert.equal(await page.locator('#commentText').inputValue(),'带图留言');assert.equal(await page.locator('#commentPreviews img').count(),7);assert.equal(uploads,7);
  await page.unroute('**/api/letter?action=comment');await page.locator('#commentPublish').click();await page.waitForFunction(()=>document.querySelectorAll('.letter-comment').length===2&&!document.querySelector('#commentPublish').disabled);assert.equal(uploads,7,'重试不能重复上传已保存的附件');
  await page.locator('#commentsDialog').screenshot({path:join(artifacts,'comments-desktop.png')});
  console.log('✓ 图片压缩上传；失败保留文字和图片；重试不重复上传；留言图片可显示');

  await page.locator('[data-letter-close="commentsDialog"]').click();await page.locator('#photoBtn').click();await page.locator('#pvUpload').click();assert.equal(await page.locator('#identityDialog').isVisible(),false);
  await page.locator('#memoryFiles').setInputFiles([{name:'回忆一.png',mimeType:'image/png',buffer:png},{name:'回忆二.png',mimeType:'image/png',buffer:png}]);
  await page.waitForFunction(()=>document.querySelectorAll('#memoryPreviews img').length===2&&!document.querySelector('#memorySave').disabled);
  await page.locator('#memoryCaption').fill('一起度过的一天');await page.locator('#memoryUploadDialog').screenshot({path:join(artifacts,'memory-upload-desktop.png')});await page.locator('#memorySave').click();
  await page.waitForFunction(()=>!document.querySelector('#memoryUploadDialog').open&&document.querySelector('#pvCount').textContent.includes('/ 50 张'));
  assert.equal(await page.locator('#pvCaption').innerText(),'一起度过的一天');await page.waitForFunction(()=>document.querySelector('#pvImg').complete&&document.querySelector('#pvImg').naturalWidth>0);
  console.log('✓ 已验证设备上传相册免再输密码；48张原图加2张新图，留言图片没有混入相册');

  const second=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'}),visitor=await second.newPage();observe(visitor);await openLetter(visitor,origin);await visitor.locator('#commentBtn').click();await visitor.waitForFunction(()=>document.querySelectorAll('.letter-comment').length===2);
  assert.equal(await visitor.locator('.letter-comment img').count(),7);assert.equal(await visitor.locator('.letter-comment-delete').count(),0);await visitor.locator('#commentsDialog').screenshot({path:join(artifacts,'comments-mobile.png')});
  await visitor.locator('[data-letter-close="commentsDialog"]').click();await visitor.locator('#photoBtn').click();await visitor.waitForFunction(()=>document.querySelector('#pvCount').textContent.includes('/ 50 张'));await visitor.locator('#pvUpload').click();await visitor.waitForFunction(()=>!document.querySelector('#identitySubmit').disabled);
  await visitor.locator('#identityDialog').screenshot({path:join(artifacts,'verification-mobile.png')});
  assert.equal((await visitor.request.post(origin+'/api/letter?action=comment',{headers:{Origin:origin},data:{text:'匿名写入'}})).status(),401);
  await enterPassword(visitor,false,'2483');await visitor.waitForFunction(()=>document.querySelector('#memoryUploadDialog').open);assert.equal(await visitor.locator('#identityDialog').isVisible(),false);
  assert.equal(await visitor.locator('#memoryUploadDialog').getAttribute('data-theme'),'blue');
  await visitor.locator('#memoryFiles').setInputFiles({name:'手机回忆.png',mimeType:'image/png',buffer:png});await visitor.waitForFunction(()=>!document.querySelector('#memorySave').disabled);
  await visitor.locator('#memoryUploadDialog').screenshot({path:join(artifacts,'memory-upload-mobile.png')});await visitor.locator('#memorySave').click();await visitor.waitForFunction(()=>document.querySelector('#pvCount').textContent.includes('/ 51 张'));
  console.log('✓ 第二台设备看到共享留言与照片；匿名写入被拒绝；相册上传首次要求验证');

  await visitor.locator('#pvClose').click();await visitor.locator('#commentBtn').click();await visitor.locator('#commentText').fill('卓言的晚安，明天也一起开心');await visitor.locator('#commentPublish').click();
  await visitor.waitForFunction(()=>document.querySelectorAll('.letter-comment').length===3&&!document.querySelector('#commentPublish').disabled);
  const blueCard=visitor.locator('.letter-comment[data-theme="blue"]');assert.equal(await blueCard.locator('strong').innerText(),'卓言');assert.equal(await blueCard.locator('.letter-avatar').innerText(),'言');assert.equal(await visitor.locator('.letter-comment-delete').count(),1);
  const blueId=await blueCard.getAttribute('data-id');await visitor.locator('#commentsDialog').screenshot({path:join(artifacts,'comments-blue-mobile.png')});
  await visitor.locator('[data-letter-close="commentsDialog"]').click();await visitor.emulateMedia({reducedMotion:'no-preference'});
  await visitor.waitForFunction(()=>document.querySelectorAll('.letter-danmaku-item').length===3&&document.querySelectorAll('.letter-danmaku-item[data-theme="blue"]').length>0);
  const movement=await visitor.evaluate(async()=>{const bubble=document.querySelector('.letter-danmaku-item'),before=getComputedStyle(bubble).transform;await new Promise(resolve=>setTimeout(resolve,200));return before!==getComputedStyle(bubble).transform;});assert.ok(movement,'弹幕需要持续移动');
  const initialTexts=await visitor.locator('.letter-danmaku-item').allTextContents();
  await visitor.evaluate(()=>document.querySelector('.letter-danmaku-item').getAnimations()[0].finish());
  await visitor.waitForFunction(before=>document.querySelector('.letter-danmaku-item').textContent!==before,initialTexts[0]);
  await visitor.screenshot({path:join(artifacts,'danmaku-mobile.png')});
  await visitor.emulateMedia({reducedMotion:'reduce'});await visitor.waitForFunction(()=>[...document.querySelectorAll('.letter-danmaku-item')].every(bubble=>bubble.getAnimations().length===0));
  await visitor.locator('#commentBtn').click();await blueCard.locator('.letter-comment-delete').click();await visitor.locator('[data-letter-close="commentDeleteDialog"]').first().click();assert.equal(await blueCard.count(),1,'取消不应删除留言');
  await blueCard.locator('.letter-comment-delete').click();await visitor.locator('#commentDeleteConfirm').click();
  await visitor.waitForFunction(id=>!document.querySelector('.letter-comment[data-id="'+id+'"]')&&!document.querySelector('.letter-danmaku-item[data-id="'+id+'"]'),blueId);
  assert.equal(await visitor.locator('.letter-comment img').count(),7,'删除卓言留言不影响谭笑的图片');
  await visitor.locator('#commentSwitchIdentity').click();await enterPassword(visitor,true);await visitor.waitForFunction(()=>document.querySelector('#identityError').textContent.includes('密码不对'));await visitor.locator('[data-letter-close="identityDialog"]').click();assert.equal(await visitor.locator('#commentIdentity').innerText(),'以卓言的名字留言');
  await visitor.locator('#commentSwitchIdentity').click();await enterPassword(visitor);await visitor.waitForFunction(()=>document.querySelector('#commentIdentity').textContent==='以谭笑的名字留言');assert.equal(await visitor.locator('.letter-comment-delete').count(),2);
  await visitor.locator('#commentSwitchIdentity').click();await enterPassword(visitor,false,'2483');await visitor.waitForFunction(()=>document.querySelector('#commentIdentity').textContent==='以卓言的名字留言');
  await visitor.locator('[data-letter-close="commentsDialog"]').click();
  console.log('✓ 卓言蓝色留言；切换/取消身份正确；只能删除自己的留言；弹幕持续移动循环，删除后移除；减少动态时静止');

  for(const width of [390,320,768]){
    await visitor.setViewportSize({width,height:844});await visitor.reload();await visitor.locator('#envelope').click();await visitor.waitForFunction(()=>document.querySelector('#main').classList.contains('show'));
    assert.ok(await visitor.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await visitor.locator('#commentBtn').click();await visitor.locator('#commentAddImage').click();assert.equal(await visitor.locator('#identityDialog').isVisible(),false,'刷新后记住设备');
    assert.equal(await visitor.locator('#commentIdentity').innerText(),'以卓言的名字留言');const bounds=await visitor.locator('#commentsDialog').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width);await visitor.locator('[data-letter-close="commentsDialog"]').click();
  }
  const state=await second.storageState();await second.close();await new Promise(resolve=>{child.once('exit',resolve);child.kill();});origin=await startServer();
  const restored=await browser.newContext({storageState:state,viewport:{width:390,height:844},reducedMotion:'reduce'}),restoredPage=await restored.newPage();observe(restoredPage);await openLetter(restoredPage,origin);await restoredPage.locator('#photoBtn').click();await restoredPage.waitForFunction(()=>document.querySelector('#pvCount').textContent.includes('/ 51 张'));await restoredPage.locator('#pvUpload').click();await restoredPage.waitForFunction(()=>document.querySelector('#memoryUploadDialog').open);assert.equal(await restoredPage.locator('#identityDialog').isVisible(),false);
  assert.deepEqual(errors,[]);console.log('✓ 手机/平板无横向溢出；刷新及服务重启后验证和照片仍然保留；无脚本错误');
  await browser.close();browser=null;
} finally {if(browser)await browser.close();if(child&&!child.killed)await new Promise(resolve=>{child.once('exit',resolve);child.kill();});await rm(folder,{recursive:true,force:true});}
