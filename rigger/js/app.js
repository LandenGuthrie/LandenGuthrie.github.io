// ============================================================
// RIGGER — main application
// ============================================================
import * as THREE from 'three';
import { OrbitControls }     from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader }        from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader }         from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader }         from 'three/addons/loaders/OBJLoader.js';
import { GLTFExporter }      from 'three/addons/exporters/GLTFExporter.js';
import { mergeVertices }     from 'three/addons/utils/BufferGeometryUtils.js';
import { buildTemplate, DISPLAY_ORDER } from './template.js';

// ---------- global state ----------
const S = {
  step: 'upload',
  fingers: 5,
  symmetry: true,
  model: null,          // root Object3D (display)
  meshes: [],           // original meshes
  size: new THREE.Vector3(),
  center: new THREE.Vector3(),
  bbox: null,
  joints: [],           // [{id,parent,mirror, pos:Vector3, marker, boneIndex}]
  jointMap: new Map(),
  bones: null,          // {group, skeleton, rootBone, boneList}
  skinned: [],          // SkinnedMesh list
  selected: null,       // selected joint id
  weightBone: null,     // bone index being painted
  brush: { radius: 0.12, strength: 0.5, add: true },
  origMaterials: new Map(),
  maxDone: 0,           // furthest unlocked step index
  coreJoints: [],       // editable body joints (no fingers)
  coreMap: new Map(),
};
const STEPS = ['upload', 'points', 'bones', 'weights', 'export'];

// ---------- three.js scene ----------
const viewport = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(viewport.clientWidth, viewport.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const SCENE_GRAY = 0x44474c;
scene.background = new THREE.Color(SCENE_GRAY);
// fog: distant geometry (the big grid) fades into the gray background
scene.fog = new THREE.Fog(SCENE_GRAY, 7, 26);

const aspect0 = viewport.clientWidth / viewport.clientHeight;
const perspCam = new THREE.PerspectiveCamera(45, aspect0, 0.01, 100);
perspCam.position.set(1.6, 1.4, 3.4);

// orthographic camera for the Blender-style axis views
let orthoSize = 1.4;
const orthoCam = new THREE.OrthographicCamera(-aspect0 * orthoSize, aspect0 * orthoSize, orthoSize, -orthoSize, -50, 100);
orthoCam.position.copy(perspCam.position);

let activeCam = perspCam;

// lights — neutral white, no blue tint on the model
scene.add(new THREE.HemisphereLight(0xf2f2f2, 0x3a3a3a, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(3, 6, 4); scene.add(key);
const rim = new THREE.DirectionalLight(0xffffff, 0.5); rim.position.set(-4, 2, -3); scene.add(rim);

// large ground grid (fades out through fog → reads as infinite)
const grid = new THREE.GridHelper(40, 80, 0x6a6e74, 0x3a3d42);
grid.material.transparent = true; grid.material.opacity = 0.65;
scene.add(grid);

// ---------- controls: middle=orbit, wheel=zoom, left=pan ----------
const controls = new OrbitControls(activeCam, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.ROTATE };
controls.target.set(0, 0.9, 0);

const gizmo = new TransformControls(activeCam, renderer.domElement);
gizmo.setSize(0.7);
gizmo.addEventListener('dragging-changed', e => { controls.enabled = !e.value; });
gizmo.addEventListener('objectChange', onGizmoMove);
scene.add(gizmo);

// ---------- camera view switching (orthographic snaps → perspective on orbit) ----------
const VIEW_DIRS = {
  front: [0, 0, 1], back: [0, 0, -1], right: [1, 0, 0],
  left: [-1, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0],
};

function setView(name) {
  const d = VIEW_DIRS[name]; if (!d) return;
  const dist = (S.size.length() || 3) * 1.2;
  const dir = new THREE.Vector3(d[0], d[1], d[2]);
  updateOrthoFrustum();
  orthoCam.position.copy(controls.target).add(dir.multiplyScalar(dist));
  orthoCam.up.set(0, 1, 0);
  if (name === 'top') orthoCam.up.set(0, 0, -1);
  if (name === 'bottom') orthoCam.up.set(0, 0, 1);
  orthoCam.lookAt(controls.target);
  activeCam = orthoCam;
  controls.object = orthoCam;
  gizmo.camera = orthoCam;
  controls.update();
}

function toPerspective() {
  if (activeCam === perspCam) return;
  const dir = orthoCam.position.clone().sub(controls.target).normalize();
  const dist = (S.size.length() || 3) * 1.1;
  perspCam.position.copy(controls.target).add(dir.multiplyScalar(dist));
  perspCam.up.set(0, 1, 0);
  activeCam = perspCam;
  controls.object = perspCam;
  gizmo.camera = perspCam;
  controls.update();
}

function updateOrthoFrustum() {
  const aspect = viewport.clientWidth / viewport.clientHeight;
  orthoSize = (S.size.y || 2) * 0.7;
  orthoCam.left = -aspect * orthoSize; orthoCam.right = aspect * orthoSize;
  orthoCam.top = orthoSize; orthoCam.bottom = -orthoSize;
  orthoCam.updateProjectionMatrix();
}

document.querySelectorAll('#viewcube button').forEach(b =>
  b.onclick = () => setView(b.dataset.view));

// ---------- render loop ----------
function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  renderer.setSize(w, h);
  perspCam.aspect = w / h; perspCam.updateProjectionMatrix();
  updateOrthoFrustum();
}
window.addEventListener('resize', resize);

// keep point/joint handles a roughly constant on-screen size
// (so when you zoom in close, they shrink in world space instead of ballooning)
let boneVis = null;       // bone visualization group (assigned in rebuildBoneVis)
let connectorLines = null;
const _hv = new THREE.Vector3();
const HANDLE_C = 0.011;   // on-screen handle size (fraction of view)
function updateHandleScales() {
  const orthoWorld = (orthoCam.top - orthoCam.bottom) / orthoCam.zoom * HANDLE_C;
  const apply = obj => {
    if (!obj) return;
    let s;
    if (activeCam.isOrthographicCamera) {
      s = orthoWorld;
    } else {
      obj.getWorldPosition(_hv);
      s = _hv.distanceTo(activeCam.position) * HANDLE_C;   // closer ⇒ smaller in world
    }
    obj.scale.setScalar(Math.max(s, 1e-4));
  };
  if (S.pointsGroup && S.pointsGroup.visible) S.pointsGroup.children.forEach(apply);
  if (boneVis && boneVis.visible) boneVis.children.forEach(c => { if (c.userData.isJointBall) apply(c); });
}

function tick() {
  requestAnimationFrame(tick);
  controls.update();
  updateHandleScales();
  renderer.render(scene, activeCam);
}
tick();

// ============================================================
//  MODEL LOADING
// ============================================================
const fileInput = document.getElementById('file-input');
const dropzone  = document.getElementById('dropzone');

// the browse button sits inside the dropzone, so stop its click from also
// bubbling to the dropzone (which would open the file dialog a second time
// and cancel the first selection — the "have to upload twice" bug).
document.getElementById('browse-btn').onclick = e => { e.stopPropagation(); fileInput.click(); };
fileInput.onchange = e => {
  const file = e.target.files[0];
  e.target.value = '';                 // allow re-selecting the same file later
  if (file) loadFile(file);
};

['dragenter', 'dragover'].forEach(ev =>
  dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add('hot'); }));
['dragleave', 'drop'].forEach(ev =>
  dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove('hot'); }));
dropzone.addEventListener('drop', e => { if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
dropzone.addEventListener('click', () => fileInput.click());

async function loadFile(file) {
  veil(true, 'Loading model…');
  const ext = file.name.split('.').pop().toLowerCase();
  const url = URL.createObjectURL(file);
  try {
    let root;
    if (ext === 'glb' || ext === 'gltf') {
      const gltf = await new GLTFLoader().loadAsync(url);
      root = gltf.scene;
    } else if (ext === 'fbx') {
      root = await new FBXLoader().loadAsync(url);
    } else if (ext === 'obj') {
      const txt = await file.text();
      root = new OBJLoader().parse(txt);
    } else {
      throw new Error('Unsupported file type: .' + ext);
    }
    installModel(root);
    toast(`Loaded ${file.name}`);
  } catch (err) {
    console.error(err);
    toast('Could not load: ' + err.message);
  } finally {
    veil(false);
    URL.revokeObjectURL(url);
  }
}

function installModel(root) {
  // clear previous
  if (S.model) scene.remove(S.model);
  S.meshes = [];

  // normalize: recenter on ground, scale to ~1.8 tall
  root.updateWorldMatrix(true, true);
  let box = new THREE.Box3().setFromObject(root);
  const sz = box.getSize(new THREE.Vector3());
  const scale = 1.8 / (sz.y || 1);
  root.scale.multiplyScalar(scale);
  root.updateWorldMatrix(true, true);
  box = new THREE.Box3().setFromObject(root);
  const c = box.getCenter(new THREE.Vector3());
  root.position.x -= c.x;
  root.position.z -= c.z;
  root.position.y -= box.min.y;
  root.updateWorldMatrix(true, true);

  root.traverse(o => {
    if (o.isMesh) {
      // Respect normals exported from Blender (smooth shading). Only synthesize
      // them when missing — welding split vertices first so the result is smooth,
      // not faceted.
      if (!o.geometry.attributes.normal) {
        try { o.geometry = mergeVertices(o.geometry); } catch (_) {}
        o.geometry.computeVertexNormals();
      }
      S.meshes.push(o);
      o.castShadow = o.receiveShadow = true;
    }
  });

  S.model = root;
  scene.add(root);

  S.bbox   = new THREE.Box3().setFromObject(root);
  S.size   = S.bbox.getSize(new THREE.Vector3());
  S.center = S.bbox.getCenter(new THREE.Vector3());

  controls.target.set(0, S.size.y * 0.5, 0);
  frameCamera();

  S.maxDone = Math.max(S.maxDone, 1);
  dropzone.classList.add('hidden');
  goStep('points');
}

function frameCamera() {
  const r = S.size.length() * 0.9 || 3;
  toPerspective();
  perspCam.position.set(r * 0.45, S.size.y * 0.55, r * 0.85);
  controls.update();
  updateOrthoFrustum();
}

// ============================================================
//  POINTS  — auto-place template, drag with gizmo
// ============================================================
function buildPoints() {
  clearPoints();
  // body points only — fingers are generated automatically from these later
  const tpl = buildTemplate(0);
  S.coreJoints = [];
  S.coreMap = new Map();

  const b = S.bbox;
  const place = (nx, ny, nz) => new THREE.Vector3(
    (b.min.x + b.max.x) / 2 + nx * S.size.x,
    b.min.y + ny * S.size.y,
    (b.min.z + b.max.z) / 2 + nz * S.size.z,
  );

  const group = new THREE.Group(); group.name = 'points';
  for (const t of tpl) {
    const pos = place(t.x, t.y, t.z);
    const marker = makeMarker();
    marker.position.copy(pos);
    marker.userData.id = t.id;
    group.add(marker);
    const j = { id: t.id, parent: t.parent, mirror: t.mirror, pos, marker };
    S.coreJoints.push(j);
    S.coreMap.set(t.id, j);
  }
  scene.add(group);
  S.pointsGroup = group;
  // during the points step the working joint set is just the body
  S.joints = S.coreJoints;
  S.jointMap = S.coreMap;
  drawConnectors();
}

// Build the full joint set (body + auto-placed fingers) for the skeleton.
function refreshSkeletonJoints() {
  const fingers = generateFingerJoints(S.fingers);
  S.joints = [...S.coreJoints, ...fingers];
  S.jointMap = new Map(S.joints.map(j => [j.id, j]));
}

// Derive finger joints from the hand + forearm points (no manual finger handles).
function generateFingerJoints(count) {
  if (count <= 0) return [];
  const out = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (const side of ['L', 'R']) {
    const hand = S.coreMap.get('hand.' + side);
    const fore = S.coreMap.get('lowerarm.' + side);
    if (!hand || !fore) continue;
    const armDir = hand.pos.clone().sub(fore.pos);
    const handLen = armDir.length() || 0.1;
    armDir.normalize();
    let spread = new THREE.Vector3().crossVectors(armDir, up);
    if (spread.lengthSq() < 1e-6) spread.set(0, 0, 1);
    spread.normalize();
    const fLen = handLen * 0.6;
    const names = count === 3 ? ['thumb', 'index', 'middle'] : ['thumb', 'index', 'middle', 'ring', 'pinky'];
    const spreads = count === 3 ? [0.55, 0.05, -0.4] : [0.6, 0.25, 0.0, -0.22, -0.42];
    names.forEach((nm, i) => {
      const off = spread.clone().multiplyScalar(spreads[i] * handLen * 0.5);
      const base = hand.pos.clone()
        .add(armDir.clone().multiplyScalar(handLen * 0.12))
        .add(off);
      let dir = armDir.clone();
      if (nm === 'thumb') dir = armDir.clone().multiplyScalar(0.6).add(spread.clone().multiplyScalar(0.8)).normalize();
      const lenMul = nm === 'pinky' ? 0.7 : nm === 'thumb' ? 0.6 : 1;
      const tip = base.clone().add(dir.multiplyScalar(fLen * lenMul));
      const other = side === 'L' ? 'R' : 'L';
      out.push({ id: `${nm}.${side}`, parent: `hand.${side}`, mirror: `${nm}.${other}`, pos: base });
      out.push({ id: `${nm}_tip.${side}`, parent: `${nm}.${side}`, mirror: `${nm}_tip.${other}`, pos: tip });
    });
  }
  return out;
}

function makeMarker() {
  const g = new THREE.SphereGeometry(1, 16, 12);   // unit radius; sized per-frame
  const m = new THREE.MeshBasicMaterial({ color: 0x84d68f, depthTest: false, transparent: true, fog: false });
  const mesh = new THREE.Mesh(g, m);
  mesh.scale.setScalar(0.02);
  mesh.renderOrder = 999;
  return mesh;
}

function drawConnectors() {
  if (connectorLines) { scene.remove(connectorLines); connectorLines.geometry.dispose(); }
  const pts = [];
  for (const j of S.joints) {
    if (!j.parent) continue;
    const p = S.jointMap.get(j.parent);
    if (p) { pts.push(j.pos.clone(), p.pos.clone()); }
  }
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  const m = new THREE.LineBasicMaterial({ color: 0x4a505a, depthTest: false, transparent: true, opacity: 0.8, fog: false });
  connectorLines = new THREE.LineSegments(g, m);
  connectorLines.renderOrder = 998;
  connectorLines.name = 'connectors';
  scene.add(connectorLines);
}

function clearPoints() {
  if (S.pointsGroup) { scene.remove(S.pointsGroup); S.pointsGroup = null; }
  if (connectorLines) { scene.remove(connectorLines); connectorLines = null; }
  gizmo.detach();
}

// ============================================================
//  PICKING (markers) + gizmo + symmetry
// ============================================================
const raycaster = new THREE.Raycaster();
raycaster.params.Line.threshold = 0.02;
const ndc = new THREE.Vector2();

function pointerNDC(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
}

renderer.domElement.addEventListener('pointerdown', e => {
  // orbiting (middle drag) leaves any axis-locked orthographic view
  if (e.button === 1) { toPerspective(); return; }
  if (e.button !== 0) return;           // only left interacts
  if (gizmo.dragging) return;

  if (S.step === 'points' || S.step === 'bones') {
    pointerNDC(e);
    raycaster.setFromCamera(ndc, activeCam);
    const markers = S.coreJoints.map(j => j.marker);
    const hit = raycaster.intersectObjects(markers, false)[0];
    if (hit) {
      controls.enabled = false;          // capture this drag for the gizmo
      selectJoint(hit.object.userData.id);
      setTimeout(() => controls.enabled = true, 0);
    }
  } else if (S.step === 'weights' && S.weightBone != null) {
    beginPaint(e);
  }
}, true);

function selectJoint(id) {
  const j = S.coreMap.get(id);
  if (!j || !j.marker) return;          // only body points are grabbable
  S.selected = id;
  gizmo.attach(j.marker);
  // highlight
  for (const jj of S.coreJoints) jj.marker.material.color.set(jj.id === id ? 0xffffff : 0x84d68f);
  if (S.step === 'bones') toolsBones();
}

function onGizmoMove() {
  if (!S.selected) return;
  const j = S.coreMap.get(S.selected);
  if (!j) return;
  j.pos.copy(j.marker.position);

  if (S.symmetry && j.mirror) {
    const m = S.coreMap.get(j.mirror);
    if (m) {
      m.pos.set(-j.pos.x, j.pos.y, j.pos.z);
      m.marker.position.copy(m.pos);
    }
  }
  drawConnectors();
  // in the bones step, regenerate fingers from the moved hand and redraw
  if (S.step === 'bones') { refreshSkeletonJoints(); rebuildBoneVis(); }
}

// ============================================================
//  BONES — build real THREE.Bone tree + minimalist visualization
// ============================================================
function buildBones() {
  if (S.bones) disposeBones();

  const boneMap = new Map();
  const boneList = [];
  // create bones in template order
  for (const j of S.joints) {
    const bone = new THREE.Bone();
    bone.name = j.id;
    boneMap.set(j.id, bone);
  }
  let rootBone = null;
  S.joints.forEach((j, i) => {
    const bone = boneMap.get(j.id);
    j.boneIndex = i;
    if (j.parent && boneMap.get(j.parent)) {
      boneMap.get(j.parent).add(bone);
      const pj = S.jointMap.get(j.parent);
      bone.position.copy(j.pos.clone().sub(pj.pos));
    } else {
      bone.position.copy(j.pos);
      rootBone = bone;
    }
    boneList.push(bone);
  });

  const skeleton = new THREE.Skeleton(boneList);
  S.bones = { boneMap, boneList, rootBone, skeleton };
  S.maxDone = Math.max(S.maxDone, 3);
  rebuildBoneVis();
}

// nice minimalist bone visualization rendered through the mesh
function rebuildBoneVis() {
  if (boneVis) { scene.remove(boneVis); boneVis.traverse(o => o.geometry?.dispose()); }
  boneVis = new THREE.Group(); boneVis.name = 'boneVis';

  const boneMat = new THREE.MeshBasicMaterial({ color: 0x9aa1ac, depthTest: false, transparent: true, opacity: 0.92, fog: false });
  const jointMat = new THREE.MeshBasicMaterial({ color: 0x84d68f, depthTest: false, transparent: true, fog: false });

  for (const j of S.joints) {
    // joint ball (unit radius; sized per-frame)
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), jointMat);
    ball.position.copy(j.pos); ball.scale.setScalar(0.016); ball.renderOrder = 1001;
    ball.userData.isJointBall = true; boneVis.add(ball);

    if (j.parent) {
      const p = S.jointMap.get(j.parent);
      if (!p) continue;
      const dir = new THREE.Vector3().subVectors(j.pos, p.pos);
      const len = dir.length();
      if (len < 1e-4) continue;
      // tapered octahedral bone
      const geo = new THREE.OctahedronGeometry(1, 0);
      geo.scale(len * 0.06, len, len * 0.06);
      geo.translate(0, len * 0.5, 0);
      const bone = new THREE.Mesh(geo, boneMat);
      bone.position.copy(p.pos);
      bone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      bone.renderOrder = 1000;
      boneVis.add(bone);
    }
  }
  scene.add(boneVis);
}

function showBoneVis(v) { if (boneVis) boneVis.visible = v; }

function disposeBones() {
  if (boneVis) { scene.remove(boneVis); boneVis = null; }
  S.bones = null;
}

// ============================================================
//  SKINNING  — auto weights (distance falloff) + bind SkinnedMesh
// ============================================================
function autoSkin() {
  // bake each mesh into world space, build skin attributes, convert to SkinnedMesh
  S.skinned = [];
  refreshSkeletonJoints();          // ensure fingers are present in the joint set
  const jointPos = S.joints.map(j => j.pos);
  const parentPos = S.joints.map(j => j.parent ? S.jointMap.get(j.parent).pos : j.pos);

  // fresh skeleton (bones were built; rebuild clean so bind pose = current)
  buildBones();

  for (const mesh of S.meshes) {
    mesh.updateWorldMatrix(true, false);
    const geo = mesh.geometry.clone();
    geo.applyMatrix4(mesh.matrixWorld);     // bake to world
    const posAttr = geo.attributes.position;
    const n = posAttr.count;

    const skinIndex  = new Uint16Array(n * 4);
    const skinWeight = new Float32Array(n * 4);
    const v = new THREE.Vector3();

    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(posAttr, i);
      // distance to each bone segment
      const scored = [];
      for (let b = 0; b < S.joints.length; b++) {
        const d = distToSegment(v, parentPos[b], jointPos[b]);
        scored.push([b, 1 / (Math.pow(d, 4) + 1e-6)]);
      }
      scored.sort((a, c) => c[1] - a[1]);
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += scored[k][1];
      for (let k = 0; k < 4; k++) {
        skinIndex[i * 4 + k]  = scored[k][0];
        skinWeight[i * 4 + k] = scored[k][1] / sum;
      }
    }
    geo.setAttribute('skinIndex',  new THREE.BufferAttribute(skinIndex, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));

    const mat = Array.isArray(mesh.material)
      ? mesh.material.map(cloneStd) : cloneStd(mesh.material);
    const sk = new THREE.SkinnedMesh(geo, mat);
    sk.name = mesh.name || 'mesh';
    sk.add(S.bones.rootBone.clone());      // attach a copy of skeleton root
    // rebuild skeleton from the cloned bones so bind matches
    const cloneBones = [];
    sk.traverse(o => { if (o.isBone) cloneBones.push(o); });
    // keep template order
    const ordered = S.joints.map(j => cloneBones.find(cb => cb.name === j.id)).filter(Boolean);
    const skel = new THREE.Skeleton(ordered);
    sk.bind(skel);
    sk.userData.skel = skel;
    S.skinned.push(sk);
  }

  // swap display: hide originals, show skinned
  for (const m of S.meshes) m.visible = false;
  for (const sk of S.skinned) scene.add(sk);

  // store master skeleton for posing (drive all skinned via shared bone names)
  S.masterSkel = S.skinned[0]?.userData.skel || null;
  S.maxDone = Math.max(S.maxDone, 4);
}

function cloneStd(m) {
  // ensure a skinning-capable standard material, preserve maps/color
  const out = new THREE.MeshStandardMaterial({
    color: m.color ? m.color.clone() : new THREE.Color(0xcfd6e0),
    map: m.map || null,
    roughness: m.roughness ?? 0.85,
    metalness: m.metalness ?? 0.0,
  });
  out.side = THREE.DoubleSide;
  return out;
}

function distToSegment(p, a, b) {
  const ab = new THREE.Vector3().subVectors(b, a);
  const ap = new THREE.Vector3().subVectors(p, a);
  let t = ab.lengthSq() < 1e-9 ? 0 : ap.dot(ab) / ab.lengthSq();
  t = Math.max(0, Math.min(1, t));
  return ap.distanceTo(ab.multiplyScalar(t));
}

// ============================================================
//  WEIGHT PAINTING  — heatmap + brush + auto-correct
// ============================================================
function enterWeightMode() {
  showBoneVis(false);
  if (S.pointsGroup) S.pointsGroup.visible = false;
  if (connectorLines) connectorLines.visible = false;
  gizmo.detach();
  // default selected bone
  S.weightBone = S.weightBone ?? 0;
  applyHeatmap();
}

function exitWeightMode() {
  // restore standard materials
  for (const sk of S.skinned) {
    if (sk.userData.origMat) { sk.material = sk.userData.origMat; sk.userData.origMat = null; }
  }
}

function applyHeatmap() {
  for (const sk of S.skinned) {
    if (!sk.userData.origMat) sk.userData.origMat = sk.material;
    const geo = sk.geometry;
    const n = geo.attributes.position.count;
    if (!geo.attributes.color) geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    paintHeatmapColors(sk);
    sk.material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  }
}

function paintHeatmapColors(sk) {
  const geo = sk.geometry;
  const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
  const col = geo.attributes.color;
  const n = geo.attributes.position.count;
  const c = new THREE.Color();
  const low = new THREE.Color(0x303338);   // none = dark gray
  const mid = new THREE.Color(0x84d68f);   // partial = green
  const high = new THREE.Color(0xe8643c);  // full = warm orange-red (no blue)
  for (let i = 0; i < n; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === S.weightBone) w = sw.getComponent(i, k);
    if (w < 0.5) c.copy(low).lerp(mid, w / 0.5);
    else c.copy(mid).lerp(high, (w - 0.5) / 0.5);
    col.setXYZ(i, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
}

// brush painting
let painting = false;
function beginPaint(e) {
  painting = true;
  controls.enabled = false;
  paintAt(e);
  const move = ev => { if (painting) paintAt(ev); };
  const up = () => {
    painting = false; controls.enabled = true;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function paintAt(e) {
  pointerNDC(e);
  raycaster.setFromCamera(ndc, activeCam);
  const hit = raycaster.intersectObjects(S.skinned, false)[0];
  if (!hit) return;
  const sk = hit.object;
  const geo = sk.geometry;
  const pos = geo.attributes.position;
  const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
  const p = hit.point;
  const r2 = S.brush.radius * S.brush.radius;
  const v = new THREE.Vector3();
  const n = pos.count;
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i);
    const d2 = v.distanceToSquared(p);
    if (d2 > r2) continue;
    const fall = 1 - Math.sqrt(d2) / S.brush.radius;
    const delta = S.brush.strength * fall * (S.brush.add ? 1 : -1) * 0.5;
    setVertexWeight(si, sw, i, S.weightBone, delta);
  }
  si.needsUpdate = true; sw.needsUpdate = true;
  paintHeatmapColors(sk);
}

// add `delta` to a vertex's weight for `bone`, keep 4 slots, renormalize
function setVertexWeight(si, sw, i, bone, delta) {
  let slot = -1;
  for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === bone) slot = k;
  if (slot === -1) {
    // replace smallest
    let min = Infinity, mk = 0;
    for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w < min) { min = w; mk = k; } }
    slot = mk; si.setComponent(i, slot, bone); sw.setComponent(i, slot, 0);
  }
  let w = sw.getComponent(i, slot) + delta;
  w = Math.max(0, Math.min(1, w));
  sw.setComponent(i, slot, w);
  // renormalize the four
  let sum = 0; for (let k = 0; k < 4; k++) sum += sw.getComponent(i, k);
  if (sum > 1e-6) for (let k = 0; k < 4; k++) sw.setComponent(i, k, sw.getComponent(i, k) / sum);
}

// Auto-correct: smooth weights across neighbours + renormalize ("clean up intent")
function autoCorrect() {
  veil(true, 'Auto-correcting weights…');
  setTimeout(() => {
    for (const sk of S.skinned) smoothWeights(sk, 2);
    for (const sk of S.skinned) paintHeatmapColors(sk);
    veil(false);
    toast('Weights smoothed & normalized');
  }, 30);
}

function smoothWeights(sk, iterations) {
  const geo = sk.geometry;
  const idx = geo.index;
  const n = geo.attributes.position.count;
  if (!idx) return;
  // adjacency
  const nbr = Array.from({ length: n }, () => new Set());
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
    nbr[a].add(b); nbr[a].add(c); nbr[b].add(a); nbr[b].add(c); nbr[c].add(a); nbr[c].add(b);
  }
  const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
  for (let it = 0; it < iterations; it++) {
    // accumulate per-vertex bone->weight maps
    const result = new Array(n);
    for (let i = 0; i < n; i++) {
      const acc = new Map();
      const add = (j, wgt) => {
        for (let k = 0; k < 4; k++) {
          const bi = si.getComponent(j, k), w = sw.getComponent(j, k) * wgt;
          acc.set(bi, (acc.get(bi) || 0) + w);
        }
      };
      add(i, 2);                       // weight self more
      for (const j of nbr[i]) add(j, 1);
      result[i] = acc;
    }
    for (let i = 0; i < n; i++) {
      const top = [...result[i].entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
      let sum = top.reduce((s, e) => s + e[1], 0) || 1;
      for (let k = 0; k < 4; k++) {
        si.setComponent(i, k, top[k] ? top[k][0] : 0);
        sw.setComponent(i, k, top[k] ? top[k][1] / sum : 0);
      }
    }
  }
  si.needsUpdate = true; sw.needsUpdate = true;
}

// ============================================================
//  POSING + EXPORT
// ============================================================
function applyPose(name) {
  // reset
  for (const sk of S.skinned) sk.userData.skel.bones.forEach(b => b.quaternion.identity());
  if (name === 'A') {
    // rotate upper arms down ~45°
    const rotate = (boneName, angle, axis) => {
      for (const sk of S.skinned) {
        const b = sk.userData.skel.bones.find(x => x.name === boneName);
        if (b) b.quaternion.setFromAxisAngle(axis, angle);
      }
    };
    const z = new THREE.Vector3(0, 0, 1);
    rotate('upperarm.L', -Math.PI / 4, z);
    rotate('upperarm.R',  Math.PI / 4, z);
  }
  for (const sk of S.skinned) sk.userData.skel.bones.forEach(b => b.updateMatrixWorld(true));
  toast(name === 'A' ? 'A-Pose applied' : 'T-Pose applied');
}

async function exportGLB() {
  veil(true, 'Exporting GLB…');
  // export a temporary group of skinned meshes
  const grp = new THREE.Group();
  for (const sk of S.skinned) grp.add(sk);
  scene.add(grp);
  try {
    const exporter = new GLTFExporter();
    const glb = await exporter.parseAsync(grp, { binary: true, onlyVisible: false });
    const blob = new Blob([glb], { type: 'model/gltf-binary' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'rigged_model.glb';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Exported rigged_model.glb');
  } catch (err) {
    console.error(err); toast('Export failed: ' + err.message);
  } finally {
    // return skinned meshes to the scene root
    for (const sk of S.skinned) scene.add(sk);
    scene.remove(grp);
    veil(false);
  }
}

// ============================================================
//  STEP MACHINE + INSPECTOR UI
// ============================================================
const railSteps = [...document.querySelectorAll('.step')];
const tools    = document.getElementById('tools');
const nextBtn  = document.getElementById('next-btn');
const backBtn  = document.getElementById('back-btn');

railSteps.forEach(b => b.onclick = () => {
  const idx = STEPS.indexOf(b.dataset.step);
  if (idx <= S.maxDone) goStep(b.dataset.step);
});
nextBtn.onclick = () => advance(1);
backBtn.onclick = () => advance(-1);

function advance(dir) {
  const i = STEPS.indexOf(S.step) + dir;
  if (i >= 0 && i < STEPS.length) goStep(STEPS[i]);
}

function goStep(step) {
  // teardown weight mode if leaving
  if (S.step === 'weights' && step !== 'weights') exitWeightMode();
  S.step = step;
  const idx = STEPS.indexOf(step);
  S.maxDone = Math.max(S.maxDone, idx);

  // rail visuals
  railSteps.forEach(b => {
    const bi = STEPS.indexOf(b.dataset.step);
    b.classList.toggle('active', b.dataset.step === step);
    b.classList.toggle('done', bi < S.maxDone && bi !== idx);
    b.classList.toggle('locked', bi > S.maxDone);
  });

  // enter logic
  if (step === 'upload') {
    dropzone.classList.toggle('hidden', !!S.model);
  }
  if (step === 'points') {
    if (!S.coreJoints.length) buildPoints();
    // body-only working set while editing points
    S.joints = S.coreJoints; S.jointMap = S.coreMap;
    drawConnectors();
    if (S.pointsGroup) S.pointsGroup.visible = true;
    if (connectorLines) connectorLines.visible = true;
    showBoneVis(false);
    showSkinned(false);
  }
  if (step === 'bones') {
    refreshSkeletonJoints();        // body points + auto-placed fingers
    rebuildBoneVis();
    showBoneVis(true);
    if (S.pointsGroup) S.pointsGroup.visible = false;  // bones replace points view
    if (connectorLines) connectorLines.visible = false;
    showSkinned(false);
  }
  if (step === 'weights') {
    if (!S.skinned.length) autoSkin();
    showSkinned(true);
    enterWeightMode();
  }
  if (step === 'export') {
    showBoneVis(false);
    showSkinned(true);
    exitWeightMode();
    applyPose('T');
  }

  renderTools();
}

// Originals show only before skinning exists; once skinned, skinned meshes
// are the live model and follow `v`, originals stay hidden.
function showSkinned(v) {
  if (S.skinned.length) {
    for (const m of S.meshes) m.visible = false;
    for (const sk of S.skinned) sk.visible = v;
  } else {
    for (const m of S.meshes) m.visible = true;
  }
}

// ---------- top toolbar renderers ----------
function renderTools() {
  const i = STEPS.indexOf(S.step);
  backBtn.disabled = i === 0;
  nextBtn.disabled = i >= STEPS.length - 1;
  ({ upload: toolsUpload, points: toolsPoints, bones: toolsBones,
     weights: toolsWeights, export: toolsExport })[S.step]();
}

function setTools(html) { tools.innerHTML = `<div class="panel-anim">${html}</div>`; }

const symButtonHTML = () => `<button class="tbtn ${S.symmetry ? 'on' : ''}" id="sym-btn">⇄ Symmetry</button>`;
function wireSymButton() {
  const b = document.getElementById('sym-btn');
  if (b) b.onclick = () => { S.symmetry = !S.symmetry; b.classList.toggle('on', S.symmetry); toast('Symmetry ' + (S.symmetry ? 'on' : 'off')); };
}

// dropdown of joints (body + fingers)
function jointOptions(selectedId, useBoneIndex) {
  return [...S.joints].sort(byDisplay).map(j => {
    const val = useBoneIndex ? j.boneIndex : j.id;
    const sel = (useBoneIndex ? j.boneIndex === S.weightBone : j.id === selectedId) ? 'selected' : '';
    return `<option value="${val}" ${sel}>${j.id}</option>`;
  }).join('');
}

function toolsUpload() {
  nextBtn.disabled = !S.model;
  setTools(`<span class="tool-hint">${S.model ? 'Model loaded — continue to <b>Points</b>' : 'Drop or choose a model to begin'}</span>`);
}

function toolsPoints() {
  setTools(
    `<div class="tool"><span class="lbl">Fingers</span>
       <div class="seg" id="finger-seg">
         <button data-f="0" class="${S.fingers===0?'on':''}">None</button>
         <button data-f="3" class="${S.fingers===3?'on':''}">Three</button>
         <button data-f="5" class="${S.fingers===5?'on':''}">Five</button>
       </div>
     </div>
     ${symButtonHTML()}
     <button class="tbtn icon" id="reset-points" title="Re-fit points to mesh">↺</button>`);
  document.querySelectorAll('#finger-seg button').forEach(b => b.onclick = () => {
    S.fingers = +b.dataset.f; toast(S.fingers + ' fingers'); toolsPoints();
  });
  wireSymButton();
  document.getElementById('reset-points').onclick = () => { buildPoints(); toast('Points re-fit'); };
}

function toolsBones() {
  setTools(
    `<div class="tool"><span class="lbl">Joint</span>
       <select class="dropdown" id="joint-sel"><option value="">— pick —</option>${jointOptions(S.selected, false)}</select>
     </div>
     ${symButtonHTML()}
     <span class="tool-hint">Click a <b>joint ball</b> to grab it</span>`);
  const sel = document.getElementById('joint-sel');
  sel.onchange = () => { if (sel.value) selectJoint(sel.value); };
  wireSymButton();
}

function toolsWeights() {
  nextBtn.disabled = false;
  setTools(
    `<div class="tool"><span class="lbl">Bone</span>
       <select class="dropdown" id="wbone">${jointOptions(null, true)}</select></div>
     <div class="seg" id="brush-mode">
       <button class="${S.brush.add?'on':''}" data-add="1">＋ Add</button>
       <button class="${!S.brush.add?'on':''}" data-add="0">－ Erase</button>
     </div>
     <div class="tool slider-tool"><span class="lbl">Size</span>
       <input type="range" id="brush-r" min="0.03" max="0.4" step="0.01" value="${S.brush.radius}"></div>
     <div class="tool slider-tool"><span class="lbl">Strength</span>
       <input type="range" id="brush-s" min="0.05" max="1" step="0.05" value="${S.brush.strength}"></div>
     <button class="tbtn" id="auto-correct">✦ Auto-Correct</button>`);
  const wb = document.getElementById('wbone');
  wb.onchange = () => { S.weightBone = +wb.value; for (const sk of S.skinned) paintHeatmapColors(sk); };
  document.querySelectorAll('#brush-mode button').forEach(b => b.onclick = () => {
    S.brush.add = b.dataset.add === '1'; toolsWeights();
  });
  const rr = document.getElementById('brush-r'), ss = document.getElementById('brush-s');
  rr.oninput = () => { S.brush.radius = +rr.value; };
  ss.oninput = () => { S.brush.strength = +ss.value; };
  document.getElementById('auto-correct').onclick = autoCorrect;
}

function toolsExport() {
  setTools(
    `<div class="tool"><span class="lbl">Pose</span>
       <div class="seg" id="pose-seg">
         <button data-p="T" class="on">T-Pose</button>
         <button data-p="A">A-Pose</button>
       </div>
     </div>
     <button class="tbtn green" id="dl-glb">⬇ Download .glb</button>`);
  document.querySelectorAll('#pose-seg button').forEach(b => b.onclick = () => {
    document.querySelectorAll('#pose-seg button').forEach(x => x.classList.toggle('on', x === b));
    applyPose(b.dataset.p);
  });
  document.getElementById('dl-glb').onclick = exportGLB;
}

function byDisplay(a, b) {
  const rank = id => {
    const base = id.replace(/[._](L|R|tip)/g, '').replace(/_tip/, '');
    const i = DISPLAY_ORDER.indexOf(base);
    return i === -1 ? 99 : i;
  };
  return rank(a.id) - rank(b.id) || a.id.localeCompare(b.id);
}

// ============================================================
//  small helpers
// ============================================================
function veil(on, msg) {
  const v = document.getElementById('veil');
  document.getElementById('veil-msg').textContent = msg || 'Working…';
  v.hidden = !on;
}
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

// init
goStep('upload');

// --- temporary debug hook ---
window.__rig = {
  get state() { return S; },
  get cam() { return activeCam; },
  scene, raycaster,
  totalWeight(boneIdx) {
    let sum = 0;
    for (const sk of S.skinned) {
      const sw = sk.geometry.attributes.skinWeight, si = sk.geometry.attributes.skinIndex;
      for (let i = 0; i < sw.count; i++)
        for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === boneIdx) sum += sw.getComponent(i, k);
    }
    return sum;
  },
};
