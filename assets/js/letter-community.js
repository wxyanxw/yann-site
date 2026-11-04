const $=id=>document.getElementById(id);
const dialogs={comments:$('commentsDialog'),memory:$('memoryUploadDialog'),identity:$('identityDialog'),image:$('letterImageDialog'),delete:$('commentDeleteDialog')};
const MAX_BYTES=1536*1024;
let verified=false,verificationResolve,verificationPromise;
let comments=[],commentCursor=null,commentLoading=false,memoriesLoading=null;
let commentFiles=[],memoryFiles=[],preparingComment=false,preparingMemory=false,publishing=false,memoryUploading=false;
let verificationRequest=0;
let currentProfile=null,maxCommentImages=30,deleteTarget=null,deleting=false;

async function api(action,{method='GET',body,params={},headers={}}={}) {
  if(location.protocol==='file:')throw new Error('请从网站地址打开这封信，才能保存留言和照片。');
  const query=new URLSearchParams({action,...params});
  const response=await fetch('/api/letter?'+query,{method,credentials:'same-origin',cache:'no-store',headers,...(body!==undefined?{body}:{}),signal:AbortSignal.timeout(30000)});
  const data=await response.json().catch(()=>({error:'暂时连不上留言和相册，请稍后再试。'}));
  if(!response.ok){const error=new Error(data.error||'保存失败，请稍后再试。');error.status=response.status;error.code=data.code;if(response.status===401)setSession({verified:false});throw error;}
  return data;
}
const post=(action,data={})=>api(action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
function notice(id,text=''){ $(id).textContent=text; }
function rememberDraft(){try{localStorage.setItem('yann.letter.comment-draft.v1',$('commentText').value);}catch{}}
try{$('commentText').value=localStorage.getItem('yann.letter.comment-draft.v1')||'';}catch{}
const sessionReady=api('session').then(setSession).catch(()=>{});
function setSession(data){verified=!!data.verified;currentProfile=data.profile||null;maxCommentImages=data.maxCommentImages||maxCommentImages;updateIdentity();renderComments();}
function updateIdentity(){
  $('commentIdentity').textContent=verified?`以${currentProfile.name}的名字留言`:'首次发布需要输入我们的密码';
  $('commentSwitchIdentity').textContent=verified?'切换身份':'验证身份';
  $('commentImageHint').textContent=`每条最多 ${maxCommentImages} 张图片 · 自动压缩`;
  for(const dialog of Object.values(dialogs))dialog.dataset.theme=currentProfile?.theme||'pink';
}
function finishVerification(ok){const resolve=verificationResolve;verificationResolve=null;verificationPromise=null;resolve?.(ok);}
async function ensureVerified(force=false) {
  await sessionReady;
  if(verified&&!force)return true;
  if(verificationPromise)return verificationPromise;
  verificationPromise=new Promise(resolve=>{verificationResolve=resolve;});
  $('identityPassword').value='';$('identityPassword').disabled=false;$('identitySubmit').disabled=false;notice('identityError');notice('identityStatus');dialogs.identity.showModal();
  return verificationPromise;
}
$('identityForm').addEventListener('submit',async event=>{
  event.preventDefault();if($('identitySubmit').disabled)return;
  const password=$('identityPassword').value;if(!password){notice('identityError','先输入密码吧。');return;}
  const request=++verificationRequest;
  $('identitySubmit').disabled=true;$('identityPassword').disabled=true;notice('identityError');notice('identityStatus','正在确认…');
  try{const session=await post('verify',{password});if(request!==verificationRequest)return;setSession(session);finishVerification(true);dialogs.identity.close();}
  catch(error){if(request!==verificationRequest)return;notice('identityError',error.message);$('identitySubmit').disabled=false;$('identityPassword').disabled=false;$('identityPassword').focus();$('identityPassword').select();}
  finally{if(request===verificationRequest)notice('identityStatus');}
});
dialogs.identity.addEventListener('close',()=>{verificationRequest++;$('identityPassword').value='';finishVerification(false);});
$('commentSwitchIdentity').addEventListener('click',()=>ensureVerified(true));

for(const button of document.querySelectorAll('[data-letter-close]'))button.addEventListener('click',()=>$(button.dataset.letterClose).close());
for(const dialog of Object.values(dialogs))dialog.addEventListener('click',event=>{
  if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();
});
function showImage(url,alt){$('letterFullImage').src=url;$('letterFullImage').alt=alt||'留言照片';dialogs.image.showModal();}
dialogs.image.addEventListener('close',()=>$('letterFullImage').removeAttribute('src'));
function commentCard(comment) {
  const card=document.createElement('article');card.className='letter-comment';card.dataset.id=comment.id;card.dataset.theme=comment.theme||'pink';
  const meta=document.createElement('div');meta.className='letter-comment-meta';
  const avatar=document.createElement('span');avatar.className='letter-avatar';avatar.textContent=comment.authorId==='zhuoyan'?'言':'笑';
  const author=document.createElement('strong');author.textContent=comment.author;
  const time=document.createElement('time');time.dateTime=comment.createdAt;time.textContent=new Date(comment.createdAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
  meta.append(avatar,author,time);
  if(verified&&currentProfile.id===comment.authorId){const button=document.createElement('button');button.type='button';button.className='letter-comment-delete';button.textContent='删除';button.setAttribute('aria-label','删除这条留言');button.addEventListener('click',()=>{deleteTarget=comment;$('commentDeletePreview').textContent=comment.text||`${comment.images.length} 张照片`;notice('commentDeleteError');dialogs.delete.showModal();});meta.append(button);}
  card.append(meta);
  if(comment.text){const text=document.createElement('p');text.className='letter-comment-text';text.textContent=comment.text;card.append(text);}
  if(comment.images.length){const grid=document.createElement('div');grid.className='letter-image-grid';for(const photo of comment.images){const button=document.createElement('button');button.type='button';button.setAttribute('aria-label','查看留言图片');const img=document.createElement('img');img.src=photo.url;img.alt=photo.name||'留言照片';img.loading='lazy';button.append(img);button.addEventListener('click',()=>showImage(photo.url,img.alt));grid.append(button);}card.append(grid);}
  return card;
}
function renderComments(){
  $('commentFeed').replaceChildren();
  if(!comments.length){const empty=document.createElement('div');empty.className='letter-empty';const icon=document.createElement('span');icon.textContent='💌';const title=document.createElement('p');title.textContent='把想说的话留在这里';const small=document.createElement('small');small.textContent='一段文字，或者一张今天的照片。';empty.append(icon,title,small);$('commentFeed').append(empty);}
  else for(const comment of comments)$('commentFeed').append(commentCard(comment));
  $('commentMore').hidden=!commentCursor;
}
async function loadComments(more=false) {
  if(commentLoading)return;commentLoading=true;$('commentRefresh').disabled=true;$('commentMore').disabled=true;notice('commentLoadStatus',more?'正在翻到下一页…':'正在收取留言…');
  try{const page=await api('comments',{params:more?{cursor:commentCursor}:{}});comments=more?[...comments,...page.items]:page.items;commentCursor=page.nextCursor;renderComments();notice('commentLoadStatus');}
  catch(error){notice('commentLoadStatus',error.message);}
  finally{commentLoading=false;$('commentRefresh').disabled=false;$('commentMore').disabled=false;}
}
$('commentBtn').addEventListener('click',()=>{dialogs.comments.showModal();updateIdentity();loadComments();});
$('commentRefresh').addEventListener('click',()=>loadComments());$('commentMore').addEventListener('click',()=>loadComments(true));
$('commentDeleteConfirm').addEventListener('click',async()=>{
  if(!deleteTarget||deleting)return;
  deleting=true;$('commentDeleteConfirm').disabled=true;notice('commentDeleteError');
  try{await post('deleteComment',{id:deleteTarget.id});comments=comments.filter(comment=>comment.id!==deleteTarget.id);renderComments();dialogs.delete.close();deleteTarget=null;await Promise.all([loadComments(),loadDialogue()]);}
  catch(error){notice('commentDeleteError',error.message);}
  finally{deleting=false;$('commentDeleteConfirm').disabled=false;}
});
$('commentText').addEventListener('input',()=>{rememberDraft();$('commentLength').textContent=`${$('commentText').value.length} / 2000`;});
$('commentText').dispatchEvent(new Event('input'));

async function decodeImage(file) {
  if(typeof createImageBitmap==='function'){try{return await createImageBitmap(file);}catch{}}
  const url=URL.createObjectURL(file),image=new Image();image.src=url;
  try{await image.decode();image.close=()=>URL.revokeObjectURL(url);return image;}
  catch{URL.revokeObjectURL(url);throw new Error('没有读到有效照片，请换一张试试。');}
}
async function processImage(file) {
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('请选择 JPG、PNG 或 WebP 图片。');
  if(file.size>25*1024*1024)throw new Error('原图超过 25 MB，请选一张小一点的照片。');
  const bitmap=await decodeImage(file);
  try {
    if(bitmap.width*bitmap.height>40000000)throw new Error('原图尺寸太大，请先缩小再上传。');
    let ratio=Math.min(1,1600/Math.max(bitmap.width,bitmap.height)),quality=.86,blob;
    const canvas=document.createElement('canvas');
    for(let tries=0;tries<6;tries++) {
      canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
      const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
      blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
      if(blob&&blob.size<=MAX_BYTES)break;quality-=.12;if(quality<.5){ratio*=.75;quality=.8;}
    }
    if(!blob||blob.size>MAX_BYTES)throw new Error('照片没有压缩成功，请换一张试试。');
    return {blob,name:file.name.replace(/\.[^.]+$/,'')+'.jpg',url:URL.createObjectURL(blob),id:null};
  } finally {bitmap.close();}
}
function renderPreviews(kind) {
  const files=kind==='comment'?commentFiles:memoryFiles,container=$(kind+'Previews');container.replaceChildren();
  files.forEach((file,index)=>{
    const preview=document.createElement('div');preview.className='letter-preview';const image=document.createElement('img');image.src=file.url;image.alt=file.name;
    const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','移除 '+file.name);remove.disabled=kind==='comment'?publishing:memoryUploading;
    remove.addEventListener('click',()=>{URL.revokeObjectURL(file.url);files.splice(index,1);renderPreviews(kind);});preview.append(image,remove);container.append(preview);
  });
  if(kind==='memory')$('memorySave').disabled=memoryUploading||preparingMemory||!memoryFiles.length;
}
async function addFiles(input,kind) {
  const selected=[...input.files];input.value='';if(!selected.length)return;
  if(kind==='comment'){preparingComment=true;$('commentAddImage').disabled=true;}else{preparingMemory=true;$('memoryFiles').disabled=true;}
  const target=kind==='comment'?commentFiles:memoryFiles,limit=kind==='comment'?maxCommentImages:12;
  const errorId=kind==='comment'?'commentError':'memoryError';notice(errorId);
  if(selected.length+target.length>limit){notice(errorId,`一次最多选择 ${limit} 张图片。`);if(kind==='comment'){preparingComment=false;$('commentAddImage').disabled=publishing;}else{preparingMemory=false;$('memoryFiles').disabled=memoryUploading;}return;}
  const statusId=kind==='comment'?'commentPublishStatus':'memoryProgress';notice(statusId,'正在整理照片…');
  try{for(const file of selected){target.push(await processImage(file));renderPreviews(kind);}}
  catch(error){notice(errorId,error.message);}
  finally{if(kind==='comment'){preparingComment=false;$('commentAddImage').disabled=publishing;}else{preparingMemory=false;$('memoryFiles').disabled=memoryUploading;}notice(statusId);renderPreviews(kind);}
}
$('commentAddImage').addEventListener('click',async()=>{if(await ensureVerified())$('commentFiles').click();});
$('commentFiles').addEventListener('change',()=>addFiles($('commentFiles'),'comment'));
$('memoryFiles').addEventListener('change',()=>addFiles($('memoryFiles'),'memory'));
async function upload(file,kind,caption='') {
  if(file.id)return;
  const result=await api('upload',{method:'POST',params:{kind,name:file.name,caption},headers:{'Content-Type':'image/jpeg'},body:file.blob});file.id=result.id;return result;
}
$('commentForm').addEventListener('submit',async event=>{
  event.preventDefault();if(publishing||preparingComment)return;
  const text=$('commentText').value.trim();if(!text&&!commentFiles.length){notice('commentError','留下一句话，或者添一张照片吧。');return;}
  publishing=true;$('commentPublish').disabled=true;$('commentAddImage').disabled=true;$('commentText').disabled=true;$('commentSwitchIdentity').disabled=true;renderPreviews('comment');notice('commentError');notice('commentPublishStatus');
  try {
    if(!await ensureVerified())return;
    for(let i=0;i<commentFiles.length;i++){notice('commentPublishStatus',`正在保存照片 ${i+1} / ${commentFiles.length}…`);await upload(commentFiles[i],'attachment');}
    notice('commentPublishStatus','正在送出留言…');
    await post('comment',{text,imageIds:commentFiles.map(file=>file.id)});
    for(const file of commentFiles)URL.revokeObjectURL(file.url);commentFiles=[];$('commentText').value='';$('commentText').dispatchEvent(new Event('input'));renderPreviews('comment');notice('commentPublishStatus','留言已经送到啦。');await Promise.all([loadComments(),loadDialogue()]);
  } catch(error){notice('commentError',error.message);notice('commentPublishStatus');}
  finally{publishing=false;$('commentPublish').disabled=false;$('commentAddImage').disabled=false;$('commentText').disabled=false;$('commentSwitchIdentity').disabled=false;renderPreviews('comment');}
});
async function loadMemories(force=false) {
  if(memoriesLoading){await memoriesLoading;if(!force)return;}
  const request=(async()=>{
    try{const items=[];let next;do{const page=await api('memories',{params:next?{cursor:next}:{}});items.push(...page.items);next=page.nextCursor;}while(next);window.dispatchEvent(new CustomEvent('letter:photos',{detail:{photos:items}}));}
    catch{/* 原有相册独立可用；上传时单独显示服务错误。 */}
  })();
  memoriesLoading=request;try{await request;}finally{if(memoriesLoading===request)memoriesLoading=null;}
}
$('photoBtn').addEventListener('click',()=>loadMemories());
$('pvUpload').addEventListener('click',async()=>{if(await ensureVerified()){dialogs.memory.showModal();notice('memoryError');notice('memoryProgress');}});
$('memorySave').addEventListener('click',async()=>{
  if(memoryUploading||preparingMemory||!memoryFiles.length)return;
  memoryUploading=true;$('memoryFiles').disabled=true;$('memoryCaption').disabled=true;$('memorySave').disabled=true;renderPreviews('memory');notice('memoryError');
  let saved=0,lastId;
  try {
    if(!await ensureVerified())return;
    const total=memoryFiles.length;
    while(memoryFiles.length){notice('memoryProgress',`正在存下回忆 ${saved+1} / ${total}…`);const file=memoryFiles[0];await upload(file,'memory',$('memoryCaption').value.trim());lastId=file.id;URL.revokeObjectURL(file.url);memoryFiles.shift();saved++;renderPreviews('memory');}
    await loadMemories(true);dialogs.memory.close();$('memoryCaption').value='';window.dispatchEvent(new CustomEvent('letter:show-photo',{detail:{id:lastId}}));
  } catch(error){notice('memoryError',`${saved?`已保存 ${saved} 张，其余照片还在这里。`:''}${error.message}`);if(saved)await loadMemories();}
  finally{memoryUploading=false;$('memoryFiles').disabled=false;$('memoryCaption').disabled=false;notice('memoryProgress');renderPreviews('memory');}
});
// 只保留少量并行轨道；一条较长的留言分段播放，轨道结束后继续循环。
const motionPreference=matchMedia('(prefers-reduced-motion: reduce)');
let dialogue=[],dialogueSignature='',dialogueLoading=false,danmakuAnimations=[],danmakuGeneration=0;
function syncDanmakuPlayback(){
  const quiet=Object.values(dialogs).some(dialog=>dialog.open)||$('photoViewer').classList.contains('show');
  const paused=document.hidden||!$('main').classList.contains('show')||quiet;
  $('letterDanmaku').classList.toggle('is-quiet',quiet);
  for(const animation of danmakuAnimations)paused?animation.pause():animation.play();
}
function renderDanmaku(){
  const generation=++danmakuGeneration;
  for(const animation of danmakuAnimations)animation.cancel();danmakuAnimations=[];
  const layer=$('letterDanmaku');layer.replaceChildren();
  const mobile=innerWidth<600,chunkSize=mobile?20:38,pool=[];
  const messages=dialogue.map(item=>({item,chars:Array.from(item.text.replace(/\s+/g,' ').trim())}));
  for(let offset=0;messages.some(message=>offset<message.chars.length);offset+=chunkSize)for(const {item,chars} of messages)if(offset<chars.length)pool.push({...item,text:chars.slice(offset,offset+chunkSize).join('')});
  if(!pool.length)return;
  const lanes=mobile?[16,53,66]:[14,31,69,84];let next=0;
  lanes.forEach((top,lane)=>{
    const bubble=document.createElement('span');bubble.className='letter-danmaku-item';bubble.style.top=top+'%';layer.append(bubble);
    function play(first=false){
      if(generation!==danmakuGeneration)return;
      const item=pool[next++%pool.length];bubble.textContent=`${item.author}：${item.text}`;bubble.dataset.theme=item.theme; bubble.dataset.id=item.id;
      if(motionPreference.matches){bubble.style.left=(mobile?5:8)+lane*3+'%';return;}
      bubble.style.left='0';const distance=innerWidth+bubble.offsetWidth+64,duration=Math.max(14000,distance/(mobile?34:44)*1000);
      const animation=bubble.animate([{transform:`translateX(${innerWidth+32}px)`},{transform:`translateX(-${bubble.offsetWidth+32}px)`}],{duration,easing:'linear',fill:'both'});
      danmakuAnimations[lane]=animation;if(first)animation.currentTime=duration*(.2+lane*.15);
      animation.onfinish=()=>play();syncDanmakuPlayback();
    }
    play(true);
  });
  syncDanmakuPlayback();
}
async function loadDialogue(){
  if(dialogueLoading)return;dialogueLoading=true;
  try{const data=await api('dialogue'),signature=JSON.stringify(data.items);if(signature!==dialogueSignature){dialogue=data.items;dialogueSignature=signature;renderDanmaku();}}
  catch{/* 留言服务暂时不可用时继续展示已收到的文字。 */}
  finally{dialogueLoading=false;}
}
const playbackObserver=new MutationObserver(syncDanmakuPlayback);
playbackObserver.observe($('main'),{attributes:true,attributeFilter:['class']});
playbackObserver.observe($('photoViewer'),{attributes:true,attributeFilter:['class']});
for(const dialog of Object.values(dialogs))playbackObserver.observe(dialog,{attributes:true,attributeFilter:['open']});
document.addEventListener('visibilitychange',()=>{syncDanmakuPlayback();if(!document.hidden)loadDialogue();});
motionPreference.addEventListener('change',renderDanmaku);
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(renderDanmaku,150);});
setInterval(()=>{if(document.hidden)return;loadDialogue();if(dialogs.comments.open&&!publishing&&!deleting&&!commentCursor)loadComments();if($('photoViewer').classList.contains('show'))loadMemories();},20000);
loadDialogue();
loadMemories();
