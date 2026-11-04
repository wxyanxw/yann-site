import { dhJoint, validateDefinition } from './models.js';

const $=id=>document.getElementById(id);
const DEG=180/Math.PI;
const fields=[
  ['a','a / m',1],['alpha','α / °',DEG],['d','d / m',1],['offset','θ₀ / °',DEG],
  ['q0','初始 / °',DEG],['lower','下限 / °',DEG],['upper','上限 / °',DEG],
  ['maxVelocity','速度 / rad·s⁻¹',1],['maxTorque','力矩 / N·m',1],['mass','质量 / kg',1],
];

export class GeometryEditor {
  constructor({onApply,onCancel}) {
    this.onApply=onApply;this.onCancel=onCancel;this.page=0;
    for(const id of ['close-geometry','cancel-geometry'])$(id).addEventListener('click',()=>$('geometry-dialog').close());
    $('geometry-dialog').addEventListener('close',()=>{if(!this.applied)this.onCancel();});
    $('geometry-prev').addEventListener('click',()=>{this.page--;this.renderRows();});
    $('geometry-next').addEventListener('click',()=>{this.page++;this.renderRows();});
    $('apply-geometry').addEventListener('click',()=>{
      try {
        const definition=this.validate();
        this.onApply(definition);this.applied=true;$('geometry-dialog').close();
      } catch(error){$('geometry-error').textContent=error.message;}
    });
    $('suggest-dh').addEventListener('click',()=>{
      for(let i=0;i<this.draft.joints.length;i++) {
        const joint=this.draft.joints[i];if(joint.kind!=='dh')continue;
        const defaults=dhJoint(i);
        for(const [key] of fields)if(joint[key]===null||joint[key]===undefined)joint[key]=defaults[key];
      }
      this.renderRows();$('geometry-error').textContent='已填入建议值；请检查参数并点击「应用构型」。';
    });
    $('export-model').addEventListener('click',()=>{
      try {
        const definition=this.validate();
        const url=URL.createObjectURL(new Blob([JSON.stringify(definition,null,2)+'\n'],{type:'application/json'}));
        const a=document.createElement('a');a.href=url;a.download=`${definition.id}_${definition.joints.length}dof.json`;a.click();
        setTimeout(()=>URL.revokeObjectURL(url),1000);
      } catch(error){$('geometry-error').textContent=error.message;}
    });
  }

  open(definition) {
    this.draft=structuredClone(definition);this.applied=false;
    const pending=this.draft.joints.findIndex(j=>!j.configured);
    this.page=Math.floor(Math.max(0,pending)/6);
    $('geometry-description').textContent=`${definition.label} · ${definition.joints.length} 轴。修改仅在「应用构型」后生效。`;
    const summary=$('geometry-summary');summary.replaceChildren();
    const notes=[...(definition.notes||[])];
    if(pending>=0)notes.unshift(`J${pending+1} 起有新关节待定义，已有关节的参数保留。`);
    if(definition.joints.some(j=>j.kind==='urdf'))notes.unshift('NERO 关节直接使用 URDF 原生变换；不将 xyz/rpy 误当作 DH。追加 DH 关节挂接到当前末端坐标系。');
    for(const text of notes){const p=document.createElement('p');p.textContent=text;summary.appendChild(p);}
    $('geometry-error').textContent='';this.renderRows();this.renderURDF();$('geometry-dialog').showModal();
    requestAnimationFrame(()=>($('geometry-rows').querySelector('.pending-row input:not(:disabled)')||$('geometry-rows').querySelector('input:not(:disabled)'))?.focus());
  }

  validate() {
    const definition=structuredClone(this.draft);
    for(const joint of definition.joints)if(joint.kind==='dh')joint.configured=['a','alpha','d','offset'].every(key=>typeof joint[key]==='number'&&Number.isFinite(joint[key]));
    return validateDefinition(definition);
  }

  renderRows() {
    const head=$('geometry-table-head');head.replaceChildren();
    const tr=document.createElement('tr');
    for(const label of ['关节 / 定义',...fields.map(x=>x[1])]){const th=document.createElement('th');th.textContent=label;tr.appendChild(th);}
    head.appendChild(tr);
    const rows=$('geometry-rows');rows.replaceChildren();
    const start=this.page*6,end=Math.min(this.draft.joints.length,start+6);
    for(let i=start;i<end;i++) {
      const joint=this.draft.joints[i],row=document.createElement('tr');row.dataset.joint=String(i);
      row.classList.toggle('pending-row',!joint.configured);
      const label=document.createElement('td');label.className='joint-cell';label.append(document.createTextNode(`J${String(i+1).padStart(2,'0')}`));
      const state=document.createElement('span');state.textContent=joint.kind==='urdf'?'URDF 原生':joint.configured?'标准 DH':'待定义 DH';label.appendChild(state);row.appendChild(label);
      for(const [key,title,scale] of fields) {
        if(joint.kind==='urdf'&&['a','alpha','d','offset'].includes(key)) {
          if(key!=='a')continue;
          const cell=document.createElement('td');cell.colSpan=4;cell.className='native-geometry';
          cell.textContent=`${joint.name}: origin + axis（原始参数见下方）`;row.appendChild(cell);continue;
        }
        const cell=document.createElement('td'),input=document.createElement('input');input.type='number';input.step='any';input.required=true;
        input.value=joint[key]===null||joint[key]===undefined?'':String(Number((joint[key]*scale).toPrecision(12)));
        input.dataset.field=key;input.dataset.joint=String(i);input.setAttribute('aria-label',`J${i+1} ${title}`);
        if(joint.kind==='urdf'&&['lower','upper','mass'].includes(key))input.disabled=true;
        input.addEventListener('input',()=>{
          joint[key]=input.value===''?null:Number(input.value)/scale;
          if(joint.kind==='dh') {
            joint.configured=['a','alpha','d','offset'].every(k=>typeof joint[k]==='number'&&Number.isFinite(joint[k]));
            row.classList.toggle('pending-row',!joint.configured);state.textContent=joint.configured?'标准 DH':'待定义 DH';
          }
          $('geometry-error').textContent='';
        });
        cell.appendChild(input);row.appendChild(cell);
      }
      rows.appendChild(row);
    }
    $('geometry-page-label').textContent=`${start+1}–${end} / ${this.draft.joints.length} 轴`;
    $('geometry-prev').disabled=this.page===0;$('geometry-next').disabled=end>=this.draft.joints.length;
    $('suggest-dh').hidden=!this.draft.joints.some(j=>j.kind==='dh');
  }

  renderURDF() {
    const joints=this.draft.joints.filter(j=>j.kind==='urdf');
    $('urdf-reference').hidden=!joints.length;const rows=$('urdf-rows');rows.replaceChildren();
    for(const joint of joints) {
      const row=document.createElement('tr');
      for(const text of [joint.name,`${joint.parent} → ${joint.child}`,joint.origin.xyz.join(' '),joint.origin.rpy.join(' '),joint.axis.join(' '),joint.mass]) {
        const cell=document.createElement('td');cell.textContent=text;row.appendChild(cell);
      }
      rows.appendChild(row);
    }
  }
}
