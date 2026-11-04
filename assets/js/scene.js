import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { RENDER_LIMIT } from './physics.js';
import { multiply, poseTransform } from './kinematics.js';

const Y=new THREE.Vector3(0,1,0);
const point=frame=>new THREE.Vector3(frame[3],frame[7],frame[11]);

export class RobotScene {
  constructor(container, engine, hero = false) {
    this.container = container;
    this.hero = hero;
    this.engine = engine;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(hero ? '#101114' : '#14151a');
    this.scene.fog = new THREE.Fog(this.scene.background, 7, 19);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', '可交互机械臂三维视图');
    this.camera = new THREE.PerspectiveCamera(32, 1, .01, 50);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = .075;
    this.controls.minDistance = .3;
    this.controls.maxDistance = 12;
    this.controls.maxPolarAngle = Math.PI * .49;
    this.resetCamera();
    this.scene.add(new THREE.HemisphereLight(0xb7c4dc, 0x43404a, 2.1));
    const key = new THREE.DirectionalLight(0xfff1df, 4.5);
    key.position.set(2, 6, 4); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.key=key;key.shadow.camera.left = -4; key.shadow.camera.right = 4;
    key.shadow.camera.top = 4; key.shadow.camera.bottom = -4;
    key.shadow.bias = -.0001; key.shadow.normalBias = .002;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xb6c6eb, 2.5); rim.position.set(-4, 3, -3); this.scene.add(rim);
    const orange = new THREE.PointLight(0xfead72, 3, 7); orange.position.set(1, 2, 2); this.scene.add(orange);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({color:hero ? '#101114' : '#14151a', roughness: .95, metalness:.1}));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -.012; floor.receiveShadow = true; this.scene.add(floor);
    this.grid = new THREE.GridHelper(12, 48, 0x3b3a40, hero ? 0x24252a : 0x292b33);
    this.grid.material.transparent = true; this.grid.material.opacity = hero ? .3 : .34; this.grid.position.y = -.004; this.scene.add(this.grid);
    // A restrained platform with mounting screws grounds the model visually.
    this.materials = {
      orange: new THREE.MeshStandardMaterial({color:0xe67834, roughness:.38, metalness:.22}),
      white: new THREE.MeshStandardMaterial({color:0xe5e6e4, roughness:.34, metalness:.35}),
      dark: new THREE.MeshStandardMaterial({color:0x24262c, roughness:.42, metalness:.55}),
      metal: new THREE.MeshStandardMaterial({color:0x8f9299, roughness:.27, metalness:.85}),
    };
    this.robot = new THREE.Group(); this.scene.add(this.robot);
    this.linkGeo = new THREE.BoxGeometry(1, 1, 1);
    this.cylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 32);
    this.jointGeo = new THREE.CylinderGeometry(1, 1, 1, 48);
    this.visualGeometries=[];this.visualMaterials=[];
    this.buildRobot(engine);
    this.trailPositions = new Float32Array(500 * 3);
    this.trailCount = 0;
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3)); trailGeo.setDrawRange(0, 0);
    this.trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({color:0xfa8b50, transparent:true, opacity:.45}));
    this.trail.frustumCulled = false; this.trail.visible = !hero; this.scene.add(this.trail);
    this.lastTip = new THREE.Vector3(Infinity, 0, 0);
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(container);
    this.resize();
  }

  mesh(geometry, material, parent, scale, position) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.set(...scale); mesh.position.set(...position); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }

  createSegment(parent,slim,material=this.materials.white) {
    const group=new THREE.Group();parent.add(group);
    const body=this.mesh(this.linkGeo,material,group,[slim*1.6,1,slim*1.35],[0,0,0]);
    const stripe=this.mesh(this.linkGeo,this.materials.dark,group,[slim*1.64,.68,slim*.48],[0,0,0]);
    stripe.visible=this.detailed;
    return {group,body,stripe,slim};
  }

  placeSegment(segment,a,b) {
    const direction=b.clone().sub(a),length=direction.length();
    segment.group.visible=length>.008;
    if(!segment.group.visible)return;
    segment.group.position.copy(a).add(b).multiplyScalar(.5);
    segment.group.quaternion.setFromUnitVectors(Y,direction.normalize());
    segment.group.scale.y=length;
  }

  buildRobot(engine) {
    this.engine=engine;
    for(const geometry of this.visualGeometries)geometry.dispose();
    for(const material of this.visualMaterials)material.dispose();
    this.visualGeometries=[];this.visualMaterials=[];
    this.robot.clear();this.joints=[];this.linkSegments=[];this.visualMeshes=[];
    const m=this.materials,count=Math.min(engine.n,RENDER_LIMIT);
    this.detailed=count<=16;
    const native=engine.definition.joints.some(j=>j.kind==='urdf');
    this.slim=native?.025:.045;
    const sourceVisuals=engine.definition.renderVisuals||[];
    const visualAnchors=new Set(sourceVisuals.map(v=>v.anchor));
    this.base=new THREE.Group();this.robot.add(this.base);
    this.base.visible=!visualAnchors.has(-1);
    const baseWidth=native?.23:.4;
    this.mesh(this.linkGeo,m.dark,this.base,[baseWidth,.025,baseWidth],[0,.012,0]);
    this.mesh(this.cylinderGeo,m.orange,this.base,[baseWidth*.29,.052,baseWidth*.29],[0,.05,0]);
    this.mesh(this.cylinderGeo,m.dark,this.base,[baseWidth*.23,.004,baseWidth*.23],[0,.078,0]);
    for(const x of [-1,1])for(const z of [-1,1]) {
      this.mesh(this.cylinderGeo,m.metal,this.base,[.005,.003,.005],[x*baseWidth*.36,.025,z*baseWidth*.36]);
    }
    this.mount=this.createSegment(this.base,native?.032:.05,m.orange);
    for(let i=0;i<count;i++) {
      const joint=new THREE.Group();this.robot.add(joint);this.joints.push(joint);
      joint.visible=!visualAnchors.has(i);
      const slim=this.slim,material=i%3===1?m.orange:m.white;
      this.mesh(this.jointGeo,material,joint,[slim*1.6,slim*2.4,slim*1.6],[0,0,0]);
      this.mesh(this.jointGeo,m.dark,joint,[slim,slim*2.5,slim],[0,0,0]);
      this.mesh(this.jointGeo,m.metal,joint,[slim*.45,slim*2.55,slim*.45],[0,0,0]);
      const segments=[this.createSegment(this.robot,slim,material),this.createSegment(this.robot,slim,material)];
      segments.forEach(segment=>segment.fallback=!visualAnchors.has(i));this.linkSegments.push(segments);
    }
    for(const visual of sourceVisuals) {
      if(visual.anchor>=count)continue;
      let geometry;
      if(visual.type==='box')geometry=new THREE.BoxGeometry(...visual.size);
      if(visual.type==='sphere')geometry=new THREE.SphereGeometry(visual.radius,32,20);
      if(visual.type==='cylinder'){geometry=new THREE.CylinderGeometry(visual.radius,visual.radius,visual.length,40);geometry.rotateX(Math.PI/2);}
      const [r,g,b,opacity]=visual.color||[.72,.76,.82,1];
      const material=new THREE.MeshStandardMaterial({color:new THREE.Color(r,g,b),opacity,transparent:opacity<1,roughness:.35,metalness:.2});
      this.visualGeometries.push(geometry);this.visualMaterials.push(material);
      const mesh=this.mesh(geometry,material,this.robot,[1,1,1],[0,0,0]);
      mesh.matrixAutoUpdate=false;
      this.visualMeshes.push({mesh,anchor:visual.anchor,local:multiply(visual.attachment,poseTransform(visual.origin))});
    }
    this.end=new THREE.Group();this.robot.add(this.end);
    this.endIllustrative=!visualAnchors.has(engine.n-1);
    if(native) {
      const flange=this.mesh(this.cylinderGeo,m.orange,this.end,[.017,.025,.017],[0,0,0]);flange.rotation.x=Math.PI/2;
      const face=this.mesh(this.cylinderGeo,m.metal,this.end,[.012,.003,.012],[0,0,.013]);face.rotation.x=Math.PI/2;
    } else for(const side of [-1,1]) {
      this.mesh(this.linkGeo,m.metal,this.end,[.018,.028,.09],[side*.035,0,.04]);
      this.mesh(this.linkGeo,m.dark,this.end,[.025,.028,.022],[side*.025,0,.085]);
    }
    this.update(false);
    if(this.trail)this.clearTrail();this.resetCamera();
  }

  resetCamera() {
    const points=this.engine.points,count=Math.min(this.engine.n,RENDER_LIMIT);
    const bounds=new THREE.Box3();bounds.expandByPoint(new THREE.Vector3(0,0,0));
    for(let i=0;i<=count;i++)bounds.expandByPoint(new THREE.Vector3(...points.slice(i*3,i*3+3)));
    const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
    const radius=Math.max(.65,size.length());
    if(this.robot){
      this.robot.updateMatrixWorld(true);
      this.robot.traverseVisible(object=>{
        if(!object.isMesh)return;
        if(!object.geometry.boundingBox)object.geometry.computeBoundingBox();
        bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
      });
      bounds.getCenter(center);bounds.getSize(size);
    }
    const fitRadius=Math.max(radius,size.length());
    this.camera.position.copy(center).add(new THREE.Vector3(fitRadius*1.05,fitRadius*.75,fitRadius*1.45));
    this.camera.far=Math.max(50,fitRadius*10);this.camera.updateProjectionMatrix();
    this.controls.maxDistance=Math.max(12,fitRadius*6);this.controls.target.copy(center);this.controls.update();
    if(this.key){const span=Math.max(1,fitRadius*1.5);Object.assign(this.key.shadow.camera,{left:-span,right:span,top:span,bottom:-span});this.key.shadow.camera.updateProjectionMatrix();this.grid.scale.setScalar(Math.max(.3,fitRadius*.4));this.key.target.position.copy(center);this.key.target.updateMatrixWorld();}
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w,h,false); this.camera.aspect=w/h; this.camera.updateProjectionMatrix();
  }

  clearTrail() { this.trailCount=0; this.trail.geometry.setDrawRange(0,0); this.lastTip.set(Infinity,0,0); }

  update(record = true) {
    const engine = this.engine;
    const baseFrame=poseTransform(engine.definition.base);
    if(this.mount){
      const origin=new THREE.Vector3(...engine.chain.origins[0]);
      this.base.position.set(baseFrame[3],0,baseFrame[11]);
      const local=origin.clone().sub(this.base.position);
      this.placeSegment(this.mount,new THREE.Vector3(0,.077,0),local);
    }
    for(let i=0;i<this.joints.length;i++) {
      const origin=new THREE.Vector3(...engine.chain.origins[i]);
      const frame=engine.chain.frames[i],axis=new THREE.Vector3(...engine.chain.axes[i]);
      const joint=engine.definition.joints[i];
      this.joints[i].position.copy(joint.motion==='prismatic'?point(frame):origin);
      this.joints[i].quaternion.setFromRotationMatrix(new THREE.Matrix4().set(...frame));
      const localAxis=new THREE.Vector3(...(joint.kind==='dh'?[0,0,1]:joint.axis)).normalize();
      // Native frame rotation keeps cover details attached to the moving link.
      if(joint.kind==='urdf')this.joints[i].quaternion.multiply(new THREE.Quaternion().setFromUnitVectors(Y,localAxis));
      else this.joints[i].quaternion.setFromUnitVectors(Y,axis);
      let ends;
      if(joint.kind==='dh') {
        const f=engine.chain.preFrames[i],corner=new THREE.Vector3(f[3]+f[2]*joint.d,f[7]+f[6]*joint.d,f[11]+f[10]*joint.d);
        ends=[[origin,corner],[corner,point(frame)]];
      } else {
        const end=new THREE.Vector3(...(i+1<engine.n?engine.chain.origins[i+1]:engine.chain.tip));
        ends=joint.motion==='prismatic'?[[origin,point(frame)],[point(frame),end]]:[[origin,end],[origin,origin]];
      }
      ends.forEach(([a,b],leg)=>{
        const segment=this.linkSegments[i][leg];this.placeSegment(segment,a,b);
        if(!segment.fallback)segment.group.visible=false;
      });
    }
    for(const {mesh,anchor,local} of this.visualMeshes)mesh.matrix.set(...multiply(anchor<0?baseFrame:engine.chain.frames[anchor],local));
    if(this.end){this.end.visible=this.endIllustrative&&engine.n<=RENDER_LIMIT;this.end.position.set(...engine.chain.tip);this.end.quaternion.setFromRotationMatrix(new THREE.Matrix4().set(...engine.chain.tipFrame));}
    if (record && this.trail?.visible && engine.n <= RENDER_LIMIT) {
      const k = engine.n * 3, tip = new THREE.Vector3(...engine.points.slice(k,k+3));
      if (tip.distanceToSquared(this.lastTip) > .000025) {
        if (this.trailCount === 500) { this.trailPositions.copyWithin(0,3); this.trailCount--; }
        this.trailPositions.set(tip.toArray(),this.trailCount * 3); this.trailCount++;
        this.trail.geometry.attributes.position.needsUpdate = true; this.trail.geometry.setDrawRange(0,this.trailCount); this.lastTip.copy(tip);
      }
    }
    this.controls.update(); this.renderer.render(this.scene,this.camera);
  }
}
