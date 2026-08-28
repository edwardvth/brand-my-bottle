// v6 — clean rewrite. Curved-plane overlay stickers on a filtered bottle mesh.
// The stickers are actual curved geometry that matches the cylinder radius, so
// their dashed borders truly wrap the surface (no DecalGeometry gymnastics).

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createClient } from "@supabase/supabase-js";

// ---------- Supabase (reuses commit.cash's project; scoped to bmb_* tables) ----------
const SUPABASE_URL = "https://kmzjbyndzgaxkrdbrdof.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImttempieW5kemdheGtyZGJyZG9mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyNzc2NDEsImV4cCI6MjEwMjg1MzY0MX0.m5Ve5B2zbwxgSTQRceYurJT6jAZkjQYKDo5npvgvxx4";
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Amounts stored as INTEGER CENTS in Supabase; UI works in whole dollars.
const dollarsToCents = (d) => Math.round(Number(d) * 100);
const centsToDollars = (c) => Math.round(Number(c) / 100);

// ---------- Config ----------
const MODEL_URL = "stainless_steel_water_bottle.glb";
const BODY_NODE_NAME = "Water Bottle_5";
const STORAGE_KEY = "bmb.state.v7";
const AUCTION_END = Date.now() + 12 * 86400 * 1000 + 14 * 3600 * 1000;
const MIN_INCREMENT = 1;
const STARTING_BID = 1;

// 11 stickers (user OK'd going past 10 to restore the below-spot-4 tile).
//  - Spot 1:  LONG horizontal top banner (front, taller)
//  - Spot 2:  medium on the back-right, aligned above spot 4's left edge
//  - Spots 3/6/7/8/9: front die-5 quincunx (TL, TR, center, BL, BR)
//  - Spot 4:  XL quad on right side (upper)
//  - Spots 5, 10: extra-wide tall verticals on left side
//  - Spot 11: XL quad on right side (lower — the "spot beneath spot 4")
const _TAU3 = (Math.PI * 2) / 3;    // 120°
const _DIE_R = -0.72;               // right-column die corners (viewer's right = -theta)
const _DIE_L =  0.42;               // left-column die corners  (viewer's left  = +theta)
const SPOT_CONFIG = [
  // Row 1 (top): banner on front + medium above spot 4
  { id: 1,  y:  0.35, theta:  0,               wMul: 2.60, hMul: 1.10 }, // taller banner
  { id: 2,  y:  0.35, theta:  _TAU3 + 0.45,    wMul: 1.15, hMul: 1.15 }, // sits above spot 4 with left edges aligned (offset = spot4_half_arc − spot2_half_arc)
  // Front die-5 top row + side stickers
  { id: 3,  y: -0.05, theta:  _DIE_R,          wMul: 1.10, hMul: 1.35 }, // die TL (top-right of view), moved further right, taller
  { id: 4,  y: -0.05, theta:  _TAU3,           wMul: 2.00, hMul: 2.00 }, // QUAD right side (upper)
  { id: 5,  y: -0.05, theta: -_TAU3,           wMul: 1.60, hMul: 2.80 }, // TALL vertical left (wider)
  { id: 6,  y: -0.05, theta:  _DIE_L,          wMul: 1.10, hMul: 1.35 }, // die TR (top-left of view), taller
  // Front die-5 CENTER
  { id: 7,  y: -0.45, theta:  0,               wMul: 1.30, hMul: 1.30 }, // die CENTER
  // Front die-5 bottom row + side stickers
  { id: 8,  y: -0.85, theta:  _DIE_R,          wMul: 1.10, hMul: 1.35 }, // die BL, moved further right, taller
  { id: 9,  y: -0.85, theta:  _DIE_L,          wMul: 1.10, hMul: 1.35 }, // die BR, taller
  { id: 10, y: -0.85, theta: -_TAU3,           wMul: 1.60, hMul: 2.80 }, // TALL vertical left (wider)
  { id: 11, y: -0.85, theta:  _TAU3,           wMul: 2.00, hMul: 2.00 }, // QUAD right side (lower) — the spot beneath spot 4
];
const TOTAL = SPOT_CONFIG.length;

// ---------- State ----------
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (s?.spots) return s;
  } catch {}
  const spots = {};
  SPOT_CONFIG.forEach(s => { spots[s.id] = null; });
  return { spots };
}
function saveState(s) { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }
let state = loadState();

// ---------- Three.js scene ----------
const canvasEl = document.getElementById("scene");
const scene = new THREE.Scene();
scene.background = null;

const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
camera.position.set(0.5, 0.1, 1.2);

const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

// Lighting — subtle direct lights + a full studio environment map (PMREM) so
// the metallic bottle has real reflections. Without an environment map, PBR
// metallic materials look flat/dark; this is why the previous <model-viewer>
// bottle looked "properly metallic" — model-viewer sets `environment-image=neutral`
// by default. We replicate that with RoomEnvironment.
scene.add(new THREE.AmbientLight(0xffffff, 0.25));
const key = new THREE.DirectionalLight(0xffffff, 0.9);
key.position.set(2, 3, 2);
scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.35);
fill.position.set(-2, 1, -1);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffe8c8, 0.5);
rim.position.set(-1, 2, -2);
scene.add(rim);
const pmremGen = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGen.fromScene(new RoomEnvironment(), 0.04).texture;

// Controls
const controls = new OrbitControls(camera, canvasEl);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enableZoom = true;
controls.zoomSpeed = 2.5;             // faster zoom per wheel tick
controls.enablePan = false;
controls.minPolarAngle = Math.PI * 0.28;
controls.maxPolarAngle = Math.PI * 0.72;
controls.autoRotate = true;           // slow spin when idle
controls.autoRotateSpeed = 0.7;
// min/maxDistance set after model loads so they scale with the bottle

// Drag guard so click doesn't fire mid-drag. Autorotate pauses ONLY while user
// is actively holding down (mouse or finger). Releases resume the spin from the
// current camera angle at the same speed — no reset.
let didDrag = false;
canvasEl.addEventListener("pointerdown", () => {
  didDrag = false;
  controls.autoRotate = false;
});
canvasEl.addEventListener("pointermove", (e) => { if (e.buttons > 0) didDrag = true; });
canvasEl.addEventListener("pointerup",     () => { controls.autoRotate = true; });
canvasEl.addEventListener("pointerleave",  () => { controls.autoRotate = true; });
canvasEl.addEventListener("pointercancel", () => { controls.autoRotate = true; });
// wheel doesn't pause spin — just a quick zoom
canvasEl.addEventListener("wheel", (e) => { /* spin continues */ }, { passive: true });

// Debug overlay — silent in production; logs to console only. Errors still
// surface via an overlay when the GLB fails to load.
function setDebug(text, opts = {}) {
  if (!opts.error) { console.debug("[bmb]", text); return; }
  let d = document.getElementById("debug");
  if (!d) {
    d = document.createElement("div");
    d.id = "debug";
    d.style.cssText = "position:fixed;top:8px;left:8px;z-index:9999;background:#a1200f;color:#fff;font:12px/1.4 ui-monospace,Menlo,monospace;padding:10px 12px;border-radius:6px;max-width:360px;pointer-events:none;white-space:pre-wrap;";
    document.body.appendChild(d);
  }
  d.textContent = text;
}

// Resize
function resize() {
  const rect = canvasEl.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);

// ---------- Load model ----------
let bottleMesh = null;
let stickerMeshes = [];
let bodyGeom = null; // { radius, height, centerY }

const loader = new GLTFLoader();
loader.load(MODEL_URL, (gltf) => {
  const root = gltf.scene;
  scene.add(root);

  // Find the "Water Bottle_5" node — it contains BOTH the body mesh (Object_13, tall)
  // and its cap top (Object_14). Keep everything under this node visible; hide the
  // stand / duplicate bottles that live elsewhere in the scene.
  const bodyRoot = findNodeByName(root, BODY_NODE_NAME);
  const keepMeshes = new Set();
  if (bodyRoot) {
    bodyRoot.traverse((child) => {
      if (child.isMesh && child.geometry) {
        child.geometry.computeBoundingBox();
        const dims = getDims(child.geometry.boundingBox);
        keepMeshes.add(child);
        // The body is the tallest mesh in this sub-tree
        if (!bottleMesh || dims.y > (bottleMesh.geometry.boundingBox.max.y - bottleMesh.geometry.boundingBox.min.y)) {
          bottleMesh = child;
        }
      }
    });
  }
  // Fallback: tallest mesh anywhere
  if (!bottleMesh) {
    let bestY = 0;
    root.traverse((child) => {
      if (child.isMesh && child.geometry) {
        child.geometry.computeBoundingBox();
        const dy = child.geometry.boundingBox.max.y - child.geometry.boundingBox.min.y;
        if (dy > bestY) { bestY = dy; bottleMesh = child; keepMeshes.add(child); }
      }
    });
  }

  // Bright chrome / polished-stainless look — light silver base + full metalness
  // + very low roughness = mirror-like reflections. envMapIntensity boosted so
  // the RoomEnvironment PMREM reflections are punchy (defaults look muted).
  let hiddenCount = 0;
  const silverMat = new THREE.MeshStandardMaterial({
    color: 0xdcdcdc,
    metalness: 1.0,
    roughness: 0.12,
    envMapIntensity: 1.4,
  });
  root.traverse((child) => {
    if (!child.isMesh) return;
    if (!keepMeshes.has(child)) {
      child.visible = false;
      hiddenCount++;
    }
    if (Array.isArray(child.material)) {
      child.material = child.material.map(() => silverMat);
    } else if (child.material) {
      child.material = silverMat;
    }
  });

  // Union bbox of ALL kept meshes (body + cap) for correct total-height framing
  bottleMesh.updateMatrixWorld(true);
  const unionPre = new THREE.Box3();
  keepMeshes.forEach(m => unionPre.expandByObject(m));
  const preSize = unionPre.getSize(new THREE.Vector3());

  // Normalize total height, THEN widen X/Z so the bottle isn't twiggy.
  // The .glb bottle has ratio 3.4:1 (very tall/thin). A real Hydro Flask-style
  // bottle is more like 2.6:1, so we squash by widening horizontally.
  const targetTotalHeight = 0.62;
  const heightScale = targetTotalHeight / preSize.y;
  const widthScale  = heightScale * 1.60;  // 60% chunkier on X/Z (thicker barrel)
  root.scale.set(widthScale, heightScale, widthScale);
  root.updateMatrixWorld(true);

  // Recompute union bbox after non-uniform scaling
  const union = new THREE.Box3();
  keepMeshes.forEach(m => union.expandByObject(m));
  const uSize = union.getSize(new THREE.Vector3());
  const uCenter = union.getCenter(new THREE.Vector3());

  // Recenter whole model so its union-bbox center is at origin
  root.position.sub(uCenter);
  root.updateMatrixWorld(true);

  // Now measure the BODY mesh (for sticker placement) in the recentered world
  const bodyBox = new THREE.Box3().setFromObject(bottleMesh);
  const bSize = bodyBox.getSize(new THREE.Vector3());
  const bCenter = bodyBox.getCenter(new THREE.Vector3());
  bodyGeom = {
    radius: Math.max(bSize.x, bSize.z) / 2,
    height: bSize.y,
    centerY: bCenter.y,
  };

  // Build 12 curved sticker overlays on the body
  buildStickers();

  // Frame from UNION bbox (body + cap) so the cap fits in view too
  const framingBox = new THREE.Box3();
  keepMeshes.forEach(m => framingBox.expandByObject(m));
  const fSize = framingBox.getSize(new THREE.Vector3());
  const fCenter = framingBox.getCenter(new THREE.Vector3());
  const fovRad = camera.fov * Math.PI / 180;
  const rect = canvasEl.getBoundingClientRect();
  const aspect = Math.max(0.4, (rect.width || 1) / (rect.height || 1));
  const distForHeight = (fSize.y / 2) / Math.tan(fovRad / 2);
  const distForWidth  = (Math.max(fSize.x, fSize.z) / 2) / Math.tan(fovRad / 2) / aspect;
  const distance = Math.max(distForHeight, distForWidth) * 1.15;
  // Start camera on spot #1's axis so the spin naturally reveals #1 first.
  const startTheta = SPOT_CONFIG[0].theta;
  camera.position.set(
    distance * Math.cos(startTheta),
    fCenter.y + fSize.y * 0.05,
    distance * Math.sin(startTheta)
  );
  controls.target.set(0, fCenter.y, 0);
  controls.minDistance = distance * 0.45;
  controls.maxDistance = distance * 1.9;
  controls.update();

  // Add a bottom cap disc — this .glb's body mesh is open at the bottom, so
  // looking up from below revealed the sticker on the far side through the void.
  const bottomCap = new THREE.Mesh(
    new THREE.CircleGeometry(bodyGeom.radius, 48),
    silverMat
  );
  bottomCap.rotation.x = Math.PI / 2;                 // face downward
  bottomCap.position.y = bodyGeom.centerY - bodyGeom.height / 2;
  scene.add(bottomCap);

  resize();

  setDebug(
    `body mesh: ${bottleMesh?.name}\n` +
    `hidden meshes: ${hiddenCount}\n` +
    `radius: ${bodyGeom.radius.toFixed(3)}  height: ${bodyGeom.height.toFixed(3)}\n` +
    `centerY: ${bodyGeom.centerY.toFixed(3)}  camera dist: ${distance.toFixed(3)}\n` +
    `stickers: ${stickerMeshes.length}/${TOTAL}`
  );
}, undefined, (err) => {
  console.error("GLB load error:", err);
  setDebug(`GLB failed to load: ${err.message || err}`, { error: true });
});

// ---------- Helpers ----------
function findNodeByName(root, name) {
  let found = null;
  root.traverse((child) => {
    if (!found && child.name === name) found = child;
  });
  return found;
}
function getDims(bb) {
  return { x: bb.max.x - bb.min.x, y: bb.max.y - bb.min.y, z: bb.max.z - bb.min.z };
}

// ---------- Curved rectangle geometry ----------
// Creates a curved rectangle that sits on a cylinder of `radius` at height `centerY`,
// centered horizontally at angle `centerTheta`, spanning `arcAngle` radians horizontally
// and `height` world units vertically. The mesh's normals point outward.
function createCurvedRect(radius, centerTheta, arcAngle, height, centerY, segments = 20) {
  const geom = new THREE.BufferGeometry();
  const positions = [];
  const uvs = [];
  const normals = [];
  const indices = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const theta = centerTheta - arcAngle / 2 + t * arcAngle;
    const x = radius * Math.cos(theta);
    const z = radius * Math.sin(theta);
    const nx = Math.cos(theta);
    const nz = Math.sin(theta);

    // NOTE: UV u is (1 - t) not t. Reason: theta increases counter-clockwise around
    // the cylinder, but when a viewer stands OUTSIDE the cylinder looking IN at a
    // sticker, "increasing theta" moves LEFT in their view — so text drawn with
    // uv.u going 0→1 in that direction reads mirrored. Flipping to (1 - t) puts
    // uv.u=0 on the viewer's LEFT and uv.u=1 on their RIGHT, so text reads correctly.
    const u = 1 - t;

    // Bottom vertex
    positions.push(x, centerY - height / 2, z);
    uvs.push(u, 0);
    normals.push(nx, 0, nz);
    // Top vertex
    positions.push(x, centerY + height / 2, z);
    uvs.push(u, 1);
    normals.push(nx, 0, nz);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    indices.push(a, c, b);
    indices.push(b, c, d);
  }
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute("uv",       new THREE.Float32BufferAttribute(uvs, 2));
  geom.setAttribute("normal",   new THREE.Float32BufferAttribute(normals, 3));
  geom.setIndex(indices);
  return geom;
}

// ---------- Sticker texture ----------
// Cache logo <img> loads across re-renders so we don't refetch the same URL
// every time buildStickers() runs.
const _logoImgCache = new Map(); // src -> HTMLImageElement (may be still-loading)
function _loadLogoImage(src) {
  if (!src) return null;
  const cached = _logoImgCache.get(src);
  if (cached) return cached;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = src;
  _logoImgCache.set(src, img);
  return img;
}

function makeStickerTexture(spotId, price, taken, geomAspect = 1.35, opts = {}) {
  const { brand = null, logoSrc = null } = opts;
  const c = document.createElement("canvas");
  // Match canvas aspect to the sticker's world-geometry aspect so text renders
  // at true proportions instead of getting horizontally squashed.
  c.width = 640;
  c.height = Math.round(c.width / geomAspect);
  const ctx = c.getContext("2d");
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;

  const paper = "#f5f1ea";
  const ink   = "#0e0e0e";

  // Async logo load: draw placeholder first, then redraw + flag texture dirty
  // when the image lands.
  const logoImg = taken && logoSrc ? _loadLogoImage(logoSrc) : null;

  function draw() {
    ctx.clearRect(0, 0, c.width, c.height);
    const pad = Math.round(Math.min(c.width, c.height) * 0.07);

    if (taken) {
      // Paper card background
      ctx.fillStyle = paper;
      ctx.fillRect(pad, pad, c.width - pad * 2, c.height - pad * 2);
    } else {
      // Dashed empty state
      ctx.fillStyle = "rgba(245,241,234,0.18)";
      ctx.fillRect(pad, pad, c.width - pad * 2, c.height - pad * 2);
      ctx.strokeStyle = paper;
      ctx.lineWidth = 8;
      ctx.setLineDash([30, 18]);
      ctx.strokeRect(pad + 4, pad + 4, c.width - pad * 2 - 8, c.height - pad * 2 - 8);
      ctx.setLineDash([]);
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (!taken) {
      // Empty state: SPOT NN + $price stacked
      const labelSize = Math.round(c.height * 0.12);
      const priceSize = Math.round(c.height * 0.42);
      ctx.font = `bold ${labelSize}px Inter, -apple-system, sans-serif`;
      ctx.fillStyle = paper;
      ctx.fillText(`SPOT ${String(spotId).padStart(2, "0")}`, c.width / 2, c.height * 0.28);
      ctx.font = `bold ${priceSize}px Georgia, "Times New Roman", serif`;
      ctx.fillStyle = paper;
      ctx.fillText(`$${price.toLocaleString()}`, c.width / 2, c.height * 0.62);
      return;
    }

    // TAKEN state — Mac-app tile: logo on top, brand name, $price beneath.
    const inner = { x: pad, y: pad, w: c.width - pad * 2, h: c.height - pad * 2 };
    // 55% of card height for the logo, 45% for text stack
    const logoH = Math.round(inner.h * 0.55);
    const textTop = inner.y + logoH + Math.round(inner.h * 0.02);
    const brandSize = Math.round(inner.h * 0.14);
    const priceSize = Math.round(inner.h * 0.20);

    // Logo
    if (logoImg && logoImg.complete && logoImg.naturalWidth > 0) {
      const iw = logoImg.naturalWidth, ih = logoImg.naturalHeight;
      const boxW = inner.w - Math.round(inner.h * 0.14);
      const boxH = logoH - Math.round(inner.h * 0.06);
      const scale = Math.min(boxW / iw, boxH / ih);
      const dw = iw * scale, dh = ih * scale;
      const dx = inner.x + (inner.w - dw) / 2;
      const dy = inner.y + Math.round(inner.h * 0.05) + (boxH - dh) / 2;
      ctx.drawImage(logoImg, dx, dy, dw, dh);
    } else {
      // Placeholder square while the image loads (or if no logo uploaded)
      const boxW = Math.round(inner.h * 0.42);
      const boxH = boxW;
      const dx = inner.x + (inner.w - boxW) / 2;
      const dy = inner.y + Math.round(inner.h * 0.08);
      ctx.fillStyle = "rgba(14,14,14,0.08)";
      ctx.fillRect(dx, dy, boxW, boxH);
      if (brand) {
        ctx.fillStyle = "rgba(14,14,14,0.55)";
        ctx.font = `bold ${Math.round(boxH * 0.55)}px Inter, sans-serif`;
        ctx.fillText(brand.slice(0, 1).toUpperCase(), dx + boxW / 2, dy + boxH / 2);
      }
    }

    // Brand name
    ctx.fillStyle = ink;
    ctx.font = `600 ${brandSize}px Inter, -apple-system, sans-serif`;
    const brandTxt = (brand || `Spot ${spotId}`).slice(0, 24);
    ctx.fillText(brandTxt, c.width / 2, textTop + brandSize * 0.6);

    // Price
    ctx.fillStyle = ink;
    ctx.font = `bold ${priceSize}px Georgia, "Times New Roman", serif`;
    ctx.fillText(`$${price.toLocaleString()}`, c.width / 2, textTop + brandSize * 1.6 + priceSize * 0.4);
  }

  draw();
  tex.needsUpdate = true;

  if (logoImg && !logoImg.complete) {
    logoImg.addEventListener("load", () => { draw(); tex.needsUpdate = true; }, { once: true });
    logoImg.addEventListener("error", () => { /* keep placeholder */ }, { once: true });
  }
  return tex;
}

// ---------- Build 12 sticker meshes ----------
function buildStickers() {
  // Tear down any prior stickers
  stickerMeshes.forEach(m => {
    scene.remove(m);
    m.geometry.dispose();
    m.material.map?.dispose();
    m.material.dispose();
  });
  stickerMeshes = [];

  if (!bodyGeom) return;

  // y in SPOT_CONFIG is normalized [-1, +1]. Band widened + baseHeight bumped
  // (user wanted taller stickers) — still no overlap.
  // Verification: rows 0.40 apart → world Δy = 0.40 * 0.42 * body_h = 0.168 * body_h.
  // Max sticker height = 1.15 * 0.11 * body_h = 0.126 * body_h. Gap ≈ 0.04 body_h.
  const bandHalfHeight = bodyGeom.height * 0.42;
  const baseArc    = (Math.PI * 2) / 3 * 0.50;  // baseline sticker arc
  const baseHeight = bodyGeom.height * 0.11;    // ~22% taller than v6

  // Taper-aware local radius: cast a ray from the cylinder axis outward at the
  // sticker's Y and theta; hit the bottle surface; use that distance as the
  // local radius so stickers on the tapered top/bottom sit flush against the
  // surface (not floating at max-body-radius above the taper).
  const radiusRay = new THREE.Raycaster();
  radiusRay.far = bodyGeom.radius * 3;
  function localRadiusAt(theta, yWorld) {
    if (!bottleMesh) return bodyGeom.radius;
    radiusRay.set(
      new THREE.Vector3(0, yWorld, 0),
      new THREE.Vector3(Math.cos(theta), 0, Math.sin(theta)).normalize()
    );
    const hits = radiusRay.intersectObject(bottleMesh, false);
    // Fallback to body radius if the ray misses (e.g. sticker above cap)
    return hits.length > 0 ? hits[0].distance : bodyGeom.radius;
  }

  SPOT_CONFIG.forEach(cfg => {
    const spot = state.spots[cfg.id];
    const price = spot ? spot.amount : STARTING_BID;
    const taken = !!spot;

    // Per-axis size multipliers (backwards-compatible with sizeMul)
    const wMul = cfg.wMul ?? cfg.sizeMul ?? 1.0;
    const hMul = cfg.hMul ?? cfg.sizeMul ?? 1.0;
    const arcAngle = baseArc * wMul;
    const stickerH = baseHeight * hMul;
    const yWorld   = bodyGeom.centerY + cfg.y * bandHalfHeight;

    // Local radius at this sticker's exact position (handles taper)
    const localR = localRadiusAt(cfg.theta, yWorld);
    const stickerRadius = localR * 1.005;

    const arcLength = stickerRadius * arcAngle;
    const geomAspect = arcLength / stickerH;

    const geom = createCurvedRect(stickerRadius, cfg.theta, arcAngle, stickerH, yWorld);
    const texture = makeStickerTexture(cfg.id, price, taken, geomAspect, {
      brand:   spot?.brand || null,
      logoSrc: spot?.logo  || null,
    });
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geom, material);
    mesh.userData.spotId = cfg.id;
    // Store the actual local radius so the pill projects from the right spot
    mesh.userData.center = { theta: cfg.theta, yWorld, radius: stickerRadius };
    scene.add(mesh);
    stickerMeshes.push(mesh);
  });
}

// ---------- Click + hover detection ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const pillEl = document.getElementById("hover-pill");
const pillVerbEl = document.getElementById("pill-verb");
const pillPriceEl = document.getElementById("pill-price");
let hoveredSpotId = null;

function raycastSticker(clientX, clientY) {
  const rect = canvasEl.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(stickerMeshes, false);
  if (hits.length === 0) return null;
  const bottleHits = bottleMesh ? raycaster.intersectObject(bottleMesh, false) : [];
  if (bottleHits.length === 0 || hits[0].distance <= bottleHits[0].distance + 0.01) {
    return hits[0].object;
  }
  return null;
}

canvasEl.addEventListener("click", (e) => {
  if (didDrag) return;
  const hit = raycastSticker(e.clientX, e.clientY);
  if (hit) openBidModal(hit.userData.spotId);
});

// Hover → move & show the Outbid pill at the hovered sticker's screen position
canvasEl.addEventListener("pointermove", (e) => {
  if (e.buttons > 0) return;  // ignore while dragging
  const hit = raycastSticker(e.clientX, e.clientY);
  if (!hit) {
    hoveredSpotId = null;
    pillEl.hidden = true;
    canvasEl.style.cursor = "grab";
    return;
  }
  const spotId = hit.userData.spotId;
  hoveredSpotId = spotId;
  const spot = state.spots[spotId];
  const price = spot ? spot.amount : STARTING_BID;
  const verb = spot ? "Outbid" : "Bid";
  pillVerbEl.textContent = verb;
  pillPriceEl.textContent = `$${(spot ? price + MIN_INCREMENT : price).toLocaleString()}`;
  positionPillAt(hit);
  pillEl.hidden = false;
  canvasEl.style.cursor = "pointer";
});
canvasEl.addEventListener("pointerleave", (e) => {
  // If the mouse is moving ONTO the pill (which now has pointer-events:auto so
  // it's actually clickable), don't hide it — otherwise we get an infinite
  // hide→show flicker.
  if (e.relatedTarget === pillEl || (pillEl && pillEl.contains && pillEl.contains(e.relatedTarget))) return;
  hoveredSpotId = null;
  pillEl.hidden = true;
});
// Direct pill click — opens the modal for the currently-hovered sticker.
pillEl.addEventListener("click", (e) => {
  e.stopPropagation();
  if (hoveredSpotId != null) openBidModal(hoveredSpotId);
});
// Keep pill visible while mouse hovers it
pillEl.addEventListener("pointerleave", (e) => {
  // If leaving pill but not going back onto the canvas, hide
  if (e.relatedTarget !== canvasEl) {
    hoveredSpotId = null;
    pillEl.hidden = true;
  }
});

// Project a sticker's 3D center to screen coords and place the pill there
function positionPillAt(mesh) {
  const c = mesh.userData.center;
  if (!c) return;
  // Slightly OUT from the sticker's own local radius (not the bottle's max radius)
  const outR = (c.radius || 1) * 1.04;
  const world = new THREE.Vector3(
    outR * Math.cos(c.theta),
    c.yWorld,
    outR * Math.sin(c.theta),
  );
  world.project(camera);
  const rect = canvasEl.getBoundingClientRect();
  const x = ((world.x + 1) / 2) * rect.width;
  const y = ((-world.y + 1) / 2) * rect.height;
  pillEl.style.left = `${x}px`;
  pillEl.style.top  = `${y}px`;
}
// Keep pill following the sticker while the bottle spins / user drags
function updatePillPosition() {
  if (!pillEl.hidden && hoveredSpotId != null) {
    const m = stickerMeshes.find(m => m.userData.spotId === hoveredSpotId);
    if (m) positionPillAt(m);
  }
}

// ---------- Render loop ----------
function loop() {
  controls.update();
  updatePillPosition();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();

// ---------- Grid (below the fold) ----------
function mountGrid() {
  const grid = document.getElementById("spot-grid");
  grid.innerHTML = "";
  for (let i = 1; i <= TOTAL; i++) {
    const card = document.createElement("button");
    card.className = "spot-card";
    card.type = "button";
    card.dataset.id = i;
    card.addEventListener("click", () => openBidModal(i));
    grid.appendChild(card);
  }
  refreshGrid();
}
function refreshGrid() {
  document.querySelectorAll(".spot-card").forEach(el => {
    const id = parseInt(el.dataset.id, 10);
    const spot = state.spots[id];
    if (spot) {
      el.classList.add("taken");
      el.innerHTML = `
        <div class="spot-num">Spot ${String(id).padStart(2, "0")}</div>
        <div class="spot-bid">$${spot.amount.toLocaleString()}</div>
        <div class="spot-bidder">${escapeHtml(spot.bidderMasked)}</div>
      `;
    } else {
      el.classList.remove("taken");
      el.innerHTML = `
        <div class="spot-num">Spot ${String(id).padStart(2, "0")}</div>
        <div class="spot-bid">$${STARTING_BID}</div>
        <div class="spot-cta">Open · bid →</div>
      `;
    }
  });
}

// ---------- Totals ----------
function refreshTotals() {
  const vals = Object.values(state.spots);
  const raised = vals.reduce((sum, s) => sum + (s ? s.amount : 0), 0);
  const taken  = vals.filter(Boolean).length;
  const high   = Math.max(0, ...vals.filter(Boolean).map(s => s.amount));
  document.getElementById("raised-amount").textContent = raised.toLocaleString();
  document.getElementById("taken-count").textContent = taken;
  const totalEl = document.getElementById("taken-total");
  if (totalEl) totalEl.textContent = TOTAL;
  document.getElementById("high-bid").textContent = `$${high.toLocaleString()}`;
}

// ---------- Bid modal ----------
// Descriptive labels + rough physical sticker size (from SPOT_CONFIG sizeMul)
const SPOT_META = {
  1:  { name: "Front — top banner",   size: "Long banner"  },
  2:  { name: "Right — upper small",  size: "Medium"       },
  3:  { name: "Front — top-right",    size: "Medium+"      },
  4:  { name: "Right — upper",        size: "XL (4× area)" },
  5:  { name: "Left — middle",        size: "Tall vertical"},
  6:  { name: "Front — top-left",     size: "Medium+"      },
  7:  { name: "Front — center",       size: "Medium+"      },
  8:  { name: "Front — bottom-right", size: "Medium+"      },
  9:  { name: "Front — bottom-left",  size: "Medium+"      },
  10: { name: "Left — bottom",        size: "Tall vertical"},
  11: { name: "Right — lower",        size: "XL (4× area)" },
};

const bidInput      = document.getElementById("bid-input");
const bidCurrent    = document.getElementById("bid-current");
const bidCurrentBid = document.getElementById("bid-current-bidder");
const bidCountWrap  = document.getElementById("bid-count-wrap");
const bidCountEl    = document.getElementById("bid-count");
const bidMinEl      = document.getElementById("bid-min");
const bidSubmit     = document.getElementById("bid-submit");
const bidSubmitAmt  = document.getElementById("bid-submit-amt");
const bidTitleEl    = document.getElementById("bid-modal-title");
const bidSpotName   = document.getElementById("bid-spot-name");
const bidSpotSize   = document.getElementById("bid-spot-size");
const bidSpotDims   = document.getElementById("bid-spot-dims");
const depTotal      = document.getElementById("dep-total");
const depAmount     = document.getElementById("dep-amount");
const depAmount2    = document.getElementById("dep-amount-2");
const brandNameEl   = document.getElementById("brand-name");
const brandEmailEl  = document.getElementById("brand-email");
const brandWebEl    = document.getElementById("brand-website");
const brandXEl      = document.getElementById("brand-x");
const logoInput     = document.getElementById("logo-input");
const logoDropEl    = document.getElementById("logo-drop");
const logoDropInner = document.getElementById("logo-drop-inner");
const logoPreview   = document.getElementById("logo-preview");
const logoPreviewImg= document.getElementById("logo-preview-img");
const logoRemoveBtn = document.getElementById("logo-remove");
let uploadedLogoDataUrl = null;

function openBidModal(spotId) {
  const spot = state.spots[spotId];
  const current = spot ? spot.amount : 0;
  const min = current ? current + MIN_INCREMENT : STARTING_BID;
  const meta = SPOT_META[spotId] || { name: "Sticker", size: "Medium" };
  const bidCount = spot ? (spot.bidCount || 1) : 0;

  // Header
  bidTitleEl.innerHTML = `Spot ${spotId} · <span id="bid-spot-name">${escapeHtml(meta.name)}</span>`;
  bidSpotSize.textContent = `${meta.size} sticker`;
  const dims = computeStickerDimsForSpot(spotId);
  bidSpotDims.textContent = dims ? `${dims.w} × ${dims.h} cm` : "";
  bidCurrent.textContent = current.toLocaleString();
  bidCurrentBid.textContent = spot?.bidderMasked ? ` by ${spot.bidderMasked}` : "";
  bidCountEl.textContent = bidCount;
  bidCountWrap.hidden = bidCount === 0;

  // Amount input
  bidInput.min = min;
  bidInput.value = min;
  bidMinEl.textContent = min;
  bidInput.oninput = updateDeposit;
  updateDeposit();

  // Reset fields for new-bid state
  document.getElementById("bid-form").reset();
  bidInput.value = min;
  updateDeposit();
  clearLogo();

  // Change primary button verb: "Bid" vs "Outbid <name>"
  const verbTxt = spot ? `Outbid ${spot.bidderMasked || "current bidder"}` : "Bid";
  bidSubmit.innerHTML = `${escapeHtml(verbTxt)} · <span id="bid-submit-amt">$${min}</span>`;

  document.getElementById("bid-form").dataset.spotId = spotId;
  document.getElementById("bid-modal").hidden = false;
  bidInput.focus();
  bidInput.select();
}

// Live update: your-bid → deposit (20%) → submit button label
function updateDeposit() {
  const v = parseInt(bidInput.value, 10);
  if (!isFinite(v) || v < 1) {
    depTotal.textContent = depAmount.textContent = depAmount2.textContent = "—";
    return;
  }
  const dep = Math.max(1, Math.round(v * 0.20));
  depTotal.textContent = v.toLocaleString();
  depAmount.textContent = dep.toLocaleString();
  depAmount2.textContent = dep.toLocaleString();
  const amtEl = document.getElementById("bid-submit-amt");
  if (amtEl) amtEl.textContent = `$${v.toLocaleString()}`;
}

// Rough physical dimensions (baseline sticker ~3.7×2.6 cm, scaled by per-axis mul).
function computeStickerDimsForSpot(spotId) {
  const cfg = SPOT_CONFIG.find(s => s.id === spotId);
  if (!cfg) return null;
  const wBase = 3.7, hBase = 2.6;
  const wMul = cfg.wMul ?? cfg.sizeMul ?? 1.0;
  const hMul = cfg.hMul ?? cfg.sizeMul ?? 1.0;
  return { w: (wBase * wMul).toFixed(1), h: (hBase * hMul).toFixed(1) };
}

function closeBidModal() { document.getElementById("bid-modal").hidden = true; }
document.getElementById("modal-close").addEventListener("click", closeBidModal);
document.getElementById("bid-modal").addEventListener("click", (e) => {
  if (e.target.id === "bid-modal") closeBidModal();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeBidModal(); });

// Logo file → dataURL preview
logoInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    uploadedLogoDataUrl = reader.result;
    logoPreviewImg.src = reader.result;
    logoPreview.hidden = false;
    logoDropInner.hidden = true;
  };
  reader.readAsDataURL(file);
});
logoRemoveBtn.addEventListener("click", (e) => {
  e.preventDefault();
  clearLogo();
});
function clearLogo() {
  uploadedLogoDataUrl = null;
  logoInput.value = "";
  logoPreview.hidden = true;
  logoDropInner.hidden = false;
}
// Drag & drop
["dragover", "dragenter"].forEach(ev =>
  logoDropEl.addEventListener(ev, (e) => { e.preventDefault(); logoDropEl.classList.add("drag"); })
);
["dragleave", "dragend", "drop"].forEach(ev =>
  logoDropEl.addEventListener(ev, () => logoDropEl.classList.remove("drag"))
);
logoDropEl.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files?.[0];
  if (!file) return;
  logoInput.files = e.dataTransfer.files;
  const evt = new Event("change", { bubbles: true });
  logoInput.dispatchEvent(evt);
});

document.getElementById("bid-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const spotId = parseInt(form.dataset.spotId, 10);
  const brand   = brandNameEl.value.trim();
  const email   = brandEmailEl.value.trim();
  const website = brandWebEl.value.trim();
  const xHandle = brandXEl.value.trim();
  const amount  = parseInt(bidInput.value, 10);
  const current = state.spots[spotId] ? state.spots[spotId].amount : 0;
  const min = current ? current + MIN_INCREMENT : STARTING_BID;
  if (amount < min) { alert(`Minimum bid is $${min}`); return; }

  const logoFile = logoInput.files?.[0] || null;

  // Bids are only recorded AFTER Stripe captures the 20% deposit — the row
  // is written by the `bmb-stripe-webhook` Edge Function on
  // `checkout.session.completed`. Do NOT optimistically pin the spot here:
  // if we did, a user who abandons Stripe would visually own the spot until
  // the next syncFromSupabase poll.
  //
  // Freeze the button so an impatient double-click doesn't open two Stripe
  // sessions (each of which would ask for a deposit).
  const submitBtn = document.getElementById("bid-submit");
  const submitOrig = submitBtn?.innerHTML;
  if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = "Opening secure checkout…"; }

  try {
    // 1) Upload logo to public storage. The bucket allows anon insert and is
    //    unrelated to money — worst case a bogus logo sits in storage and is
    //    never referenced because Stripe was never paid.
    let logoUrl = null;
    if (logoFile) {
      const ext = (logoFile.name.split(".").pop() || "png").toLowerCase();
      const key = `${spotId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
      const { error: upErr } = await sb.storage.from("bmb-logos").upload(key, logoFile, {
        contentType: logoFile.type,
        cacheControl: "3600",
        upsert: false,
      });
      if (upErr) throw new Error(`Logo upload failed: ${upErr.message}`);
      const { data: pub } = sb.storage.from("bmb-logos").getPublicUrl(key);
      logoUrl = pub?.publicUrl || null;
    }

    // 2) Ask the Edge Function to open a Stripe Checkout session for the 20%
    //    deposit. Metadata carries the full bid payload — the webhook reads
    //    it back and inserts the row.
    const res = await fetch(`${SUPABASE_URL}/functions/v1/bmb-create-checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        spot_id: spotId,
        amount_cents: dollarsToCents(amount),
        brand,
        email,
        website: website || null,
        x_handle: xHandle || null,
        logo_url: logoUrl,
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload?.url) {
      throw new Error(payload?.error || `checkout request failed (${res.status})`);
    }

    // 3) Redirect. On return the URL will carry ?bid=success or ?bid=cancel —
    //    see the boot-time toast handler at the very bottom of this file.
    window.location.href = payload.url;
  } catch (err) {
    console.error("[bmb] checkout failed:", err);
    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = submitOrig || "Bid"; }
    alert(`Sorry — couldn't start checkout.\n\n${err.message || err}\n\nNothing was charged. Try again.`);
  }
});

// ---------- Countdown ----------
function tickCountdown() {
  const ms = AUCTION_END - Date.now();
  const el = document.getElementById("countdown");
  if (!el) return;
  if (ms <= 0) { el.textContent = "auction closed"; return; }
  const d = Math.floor(ms / (86400 * 1000));
  const h = Math.floor((ms / (3600 * 1000)) % 24);
  const m = Math.floor((ms / (60 * 1000)) % 60);
  el.textContent = `${d}d ${h}h ${m}m`;
}

// ---------- Helpers ----------
function maskEmail(email) {
  const [user, domain] = email.split("@");
  if (!domain) return email;
  const u = user.length <= 2 ? user[0] + "•" : user.slice(0, 2) + "•".repeat(Math.max(1, user.length - 2));
  return `${u}@${domain}`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}

// ---------- Supabase load: fetch current top bid per spot ----------
async function syncFromSupabase() {
  try {
    const { data, error } = await sb.from("bmb_current_bids").select("*");
    if (error) throw error;
    if (!Array.isArray(data)) return;
    // Merge into local state (Supabase is authoritative for public bid info)
    let changed = false;
    data.forEach(row => {
      const local = state.spots[row.spot_id];
      const amount = centsToDollars(row.amount_cents);
      const brand = row.brand || "";
      if (!local || amount > local.amount) {
        state.spots[row.spot_id] = {
          amount,
          brand,
          bidder: row.brand,        // no email exposed via view
          bidderMasked: brand,
          website: row.website || null,
          x_handle: row.x_handle || null,
          logo: row.logo_url || null,
          bidCount: (local?.bidCount || 0) + 1,
          at: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
        };
        changed = true;
      }
    });
    if (changed) {
      saveState(state);
      buildStickers();
      refreshGrid();
      refreshTotals();
    }
  } catch (err) {
    console.warn("[bmb] Supabase sync failed — using localStorage only.", err.message || err);
  }
}

// ---------- Supabase: upload logo to storage + insert bid ----------
async function submitBidToSupabase({ spotId, amount, brand, email, website, xHandle, logoFile }) {
  let logoUrl = null;
  if (logoFile) {
    // Upload to bmb-logos bucket
    const ext = (logoFile.name.split(".").pop() || "png").toLowerCase();
    const key = `${spotId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const { error: upErr } = await sb.storage.from("bmb-logos").upload(key, logoFile, {
      contentType: logoFile.type,
      cacheControl: "3600",
      upsert: false,
    });
    if (upErr) throw new Error(`Logo upload failed: ${upErr.message}`);
    const { data: pub } = sb.storage.from("bmb-logos").getPublicUrl(key);
    logoUrl = pub?.publicUrl || null;
  }

  const { data, error } = await sb.from("bmb_bids").insert({
    spot_id: spotId,
    amount_cents: dollarsToCents(amount),
    brand,
    email,
    website: website || null,
    x_handle: xHandle || null,
    logo_url: logoUrl,
  }).select().single();
  if (error) throw new Error(`Bid insert failed: ${error.message}`);
  return { ...data, logoUrl };
}

// ---------- Init ----------
mountGrid();
refreshTotals();
tickCountdown();
setInterval(tickCountdown, 30 * 1000);
resize();
syncFromSupabase();
// Poll every 20s for competing bids
setInterval(syncFromSupabase, 20 * 1000);

// ---------- Stripe return-from-Checkout toast ----------
// Kept at the very bottom of the file to minimise conflict area with the 3D
// scene code above. When Stripe redirects the user back to the site the URL
// carries ?bid=success or ?bid=cancel. On success we show a small toast and
// force a fresh pull from Supabase — the webhook may still be in flight, so
// we retry a few times.
(function handleCheckoutReturn() {
  try {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("bid");
    if (outcome !== "success" && outcome !== "cancel") return;

    // Strip the query param so a refresh doesn't re-toast.
    const cleanUrl = window.location.pathname + window.location.hash;
    window.history.replaceState({}, "", cleanUrl);

    const toast = document.createElement("div");
    toast.style.cssText =
      "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:10000;" +
      "background:#0e0e0e;color:#f5f1ea;padding:12px 18px;border-radius:999px;" +
      "font:500 14px/1.3 Inter,-apple-system,sans-serif;" +
      "box-shadow:0 12px 28px rgba(0,0,0,0.25);max-width:88vw;text-align:center;" +
      "transition:opacity .4s ease,transform .4s ease;opacity:0;";
    toast.textContent = outcome === "success"
      ? "Deposit captured. Refreshing the board…"
      : "Payment cancelled — nothing was charged.";
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = "1"; });

    if (outcome === "success") {
      // Webhook usually lands within a second; give it a few tries before
      // giving up. syncFromSupabase() rebuilds the stickers + grid + totals.
      let tries = 0;
      const poll = () => {
        if (typeof syncFromSupabase === "function") syncFromSupabase();
        tries += 1;
        if (tries < 6) setTimeout(poll, 1500);
      };
      poll();
    }

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(-50%) translateY(8px)";
      setTimeout(() => toast.remove(), 500);
    }, 4500);
  } catch (err) {
    console.warn("[bmb] checkout-return toast failed:", err);
  }
})();
