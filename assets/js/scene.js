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
    this.controls.minDistance = 1.3;
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
    // Shared geometries/materials are kept; only obsolete meshes are removed.
    this.robot.clear(); this.joints = [];
    const m = this.materials;
    this.mesh(this.linkGeo, m.dark, this.robot, [.66,.055,.66], [0,.027,0]);
    for (const x of [-.27,.27]) for (const z of [-.27,.27]) this.mesh(this.cylinderGeo,m.metal,this.robot,[.024,.01,.024],[x,.06,z]);
    this.mesh(this.cylinderGeo,m.dark,this.robot,[.23,.15,.23],[0,.13,0]);
    this.mesh(this.cylinderGeo,m.orange,this.robot,[.2,.24,.2],[0,.3,0]);
    this.mesh(this.cylinderGeo,m.metal,this.robot,[.2,.025,.2],[0,.43,0]);
    let parent = this.robot;
    const count = Math.min(engine.n, RENDER_LIMIT), slim = Math.max(.014, engine.n > 7 ? .09 * 6 / engine.n : .09);
    for (let i = 0; i < count; i++) {
      const joint = new THREE.Group();
      joint.position.set(i === 0 ? 0 : engine.lengths[i - 1],i === 0 ? .49 : 0,0);
      parent.add(joint); this.joints.push(joint);
      const length = engine.lengths[i];
      const hub = this.mesh(this.jointGeo,i % 3 === 1 ? m.orange : m.white,joint,[slim * 1.55,slim * 2.4,slim * 1.55],[0,0,0]);
      if (i > 0) hub.rotation.x = Math.PI / 2;
      const cap = this.mesh(this.jointGeo,m.dark,joint,[slim * .95,slim * 2.48,slim * .95],[0,0,0]);
      if (i > 0) cap.rotation.x = Math.PI / 2;
      const pin = this.mesh(this.jointGeo,m.metal,joint,[slim * .43,slim * 2.52,slim * .43],[0,0,0]);
      if (i > 0) pin.rotation.x = Math.PI / 2;
      this.mesh(this.linkGeo,i === 0 || i % 3 === 1 ? m.orange : m.white,joint,[Math.max(length - slim * .7, .006),slim * 1.9,slim * 1.55],[length * .5,0,0]);
      if (length > .18) {
        this.mesh(this.linkGeo,m.dark,joint,[length * .68,slim * .5,slim * 1.58],[length * .5,0,0]);
        this.mesh(this.linkGeo,m.metal,joint,[length * .5,.009,slim * .7],[length * .5,slim * .965,0]);
      }
      parent = joint;
    }
    const end = new THREE.Group(); end.position.x = engine.lengths[count - 1]; parent.add(end);
    this.mesh(this.jointGeo,m.dark,end,[slim,.1,slim],[.045,0,0]).rotation.z = Math.PI / 2;
    for (const z of [-1,1]) {
      this.mesh(this.linkGeo,m.metal,end,[.13,.035,.025],[.13,0,z * .075]);
      this.mesh(this.linkGeo,m.dark,end,[.03,.035,.08],[.2,0,z * .05]);
    }
    this.update(false);
    if (this.trail) this.clearTrail();
  }

  resetCamera() {
    this.camera.position.set(this.hero ? 2.65 : 2.8, this.hero ? 2.1 : 2.2, this.hero ? 3.8 : 4.0);
    this.controls.target.set(.7,.85,0); this.controls.update();
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
      if (i === 0) this.joints[i].rotation.y = engine.q[i];
      else this.joints[i].rotation.z = engine.q[i];
    }
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
