import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { RENDER_LIMIT } from './physics.js';

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
    key.shadow.camera.left = -4; key.shadow.camera.right = 4;
    key.shadow.camera.top = 4; key.shadow.camera.bottom = -4;
    key.shadow.bias = -.001; key.shadow.normalBias = .03;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xb6c6eb, 2.5); rim.position.set(-4, 3, -3); this.scene.add(rim);
    const orange = new THREE.PointLight(0xfead72, 3, 7); orange.position.set(1, 2, 2); this.scene.add(orange);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({color:hero ? '#101114' : '#14151a', roughness: .95, metalness:.1}));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -.012; floor.receiveShadow = true; this.scene.add(floor);
    this.grid = new THREE.GridHelper(12, 48, 0x3b3a40, hero ? 0x24252a : 0x292b33);
    this.grid.material.transparent = true; this.grid.material.opacity = hero ? .48 : .65; this.grid.position.y = -.004; this.scene.add(this.grid);
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
    this.jointGeo = new THREE.CylinderGeometry(1, 1, 1, 24);
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

  buildRobot(engine) {
    this.engine = engine;
    this.robot.clear();this.joints=[];this.linkSegments=[];
    const m=this.materials,count=Math.min(engine.n,RENDER_LIMIT);
    const native=engine.definition.joints.some(j=>j.kind==='urdf');
    this.slim=native ? .025 : .045;
    const baseWidth=native ? .23 : .4,baseHeight=engine.definition.base.xyz[1];
    this.mesh(this.linkGeo,m.dark,this.robot,[baseWidth,.025,baseWidth],[0,.012,0]);
    this.mesh(this.cylinderGeo,m.orange,this.robot,[baseWidth*.29,Math.max(.035,baseHeight-.025),baseWidth*.29],[0,baseHeight*.5,0]);
    for(let i=0;i<count;i++) {
      const joint=new THREE.Group();this.robot.add(joint);this.joints.push(joint);
      const slim=this.slim;
      this.mesh(this.jointGeo,i%3===1?m.orange:m.white,joint,[slim*1.6,slim*2.4,slim*1.6],[0,0,0]);
      this.mesh(this.jointGeo,m.dark,joint,[slim,slim*2.5,slim],[0,0,0]);
      this.mesh(this.jointGeo,m.metal,joint,[slim*.45,slim*2.55,slim*.45],[0,0,0]);
      const segments=[];
      for(let leg=0;leg<2;leg++) {
        const body=this.mesh(this.linkGeo,i%3===1?m.orange:m.white,this.robot,[1,1,1],[0,0,0]);
        const stripe=this.mesh(this.linkGeo,m.dark,this.robot,[1,1,1],[0,0,0]);
        segments.push({body,stripe});
      }
      this.linkSegments.push(segments);
    }
    this.end=new THREE.Group();this.robot.add(this.end);
    // Skeleton marker for URDF; a gripper is only decorative on generic DH models.
    if(native)this.mesh(this.jointGeo,m.orange,this.end,[.017,.025,.017],[0,0,0]);
    else for(const side of [-1,1]) {
      this.mesh(this.linkGeo,m.metal,this.end,[.018,.028,.09],[side*.035,0,.04]);
      this.mesh(this.linkGeo,m.dark,this.end,[.025,.028,.022],[side*.025,0,.085]);
    }
    this.update(false);
    if (this.trail) this.clearTrail();
    this.resetCamera();
  }

  resetCamera() {
    const points=this.engine.points,count=Math.min(this.engine.n,RENDER_LIMIT);
    const bounds=new THREE.Box3();bounds.expandByPoint(new THREE.Vector3(0,0,0));
    for(let i=0;i<=count;i++)bounds.expandByPoint(new THREE.Vector3(...points.slice(i*3,i*3+3)));
    const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
    const radius=Math.max(.65,size.length());
    this.camera.position.copy(center).add(new THREE.Vector3(radius*1.1,radius*.8,radius*1.5));
    this.camera.far=Math.max(50,radius*10);this.camera.updateProjectionMatrix();
    this.controls.maxDistance=Math.max(12,radius*6);this.controls.target.copy(center);this.controls.update();
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w,h,false); this.camera.aspect=w/h; this.camera.updateProjectionMatrix();
  }

  clearTrail() { this.trailCount=0; this.trail.geometry.setDrawRange(0,0); this.lastTip.set(Infinity,0,0); }

  update(record = true) {
    const engine = this.engine;
    for (let i = 0; i < this.joints.length; i++) {
      const origin=new THREE.Vector3(...engine.chain.origins[i]);
      this.joints[i].position.copy(origin);
      this.joints[i].quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(...engine.chain.axes[i]));
      const joint=engine.definition.joints[i];
      let ends;
      if(joint.kind==='dh') {
        const f=engine.chain.preFrames[i],corner=new THREE.Vector3(f[3]+f[2]*joint.d,f[7]+f[6]*joint.d,f[11]+f[10]*joint.d);
        const end=new THREE.Vector3(engine.chain.frames[i][3],engine.chain.frames[i][7],engine.chain.frames[i][11]);
        ends=[[origin,corner],[corner,end]];
      } else {
        const end=new THREE.Vector3(...(i+1<engine.n?engine.chain.origins[i+1]:engine.chain.tip));
        ends=[[origin,end],[origin,origin]];
      }
      ends.forEach(([a,b],leg)=>{
        const {body,stripe}=this.linkSegments[i][leg],direction=b.clone().sub(a),length=direction.length();
        body.visible=stripe.visible=length>.001;
        if(length<=.001)return;
        body.position.copy(a).add(b).multiplyScalar(.5);body.scale.set(this.slim*1.6,length,this.slim*1.35);
        body.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());
        stripe.position.copy(body.position);stripe.quaternion.copy(body.quaternion);stripe.scale.set(this.slim*1.64,length*.68,this.slim*.48);
      });
    }
    if(this.end){this.end.visible=engine.n<=RENDER_LIMIT;this.end.position.set(...engine.chain.tip);this.end.quaternion.setFromRotationMatrix(new THREE.Matrix4().set(...engine.chain.tipFrame));}
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
