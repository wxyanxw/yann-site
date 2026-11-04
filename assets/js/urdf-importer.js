import { parseURDF, buildURDFDefinition, URDF_FILE_LIMIT } from './urdf-parser.js';

const $=id=>document.getElementById(id);

export class URDFImporter {
  constructor({onOpen,onReview,onCancel}) {
    this.onOpen=onOpen;this.onReview=onReview;this.onCancel=onCancel;this.request=0;
    $('upload-urdf').addEventListener('click',()=>this.open());
    for(const id of ['close-urdf','cancel-urdf'])$(id).addEventListener('click',()=>$('urdf-dialog').close());
    $('urdf-dialog').addEventListener('close',()=>{
      this.request++;
      const definition=this.review;this.review=null;
      if(definition)this.onReview(definition);else this.onCancel();
    });
    $('choose-urdf').addEventListener('click',()=>$('urdf-file').click());
    $('urdf-file').addEventListener('change',()=>{
      const file=$('urdf-file').files[0];$('urdf-file').value='';if(file)this.load(file);
    });
    const drop=$('urdf-dropzone');
    for(const type of ['dragenter','dragover'])drop.addEventListener(type,e=>{e.preventDefault();drop.classList.add('dragging');});
    for(const type of ['dragleave','drop'])drop.addEventListener(type,e=>{e.preventDefault();drop.classList.remove('dragging');});
    drop.addEventListener('drop',e=>{
      if(e.dataTransfer.files.length!==1){this.error('请一次选择一个 URDF 文件。');return;}
      this.load(e.dataTransfer.files[0]);
    });
    $('urdf-chain').addEventListener('change',()=>this.build());
    $('review-urdf').addEventListener('click',()=>{
      if(!this.definition)return;
      this.review=this.definition;$('urdf-dialog').close();
    });
  }

  open() {
    this.review=null;this.onOpen();$('urdf-dialog').showModal();
  }

  error(message) {
    this.definition=null;$('review-urdf').disabled=true;
    $('urdf-import-error').textContent=message;
  }

  async load(file) {
    const request=++this.request;
    this.error('');this.parsed=null;$('urdf-preview').hidden=true;
    $('urdf-model-name').textContent='';$('urdf-model-summary').textContent='';$('urdf-import-notes').replaceChildren();
    $('urdf-file-label').textContent=`${file.name} · ${(file.size/1024).toFixed(1)} KB`;
    $('urdf-parse-status').textContent='正在解析…';
    try {
      if(file.size>URDF_FILE_LIMIT)throw new Error('URDF 文件须小于 5 MB。');
      const source=await file.text();if(request!==this.request)return;
      this.parsed=parseURDF(source,{filename:file.name});
      $('urdf-model-name').textContent=this.parsed.name;
      const select=$('urdf-chain');select.replaceChildren();
      for(const candidate of this.parsed.candidates) {
        const option=document.createElement('option');option.value=candidate.tip;option.disabled=!candidate.supported;
        option.textContent=`${candidate.tip} · ${candidate.dof} 轴${candidate.leaf?' · 末端':''}${candidate.reason?` · ${candidate.reason}`:''}`;
        select.appendChild(option);
      }
      select.value=this.parsed.defaultTip;
      $('urdf-root').textContent=this.parsed.rootLink;
      $('urdf-preview').hidden=false;await this.build();
    } catch(error){if(request===this.request){this.error(error.message);$('urdf-parse-status').textContent='解析失败';}}
  }

  async build() {
    if(!this.parsed)return;
    const request=++this.request;
    this.error('');$('urdf-parse-status').textContent='正在检查关节链…';
    $('urdf-model-summary').textContent='';$('urdf-import-notes').replaceChildren();
    try {
      const model=await buildURDFDefinition(this.parsed,$('urdf-chain').value);
      if(request!==this.request)return;
      this.definition=model;
      const linear=model.joints.filter(j=>j.motion==='prismatic').length,continuous=model.joints.filter(j=>j.continuous).length;
      $('urdf-model-name').textContent=model.label;
      $('urdf-model-summary').textContent=`${model.joints.length} 轴 · ${model.joints.length-linear} 旋转（含 ${continuous} 连续）· ${linear} 直线`;
      const notes=$('urdf-import-notes');notes.replaceChildren();
      for(const note of model.notes){const p=document.createElement('p');p.textContent=note;notes.appendChild(p);}
      $('urdf-parse-status').textContent='解析完成 · 可检查并应用';$('review-urdf').disabled=false;
    } catch(error){if(request===this.request){this.error(error.message);$('urdf-parse-status').textContent='关节链不可用';}}
  }
}
