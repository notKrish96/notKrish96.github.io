import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* =====================================================================
   krishgoel.dev · a 6-chapter cinematic journey, driven by scroll
   ===================================================================== */

const COL = { purple: 0x7c3aed, light: 0xa78bfa, cyan: 0x22d3ee, green: 0x4ade80, white: 0xf0f0ff };
const mobile = matchMedia('(max-width: 760px)').matches || matchMedia('(pointer: coarse)').matches;

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a = 0, b = 1) => Math.min(Math.max(v, a), b);
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeIn = t => t * t * t;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const dummy = new THREE.Object3D();

// small seeded random, so the world looks the same on every visit
function rng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const glow = (color, opacity = 1) => new THREE.MeshBasicMaterial({
  color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
});

const dotTex = canvasTex(64, 64, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});

function bezier(a, b, c, t) {
  const u = 1 - t;
  return V(
    u * u * a.x + 2 * u * t * b.x + t * t * c.x,
    u * u * a.y + 2 * u * t * b.y + t * t * c.y,
    u * u * a.z + 2 * u * t * b.z + t * t * c.z,
  );
}

// flat ribbons (circuit traces) lying on the board
function ribbonGeo(routes, width, y) {
  const pos = [];
  for (const pts of routes) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const L = Math.hypot(dx, dz) || 1;
      const nx = -dz / L * width / 2, nz = dx / L * width / 2;
      const ex = dx / L * width / 2, ez = dz / L * width / 2;
      const ax = a[0] - ex, az = a[1] - ez, bx = b[0] + ex, bz = b[1] + ez;
      pos.push(ax + nx, y, az + nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz,
               ax + nx, y, az + nz, bx - nx, y, bz - nz, ax - nx, y, az - nz);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

// the "drawn circuit" texture reused inside the PC case
function drawBoardTraces(g, w, h) {
  const r = rng(3);
  g.fillStyle = '#07061a'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    let x = Math.floor(r() * w / 8) * 8, y = Math.floor(r() * h / 8) * 8;
    g.strokeStyle = r() < 0.75 ? 'rgba(139,92,246,0.85)' : 'rgba(34,211,238,0.85)';
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 3; k++) {
      if (k % 2) y += (r() - 0.5) * 160; else x += (r() - 0.5) * 120;
      g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = '#c4b5fd'; g.fillRect(x - 2, y - 2, 4, 4);
  }
  g.fillStyle = '#16142c'; g.fillRect(w * 0.3, h * 0.18, w * 0.4, w * 0.4);
  g.strokeStyle = '#a78bfa'; g.lineWidth = 2; g.strokeRect(w * 0.3, h * 0.18, w * 0.4, w * 0.4);
}

/* =====================================================================
   RENDERER
   ===================================================================== */
const canvas = document.getElementById('scene');
// try the best settings first, then the safest ones, before giving up
let renderer;
for (const opts of [{ antialias: !mobile, powerPreference: 'high-performance' }, { antialias: false, powerPreference: 'default' }]) {
  try { renderer = new THREE.WebGLRenderer({ canvas, ...opts }); break; } catch (e) { console.warn('WebGL init failed:', e); }
}
if (!renderer) {
  const box = document.getElementById('noWebgl');
  box.hidden = false;
  const why = document.createElement('small');
  why.style.cssText = 'flex-basis:100%;color:#8b8fa3;margin-top:10px';
  why.textContent = 'WebGL is unavailable. Turning on hardware / graphics acceleration in your browser settings usually fixes this.';
  box.appendChild(why);
  document.getElementById('boot').classList.add('done');
  throw new Error('WebGL unavailable');
}
renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.25 : 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 6000);
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(new THREE.Scene(), camera);
composer.addPass(renderPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 1, 0.5, 0.15);
if (mobile) bloom.resolution.set(innerWidth / 2, innerHeight / 2);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* =====================================================================
   TIMELINE
   The 30 scenes, in order. w = how much scrolling a scene takes.
   cam(t, start) returns where the camera is, t = 0..1 through the scene.
   ===================================================================== */
const CHAPTERS = [
  { title: 'The Awakening', sub: 'The journey begins inside a computer.' },
  { title: 'The Physical World', sub: 'The machine becomes a world of its own.' },
  { title: 'The Digital Frontier', sub: 'Beyond the screen lies an immense digital universe.' },
  { title: 'The Infinite Network', sub: 'A single connection opens into an entire civilization.' },
  { title: 'The Digital Core', sub: 'The infrastructure transforms into information and interface.' },
  { title: 'The Arrival', sub: 'The journey ends at the entrance to the website.' },
];

// camera move helpers
const to = (pos, look, fov, e = ease) => (t, s) => {
  const k = e(t);
  return { pos: s.pos.clone().lerp(V(...pos), k), look: s.look.clone().lerp(V(...look), k), fov: fov ? lerp(s.fov, fov, k) : s.fov };
};
const follow = (curve, la, blend = 0.15) => (t, s) => {
  const u = t * (1 - la);
  const look = curve.getPointAt(Math.min(u + la, 1));
  return { pos: curve.getPointAt(u), look: s.look.clone().lerp(look, ease(clamp(t / blend))), fov: s.fov };
};

// chapter 1 · down the road, up the ring tower, through the crown into the sky
const circuitPath = new THREE.CatmullRomCurve3([
  V(0, 3.2, 20), V(0, 3.6, -70), V(0, 5, -160), V(0, 22, -232), V(0, 80, -262), V(0, 128, -282),
  V(0, 148, -300), V(0, 178, -322), V(0, 215, -345),
], false, 'centripetal');
// the storm-sky dome is centred over the crown; its rift opens toward SKY_F, a galaxy waits beyond
const CROWN = V(0, 148, -300);
const SKY_C = V(0, 150, -300), SKY_R = 1200, SKY_F = V(0, 0.77, -0.64).normalize();
const RIFT = SKY_C.clone().addScaledVector(SKY_F, SKY_R);
const GALAXY = SKY_C.clone().addScaledVector(SKY_F, 1850);
const circuitCam = (t, s) => {
  const k = clamp(t / 0.62), e = clamp((t - 0.62) / 0.38);
  let pos = circuitPath.getPointAt(k);
  const street = V(0, 10, -300);
  let look = s.look.clone().lerp(street, ease(clamp(k / 0.1)));
  look.lerp(CROWN, ease(clamp((k - 0.38) / 0.3)));
  look.lerp(RIFT, ease(clamp((k - 0.72) / 0.28)));
  if (e > 0) {
    // fly up through the gap in the sky and out toward the galaxy
    pos = pos.clone().lerp(SKY_C.clone().addScaledVector(SKY_F, 1330), ease(e));
    look = RIFT.clone().lerp(GALAXY, ease(clamp(e / 0.7)));
  }
  return { pos, look, fov: s.fov };
};

// chapter 1 · the board: the flash reveals we're rising out of the centre of the chip,
// then the camera tilts up to the concentric-ring button above and rises into it
const BUTTON = V(0, 90, 0);
const CHIP_C = V(0, 0, 0);
const boardCam = (t, s) => {
  const a = ease(clamp(t / 0.58)), b = ease(clamp((t - 0.58) / 0.2)), c = easeIn(clamp((t - 0.78) / 0.22));
  // rise out of the chip, looking back down at it
  let pos = s.pos.clone().lerp(V(0, BUTTON.y * 0.85, 6), a);
  // tilt up to the button overhead (kept slightly off-axis so the view never flips)
  let look = CHIP_C.clone().lerp(BUTTON, b);
  if (t > 0.58) pos.lerp(V(0, BUTTON.y * 0.85, 5), b);
  // and rise into it
  if (t > 0.78) { pos = V(0, BUTTON.y * 0.85, 5).lerp(V(0, BUTTON.y - 1.2, 0.25), c); look = BUTTON.clone().add(V(0, 3, 0)); }
  return { pos, look, fov: s.fov };
};

const tubePts = [V(0, -58, -30), V(0, -52, -70), V(8, -44, -120), V(-8, -36, -170), V(6, -30, -220), V(0, -28, -260), V(0, -28, -300)];
const netPath = new THREE.CatmullRomCurve3([V(14, -50, 14), V(6, -55, -8), ...tubePts, V(0, -28, -340)], false, 'centripetal');

// chapter 4 · the infinite rack megastructure. The main corridor runs along x = 20;
// at z = 100 it crosses a bottomless shaft; the target server stands in a hall at z = -620.
const CORE4 = V(20, -200, -620);
const infiniteCam = (t, s) => {
  const pos = s.pos.clone().lerp(V(20, 24, 100), ease(clamp(t / 0.6)));
  const look = s.look.clone().lerp(V(20, -500, 97), ease(clamp((t - 0.25) / 0.75)));
  return { pos, look, fov: lerp(s.fov, 70, ease(t)), roll: 0.35 * ease(clamp((t - 0.4) / 0.6)) };
};
const explorePath = new THREE.CatmullRomCurve3([
  V(20, 24, 100), V(20, -70, 99), V(20, -175, 90), V(20, -240, 55), V(20, -252, -10), V(20, -248, -180), V(20, -242, -380),
], false, 'centripetal');
const exploreCam = (t, s) => {
  const u = t * 0.97, pos = explorePath.getPointAt(u);
  const ahead = explorePath.getPointAt(Math.min(u + 0.03, 1));
  const look = s.look.clone().lerp(ahead.clone().add(ahead.clone().sub(pos).multiplyScalar(10)), ease(clamp(t / 0.15)));
  const roll = lerp(0.35, 0, ease(clamp(t / 0.55))) - 0.25 * Math.sin(t * Math.PI) * (1 - ease(clamp((t - 0.6) / 0.4)));
  return { pos, look, fov: lerp(70, 56, ease(t)), roll };
};

const SCENES = [
  // ---- Chapter 1 · The Awakening
  { id: '1.1', ch: 1, name: 'Inside the Motherboard', realm: 'circuit', w: 1.3,
    start: { pos: [0, 3, 80], look: [0, 8, -300] }, cam: to([0, 3.2, 20], [0, 10, -300]) },
  { id: '1.2', ch: 1, name: 'Circuit Traversal', realm: 'circuit', w: 4.4, cam: circuitCam },
  { id: '1.3', ch: 1, name: 'Hardware Exit', realm: 'board', w: 3.2,
    start: { pos: [0, 2.15, 0.2], look: [0, 0, 0] }, cam: boardCam },

  // ---- Chapter 2 · The Physical World
  { id: '2.1', ch: 2, name: 'Computer Reveal', realm: 'room', w: 1.1,
    start: { pos: [6.3, 10.3, -9.4], look: [6.3, 10.3, -12.8] }, cam: to([8.5, 11, 4], [6.5, 10.25, -10]) },
  { id: '2.2', ch: 2, name: 'Gaming Setup Reveal', realm: 'room', w: 1.2, cam: to([1.5, 10.5, 16], [1.5, 10, -9.5]) },
  { id: '2.3', ch: 2, name: 'The Chamber', realm: 'room', w: 1.2, cam: to([1.5, 8, 24], [1.5, 10, -9.5]) },
  // a full spiral: right side → behind the setup → left side → back to the front, centred
  { id: '2.4', ch: 2, name: 'Hero Orbit', realm: 'room', w: 2.4, cam: (t, s) => {
      const e = ease(t), O = V(1.5, 9, -9.5);
      const th = e * Math.PI * 2, rad = lerp(33.5, 22, e), h = lerp(-1, 2.5, e) + 6 * Math.sin(Math.PI * e);
      return { pos: V(O.x + Math.sin(th) * rad, O.y + h, O.z + Math.cos(th) * rad), look: s.look.clone().lerp(V(1.5, 10, -9.5), e), fov: s.fov };
    } },
  { id: '2.5', ch: 2, name: 'Monitor Dive', realm: 'room', w: 1.3, cam: (t, s) => ({
      pos: bezier(s.pos, V(-1.5, 11.6, 2), V(-1.5, 11.5, -10.18), Math.pow(t, 1.7)),
      look: s.look.clone().lerp(V(-1.5, 11.5, -10.31), ease(clamp(t / 0.4))),
      fov: lerp(55, 100, easeIn(t)),
    }) },

  // ---- Chapter 3 · The Digital Frontier
  { id: '3.1', ch: 3, name: 'Digital Rebirth', realm: 'net', w: 1.7,
    start: { pos: [0, 30, 170], look: [0, 5, 0] }, cam: to([0, 34, 150], [0, 5, 0]) },
  { id: '3.2', ch: 3, name: 'Network Overview', realm: 'net', w: 1.5, cam: to([95, 62, 105], [0, 5, 0]) },
  { id: '3.3', ch: 3, name: 'The Network Ocean', realm: 'net', w: 1.7, cam: to([24, -44, 62], [0, -56, -200]) },
  { id: '3.4', ch: 3, name: 'Target Path Selection', realm: 'net', w: 1.5, cam: to([14, -50, 14], [0, -57, -30]) },
  { id: '3.5', ch: 3, name: 'Network Dive', realm: 'net', w: 2.4, cam: follow(netPath, 0.03, 0.15) },
  { id: '3.6', ch: 3, name: 'DNA Traversal', realm: 'net', w: 2.2, cam: (t, s) => {
      const base = s.pos.clone().lerp(V(0, -28, -520), t);
      const rr = 1.6 * Math.sin(Math.PI * t), a = t * 9;
      base.x += Math.cos(a) * rr; base.y += Math.sin(a) * rr;
      return { pos: base, look: s.look.clone().lerp(V(0, -28, base.z - 30), ease(clamp(t / 0.2))), fov: s.fov };
    } },
  { id: '3.7', ch: 3, name: 'The Destination Appears', realm: 'net', w: 1.6, cam: to([0, -28, -585], [0, -28, -650], 70, easeIn) },

  // ---- Chapter 4 · The Infinite Network
  { id: '4.1', ch: 4, name: 'Network Exit', realm: 'city', w: 1.2,
    start: { pos: [20, 0, 430], look: [20, 0, 0] }, cam: to([20, 2, 270], [20, 6, -400], null, easeOut) },
  { id: '4.2', ch: 4, name: 'First Server Civilization', realm: 'city', w: 1.4, cam: to([20, 6, 150], [20, 14, -600]) },
  { id: '4.3', ch: 4, name: 'The Infinite View', realm: 'city', w: 1.7, cam: infiniteCam },
  { id: '4.4', ch: 4, name: 'Metropolis Exploration', realm: 'city', w: 2.6, cam: exploreCam },
  { id: '4.5', ch: 4, name: 'Target Server', realm: 'city', w: 1.4, cam: to([20, -236, -470], [20, -180, -620]) },
  { id: '4.6', ch: 4, name: 'Approach', realm: 'city', w: 1.2, cam: to([20, -210, -568], [20, -150, -640], null, easeIn) },

  // ---- Chapter 5 · The Digital Core
  { id: '5.1', ch: 5, name: 'Digital Reformation', realm: 'core', w: 1.1,
    start: { pos: [6, 0, 20], look: [0, 0, 0] }, cam: to([30, 18, 62], [0, 0, 0]) },
  { id: '5.2', ch: 5, name: 'Information Architecture', realm: 'core', w: 1.1, cam: to([-42, 22, 56], [0, 0, 0]) },
  { id: '5.3', ch: 5, name: 'Digital Core', realm: 'core', w: 1.2, cam: to([0, 8, 40], [0, 0, 0]) },
  { id: '5.4', ch: 5, name: 'Interface Formation', realm: 'core', w: 1.1, cam: to([0, 0, 32], [0, 0, 0]) },

  // ---- Chapter 6 · The Arrival
  { id: '6.1', ch: 6, name: 'Screen Materialization', realm: 'core', w: 1.1, cam: to([0, 0, 19.5], [0, 0, 0]) },
  { id: '6.2', ch: 6, name: 'Browser Selection', realm: 'core', w: 1, cam: to([0, 0, 19.5], [0, 0, 0]) },
  { id: '6.3', ch: 6, name: 'Login', realm: 'core', w: 0.9, cam: to([0, 0, 19.5], [0, 0, 0]) },
  { id: '6.4', ch: 6, name: 'Authentication', realm: 'core', w: 1.1, cam: to([0, 0, 19.5], [0, 0, 0]) },
  { id: '6.5', ch: 6, name: 'Welcome', realm: 'core', w: 0.9, cam: to([0, 0, 19.5], [0, 0, 0]) },
];

// colour of the flash when we cut into a new world
const CUT_COLOR = { board: '#f4f0ff', room: '#000000', net: '#f4f0ff', city: '#cfe9ff', core: '#000000' };

const cum = [0];
SCENES.forEach(s => cum.push(cum[cum.length - 1] + s.w));
const W = cum[cum.length - 1];
const idx = id => SCENES.findIndex(s => s.id === id);

// where each scene's camera starts = where the previous one ended
SCENES.forEach((s, i) => {
  if (s.start) {
    s.s = { pos: V(...s.start.pos), look: V(...s.start.look), fov: 55 };
  } else {
    const p = SCENES[i - 1];
    const end = p.cam(1, p.s);
    s.s = { pos: end.pos.clone(), look: end.look.clone(), fov: end.fov };
  }
});

let X = 0; // current position on the timeline, in scene units
const sp = id => { const i = idx(id); return clamp((X - cum[i]) / SCENES[i].w); };

/* =====================================================================
   CHAPTER 1 · shared GLSL noise
   ===================================================================== */
const NOISE_GLSL = `
  float hash3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise3(vec3 x){
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < ${mobile ? 4 : 5}; i++){ s += a * noise3(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
`;

/* =====================================================================
   CHAPTER 1 · the storm sky: a real dome of cloud with a torn gap in it.
   Through the gap is deep space and a 3D spiral galaxy the camera flies into.
   ===================================================================== */
function buildStormSky() {
  const F = SKY_F.clone();
  const A = V(1, 0.35, 0.25).normalize();
  const N = new THREE.Vector3().crossVectors(F, A).normalize();
  A.crossVectors(N, F).normalize();
  const sky = new THREE.Group();
  sky.position.copy(SKY_C);
  const r = rng(77);

  // the cloud dome; pixels inside the rift are cut away so the space beyond shows through
  const domeMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFlash: { value: 0 }, uF: { value: F }, uN: { value: N }, uA: { value: A } },
    side: THREE.BackSide, fog: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uTime; uniform float uFlash; uniform vec3 uF; uniform vec3 uN; uniform vec3 uA; varying vec3 vDir;
      ${NOISE_GLSL}
      void main(){
        vec3 d = normalize(vDir);
        float c = fbm(d * 3.0 + vec3(uTime * 0.012, 0.0, uTime * 0.008));
        float c2 = fbm(d * 7.5 + c * 1.6);
        vec3 cloud = mix(vec3(0.012, 0.015, 0.025), vec3(0.13, 0.15, 0.2), smoothstep(0.4, 0.95, c * 0.6 + c2 * 0.5));
        cloud *= 0.45 + 0.55 * smoothstep(-0.3, 0.5, d.y);

        float across = dot(d, uN), along = dot(d, uA);
        float lens = smoothstep(0.98, 0.05, abs(along)) * smoothstep(-0.25, 0.45, dot(d, uF));
        float edgeN = (fbm(d * 14.0) - 0.5) * 0.1 + (fbm(d * 42.0) - 0.5) * 0.035;
        float w = 0.12 * lens;
        float dist = abs(across + edgeN * 0.6) - w;
        if (dist < 0.0 && w > 0.002) discard;

        float edge = smoothstep(0.03, 0.0, dist) * step(0.002, w);
        vec3 edgeCol = mix(vec3(0.55, 0.35, 1.0), vec3(1.0, 0.72, 0.38), smoothstep(0.35, 0.7, fbm(d * 20.0)));
        vec3 col = cloud + edgeCol * edge * 0.4;
        col += vec3(0.4, 0.43, 0.68) * uFlash * smoothstep(0.5, 0.0, dist) * (0.4 + c2);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  sky.add(new THREE.Mesh(new THREE.SphereGeometry(SKY_R, 96, 48), domeMat));

  // deep space beyond the dome: nebula backdrop + stars
  const spaceMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, fog: false, depthWrite: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vDir;
      ${NOISE_GLSL}
      void main(){
        vec3 d = normalize(vDir);
        float neb = fbm(d * 4.0 + 2.0);
        vec3 col = mix(vec3(0.005, 0.012, 0.02), vec3(0.04, 0.26, 0.26), smoothstep(0.45, 0.8, neb));
        col += vec3(0.38, 0.24, 0.75) * smoothstep(0.55, 0.85, fbm(d * 6.0 + 9.0)) * 0.35;
        col += vec3(0.8, 0.55, 0.28) * smoothstep(0.62, 0.9, fbm(d * 8.0 + 4.0)) * 0.25;
        vec3 sp = d * 600.0;
        col += step(0.988, hash3(floor(sp))) * (0.4 + 0.6 * hash3(floor(sp) + 3.1)) * vec3(1.0, 0.96, 0.9);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const space = new THREE.Mesh(new THREE.SphereGeometry(3200, 48, 24), spaceMat);
  space.renderOrder = -2;
  sky.add(space);

  // the spiral galaxy
  const G = mobile ? 14000 : 30000;
  const gp = new Float32Array(G * 3), gc = new Float32Array(G * 3);
  const core = new THREE.Color(0xffe2b0), arms = [new THREE.Color(0x35c9b8), new THREE.Color(0x8a6cf2), new THREE.Color(0x5aa0ff)];
  const gauss = () => (r() + r() + r() - 1.5) / 1.5;
  for (let i = 0; i < G; i++) {
    const arm = i % 3, rr = Math.pow(r(), 0.75) * 480;
    const ang = arm * Math.PI * 2 / 3 + rr * 0.012 + gauss() * 0.35 * (1 - rr / 600);
    gp.set([Math.cos(ang) * rr + gauss() * 14, gauss() * 20 * (1 - rr / 520), Math.sin(ang) * rr + gauss() * 14], i * 3);
    const col = core.clone().lerp(arms[Math.floor(r() * 3)], clamp(rr / 160)).multiplyScalar(0.35 + 0.65 * (1 - rr / 520));
    gc.set([col.r, col.g, col.b], i * 3);
  }
  const gGeo = new THREE.BufferGeometry();
  gGeo.setAttribute('position', new THREE.BufferAttribute(gp, 3));
  gGeo.setAttribute('color', new THREE.BufferAttribute(gc, 3));
  const galaxy = new THREE.Group();
  galaxy.add(new THREE.Points(gGeo, new THREE.PointsMaterial({ size: 2.6, map: dotTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })));
  const bulge = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: 0xffd9a0, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  bulge.scale.set(220, 220, 1);
  galaxy.add(bulge);
  galaxy.position.copy(GALAXY).sub(SKY_C);
  galaxy.lookAt(SKY_C.clone().sub(SKY_C));
  galaxy.rotateX(1.15);
  sky.add(galaxy);

  // lightning bolts crackling along the rift's torn edges (with branches)
  const bolts = [];
  const boltMat = () => new THREE.LineBasicMaterial({ color: 0xe6e8ff, transparent: true, opacity: 0, fog: false });
  const walk = (start, side, steps) => {
    const pts = [];
    let dir = start.clone();
    for (let k = 0; k < steps; k++) {
      pts.push(dir.clone().multiplyScalar(SKY_R - 15));
      dir = dir.clone().addScaledVector(N, side * 0.018).add(V((r() - 0.5) * 0.035, (r() - 0.5) * 0.035, (r() - 0.5) * 0.035)).normalize();
    }
    return pts;
  };
  for (let b = 0; b < 12; b++) {
    const side = b % 2 ? 1 : -1;
    const start = F.clone().addScaledVector(A, (r() - 0.5) * 1.4).addScaledVector(N, side * (0.1 + r() * 0.08)).normalize();
    const main = walk(start, side, 16);
    const g = new THREE.Group();
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(main), boltMat()));
    const from = main[6 + Math.floor(r() * 5)].clone().normalize();
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(walk(from, side, 7)), boltMat()));
    sky.add(g);
    bolts.push({ g, life: 0 });
  }

  let flash = 0;
  return {
    group: sky,
    update(time, dt) {
      domeMat.uniforms.uTime.value = time;
      if (Math.random() < dt * 1.6) {
        flash = 1;
        const n = Math.random() < 0.35 ? 2 : 1;
        for (let k = 0; k < n; k++) bolts[Math.floor(Math.random() * bolts.length)].life = 1;
      }
      flash = Math.max(0, flash - dt * 2.6);
      domeMat.uniforms.uFlash.value = flash * (0.6 + 0.4 * Math.sin(time * 60));
      bolts.forEach(b => {
        b.life = Math.max(0, b.life - dt * 2.2);
        const o = b.life * (0.55 + 0.45 * Math.sin(time * 70));
        b.g.children.forEach(l => { l.material.opacity = o; });
      });
      galaxy.rotation.z += dt * 0.01;
    },
  };
}

/* =====================================================================
   CHAPTER 1 · SCENE 1 · the circuit city inside the motherboard
   ===================================================================== */
function buildCircuit() {
  const scene = new THREE.Scene();
  const fogCol = new THREE.Color(0x020107);
  scene.background = fogCol;
  scene.fog = new THREE.FogExp2(fogCol, 0.0045);
  const r = rng(13);

  // cube-stacked towers covered in white circuit lines
  const towerMat = new THREE.ShaderMaterial({
    uniforms: { uLine: { value: new THREE.Color(0.78, 0.74, 0.95) }, uFog: { value: fogCol }, uFogD: { value: 0.0045 } },
    vertexShader: `varying vec3 vW; varying vec3 vN; varying float vDist;
      void main(){
        mat4 im = mat4(1.0);
        #ifdef USE_INSTANCING
          im = instanceMatrix;
        #endif
        vec4 w = modelMatrix * im * vec4(position, 1.0);
        vW = w.xyz; vN = normalize(mat3(modelMatrix * im) * normal);
        vec4 mv = viewMatrix * w; vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uLine; uniform vec3 uFog; uniform float uFogD; varying vec3 vW; varying vec3 vN; varying float vDist;
      float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        vec3 n = abs(vN);
        vec2 q = n.y > 0.5 ? vW.xz : (n.x > 0.5 ? vW.zy : vW.xy);
        vec2 id = floor(q / 1.7), f = fract(q / 1.7);
        float a = h2(id), b = h2(id + 7.3), c = h2(id + 3.1), d = h2(id + 11.7);
        float lw = 0.035;
        float hl = step(0.45, a) * smoothstep(lw, 0.0, abs(f.y - 0.08)) * step(b * 0.5, f.x) * step(f.x, 0.5 + b * 0.5);
        float vl = step(0.5, c) * smoothstep(lw, 0.0, abs(f.x - 0.1)) * step(d * 0.5, f.y) * step(f.y, 0.4 + d * 0.6);
        float shade = 0.55 + 0.45 * max(dot(vN, normalize(vec3(0.3, 0.8, 0.5))), 0.0);
        vec3 col = vec3(0.02, 0.018, 0.03) * shade + uLine * max(hl, vl);
        vec2 e = abs(f - 0.5);
        col += vec3(0.025, 0.022, 0.04) * smoothstep(0.485, 0.5, max(e.x, e.y));
        float fg = 1.0 - exp(-pow(vDist * uFogD, 2.0));
        gl_FragColor = vec4(mix(col, uFog, fg), 1.0);
      }`,
  });
  const boxes = [];
  for (const side of [-1, 1]) {
    for (let z = 120; z > -460; z -= 8 + r() * 6) {
      for (let x = 9 + r() * 2; x < 80; x += 7 + r() * 5) {
        let y = 0, bx = side * x, bz = z;
        const n = 2 + Math.floor(r() * 7 * (1 - (x - 9) / 120));
        for (let k = 0; k < n; k++) {
          const w = 4 + r() * 4, h = 3.4 * (1 + Math.floor(r() * 3)), d = 4 + r() * 4;
          bx += (r() - 0.5) * 1.6; bz += (r() - 0.5) * 1.6;
          if (side * (bx - side * w / 2) < 8) bx = side * (8 + w / 2);
          boxes.push([bx, y + h / 2, bz, w, h, d]);
          y += h;
        }
      }
    }
  }
  const city = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), towerMat, boxes.length);
  boxes.forEach(([x, y, z, w, h, d], i) => { dummy.position.set(x, y, z); dummy.scale.set(w, h, d); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); city.setMatrixAt(i, dummy.matrix); });
  scene.add(city);

  // the glowing striped road
  const roadMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec3 vW; varying float vDist; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uTime; varying vec3 vW; varying float vDist;
      void main(){
        float x = vW.x;
        float stripe = smoothstep(0.42, 0.48, abs(fract(x * 2.6) - 0.5));
        float centre = smoothstep(0.14, 0.0, abs(x));
        float edgeFade = smoothstep(7.5, 1.5, abs(x));
        float k = fract(vW.z * 0.02 + uTime * 0.5);
        float pulse = smoothstep(0.0, 0.4, k) * smoothstep(1.0, 0.6, k);
        vec3 col = vec3(0.3, 0.22, 0.58) * stripe * edgeFade * 0.55 + vec3(0.85, 0.8, 1.0) * centre * (0.35 + 0.45 * pulse);
        gl_FragColor = vec4(col * exp(-vDist * 0.006) + vec3(0.012, 0.01, 0.02), 1.0);
      }`,
  });
  const road = new THREE.Mesh(new THREE.PlaneGeometry(15, 640), roadMat);
  road.rotation.x = -Math.PI / 2; road.position.set(0, 0.02, -150);
  scene.add(road);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 800), new THREE.MeshBasicMaterial({ color: 0x030208 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(0, 0, -150);
  scene.add(ground);

  // ringed pillars with glowing discs along the road
  const dark = new THREE.MeshBasicMaterial({ color: 0x07060d });
  const white = glow(0xe0daf8, 0.55);
  for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
    const x = side * (12 + r() * 4), z = -170 - i * 28 - r() * 8, h = 12 + r() * 18;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, h, 24), dark); p.position.set(x, h / 2, z); scene.add(p);
    for (let k = 0; k < 2; k++) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 1.1, 32, 1, true), white);
      band.position.set(x, h - 1 - k * (3 + r() * 4), z); scene.add(band);
    }
  }

  // the tall ring tower
  const tower = new THREE.Group();
  tower.position.set(0, 0, -300);
  tower.add(new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 142, 32), dark).translateY(71));
  const ringGeo = new THREE.TorusGeometry(5.3, 0.14, 8, 48);
  for (let y = 4; y < 142; y += 3.3) { const m = new THREE.Mesh(ringGeo, white); m.rotation.x = Math.PI / 2; m.position.y = y; tower.add(m); }
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * Math.PI * 2;
    tower.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 142, 0.22), glow(0xbfb6e8, 0.4)).translateX(Math.cos(a) * 5.3).translateZ(Math.sin(a) * 5.3).translateY(71));
  }
  scene.add(tower);

  // the crown: teardrop petals lying flat in a full ring around the tower top
  const petalGeo = new THREE.CapsuleGeometry(0.85, 8, 4, 12);
  const up = V(0, 1, 0);
  for (let i = 0; i < 22; i++) {
    const a = i / 22 * Math.PI * 2, dir = V(Math.cos(a), 0, Math.sin(a));
    const m = new THREE.Mesh(petalGeo, glow(0xd9d2f5, 0.45));
    m.position.copy(CROWN).addScaledVector(dir, 12.5);
    m.quaternion.setFromUnitVectors(up, dir);
    scene.add(m);
  }

  // drifting specks
  const dPos = [];
  for (let i = 0; i < 900; i++) dPos.push((r() - 0.5) * 120, r() * 90, 100 - r() * 520);
  const dGeo = new THREE.BufferGeometry(); dGeo.setAttribute('position', new THREE.Float32BufferAttribute(dPos, 3));
  const dust = new THREE.Points(dGeo, new THREE.PointsMaterial({ size: 0.35, map: dotTex, color: 0xb9a8ff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(dust);

  const sky = buildStormSky();
  scene.add(sky.group);

  return {
    scene, bloom: [0.45, 0.4, 0.5],
    update(time, dt) {
      roadMat.uniforms.uTime.value = time;
      sky.update(time, dt);
      dust.position.y = Math.sin(time * 0.2) * 0.6;
    },
  };
}

/* =====================================================================
   CHAPTER 1 · SCENE 2 · the motherboard: sample-4 tiles, a sample-5 chip,
   and a standing glass cuboid on the chip with the power button on top
   ===================================================================== */
function buildBoard() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02050a);
  scene.fog = new THREE.FogExp2(0x02050a, 0.0075);
  const r = rng(11);

  scene.add(new THREE.AmbientLight(0x8ab0c8, 0.4));
  const sun = new THREE.DirectionalLight(0xc8e4ff, 1.3); sun.position.set(30, 70, 40); scene.add(sun);
  const chipLight = new THREE.PointLight(0x2ec4e0, 110, 0, 2); chipLight.position.set(0, 5, 14); scene.add(chipLight);
  const btnLight = new THREE.PointLight(0x8b5cf6, 300, 0, 2); btnLight.position.set(0, BUTTON.y + 8, 0); scene.add(btnLight);

  // glowing lanes between the tiles
  const laneMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec3 vW; varying float vDist; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uTime; varying vec3 vW; varying float vDist;
      float h1(float n){ return fract(sin(n) * 43758.5453); }
      void main(){
        vec2 g = (vW.xz + 3.0) / 6.0;
        vec2 d = fract(g); d = min(d, 1.0 - d) * 6.0;
        float lx = smoothstep(0.45, 0.0, d.x), lz = smoothstep(0.45, 0.0, d.y);
        float px = fract(vW.z * 0.015 - uTime * (0.25 + h1(floor(g.x)) * 0.4) + h1(floor(g.x) * 3.1));
        float pz = fract(vW.x * 0.015 - uTime * (0.25 + h1(floor(g.y)) * 0.4) + h1(floor(g.y) * 5.7));
        float pulse = lx * smoothstep(0.92, 1.0, px) * step(0.6, h1(floor(g.x) + 2.0)) + lz * smoothstep(0.92, 1.0, pz) * step(0.6, h1(floor(g.y) + 9.0));
        vec3 col = vec3(0.05, 0.42, 0.75) * max(lx, lz) * 0.5 + vec3(0.55, 0.9, 1.0) * pulse * 0.7;
        gl_FragColor = vec4(col * exp(-vDist * 0.006) + vec3(0.004, 0.008, 0.014), 1.0);
      }`,
  });
  const lanes = new THREE.Mesh(new THREE.PlaneGeometry(520, 520), laneMat);
  lanes.rotation.x = -Math.PI / 2;
  scene.add(lanes);

  // tiles with raised detail (sample 4)
  const tiles = [];
  for (let i = -36; i <= 36; i++) for (let j = -36; j <= 36; j++) {
    const x = i * 6, z = j * 6;
    if (Math.abs(x) < 14 && Math.abs(z) < 14) continue;
    tiles.push([x, z]);
  }
  const tileMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(5.3, 0.5, 5.3), new THREE.MeshStandardMaterial({ color: 0x18222a, roughness: 0.45, metalness: 0.7 }), tiles.length);
  tiles.forEach(([x, z], i) => { dummy.position.set(x, 0.25, z); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); tileMesh.setMatrixAt(i, dummy.matrix); });
  scene.add(tileMesh);

  const greebles = [], dots = [];
  for (let k = 0; k < (mobile ? 3500 : 7500); k++) {
    const [tx, tz] = tiles[Math.floor(r() * tiles.length)];
    const w = 0.4 + r() * 2.2, d = 0.3 + r() * 1.6;
    greebles.push([tx + (r() - 0.5) * (5.3 - w), 0.56, tz + (r() - 0.5) * (5.3 - d), w, 0.08 + r() * 0.3, d]);
  }
  for (let k = 0; k < 500; k++) {
    const [tx, tz] = tiles[Math.floor(r() * tiles.length)];
    const ox = tx + (r() - 0.5) * 3, oz = tz + (r() - 0.5) * 3;
    for (let a = 0; a < 4; a++) for (let b = 0; b < 3; b++) dots.push([ox + a * 0.28, oz + b * 0.28]);
  }
  const gMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x22303a, roughness: 0.5, metalness: 0.6 }), greebles.length);
  greebles.forEach(([x, y, z, w, h, d], i) => { dummy.position.set(x, y + h / 2, z); dummy.scale.set(w, h, d); dummy.updateMatrix(); gMesh.setMatrixAt(i, dummy.matrix); });
  scene.add(gMesh);
  const dotMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.05, 0.1), new THREE.MeshBasicMaterial({ color: 0x2a86b0 }), dots.length);
  dots.forEach(([x, z], i) => { dummy.position.set(x, 0.53, z); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); dotMesh.setMatrixAt(i, dummy.matrix); });
  scene.add(dotMesh);

  // the chip (sample 5): a dark-teal rounded square with pin rows on every edge
  const S = 8, RAD = 1.6;
  const shape = new THREE.Shape();
  shape.moveTo(-S + RAD, -S); shape.lineTo(S - RAD, -S); shape.quadraticCurveTo(S, -S, S, -S + RAD); shape.lineTo(S, S - RAD);
  shape.quadraticCurveTo(S, S, S - RAD, S); shape.lineTo(-S + RAD, S); shape.quadraticCurveTo(-S, S, -S, S - RAD); shape.lineTo(-S, -S + RAD); shape.quadraticCurveTo(-S, -S, -S + RAD, -S);
  const chipGeo = new THREE.ExtrudeGeometry(shape, { depth: 1.2, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.25, bevelSegments: 3 });
  const chip = new THREE.Mesh(chipGeo, new THREE.MeshStandardMaterial({ color: 0x1b3943, roughness: 0.32, metalness: 0.55 }));
  chip.rotation.x = -Math.PI / 2; chip.position.y = 0.5;
  scene.add(chip);
  const pins = [];
  for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let k = -14; k <= 14; k++) {
    const o = k * 0.5;
    pins.push([nx * 9.1 + (nz ? o : 0), nz * 9.1 + (nx ? o : 0), nx ? 1.6 : 0.2, nx ? 0.2 : 1.6]);
  }
  const pinMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.14, 1), new THREE.MeshStandardMaterial({ color: 0xa9d7e0, roughness: 0.3, metalness: 0.9 }), pins.length);
  pins.forEach(([x, z, w, d], i) => { dummy.position.set(x, 0.6, z); dummy.scale.set(w, 1, d); dummy.updateMatrix(); pinMesh.setMatrixAt(i, dummy.matrix); });
  scene.add(pinMesh);
  // the die at the chip's centre: the point the camera emerges from
  const die = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), glow(0x7fe3ff, 0.9));
  die.rotation.x = -Math.PI / 2; die.position.y = 1.97;
  scene.add(die);
  const dieRim = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(4.4, 4.4)), new THREE.LineBasicMaterial({ color: 0x5fd4ff, transparent: true, opacity: 0.8 }));
  dieRim.rotation.x = -Math.PI / 2; dieRim.position.y = 1.97;
  scene.add(dieRim);

  // trace bundles running out of the pins with 45° bends (sample 5)
  const bright = [], dim = [];
  for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const tx = -nz, tz = nx;
    for (let b = 0; b < 3; b++) {
      const n = 5 + Math.floor(r() * 4), base = (b - 1) * 4.5 - n * 0.25, dir = b === 1 ? 0 : (b === 0 ? -1 : 1);
      const L1 = 3 + r() * 4, L2 = 6 + r() * 10, L3 = 10 + r() * 30;
      for (let k = 0; k < n; k++) {
        const o = base + k * 0.5;
        const x0 = nx * 10 + tx * o, z0 = nz * 10 + tz * o;
        const nest = (dir > 0 ? (n - 1 - k) : k) * 0.5;
        const x1 = x0 + nx * (L1 + nest), z1 = z0 + nz * (L1 + nest);
        const x2 = x1 + (nx + tx * dir) * L2, z2 = z1 + (nz + tz * dir) * L2;
        const x3 = x2 + nx * L3, z3 = z2 + nz * L3;
        (r() < 0.3 ? bright : dim).push([[x0, z0], [x1, z1], [x2, z2], [x3, z3]]);
      }
    }
  }
  scene.add(new THREE.Mesh(ribbonGeo(dim, 0.2, 0.57), new THREE.MeshBasicMaterial({ color: 0x3f8f9e, side: THREE.DoubleSide })));
  scene.add(new THREE.Mesh(ribbonGeo(bright, 0.2, 0.575), new THREE.MeshBasicMaterial({ color: 0x7fdcec, side: THREE.DoubleSide })));

  // the standing glass cuboid: chip at the bottom, power button on top
  const H = BUTTON.y - 1.9, W = 15;
  const cuboid = new THREE.Mesh(new THREE.BoxGeometry(W, H, W), new THREE.MeshBasicMaterial({ color: 0x0b1a22, transparent: true, opacity: 0.14, depthWrite: false }));
  cuboid.position.y = 1.9 + H / 2;
  scene.add(cuboid);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, W)), new THREE.LineBasicMaterial({ color: 0x5fd4ff, transparent: true, opacity: 0.8 }));
  edges.position.copy(cuboid.position);
  scene.add(edges);
  // data rising up the faces
  const risers = [];
  for (let k = 0; k < 16; k++) {
    const face = k % 4, o = (r() - 0.5) * (W - 2);
    const x = face === 0 ? W / 2 + 0.02 : face === 1 ? -W / 2 - 0.02 : o;
    const z = face === 2 ? W / 2 + 0.02 : face === 3 ? -W / 2 - 0.02 : o;
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3, 0.12), glow(0x7fe3ff, 0.7));
    m.position.set(x, 2, z);
    scene.add(m);
    risers.push([m, r() * H, 4 + r() * 6]);
  }
  const button = new THREE.Group();
  button.position.copy(BUTTON);
  button.add(new THREE.Mesh(new THREE.BoxGeometry(W, 0.4, W), new THREE.MeshStandardMaterial({ color: 0x0c141c, roughness: 0.2, metalness: 0.6, transparent: true, opacity: 0.35, depthWrite: false })));
  const rings = [];
  for (let k = 0; k < 8; k++) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(2.2 + k * 0.72, 0.07, 8, 96), glow(k % 2 ? 0x8b5cf6 : 0x22d3ee, 0.75));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.25;
    button.add(m); rings.push(m);
  }
  button.add(new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.7, 0.7, 48), new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 0.3, metalness: 0.8 })).translateY(0.45));
  button.add(new THREE.Mesh(new THREE.TorusGeometry(1.65, 0.06, 8, 64), glow(0x7fe3ff, 0.9)).rotateX(-Math.PI / 2).translateZ(0.81));
  scene.add(button);

  return {
    scene, bloom: [0.55, 0.45, 0.42],
    update(time) {
      laneMat.uniforms.uTime.value = time;
      die.material.opacity = 0.3 + 0.6 * (1 - ease(clamp(sp('1.3') / 0.3))) + 0.08 * Math.sin(time * 3);
      rings.forEach((m, k) => { m.material.opacity = 0.45 + 0.35 * Math.max(0, Math.sin(time * 2 - k * 0.6)); });
      risers.forEach(([m, off, sp]) => { m.position.y = 2 + (off + time * sp) % (H - 3); });
    },
  };
}

/* =====================================================================
   CHAPTER 2 · THE ROOM
   ===================================================================== */
function buildRoom() {
  // a dark studio shot: the setup sits in a black void, lit by two hazy
  // overhead lamps and a backlight that traces its edges
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.FogExp2(0x000000, 0.0075);
  const r = rng(21);
  const std = (color, rough = 0.5, metal = 0.4) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); scene.add(m); return m; };
  const soft = (color, opacity) => glow(color, opacity);

  // glossy black floor, no walls
  add(new THREE.PlaneGeometry(240, 240), std(0x060606, 0.55, 0.6), 0, 0, 0).rotation.x = -Math.PI / 2;

  // desk
  const deskMat = std(0x2c2a34, 0.9, 0.05);
  add(new THREE.BoxGeometry(18, 0.5, 7.5), deskMat, 0, 7.5, -9.5);
  for (const [x, z] of [[-8.5, -6.2], [8.5, -6.2], [-8.5, -12.8], [8.5, -12.8]]) add(new THREE.BoxGeometry(0.5, 7.25, 0.5), deskMat, x, 3.62, z);

  // monitor, screen kept dim
  const M = V(-1.5, 11.5, -10.5);
  const shell = std(0x24222c, 0.85, 0.1);
  add(new THREE.BoxGeometry(8.3, 4.9, 0.35), shell, M.x, M.y, M.z);
  const screenTex = canvasTex(1024, 576, (g, w, h) => {
    g.fillStyle = '#060608'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#9a9aa8'; g.font = '18px monospace'; g.fillText('krishgoel.dev — terminal', 20, 28);
    const lines = ['krish@core:~$ whoami', 'krish', 'krish@core:~$ nmap -sV 10.10.10.5', 'PORT     STATE  SERVICE   VERSION',
      '22/tcp   open   ssh       OpenSSH 8.9', '80/tcp   open   http      nginx 1.24', 'krish@core:~$ ./enter_the_network.sh', '[*] establishing link...'];
    g.font = '24px monospace';
    lines.forEach((t, i) => { g.fillStyle = i % 2 ? '#8a8a96' : '#b9b4d6'; g.fillText(t, 30, 84 + i * 46); });
  });
  add(new THREE.PlaneGeometry(8, 4.6), new THREE.MeshBasicMaterial({ map: screenTex, color: 0x9a96b0 }), M.x, M.y, -10.31);
  add(new THREE.BoxGeometry(0.6, 2.4, 0.4), shell, M.x, 8.9, -10.9);
  add(new THREE.BoxGeometry(3, 0.15, 1.8), shell, M.x, 7.82, -10.7);

  // keyboard + mouse, no RGB
  add(new THREE.BoxGeometry(6, 0.3, 2), shell, -1.5, 7.9, -7.4);
  const keys = new THREE.InstancedMesh(new THREE.BoxGeometry(0.32, 0.12, 0.32), std(0x34323e, 0.85, 0.05), 15 * 5);
  for (let i = 0; i < 15; i++) for (let j = 0; j < 5; j++) {
    dummy.position.set(-1.5 - 2.75 + i * 0.39, 8.1, -7.4 - 0.78 + j * 0.39); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
    keys.setMatrixAt(i * 5 + j, dummy.matrix);
  }
  scene.add(keys);
  add(new THREE.BoxGeometry(0.6, 0.25, 1), shell, 3.6, 7.88, -7.4);

  // PC: a white dual-glass case with LED-strip fans, white RAM, GPU and sleeved cables
  const MP = 0x5b2bb5, MP_LIGHT = 0x7c4dff;
  const T = V(6.6, 9.85, -10.6), CW = 3.4, CH = 4.2, CD = 4.2;
  const X0 = T.x - CW / 2, X1 = T.x + CW / 2, Y0 = T.y - CH / 2, Y1 = T.y + CH / 2, Z0 = T.z - CD / 2, Z1 = T.z + CD / 2;
  const whiteMat = std(0x9c9ca8, 0.75, 0.1);
  const led = (op = 0.4) => soft(0xd9d3ff, op * 0.7);
  // frame: edge pillars, solid top/back/right, glass front + left
  const bar = 0.12;
  for (const [x, z] of [[X0, Z0], [X1, Z0], [X0, Z1], [X1, Z1]]) add(new THREE.BoxGeometry(bar, CH, bar), whiteMat, x, T.y, z);
  for (const y of [Y0, Y1]) {
    for (const z of [Z0, Z1]) add(new THREE.BoxGeometry(CW, bar, bar), whiteMat, T.x, y, z);
    for (const x of [X0, X1]) add(new THREE.BoxGeometry(bar, bar, CD), whiteMat, x, y, T.z);
  }
  add(new THREE.BoxGeometry(CW, 0.05, CD), whiteMat, T.x, Y1, T.z);
  add(new THREE.BoxGeometry(CW, 0.05, CD), whiteMat, T.x, Y0, T.z);
  add(new THREE.BoxGeometry(CW, CH, 0.05), whiteMat, T.x, T.y, Z0);
  add(new THREE.BoxGeometry(0.05, CH, CD), whiteMat, X1, T.y, T.z);
  const glass = new THREE.MeshStandardMaterial({ color: 0xd8dcf0, transparent: true, opacity: 0.07, roughness: 0.05, metalness: 0.9, depthWrite: false });
  add(new THREE.PlaneGeometry(CW, CH), glass, T.x, T.y, Z1);
  add(new THREE.PlaneGeometry(CD, CH), glass, X0, T.y, T.z).rotation.y = -Math.PI / 2;
  for (const [x, z] of [[X0 + 0.3, Z0 + 0.3], [X1 - 0.3, Z0 + 0.3], [X0 + 0.3, Z1 - 0.3], [X1 - 0.3, Z1 - 0.3]]) add(new THREE.BoxGeometry(0.35, 0.12, 0.35), whiteMat, x, Y0 - 0.06, z);

  // motherboard, AIO pump, RAM
  add(new THREE.PlaneGeometry(2.3, 2.6), new THREE.MeshBasicMaterial({ map: canvasTex(256, 512, drawBoardTraces), color: 0x3a3a46 }), T.x - 0.3, T.y + 0.45, Z0 + 0.04);
  add(new THREE.CylinderGeometry(0.4, 0.4, 0.22, 40), whiteMat, T.x - 0.55, T.y + 0.85, Z0 + 0.2).rotation.x = Math.PI / 2;
  add(new THREE.CircleGeometry(0.32, 40), new THREE.MeshBasicMaterial({ color: 0x5d6b62 }), T.x - 0.55, T.y + 0.85, Z0 + 0.32);
  for (let k = 0; k < 4; k++) {
    const x = T.x + 0.35 + k * 0.13;
    add(new THREE.BoxGeometry(0.07, 0.95, 0.26), whiteMat, x, T.y + 0.85, Z0 + 0.18);
    add(new THREE.BoxGeometry(0.075, 0.05, 0.27), led(0.45), x, T.y + 1.34, Z0 + 0.18);
  }

  // GPU with an LED strip along its face
  add(new THREE.BoxGeometry(2.7, 0.55, 1.35), whiteMat, T.x - 0.1, T.y - 0.45, Z0 + 0.75);
  add(new THREE.BoxGeometry(2.4, 0.05, 0.04), led(0.6), T.x - 0.1, T.y - 0.6, Z0 + 1.44);
  add(new THREE.BoxGeometry(2.0, 0.08, 0.02), std(0x9a9aa6, 0.4, 0.5), T.x - 0.1, T.y - 0.35, Z0 + 1.43);

  // square fans with LED strips on their frames: three on top, three below, two on the right side
  const fanBlades = [];
  const makeFan = (pos, normal) => {
    const g = new THREE.Group();
    const s = 1.1, t = 0.07;
    for (const [x, z, w, d] of [[0, -s / 2, s, t], [0, s / 2, s, t], [-s / 2, 0, t, s], [s / 2, 0, t, s]]) {
      g.add(new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), whiteMat).translateX(x).translateZ(z));
      g.add(new THREE.Mesh(new THREE.BoxGeometry(w === s ? 0.62 : 0.03, 0.03, d === s ? 0.62 : 0.03), led(0.6)).translateX(x * 0.94).translateZ(z * 0.94).translateY(0.065));
    }
    const blades = new THREE.Mesh(new THREE.CircleGeometry(0.47, 7), new THREE.MeshStandardMaterial({ color: 0xd4d5dc, roughness: 0.6, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    blades.rotation.x = -Math.PI / 2;
    g.add(blades);
    g.add(new THREE.Mesh(new THREE.CircleGeometry(0.13, 24), std(0x9a9aa6)).rotateX(-Math.PI / 2).translateZ(0.01));
    g.position.copy(pos);
    g.quaternion.setFromUnitVectors(V(0, 1, 0), normal);
    scene.add(g);
    fanBlades.push(blades);
  };
  for (const z of [-1.35, 0, 1.35]) {
    makeFan(V(T.x, Y1 - 0.12, T.z + z), V(0, -1, 0));
    makeFan(V(T.x, Y0 + 0.12, T.z + z), V(0, 1, 0));
  }
  for (const y of [-0.65, 0.65]) makeFan(V(X1 - 0.12, T.y + y, T.z + 0.6), V(-1, 0, 0));

  // white sleeved cables
  const cable = (pts, rad) => scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, rad, 8, false), whiteMat));
  cable([V(T.x - 0.55, T.y + 0.85, Z0 + 0.32), V(T.x - 0.2, T.y + 1.3, Z0 + 0.9), V(T.x + 0.7, Y1 - 0.4, T.z + 0.4)], 0.07);
  cable([V(T.x - 0.45, T.y + 0.75, Z0 + 0.32), V(T.x + 0.1, T.y + 1.1, Z0 + 1.1), V(T.x + 0.9, Y1 - 0.5, T.z + 0.9)], 0.07);
  for (let k = 0; k < 5; k++) cable([V(T.x + 0.3 + k * 0.05, T.y - 0.17, Z0 + 1.0), V(T.x + 0.6 + k * 0.05, T.y - 0.6, Z0 + 1.6), V(X1 - 0.3, Y0 + 0.5, T.z + 1.2 - k * 0.05)], 0.03);

  // a soft fill inside the case so the white parts read, without a bulb-like hotspot
  const caseLight = new THREE.PointLight(0xeeeaff, 0.8, 0, 2); caseLight.position.set(T.x, T.y, T.z + 0.6); scene.add(caseLight);

  // midnight-purple strip lights: two overhead bars, a bar on the floor behind the desk,
  // a strip under the desk's front edge and bias lighting behind the monitor
  const strip = (w, h, d, x, y, z, op = 0.9) => add(new THREE.BoxGeometry(w, h, d), soft(MP_LIGHT, op), x, y, z);
  const lamps = [];
  for (const x of [-9, 12]) {
    strip(9, 0.18, 0.18, x, 24, -20);
    const spot = new THREE.SpotLight(MP_LIGHT, 1400, 0, 0.55, 0.8, 2);
    spot.position.set(x, 24, -20); spot.target.position.set(1.5, 8, -9.5);
    scene.add(spot, spot.target);
    lamps.push([spot, 1400]);
  }
  strip(26, 0.12, 0.12, 1.5, 0.08, -19);
  strip(17, 0.06, 0.06, 0, 7.18, -5.8, 0.6);
  strip(7.6, 0.06, 0.06, -1.5, 13.9, -10.75, 0.7);
  const bias = new THREE.PointLight(MP_LIGHT, 22, 0, 2); bias.position.set(-1.5, 11.5, -12.2); scene.add(bias);
  const under = new THREE.PointLight(MP, 20, 0, 2); under.position.set(0, 6, -5); scene.add(under);
  const back = new THREE.PointLight(MP_LIGHT, 160, 0, 2); back.position.set(1.5, 9, -20); scene.add(back);

  // purple backlight on the edges, a soft front fill so the setup always reads
  const rim = new THREE.SpotLight(0x8a6bff, 2400, 0, 0.6, 0.6, 2);
  rim.position.set(1.5, 15, -36); rim.target.position.set(1.5, 9, -9.5);
  scene.add(rim, rim.target);
  const fill = new THREE.PointLight(0x7a68c8, 900, 0, 2); fill.position.set(1.5, 18, 20); scene.add(fill);
  const amb = new THREE.AmbientLight(0x2a1f4a, 1.4); scene.add(amb);
  const lights = [...lamps, [rim, 2400], [fill, 900], [amb, 1.4], [bias, 22], [under, 20], [back, 160]];

  // drifting haze around and behind the setup
  const smokeTex = canvasTex(256, 256, (g, w, h) => {
    for (let i = 0; i < 40; i++) {
      const x = w * (0.2 + r() * 0.6), y = h * (0.3 + r() * 0.4), rad = 30 + r() * 70;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(255,255,255,0.08)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }
  });
  const haze = [];
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0x6a4fc0, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
    const a = i / 6 * Math.PI * 2;
    s.position.set(1.5 + Math.sin(a) * 18, 2 + r() * 5, -22 - r() * 10);
    s.scale.set(34, 14, 1);
    scene.add(s);
    haze.push([s, s.position.x, r() * 6]);
  }
  const dustPos = [];
  for (let i = 0; i < 400; i++) dustPos.push(-28 + r() * 56, r() * 28, -30 + r() * 50);
  const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.Float32BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 0.12, map: dotTex, color: 0xa78bfa, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(dust);

  return {
    scene, bloom: [0.6, 0.5, 0.35],
    update(time) {
      const m = lerp(0.6, 1, ease(Math.max(sp('2.2') * 0.5, sp('2.3'))));
      lights.forEach(([l, base]) => { l.intensity = base * m; });
      haze.forEach(([s, x0, ph]) => { s.position.x = x0 + Math.sin(time * 0.08 + ph) * 3; s.material.opacity = 0.18 * m; });
      dust.rotation.y = time * 0.008;
      fanBlades.forEach(b => { b.rotation.z = time * 3; });
    },
  };
}

/* =====================================================================
   CHAPTER 3 · THE DIGITAL FRONTIER
   ===================================================================== */
const OCEAN_Y = -60;
const oceanH = (x, z, t) => Math.sin(x * 0.018 + t * 0.6) * 4 + Math.cos(z * 0.022 + t * 0.5) * 4 + Math.sin((x + z) * 0.05 + t) * 1.2;

const tubeShader = () => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 }, uColor: { value: new THREE.Color(COL.light) } },
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform float uTime; uniform float uOpacity; uniform vec3 uColor; varying vec2 vUv;
    void main(){
      float ring = smoothstep(0.86, 1.0, fract(vUv.x * 120.0 - uTime * 1.5));
      float line = smoothstep(0.9, 1.0, fract(vUv.y * 10.0));
      float a = (ring * 0.4 + line * 0.22 + 0.025) * uOpacity;
      gl_FragColor = vec4(uColor * a, 1.0);
    }`,
});

function buildNet() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03020a);
  scene.fog = new THREE.FogExp2(0x03020a, 0.004);
  const r = rng(31);

  // --- network graph
  const nodes = [];
  for (let i = 0; i < (mobile ? 160 : 260); i++) {
    const a = r() * Math.PI * 2, rad = Math.sqrt(r()) * 75;
    nodes.push(V(Math.cos(a) * rad, (r() - 0.5) * 40 * (1 - rad / 110) + 8, Math.sin(a) * rad));
  }
  const edges = [];
  nodes.forEach((n, i) => {
    nodes.map((m, j) => [j, n.distanceToSquared(m)]).filter(([j]) => j !== i).sort((a, b) => a[1] - b[1]).slice(0, 2)
      .forEach(([j]) => { if (i < j || !edges.some(e => e[0] === j && e[1] === i)) edges.push([i, j]); });
  });
  const ePos = [];
  edges.forEach(([i, j]) => ePos.push(nodes[i].x, nodes[i].y, nodes[i].z, nodes[j].x, nodes[j].y, nodes[j].z));
  const eGeo = new THREE.BufferGeometry(); eGeo.setAttribute('position', new THREE.Float32BufferAttribute(ePos, 3));
  const edgeMat = new THREE.LineBasicMaterial({ color: COL.purple, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  scene.add(new THREE.LineSegments(eGeo, edgeMat));
  const nodeMat = new THREE.MeshBasicMaterial({ color: 0x8f86b8, transparent: true, opacity: 0 });
  const nodeMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.8, 0), nodeMat, nodes.length);
  nodes.forEach((n, i) => { dummy.position.copy(n); const s = r() < 0.08 ? 2.2 : 1; dummy.scale.set(s, s, s); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); nodeMesh.setMatrixAt(i, dummy.matrix); });
  scene.add(nodeMesh);

  // --- rebirth particles: scattered light that settles into the graph
  const N = mobile ? 2500 : 5000;
  const start = new Float32Array(N * 3), target = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    let p;
    if (i % 3 === 0) p = nodes[Math.floor(r() * nodes.length)].clone();
    else { const [a, b] = edges[Math.floor(r() * edges.length)]; p = nodes[a].clone().lerp(nodes[b], r()); }
    target.set([p.x, p.y, p.z], i * 3);
    const d = V(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(60 + r() * 160);
    start.set([d.x, d.y + 30, d.z + 120], i * 3);
  }
  const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(start.slice(), 3));
  const pMat = new THREE.PointsMaterial({ size: 0.8, map: dotTex, color: 0xb4acd6, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
  scene.add(new THREE.Points(pGeo, pMat));
  let lastK = -1;

  // --- the network ocean
  const step = mobile ? 14 : 8, X0 = -800, X1 = 800, Z0 = -1400, Z1 = 200;
  const oPos = [];
  for (let z = Z0; z <= Z1; z += step) for (let x = X0; x < X1; x += step) oPos.push(x, 0, z, x + step, 0, z);
  for (let x = X0; x <= X1; x += step) for (let z = Z0; z < Z1; z += step) oPos.push(x, 0, z, x, 0, z + step);
  const oGeo = new THREE.BufferGeometry(); oGeo.setAttribute('position', new THREE.Float32BufferAttribute(oPos, 3));
  const oceanMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uA: { value: new THREE.Color(COL.purple) }, uB: { value: new THREE.Color(COL.cyan) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uTime; varying float vDist; varying float vH;
      void main(){
        vec3 p = position;
        float h = sin(p.x*0.018 + uTime*0.6)*4.0 + cos(p.z*0.022 + uTime*0.5)*4.0 + sin((p.x+p.z)*0.05 + uTime)*1.2;
        p.y += h; vH = h;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uA; uniform vec3 uB; varying float vDist; varying float vH;
      void main(){
        float f = exp(-vDist * 0.0045);
        vec3 c = mix(uA, uB, clamp(vH * 0.08 + 0.5, 0.0, 1.0));
        gl_FragColor = vec4(c * f * 0.45, 1.0);
      }`,
  });
  const ocean = new THREE.LineSegments(oGeo, oceanMat);
  ocean.position.y = OCEAN_Y;
  scene.add(ocean);

  // light streaks racing across the ocean
  const streaks = [];
  for (let i = 0; i < (mobile ? 140 : 280); i++) streaks.push({ x: Math.round((r() - 0.5) * 75) * step, z: -1000 + r() * 1150, sp: 30 + r() * 60 });
  const streakMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 0.35, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), streaks.length);
  streaks.forEach((s, i) => streakMesh.setColorAt(i, new THREE.Color(r() < 0.5 ? 0x6e6496 : 0x3f8590)));
  scene.add(streakMesh);

  // --- the selected path: a glowing tube rising out of the ocean
  const tubeCurve = new THREE.CatmullRomCurve3(tubePts, false, 'centripetal');
  const tubeMat = tubeShader();
  scene.add(new THREE.Mesh(new THREE.TubeGeometry(tubeCurve, 500, 3.2, 20, false), tubeMat));
  const marker = new THREE.Mesh(new THREE.TorusGeometry(5, 0.25, 8, 48), glow(COL.cyan, 0));
  marker.position.set(0, -57, -30);
  marker.rotation.x = Math.PI / 2;
  scene.add(marker);

  // --- DNA helix
  const dna = new THREE.Group();
  dna.position.set(0, -28, 0);
  const strandPts = [];
  for (let z = -300; z > -560; z -= 1.4) strandPts.push(z);
  const R = 6;
  const sph = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }), strandPts.length * 2);
  const rungs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.07, 1, 6), glow(COL.purple, 0.35), Math.ceil(strandPts.length / 2));
  const up = V(0, 1, 0);
  strandPts.forEach((z, i) => {
    const a = z * 0.09;
    for (let s = 0; s < 2; s++) {
      const k = i * 2 + s, sg = s ? -1 : 1;
      dummy.position.set(Math.cos(a) * R * sg, Math.sin(a) * R * sg, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      sph.setMatrixAt(k, dummy.matrix);
      sph.setColorAt(k, new THREE.Color(s ? 0x1f6f7a : 0x5f548c));
    }
    if (i % 2 === 0) {
      dummy.position.set(0, 0, z);
      dummy.quaternion.setFromUnitVectors(up, V(Math.cos(a), Math.sin(a), 0));
      dummy.scale.set(1, R * 2, 1); dummy.updateMatrix();
      rungs.setMatrixAt(i / 2, dummy.matrix);
      dummy.quaternion.identity();
    }
  });
  dna.add(sph, rungs);
  scene.add(dna);
  const bitsPos = [];
  for (let i = 0; i < 1500; i++) { const a = r() * Math.PI * 2, rr = 10 + r() * 25; bitsPos.push(Math.cos(a) * rr, -28 + Math.sin(a) * rr, -280 - r() * 360); }
  const bitsGeo = new THREE.BufferGeometry(); bitsGeo.setAttribute('position', new THREE.Float32BufferAttribute(bitsPos, 3));
  scene.add(new THREE.Points(bitsGeo, new THREE.PointsMaterial({ size: 0.7, map: dotTex, color: COL.light, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })));

  // --- the destination: a portal at the end of the path
  const portal = new THREE.Group();
  portal.position.set(0, -28, -640);
  const pr1 = new THREE.Mesh(new THREE.TorusGeometry(14, 0.4, 12, 96), glow(0x9a8fd0));
  const pr2 = new THREE.Mesh(new THREE.TorusGeometry(18, 0.15, 8, 96), glow(COL.cyan, 0.8));
  const pr3 = new THREE.Mesh(new THREE.TorusGeometry(22, 0.1, 8, 96), glow(COL.purple, 0.6));
  const coreTex = canvasTex(256, 256, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(196,181,253,0.6)'); gr.addColorStop(1, 'rgba(124,58,237,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const disk = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial({ map: coreTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  portal.add(pr1, pr2, pr3, disk);
  scene.add(portal);

  return {
    scene, bloom: [0.5, 0.4, 0.4],
    update(time) {
      // rebirth
      const k = ease(sp('3.1'));
      if (Math.abs(k - lastK) > 1e-4) {
        const arr = pGeo.attributes.position.array;
        for (let i = 0; i < N * 3; i++) arr[i] = lerp(start[i], target[i], k);
        pGeo.attributes.position.needsUpdate = true;
        lastK = k;
      }
      const g = clamp((k - 0.4) / 0.6);
      edgeMat.opacity = 0.35 * g;
      nodeMat.opacity = g;
      pMat.opacity = 0.8 - 0.55 * g;

      oceanMat.uniforms.uTime.value = time;
      streaks.forEach((s, i) => {
        const z = ((s.z - time * s.sp + 1000) % 1150 + 1150) % 1150 - 1000;
        dummy.position.set(s.x, OCEAN_Y + oceanH(s.x, z, time) + 0.4, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
        streakMesh.setMatrixAt(i, dummy.matrix);
      });
      streakMesh.instanceMatrix.needsUpdate = true;

      const sel = ease(sp('3.4'));
      tubeMat.uniforms.uTime.value = time;
      tubeMat.uniforms.uOpacity.value = sel;
      marker.material.opacity = sel * (1 - sp('3.5')) * (0.6 + 0.4 * Math.sin(time * 4));
      marker.scale.setScalar(1 + 0.15 * Math.sin(time * 4));

      dna.rotation.z = time * 0.25;

      const near = ease(sp('3.7'));
      portal.scale.setScalar(0.6 + near * 0.6);
      pr1.rotation.z = time * 0.3; pr2.rotation.z = -time * 0.5; pr3.rotation.x = time * 0.2;
      disk.material.opacity = 0.3 + near * 0.35;
    },
  };
}

/* =====================================================================
   CHAPTER 4 · THE INFINITE NETWORK
   An endless server megastructure (Watch Dogs data centre × Infinity Castle):
   rack walls full of blinking LEDs that vanish into haze above and below,
   rack-covered bridges crossing at every height (some slowly shifting),
   catwalks along the main corridor, and the target server: a cage of light.
   ===================================================================== */
function buildCity() {
  const scene = new THREE.Scene();
  const fogCol = new THREE.Color(0.04, 0.12, 0.17);
  scene.background = fogCol;
  scene.fog = new THREE.FogExp2(fogCol, 0.0032);
  const r = rng(41);

  const rackMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFog: { value: fogCol }, uFogD: { value: 0.0032 } },
    vertexShader: `varying vec3 vW; varying vec3 vN; varying float vDist;
      void main(){
        mat4 im = mat4(1.0);
        #ifdef USE_INSTANCING
          im = instanceMatrix;
        #endif
        vec4 w = modelMatrix * im * vec4(position, 1.0);
        vW = w.xyz; vN = normalize(mat3(modelMatrix * im) * normal);
        vec4 mv = viewMatrix * w; vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform float uTime; uniform vec3 uFog; uniform float uFogD; varying vec3 vW; varying vec3 vN; varying float vDist;
      float hash(float n){ return fract(sin(n) * 43758.5453); }
      void main(){
        vec3 n = abs(vN);
        float side = 1.0 - step(0.5, n.y);
        vec2 q = n.y > 0.5 ? vW.xz : (n.x > 0.5 ? vW.zy : vW.xy);
        vec2 cab = vec2(2.4, 0.62);
        vec2 id = floor(q / cab), f = fract(q / cab);
        float frame = max(step(0.94, f.x), step(f.x, 0.05));
        float slot = step(0.12, f.y) * step(f.y, 0.88);
        vec3 col = vec3(0.02, 0.03, 0.042) + vec3(0.008, 0.012, 0.018) * slot;
        col *= 1.0 - 0.6 * frame;

        // blinking status LEDs, a row per rack unit
        float li = floor(f.x * 7.0), lx = fract(f.x * 7.0);
        float dotm = smoothstep(0.32, 0.12, length(vec2(lx - 0.5, (f.y - 0.5) * 2.4)));
        float h = hash(id.x * 13.1 + id.y * 7.7 + li * 3.3);
        float blink = step(0.45, fract(h * 91.0 + floor(uTime * (0.4 + h * 2.5) + h * 10.0) * 0.37));
        float on = step(0.3, h) * blink * (1.0 - frame) * slot;
        vec3 led = h > 0.95 ? vec3(0.85, 0.95, 1.0) : (h > 0.92 ? vec3(0.3, 1.0, 0.7) : vec3(0.16, 0.42, 1.0));
        col += led * dotm * on * 1.5 * side;

        // catwalk levels every 45 units
        float d = abs(vW.y - floor(vW.y / 45.0 + 0.5) * 45.0);
        col = mix(col, vec3(0.008, 0.012, 0.016), step(d, 0.8) * side);
        col += vec3(0.12, 0.3, 0.26) * smoothstep(0.18, 0.0, abs(d - 0.95)) * side * 0.6;

        float fg = 1.0 - exp(-pow(vDist * uFogD, 2.0));
        gl_FragColor = vec4(mix(col, uFog, fg), 1.0);
      }`,
  });

  // the camera's route, used to keep bridges out of its way
  const route = [];
  for (let z = 440; z >= 150; z -= 10) route.push(V(20, 3, z));
  for (let k = 0; k <= 20; k++) route.push(V(20, 6, 150).lerp(V(20, 24, 100), k / 20));
  for (let k = 0; k <= 120; k++) route.push(explorePath.getPointAt(k / 120));
  for (let k = 0; k <= 30; k++) route.push(V(20, -242, -380).lerp(V(20, -205, -580), k / 30));

  // towers: an endless grid of rack blocks with corridors between them
  const TS = 24, GRID = 40, TH = 1000;
  const towers = [];
  for (let i = -8; i <= 8; i++) for (let j = -20; j <= 10; j++) {
    const x = i * GRID, z = j * GRID;
    if (Math.hypot(x - CORE4.x, z - CORE4.z) < 75) continue;
    towers.push([x, 0, z, TS, TH, TS]);
  }

  // bridges and blocks crossing the corridors at every height
  const bridges = [];
  for (let tries = 0; tries < 1400 && bridges.length < (mobile ? 140 : 260); tries++) {
    const alongX = r() < 0.5, line = 20 + GRID * Math.round((r() - 0.5) * 16), off = (r() - 0.5) * 640;
    const len = 30 + r() * 170, th = 5 + r() * 10, wd = 6 + r() * 8;
    const y = (r() - 0.5) * 900;
    const c = alongX ? V(off, y, line) : V(line, y, off - 200);
    const half = alongX ? V(len / 2, th / 2, wd / 2) : V(wd / 2, th / 2, len / 2);
    if (Math.hypot(c.x - CORE4.x, c.z - CORE4.z) < 80) continue;
    const pad = 8 + 14; // clearance + room for the slow drift
    if (route.some(p => Math.abs(p.x - c.x) < half.x + pad && Math.abs(p.y - c.y) < half.y + pad && Math.abs(p.z - c.z) < half.z + pad)) continue;
    bridges.push({ c, half, drift: r() < 0.3 ? 6 + r() * 10 : 0, ph: r() * 6.28, sp: 0.15 + r() * 0.2 });
  }

  const box = new THREE.BoxGeometry(1, 1, 1);
  const towerMesh = new THREE.InstancedMesh(box, rackMat, towers.length);
  towers.forEach(([x, y, z, w, h, d], i) => { dummy.position.set(x, y, z); dummy.scale.set(w, h, d); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); towerMesh.setMatrixAt(i, dummy.matrix); });
  scene.add(towerMesh);
  const bridgeMesh = new THREE.InstancedMesh(box, rackMat, bridges.length);
  const placeBridges = time => {
    bridges.forEach((b, i) => {
      dummy.position.copy(b.c); dummy.position.y += b.drift * Math.sin(time * b.sp + b.ph);
      dummy.scale.set(b.half.x * 2, b.half.y * 2, b.half.z * 2); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
      bridgeMesh.setMatrixAt(i, dummy.matrix);
    });
    bridgeMesh.instanceMatrix.needsUpdate = true;
  };
  placeBridges(0);
  scene.add(bridgeMesh);

  // catwalks with dim rails along the main corridor
  const walks = [];
  for (let y = -270; y <= 90; y += 45) for (let j = -14; j <= 10; j++) {
    const z = j * GRID;
    if (Math.hypot(20 - CORE4.x, z - CORE4.z) < 75) continue;
    for (const x of [13.2, 26.8]) walks.push([x, y, z]);
  }
  const walkMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.3, TS), new THREE.MeshBasicMaterial({ color: 0x0a1418 }), walks.length);
  const railMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.08, TS), glow(0x3fae96, 0.35), walks.length);
  walks.forEach(([x, y, z], i) => {
    dummy.position.set(x, y, z); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); walkMesh.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x + (x < 20 ? 1.15 : -1.15), y + 1.1, z); dummy.updateMatrix(); railMesh.setMatrixAt(i, dummy.matrix);
  });
  scene.add(walkMesh, railMesh);

  // the exit tube the camera emerges from
  const tunnelMat = tubeShader();
  tunnelMat.uniforms.uColor.value.set(0x6fb0ff);
  scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(V(20, 0, 470), V(20, 0, 330)), 30, 6, 24, false), tunnelMat));

  // the target server: a cage of light around a core beam, in a hazy hall
  const core = new THREE.Group();
  core.position.set(CORE4.x, 0, CORE4.z);
  const barGeo = new THREE.BoxGeometry(1.2, 1400, 1.2);
  for (let k = 0; k < 24; k++) {
    const a = k / 24 * Math.PI * 2;
    core.add(new THREE.Mesh(barGeo, glow(0xbfe6ff, 0.22)).translateX(Math.cos(a) * 20).translateZ(Math.sin(a) * 20));
  }
  const frames = [];
  for (let y = -500; y <= 500; y += 60) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(20, 0.35, 8, 64), glow(0x9fd8ff, 0.3));
    m.rotation.x = Math.PI / 2; m.position.y = y;
    core.add(m); frames.push(m);
  }
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 1400, 32, 1, true), glow(0xd8f0ff, 0.35));
  core.add(beam);
  const coreHalo = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 1400, 32, 1, true), glow(0x6fb8ff, 0.05));
  core.add(coreHalo);
  scene.add(core);

  // haze: soft fog cards along the corridor and thick around the hall
  const hazeTex = canvasTex(256, 256, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(160,215,240,0.35)'); gr.addColorStop(1, 'rgba(160,215,240,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const hazes = [];
  for (let k = 0; k < 40; k++) {
    const nearCore = k < 18;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: hazeTex, color: 0x8fc8e6, transparent: true, opacity: nearCore ? 0.22 : 0.1, blending: THREE.AdditiveBlending, depthWrite: false }));
    if (nearCore) s.position.set(CORE4.x + (r() - 0.5) * 120, CORE4.y + (r() - 0.5) * 220, CORE4.z + (r() - 0.5) * 120);
    else s.position.set(20 + (r() - 0.5) * 10, (r() - 0.5) * 500, 300 - r() * 800);
    s.scale.setScalar(nearCore ? 110 : 70);
    scene.add(s);
    hazes.push([s, s.position.y, r() * 6]);
  }

  return {
    scene, bloom: [0.55, 0.5, 0.35],
    update(time) {
      rackMat.uniforms.uTime.value = time;
      tunnelMat.uniforms.uTime.value = time;
      tunnelMat.uniforms.uOpacity.value = 1 - ease(sp('4.1'));
      placeBridges(time);
      const hi = ease(sp('4.5'));
      beam.material.opacity = 0.14 + 0.18 * hi + 0.03 * Math.sin(time * 2);
      frames.forEach((m, k) => { m.material.opacity = 0.2 + 0.3 * hi * (0.5 + 0.5 * Math.sin(time * 1.5 - k * 0.4)); });
      hazes.forEach(([s, y0, ph]) => { s.position.y = y0 + Math.sin(time * 0.1 + ph) * 6; });
    },
  };
}

/* =====================================================================
   CHAPTER 5–6 · THE DIGITAL CORE → THE SCREEN
   ===================================================================== */
function buildCore() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05040c);
  scene.fog = new THREE.FogExp2(0x05040c, 0.006);
  const r = rng(51);

  scene.add(new THREE.AmbientLight(0x8877cc, 0.5));
  const l1 = new THREE.PointLight(COL.purple, 1500, 0, 2); l1.position.set(20, 20, 30); scene.add(l1);
  const l2 = new THREE.PointLight(COL.cyan, 900, 0, 2); l2.position.set(-25, -10, 20); scene.add(l2);
  const l3 = new THREE.PointLight(COL.light, 600, 0, 2); l3.position.set(0, 0, 0); scene.add(l3);

  // one set of cubes, five formations: tower → scatter → rings → core shell → screen grid
  const COLS = 48, ROWS = 27, N = COLS * ROWS;
  const F = [0, 1, 2, 3, 4].map(() => new Float32Array(N * 3));
  const ringE = [0, 1, 2, 3, 4, 5].map(k => new THREE.Euler(k % 2 ? 0.45 : -0.45, 0, k * 0.35));
  for (let i = 0; i < N; i++) {
    F[0].set([(i % 6 - 2.5) * 1.6, (Math.floor(i / 36) - 17.5) * 1.1, (Math.floor(i / 6) % 6 - 2.5) * 1.6], i * 3);
    const d = V(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(25 + r() * 35);
    F[1].set([d.x, d.y, d.z], i * 3);
    const k = i % 6, a = Math.floor(i / 6) / (N / 6) * Math.PI * 2, R = 12 + k * 4;
    const p = V(Math.cos(a) * R, 0, Math.sin(a) * R).applyEuler(ringE[k]);
    F[2].set([p.x, p.y, p.z], i * 3);
    const y = 1 - 2 * (i + 0.5) / N, rr = Math.sqrt(1 - y * y), ph = i * 2.39996;
    F[3].set([Math.cos(ph) * rr * 11, y * 11, Math.sin(ph) * rr * 11], i * 3);
    F[4].set([(i % COLS - (COLS - 1) / 2) * 0.667, (Math.floor(i / COLS) - (ROWS - 1) / 2) * 0.667, 0], i * 3);
  }
  const delay = Float32Array.from({ length: N }, () => r() * 0.3);
  const spin = Float32Array.from({ length: N }, () => r() * 6);

  const baseCol = [], uiCol = [];
  for (let i = 0; i < N; i++) {
    baseCol.push(new THREE.Color(COL.light).lerp(new THREE.Color(COL.cyan), r() * 0.4));
    const col = i % COLS, row = Math.floor(i / COLS);
    let c;
    if (row === ROWS - 1) c = new THREE.Color(0x3b2f6e);
    else if (col < 9) c = new THREE.Color(0x1a1533);
    else c = new THREE.Color(0x100d22);
    if (r() < 0.04) c = new THREE.Color(0x4c3a8f);
    uiCol.push(c);
  }
  const cubes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.6, emissive: 0x1a0b40 }), N);
  for (let i = 0; i < N; i++) cubes.setColorAt(i, baseCol[i]);
  scene.add(cubes);
  let lastCol = -1;

  // the guide rings of the information architecture
  const ringLines = ringE.map((e, k) => {
    const pts = [];
    for (let i = 0; i <= 128; i++) { const a = i / 128 * Math.PI * 2; pts.push(V(Math.cos(a) * (12 + k * 4), 0, Math.sin(a) * (12 + k * 4))); }
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: COL.purple, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    l.rotation.copy(e);
    scene.add(l);
    return l;
  });

  // the core itself
  const core = new THREE.Group();
  const coreMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(5, 1), new THREE.MeshBasicMaterial({ color: 0xd9ccff }));
  const shell1 = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(7.5, 1)), new THREE.LineBasicMaterial({ color: COL.light, transparent: true, opacity: 0.8 }));
  const shell2 = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(9.5, 0)), new THREE.LineBasicMaterial({ color: COL.cyan, transparent: true, opacity: 0.6 }));
  core.add(coreMesh, shell1, shell2);
  scene.add(core);

  // the screen that forms at the end
  const desktopTex = canvasTex(1024, 576, (g, w, h) => {
    g.fillStyle = '#08071a'; g.fillRect(0, 0, w, h);
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.6);
    gr.addColorStop(0, 'rgba(124,58,237,0.25)'); gr.addColorStop(1, 'rgba(124,58,237,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(124,58,237,0.12)';
    for (let x = 0; x < w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y < h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(32, 18), new THREE.MeshBasicMaterial({ map: desktopTex, transparent: true, opacity: 0 }));
  screen.position.z = 0.5;
  const bezel = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(32.6, 18.6)), new THREE.LineBasicMaterial({ color: COL.light, transparent: true, opacity: 0 }));
  bezel.position.z = 0.55;
  scene.add(screen, bezel);

  const tmp = V(0, 0, 0);
  return {
    scene, bloom: [1.0, 0.6, 0.15],
    update(time) {
      const raw = [sp('5.1'), sp('5.2'), sp('5.3'), sp('5.4')];
      const fill = ease(sp('6.1'));
      const scl = lerp(0.55, 0.667, fill);
      const wob = Math.sin(time * 0.2) * 0.6 * clamp(raw[1] * 2) * (1 - ease(raw[3]));
      const cw = Math.cos(wob), sw = Math.sin(wob);
      for (let i = 0; i < N; i++) {
        const j = i * 3;
        let x = F[0][j], y = F[0][j + 1], z = F[0][j + 2];
        for (let s = 0; s < 4; s++) {
          const a = ease(clamp((raw[s] - delay[i]) / 0.7));
          if (a <= 0) break;
          x = lerp(x, F[s + 1][j], a); y = lerp(y, F[s + 1][j + 1], a); z = lerp(z, F[s + 1][j + 2], a);
        }
        tmp.set(x * cw + z * sw, y, -x * sw + z * cw);
        const tumble = ease(clamp(raw[0] * 2)) * (1 - ease(clamp((raw[3] - delay[i]) / 0.7)));
        dummy.position.copy(tmp);
        dummy.rotation.set(tumble * (spin[i] + time * 0.6), tumble * (spin[i] * 1.3 + time * 0.4), 0);
        dummy.scale.setScalar(scl);
        dummy.updateMatrix();
        cubes.setMatrixAt(i, dummy.matrix);
      }
      cubes.instanceMatrix.needsUpdate = true;

      const cmix = ease(raw[3]);
      if (Math.abs(cmix - lastCol) > 1e-3) {
        const c = new THREE.Color();
        for (let i = 0; i < N; i++) cubes.setColorAt(i, c.copy(baseCol[i]).lerp(uiCol[i], cmix));
        cubes.instanceColor.needsUpdate = true;
        lastCol = cmix;
      }

      const ringOp = ease(raw[1]) * (1 - ease(raw[2]));
      ringLines.forEach((l, k) => { l.material.opacity = 0.5 * ringOp; l.rotation.y = wob; });

      const cs = (0.3 * ease(raw[1]) + 0.7 * ease(raw[2])) * (1 - ease(raw[3]));
      core.scale.setScalar(Math.max(cs, 0.0001));
      core.visible = cs > 0.001;
      coreMesh.rotation.y = time * 0.3; shell1.rotation.y = -time * 0.2; shell1.rotation.x = time * 0.1; shell2.rotation.z = time * 0.15;
      l3.intensity = 600 * cs;

      screen.material.opacity = fill;
      bezel.material.opacity = fill;
      bloom.strength = lerp(1.0, 0.35, fill);
    },
  };
}

/* =====================================================================
   HUD, SPOILERS, CHAPTER 6 OVERLAY
   ===================================================================== */
const $ = id => document.getElementById(id);
const fadeEl = $('fade');
const card = $('chapterCard'), ccNum = $('ccNum'), ccTitle = $('ccTitle'), ccSub = $('ccSub');
const hint = $('scrollHint'), bar = $('timelineBar');
const spoilers = [...document.querySelectorAll('.spoiler')];
const os = $('os'), desktop = $('desktop'), pointer = $('pointer'), browserIcon = $('browserIcon');
const terminal = $('terminal'), userField = $('userField'), passField = $('passField'), statusField = $('statusField');
const welcome = $('welcome'), welcomeCta = $('welcomeCta');

// chapter buttons in the timeline bar
const chRange = CHAPTERS.map((_, c) => {
  const first = SCENES.findIndex(s => s.ch === c + 1), last = SCENES.map(s => s.ch).lastIndexOf(c + 1);
  return [cum[first], cum[last + 1]];
});
const chFills = CHAPTERS.map((c, i) => {
  const b = document.createElement('button');
  b.title = `Chapter ${i + 1}: ${c.title}`;
  b.setAttribute('aria-label', b.title);
  const fill = document.createElement('i');
  b.appendChild(fill);
  b.addEventListener('click', () => jumpTo((chRange[i][0] + 0.02) / W));
  bar.appendChild(b);
  return fill;
});

function updateOS(q) {
  desktop.classList.toggle('visible', q < 0.29);
  const tx = 52, ty = 32, sx = 88, sy = 88;
  if (q < 0.03) {
    pointer.style.opacity = 0;
  } else if (q < 0.18) {
    const t = (q - 0.03) / 0.15;
    pointer.style.opacity = 1;
    pointer.style.left = lerp(sx, tx, t) + 'vw';
    pointer.style.top = lerp(sy, ty, t) + 'vh';
    pointer.classList.remove('clicked'); browserIcon.classList.remove('clicked');
  } else if (q < 0.25) {
    pointer.style.opacity = 1;
    pointer.style.left = tx + 'vw'; pointer.style.top = ty + 'vh';
    pointer.classList.add('clicked'); browserIcon.classList.add('clicked');
  } else {
    pointer.style.opacity = 0;
  }

  terminal.classList.toggle('visible', q > 0.25 && q < 0.8);
  if (q > 0.25 && q < 0.4) terminal.style.transformOrigin = `${tx}vw ${ty}vh`;

  const user = 'guest', dots = 8;
  if (q < 0.3) userField.innerHTML = '';
  else if (q < 0.45) userField.innerHTML = user.substring(0, Math.floor((q - 0.3) / 0.15 * user.length)) + '<span class="cursor-blink"></span>';
  else userField.textContent = user;

  if (q < 0.52) passField.innerHTML = '';
  else if (q < 0.64) passField.innerHTML = '•'.repeat(Math.floor((q - 0.52) / 0.12 * dots)) + '<span class="cursor-blink"></span>';
  else passField.textContent = '•'.repeat(dots);

  if (q < 0.64) { statusField.textContent = ''; statusField.classList.remove('success'); }
  else if (q < 0.7) { statusField.textContent = 'authenticating...'; statusField.classList.remove('success'); }
  else { statusField.textContent = 'access granted'; statusField.classList.add('success'); }

  if (q > 0.7 && q < 0.8) {
    const t = (q - 0.7) / 0.1;
    terminal.style.width = Math.min(innerWidth * 0.95, 460 + t * 600) + 'px';
    terminal.style.borderRadius = (8 - t * 8) + 'px';
  } else if (q <= 0.7) {
    terminal.style.width = ''; terminal.style.borderRadius = '';
  }

  welcome.classList.toggle('visible', q > 0.8);
  welcomeCta.classList.toggle('visible', q > 0.9);
}

let lastScene = -1;
function updateHUD(i, t) {
  const s = SCENES[i];
  if (i !== lastScene) {
    document.body.dataset.scene = s.id;
    ccNum.textContent = `Chapter ${s.ch}`;
    ccTitle.textContent = CHAPTERS[s.ch - 1].title;
    ccSub.textContent = CHAPTERS[s.ch - 1].sub;
    lastScene = i;
  }
  const firstOfCh = i === 0 || SCENES[i - 1].ch !== s.ch;
  card.style.opacity = firstOfCh && t < 0.6 ? (s.ch === 1 ? 1 : clamp(t / 0.1)) * clamp((0.6 - t) / 0.2) : 0;

  hint.style.opacity = X < 0.05 ? 1 : 0;
  chFills.forEach((f, c) => { f.style.width = clamp((X - chRange[c][0]) / (chRange[c][1] - chRange[c][0])) * 100 + '%'; });
  spoilers.forEach(el => el.classList.toggle('show', el.dataset.scene === s.id && t > 0.12 && t < 0.92));
  document.body.classList.toggle('at-end', X > W - 0.15);

  // chapter 6 overlay sits on top of the 3D screen
  const i61 = idx('6.1'), i62 = idx('6.2');
  os.style.opacity = i > i61 ? 1 : i === i61 ? ease(clamp((t - 0.5) / 0.5)) : 0;
  if (i >= i61) updateOS(clamp((X - cum[i62]) / (W - cum[i62])));
}

function updateFade() {
  let a = 0, color = '#000';
  for (let i = 1; i < SCENES.length; i++) {
    if (SCENES[i].realm === SCENES[i - 1].realm) continue;
    const k = 1 - clamp(Math.abs(X - cum[i]) / 0.3);
    if (k > a) { a = k; color = CUT_COLOR[SCENES[i].realm]; }
  }
  fadeEl.style.opacity = a;
  fadeEl.style.background = color;
}

/* =====================================================================
   SCROLL + LOOP
   ===================================================================== */
const scroller = $('scroller');
function sizeScroller() {
  const perScene = (mobile ? 0.6 : 0.7) * innerHeight;
  scroller.style.height = (W * perScene + innerHeight) + 'px';
}
const scrollP = () => clamp(scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight));
let snapNext = true;
function jumpTo(p) {
  snapNext = true;
  scrollTo({ top: p * (document.documentElement.scrollHeight - innerHeight), behavior: 'instant' });
}
$('skip').addEventListener('click', e => { e.preventDefault(); jumpTo(1); });

// ?debug adds a scene jumper for testing, e.g. __scene('3.5', 0.5)
if (new URLSearchParams(location.search).has('debug')) {
  window.__scene = (id, t = 0) => { const i = idx(id); jumpTo((cum[i] + SCENES[i].w * t) / W); };
}
for (const id of ['replay', 'replayTop']) $(id).addEventListener('click', e => { e.preventDefault(); jumpTo(0); });

const clock = $('clock');
const tick = () => { clock.textContent = new Date().toTimeString().split(' ')[0]; };
tick(); setInterval(tick, 1000);

/* =====================================================================
   AUTOPLAY: plays the journey like a film. Any scroll, touch or key
   press hands control straight back to the visitor.
   ===================================================================== */
const SEC_PER_UNIT = 2.3;   // overall speed: seconds per unit of scene weight (lower = faster)
const PACE = {              // per-scene slow-down for the hero moments (1 = normal)
  '1.2': 1.1, '1.3': 1.35, '2.4': 1.1, '3.6': 1.1, '4.3': 1.3, '4.5': 1.15, '6.5': 1.4,
};
const IDLE_START_MS = 6000; // start by itself if nobody scrolls this long on the first screen
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const playBtn = $('play'), playHint = $('playHint');
let playing = false, autoX = 0, interacted = false, idleTimer = null;

function setPlaying(on) {
  playing = on;
  if (on) autoX = X;
  playBtn.innerHTML = on ? '&#10074;&#10074; pause' : (X > 0.05 && X < W - 0.15 ? '&#9654; resume' : '&#9654; play');
  playBtn.setAttribute('aria-pressed', String(on));
}
function advanceAuto(dt) {
  if (!playing) return;
  let i = SCENES.length - 1;
  for (let k = 0; k < SCENES.length; k++) if (autoX < cum[k + 1]) { i = k; break; }
  autoX += dt / (SEC_PER_UNIT * (PACE[SCENES[i].id] || 1));
  if (autoX >= W) { autoX = W; setPlaying(false); }
  scrollTo({ top: autoX / W * (document.documentElement.scrollHeight - innerHeight), behavior: 'instant' });
}
playBtn.addEventListener('click', e => {
  e.preventDefault();
  interacted = true; clearTimeout(idleTimer);
  if (!playing && X >= W - 0.15) jumpTo(0);
  setPlaying(!playing);
});
const takeControl = e => {
  if (e && e.target instanceof Node && playBtn.contains(e.target)) return;
  interacted = true; clearTimeout(idleTimer);
  if (playing) setPlaying(false);
};
for (const type of ['wheel', 'touchstart', 'pointerdown']) addEventListener(type, takeControl, { passive: true });
addEventListener('keydown', e => { if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(e.key)) takeControl(e); });
function armIdleStart() {
  if (reduceMotion) return;
  idleTimer = setTimeout(() => {
    if (interacted || X > 0.05) return;
    setPlaying(true);
    playHint.classList.add('show');
    setTimeout(() => playHint.classList.remove('show'), 4500);
  }, IDLE_START_MS);
}

let REALMS = {};
let cur = 0, lastT = performance.now(), activeRealm = null;

function render(now) {
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  advanceAuto(dt);
  const target = scrollP();
  if (snapNext) { cur = target; snapNext = false; }
  else cur += (target - cur) * (1 - Math.exp(-dt * 4.5));
  if (Math.abs(target - cur) < 1e-5) cur = target;

  X = cur * W;
  let i = SCENES.length - 1;
  for (let k = 0; k < SCENES.length; k++) if (X < cum[k + 1]) { i = k; break; }
  const s = SCENES[i];
  const t = clamp((X - cum[i]) / s.w);

  const pose = s.cam(t, s.s);
  camera.position.copy(pose.pos);
  camera.lookAt(pose.look);
  if (pose.roll) camera.rotateZ(pose.roll);
  // on tall (phone) screens, keep the same horizontal view as a 1.2:1 screen
  let fov = pose.fov;
  if (camera.aspect < 1.2) fov = Math.min(110, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * 1.2 / camera.aspect)));
  if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }

  const realm = REALMS[s.realm];
  if (realm !== activeRealm) {
    [bloom.strength, bloom.radius, bloom.threshold] = realm.bloom;
    activeRealm = realm;
  }
  const time = now / 1000;
  realm.update(time, dt);
  renderPass.scene = realm.scene;
  composer.render();

  updateFade();
  updateHUD(i, t);
  requestAnimationFrame(render);
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  sizeScroller();
});

/* =====================================================================
   BOOT
   ===================================================================== */
async function boot() {
  const fill = $('bootFill');
  const frame = () => new Promise(res => requestAnimationFrame(res));
  sizeScroller();
  const builders = [['circuit', buildCircuit], ['board', buildBoard], ['room', buildRoom], ['net', buildNet], ['city', buildCity], ['core', buildCore]];
  for (let k = 0; k < builders.length; k++) {
    const [name, build] = builders[k];
    REALMS[name] = build();
    renderer.compile(REALMS[name].scene, camera);
    fill.style.width = ((k + 1) / builders.length * 100) + '%';
    await frame();
  }
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  scrollTo(0, 0);
  snapNext = true;
  requestAnimationFrame(render);
  await frame(); await frame();
  $('boot').classList.add('done');
  armIdleStart();
}
boot();
