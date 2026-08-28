// v6 — clean rewrite. Curved-plane overlay stickers on a filtered bottle mesh.
// The stickers are actual curved geometry that matches the cylinder radius, so
// their dashed borders truly wrap the surface (no DecalGeometry gymnastics).

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
// bottle-slim.glb is meshopt-compressed — MeshoptDecoder must be wired in
// or GLTFLoader will throw KHR_mesh_quantization/meshopt errors.
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
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
  { id: 5,  y:  0.10, theta: -_TAU3,           wMul: 1.60, hMul: 2.50 }, // TALL vertical left — centered in the UPPER half (between top banner row and equator)
  { id: 6,  y: -0.05, theta:  _DIE_L,          wMul: 1.10, hMul: 1.35 }, // die TR (top-left of view), taller
  // Front die-5 CENTER
  { id: 7,  y: -0.45, theta:  0,               wMul: 1.30, hMul: 1.30 }, // die CENTER
  // Front die-5 bottom row + side stickers
  { id: 8,  y: -0.85, theta:  _DIE_R,          wMul: 1.10, hMul: 1.35 }, // die BL, moved further right, taller
  { id: 9,  y: -0.85, theta:  _DIE_L,          wMul: 1.10, hMul: 1.35 }, // die BR, taller
  { id: 10, y: -0.70, theta: -_TAU3,           wMul: 1.60, hMul: 2.50 }, // TALL vertical left — centered in the LOWER half; stops before the bottom taper
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

// Drag guard so click/tap doesn't fire mid-drag. Autorotate pauses ONLY while
// user is actively holding down (mouse or finger). Releases resume the spin
// from the current camera angle at the same speed — no reset.
//
// Uses a distance THRESHOLD (px from pointerdown position) rather than any-
// motion because touch events always fire tiny pointermove during a real tap
// (finger wobble), which would flip didDrag=true and kill the bid modal.
const DRAG_THRESHOLD_PX = 10;
let didDrag = false;
let downX = 0, downY = 0;
canvasEl.addEventListener("pointerdown", (e) => {
  didDrag = false;
  downX = e.clientX;
  downY = e.clientY;
  controls.autoRotate = false;
});
canvasEl.addEventListener("pointermove", (e) => {
  if (e.buttons === 0 && e.pointerType !== "touch") return;
  const dx = e.clientX - downX;
  const dy = e.clientY - downY;
  if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) didDrag = true;
});
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
loader.setMeshoptDecoder(MeshoptDecoder);
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

  // GLB is loaded + stickers built — hide the spinner on the next frame
  // (giving the render loop one tick to paint the real scene first so we
  // don't fade out onto a blank canvas).
  const loaderEl = document.getElementById("bottle-loader");
  if (loaderEl) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        loaderEl.classList.add("hide");
        setTimeout(() => loaderEl.classList.add("gone"), 500);
      });
    });
  }

  // Frame from union of every VISIBLE mesh under the root, not just
  // keepMeshes — the source model renders extra meshes (the cap!) that
  // aren't in the sticker-body sub-tree. Framing on keepMeshes alone
  // cut off the bottom of the bottle once we tightened the multiplier.
  const framingBox = new THREE.Box3();
  root.traverse((child) => {
    if (child.isMesh && child.visible !== false && child.geometry) {
      framingBox.expandByObject(child);
    }
  });
  const fSize = framingBox.getSize(new THREE.Vector3());
  const fCenter = framingBox.getCenter(new THREE.Vector3());
  const fovRad = camera.fov * Math.PI / 180;
  const rect = canvasEl.getBoundingClientRect();
  const aspect = Math.max(0.4, (rect.width || 1) / (rect.height || 1));
  const distForHeight = (fSize.y / 2) / Math.tan(fovRad / 2);
  const distForWidth  = (Math.max(fSize.x, fSize.z) / 2) / Math.tan(fovRad / 2) / aspect;
  // Both viewports load at the owner-tuned spherical view (2026-08-28):
  //   azimuth = -75° (measured from +Z, positive toward +X — three.js convention)
  //   elevation = 14° (above the equator)
  //   distance + target from earlier dev-panel tune
  const isMobile = rect.width < 640;
  const distance = isMobile ? 1.480 : 1.637;
  const targetY  = isMobile ? -0.041 : -0.082;
  const azimuthDeg   = -75;
  const elevationDeg =  14;
  const theta = THREE.MathUtils.degToRad(azimuthDeg);
  const phi   = THREE.MathUtils.degToRad(90 - elevationDeg);
  const sinPhi = Math.sin(phi);
  controls.target.set(0, targetY, 0);
  camera.position.set(
    sinPhi * distance * Math.sin(theta),
    targetY + Math.cos(phi) * distance,
    sinPhi * distance * Math.cos(theta)
  );
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
    `centerY: ${bodyGeom.centerY.toFixed(3)}\n` +
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
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (!taken) {
      // Empty state: dashed cream frame + SPOT NN + $price
      ctx.fillStyle = "rgba(245,241,234,0.18)";
      ctx.fillRect(pad, pad, c.width - pad * 2, c.height - pad * 2);
      ctx.strokeStyle = paper;
      ctx.lineWidth = 8;
      ctx.setLineDash([30, 18]);
      ctx.strokeRect(pad + 4, pad + 4, c.width - pad * 2 - 8, c.height - pad * 2 - 8);
      ctx.setLineDash([]);

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

    // TAKEN state — App-Store-tile look:
    //   - Big logo on a paper-cream card at the TOP (~62% of sticker height).
    //     The paper card exists so transparent-PNG artwork still reads —
    //     everything OUTSIDE the card is transparent so the bottle shows.
    //   - Brand name in bold paper-cream sits DIRECTLY on the bottle (same
    //     color language as the empty stickers).
    //   - Smaller "Outbid · $N" line beneath, same cream color.

    // Image dominates but text sizes bumped so brand + outbid stay readable
    // from real bottle distance. Card slightly smaller (0.66 vs 0.78) to make
    // room; the trade-off is worth it since the image is still the biggest
    // element on the sticker.
    const inner  = { x: pad, y: pad, w: c.width - pad * 2, h: c.height - pad * 2 };
    const cardH  = Math.round(inner.h * 0.66);
    const brandSize   = Math.round(inner.h * 0.19);
    const outbidSize  = Math.round(inner.h * 0.13);
    const gapTextTop  = Math.round(inner.h * 0.03);
    const brandY      = inner.y + cardH + gapTextTop + brandSize * 0.55;
    const outbidY     = brandY + brandSize * 0.60 + outbidSize * 0.80;

    // Paper card behind logo (catches transparent-PNG artwork)
    ctx.fillStyle = paper;
    ctx.fillRect(inner.x, inner.y, inner.w, cardH);

    // Logo, contained within the paper card with a tight inset so the image
    // fills the card visibly. Small breathing room only.
    const cardInset = Math.round(inner.h * 0.03);
    const boxW = inner.w  - cardInset * 2;
    const boxH = cardH    - cardInset * 2;
    if (logoImg && logoImg.complete && logoImg.naturalWidth > 0) {
      const iw = logoImg.naturalWidth, ih = logoImg.naturalHeight;
      const scale = Math.min(boxW / iw, boxH / ih);
      const dw = iw * scale, dh = ih * scale;
      const dx = inner.x + (inner.w - dw) / 2;
      const dy = inner.y + cardInset + (boxH - dh) / 2;
      ctx.drawImage(logoImg, dx, dy, dw, dh);
    } else if (brand) {
      // Placeholder: giant first letter of brand while image loads / if none
      ctx.fillStyle = "rgba(14,14,14,0.55)";
      ctx.font = `bold ${Math.round(boxH * 0.65)}px Inter, sans-serif`;
      ctx.fillText(brand.slice(0, 1).toUpperCase(), inner.x + inner.w / 2, inner.y + cardInset + boxH / 2);
    }

    // Brand name — cream text on transparent bg (over the bottle)
    ctx.fillStyle = paper;
    ctx.font = `700 ${brandSize}px Inter, -apple-system, sans-serif`;
    const brandTxt = (brand || `Spot ${spotId}`).slice(0, 28);
    ctx.fillText(brandTxt, inner.x + inner.w / 2, brandY);

    // Outbid line — smaller cream text on transparent bg
    ctx.fillStyle = paper;
    ctx.font = `500 ${outbidSize}px Inter, -apple-system, sans-serif`;
    ctx.fillText(`Outbid · $${(price + 1).toLocaleString()}`, inner.x + inner.w / 2, outbidY);
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
const pillEl      = document.getElementById("hover-pill");
const pillBtnEl   = document.getElementById("pill-btn");
const pillVerbEl  = document.getElementById("pill-verb");
const pillPriceEl = document.getElementById("pill-price");
const pillInfoEl  = document.getElementById("pill-info");
const pillBrandEl = document.getElementById("pill-brand");
const pillLinksEl = document.getElementById("pill-links");
let hoveredSpotId = null;

function normaliseUrl(u) {
  if (!u) return null;
  const s = String(u).trim();
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}
function xHandleUrl(h) {
  if (!h) return null;
  const clean = String(h).trim().replace(/^@+/, "");
  return clean ? `https://x.com/${encodeURIComponent(clean)}` : null;
}
// Populate the info card above the Outbid button for TAKEN spots.
function fillPillInfo(spot) {
  if (!spot) { pillInfoEl.hidden = true; return; }
  pillBrandEl.textContent = spot.brand || "Anonymous";
  const links = [];
  const url = normaliseUrl(spot.website);
  const xu  = xHandleUrl(spot.x_handle);
  if (url) links.push(`<a href="${escapeAttr(url)}" target="_blank" rel="noopener">Website</a>`);
  if (xu)  links.push(`<a href="${escapeAttr(xu)}"  target="_blank" rel="noopener">@${escapeHtml(String(spot.x_handle).replace(/^@+/, ""))}</a>`);
  pillLinksEl.innerHTML = links.join('<span class="pill-links-sep">·</span>');
  pillLinksEl.style.display = links.length ? "" : "none";
  pillInfoEl.hidden = false;
}

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

// Mobile: a tap on a sticker should open the bid modal DIRECTLY (there is
// no hover, so the pill's click-to-bid flow is unreachable without this).
canvasEl.addEventListener("pointerup", (e) => {
  if (e.pointerType !== "touch") return;
  if (didDrag) return;
  const hit = raycastSticker(e.clientX, e.clientY);
  if (!hit) return;
  e.preventDefault();
  const spotId = hit.userData.spotId;
  const spot   = state.spots[spotId];
  // For OCCUPIED stickers, first tap shows the info pill (brand + website
  // + X handle + Outbid button) — same info a desktop hover shows. User
  // taps Outbid to open the bid modal. For OPEN stickers, jump straight
  // to the bid modal (nothing to preview).
  if (spot) {
    hoveredSpotId = spotId;
    const price = spot.amount;
    pillVerbEl.textContent  = "Outbid";
    pillPriceEl.textContent = `$${(price + MIN_INCREMENT).toLocaleString()}`;
    fillPillInfo(spot);
    positionPillAt(hit);
    pillEl.hidden = false;
  } else {
    openBidModal(spotId);
  }
});
// Dismiss the pill when the user taps outside the canvas or the pill.
document.addEventListener("pointerdown", (e) => {
  if (!pillEl || pillEl.hidden) return;
  if (canvasEl.contains(e.target)) return;
  if (pillEl.contains(e.target))   return;
  hoveredSpotId = null;
  pillEl.hidden = true;
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
  fillPillInfo(spot);
  positionPillAt(hit);
  pillEl.hidden = false;
  canvasEl.style.cursor = "pointer";
});
canvasEl.addEventListener("pointerleave", (e) => {
  // Moving onto the pill (btn or info card, which are clickable) should NOT
  // hide the pill — otherwise we get flicker.
  if (e.relatedTarget === pillEl || (pillEl && pillEl.contains && pillEl.contains(e.relatedTarget))) return;
  hoveredSpotId = null;
  pillEl.hidden = true;
});
// Direct pill click — opens the modal for the currently-hovered sticker.
pillBtnEl.addEventListener("click", (e) => {
  e.stopPropagation();
  if (hoveredSpotId != null) openBidModal(hoveredSpotId);
});
// Keep pill visible while mouse hovers over it (or its info card / button).
pillEl.addEventListener("pointerleave", (e) => {
  // If leaving pill but not going back onto the canvas, hide
  if (e.relatedTarget !== canvasEl && !(pillEl.contains && pillEl.contains(e.relatedTarget))) {
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
  updateDevPanel();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();

// ---------- Dev scale panel ----------
// Enabled when the URL has ?dev=on OR localStorage.bmb_dev === "on".
// Once enabled, the user can orbit/zoom the bottle, then click "Save as
// initial view" to persist the camera state to localStorage. Every
// subsequent page load restores that exact camera position, target,
// autoRotate=false, so the bottle loads oriented how they want.
const DEV_VIEW_KEY = "bmb.dev.initialView";
const DEV_ON_KEY   = "bmb.dev.on";
(function bootDevPanel() {
  const p = new URLSearchParams(location.search);
  if (p.get("dev") === "on")  localStorage.setItem(DEV_ON_KEY, "on");
  if (p.get("dev") === "off") localStorage.removeItem(DEV_ON_KEY);
  const on = localStorage.getItem(DEV_ON_KEY) === "on";
  const panel = document.getElementById("dev-panel");
  if (!panel) return;
  panel.hidden = !on;
  if (!on) return;

  const $ = (id) => document.getElementById(id);
  const status = $("dev-status");
  function say(msg, ms = 2200) {
    status.textContent = msg;
    if (ms) setTimeout(() => { if (status.textContent === msg) status.textContent = ""; }, ms);
  }

  // Collapse the panel by default on mobile so it doesn't block the bottle.
  // Header (dev-toggle) toggles state; state persists across reloads.
  const COLL_KEY = "bmb.dev.collapsed";
  const startCollapsed = window.innerWidth < 640
    ? (localStorage.getItem(COLL_KEY) !== "no")   // mobile default: collapsed
    : (localStorage.getItem(COLL_KEY) === "yes"); // desktop default: expanded
  panel.classList.toggle("collapsed", startCollapsed);
  $("dev-toggle").addEventListener("click", () => {
    const collapsed = panel.classList.toggle("collapsed");
    localStorage.setItem(COLL_KEY, collapsed ? "yes" : "no");
  });

  $("dev-save").addEventListener("click", () => {
    const cp = camera.position;
    const t  = controls.target;
    const view = {
      camera: { x: cp.x, y: cp.y, z: cp.z },
      target: { x: t.x,  y: t.y,  z: t.z },
      // Also freeze the current autoRotate state so a manually-set angle isn't
      // instantly overwritten by the spin.
      autoRotate: controls.autoRotate,
      _viewport: { w: window.innerWidth, h: window.innerHeight },
      _at: new Date().toISOString(),
    };
    localStorage.setItem(DEV_VIEW_KEY, JSON.stringify(view));
    say("Saved. Refresh to verify.");
  });

  $("dev-reset").addEventListener("click", () => {
    localStorage.removeItem(DEV_VIEW_KEY);
    say("Cleared. Refresh to see default.");
  });

  $("dev-copy").addEventListener("click", async () => {
    const cp = camera.position, t = controls.target;
    const spherical = new THREE.Spherical().setFromVector3(
      new THREE.Vector3(cp.x - t.x, cp.y - t.y, cp.z - t.z)
    );
    const payload = {
      camera: { x: +cp.x.toFixed(3), y: +cp.y.toFixed(3), z: +cp.z.toFixed(3) },
      target: { x: +t.x.toFixed(3),  y: +t.y.toFixed(3),  z: +t.z.toFixed(3) },
      distance:  +spherical.radius.toFixed(3),
      azimuthDeg:  +(THREE.MathUtils.radToDeg(spherical.theta)).toFixed(1),
      elevationDeg: +(90 - THREE.MathUtils.radToDeg(spherical.phi)).toFixed(1),
      viewport: { w: window.innerWidth, h: window.innerHeight },
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      say("Copied to clipboard.");
    } catch {
      say("Copy failed — check console.");
      console.log("[bmb dev view]", payload);
    }
  });
})();

function updateDevPanel() {
  const panel = document.getElementById("dev-panel");
  if (!panel || panel.hidden) return;
  const cp = camera.position, t = controls.target;
  const rel = new THREE.Vector3(cp.x - t.x, cp.y - t.y, cp.z - t.z);
  const dist = rel.length();
  const spherical = new THREE.Spherical().setFromVector3(rel);
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setText("dev-dist", dist.toFixed(3));
  setText("dev-az",   `${THREE.MathUtils.radToDeg(spherical.theta).toFixed(1)}°`);
  setText("dev-el",   `${(90 - THREE.MathUtils.radToDeg(spherical.phi)).toFixed(1)}°`);
  setText("dev-ty",   t.y.toFixed(3));
  setText("dev-vp",   `${window.innerWidth}×${window.innerHeight}`);
}

// Attempt to restore a saved dev view — runs deferred so the GLB load has
// already framed the camera; we then override with the saved coordinates.
function tryApplySavedDevView() {
  try {
    const raw = localStorage.getItem(DEV_VIEW_KEY);
    if (!raw) return;
    const v = JSON.parse(raw);
    camera.position.set(v.camera.x, v.camera.y, v.camera.z);
    controls.target.set(v.target.x, v.target.y, v.target.z);
    if (typeof v.autoRotate === "boolean") controls.autoRotate = v.autoRotate;
    controls.update();
  } catch (err) {
    console.warn("[bmb dev] could not restore view:", err);
  }
}
// Apply after next frame so it overrides the GLB-load framing.
requestAnimationFrame(() => requestAnimationFrame(tryApplySavedDevView));

// ---------- Spots table + tabs (replaces the old card grid) ----------
// Size badge: XL for the quads + tall verticals, L for the banner, M for the
// die corners. Matches Mac-ref information density.
function sizeBadgeFor(id) {
  const area = (SPOT_CONFIG.find(c => c.id === id)?.wMul ?? 1) *
               (SPOT_CONFIG.find(c => c.id === id)?.hMul ?? 1);
  if (area >= 3.5) return "XL";
  if (area >= 2.0) return "L";
  return "M";
}
function physDimsFor(id) {
  const d = computeStickerDimsForSpot(id);
  return d ? `${d.w} × ${d.h} cm` : "";
}
function escapeAttr(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}

// Two modes:
//   - GRID  → shown while any spot is still open. Chunky cards with the
//              uploaded logo + brand for taken, "$1 · Open" for empty.
//              This is the fun/marketing view — encourages people to grab
//              the empty ones.
//   - TABLE → shown once every spot is held. Denser, sortable-feeling row
//              layout so late bidders scan quickly for the cheapest ones
//              they could still outbid.
function renderSpots() {
  const body = document.getElementById("spots-body");
  if (!body) return;
  const filled = Object.values(state.spots).filter(Boolean).length;
  if (filled >= TOTAL) {
    renderSpotsTable(body);
  } else {
    renderSpotsGrid(body);
  }
}
// Kept so old call sites (buildStickers, sync, etc) continue to work.
function refreshGrid()     { renderSpots(); }
function mountSpotTable()  { renderSpots(); }

function renderSpotsGrid(body) {
  const cards = SPOT_CONFIG.map(cfg => {
    const id   = cfg.id;
    const spot = state.spots[id];
    const meta = SPOT_META[id] || { name: `Spot ${id}` };
    if (spot) {
      const logo = spot.logo
        ? `<img class="spot-card-logo" src="${escapeAttr(spot.logo)}" alt="${escapeAttr(spot.brand)}" />`
        : `<div class="spot-card-logo empty">${escapeHtml((spot.brand || "?")[0].toUpperCase())}</div>`;
      return `
        <button class="spot-card taken" data-id="${id}" type="button">
          ${logo}
          <div class="spot-card-brand">${escapeHtml(spot.brand || "Anonymous")}</div>
          <div class="spot-card-bid">$${spot.amount.toLocaleString()}</div>
          <div class="spot-card-cta">Outbid →</div>
        </button>`;
    }
    return `
      <button class="spot-card" data-id="${id}" type="button">
        <div class="spot-num">Spot ${String(id).padStart(2, "0")}</div>
        <div class="spot-card-name">${escapeHtml(meta.name)}</div>
        <div class="spot-bid">$${STARTING_BID}</div>
        <div class="spot-cta">Open · bid →</div>
      </button>`;
  }).join("");
  body.innerHTML = `<div class="spot-grid">${cards}</div>`;
  body.querySelectorAll(".spot-card").forEach(el => {
    el.addEventListener("click", () => openBidModal(parseInt(el.dataset.id, 10)));
  });
}

function renderSpotsTable(body) {
  const ordered = [...SPOT_CONFIG].sort((a, b) => {
    const ba = state.spots[a.id]?.amount ?? 0;
    const bb = state.spots[b.id]?.amount ?? 0;
    if (ba !== bb) return bb - ba;
    return a.id - b.id;
  });
  const rows = ordered.map(cfg => {
    const id   = cfg.id;
    const spot = state.spots[id];
    const meta = SPOT_META[id] || { name: `Spot ${id}` };
    const logoCell = spot?.logo
      ? `<img src="${escapeAttr(spot.logo)}" class="spot-held-logo" alt="${escapeAttr(spot.brand || "")}" />`
      : `<div class="spot-held-logo empty"></div>`;
    const heldBy = spot
      ? `<div class="spot-held">${logoCell}<span>${escapeHtml(spot.brand || "")}</span></div>`
      : `<span class="spot-held-empty">Open</span>`;
    const bidAmount = spot?.amount ?? STARTING_BID;
    const bidCount  = spot?.bidCount ?? 0;
    const bidCountLabel = bidCount > 0 ? `${bidCount} bid${bidCount === 1 ? "" : "s"}` : "no bids yet";
    return `
      <tr data-id="${id}">
        <td class="td-spot">
          <div class="spot-cell-name">
            <span class="spot-number">${id}</span>${escapeHtml(meta.name)}
          </div>
        </td>
        <td class="td-size">
          <span class="spot-size-badge">${sizeBadgeFor(id)}</span>
          <span class="spot-size-dims">${physDimsFor(id)}</span>
        </td>
        <td class="td-held">${heldBy}</td>
        <td class="td-bid ta-r">
          <div class="spot-bid-amt">$${bidAmount.toLocaleString()}</div>
          <span class="spot-bid-count">${bidCountLabel}</span>
        </td>
        <td class="td-cta ta-r">
          <button class="spot-outbid-btn" data-id="${id}">${spot ? "Outbid" : "Bid"}</button>
        </td>
      </tr>`;
  }).join("");
  body.innerHTML = `
    <div class="spot-table-wrap">
      <table class="spot-table">
        <thead>
          <tr>
            <th class="th-spot">Spot</th>
            <th class="th-size">Size</th>
            <th class="th-held">Held by</th>
            <th class="th-bid ta-r">Current bid</th>
            <th class="th-cta"></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  body.querySelectorAll(".spot-outbid-btn").forEach(btn => {
    btn.addEventListener("click", () => openBidModal(parseInt(btn.dataset.id, 10)));
  });
}

// ---------- History tab ----------
let _historyRows  = [];    // raw rows from bmb_bid_history
let _historyFilter = "";   // "" = all spots, else numeric spot id string
let _historySort   = "newest"; // "newest" | "highest"

function renderHistory() {
  const list = document.getElementById("history-list");
  if (!list) return;
  const rows = _historyRows
    .filter(r => !_historyFilter || String(r.spot_id) === _historyFilter)
    .sort((a, b) => {
      if (_historySort === "highest") return b.amount_cents - a.amount_cents;
      return new Date(b.created_at) - new Date(a.created_at);
    });

  document.getElementById("history-count").textContent = _historyRows.length;

  if (!rows.length) {
    list.innerHTML = `<div class="history-empty">No bids yet. Be the first — click any spot on the bottle.</div>`;
    return;
  }
  list.innerHTML = rows.map(r => {
    const meta = SPOT_META[r.spot_id] || { name: `Spot ${r.spot_id}` };
    const logo = r.logo_url
      ? `<img src="${escapeAttr(r.logo_url)}" class="hist-row-logo" alt="${escapeAttr(r.brand || "")}" />`
      : `<div class="hist-row-logo empty">${escapeHtml((r.brand || "?")[0].toUpperCase())}</div>`;
    return `
      <div class="hist-row">
        ${logo}
        <div class="hist-row-desc">
          <span class="hist-brand">${escapeHtml(r.brand || "Anonymous")}</span>
          <span class="hist-spot">· ${escapeHtml(meta.name)}</span>
        </div>
        <div class="hist-row-amt">$${centsToDollars(r.amount_cents).toLocaleString()}</div>
        <div class="hist-row-time">${timeAgo(r.created_at)}</div>
      </div>`;
  }).join("");
}

function mountHistoryControls() {
  const sel = document.getElementById("hist-filter");
  if (sel && sel.options.length <= 1) {
    // Prime the "All spots" dropdown with the current SPOT_CONFIG.
    for (const cfg of SPOT_CONFIG) {
      const meta = SPOT_META[cfg.id] || {};
      const opt = document.createElement("option");
      opt.value = String(cfg.id);
      opt.textContent = `Spot ${cfg.id} — ${meta.name || ""}`.trim();
      sel.appendChild(opt);
    }
    sel.addEventListener("change", () => { _historyFilter = sel.value; renderHistory(); });
  }
  document.querySelectorAll(".pill-toggle .pt").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".pill-toggle .pt").forEach(x => x.classList.remove("active"));
      btn.classList.add("active");
      _historySort = btn.dataset.sort;
      renderHistory();
    });
  });
  // Tab switching
  document.querySelectorAll(".tab-switcher .tab").forEach(t => {
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab-switcher .tab").forEach(x => {
        x.classList.remove("active");
        x.setAttribute("aria-selected", "false");
      });
      t.classList.add("active");
      t.setAttribute("aria-selected", "true");
      const which = t.dataset.tab;
      document.querySelectorAll(".tab-pane").forEach(p => {
        p.hidden = p.dataset.pane !== which;
      });
      if (which === "history") fetchHistory();
    });
  });
}

async function fetchHistory() {
  try {
    const { data, error } = await sb.from("bmb_bid_history")
      .select("id, spot_id, amount_cents, brand, x_handle, website, logo_url, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    _historyRows = Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn("[bmb] history fetch failed:", err.message || err);
    _historyRows = [];
  }
  renderHistory();
}

function timeAgo(iso) {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60)      return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60)      return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24)      return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

// ---------- Totals + money bar ----------
const GOAL_DOLLARS = 50;
function refreshTotals() {
  const vals = Object.values(state.spots);
  const raised = vals.reduce((sum, s) => sum + (s ? s.amount : 0), 0);
  const raisedEl = document.getElementById("raised-amount");
  if (raisedEl) raisedEl.textContent = raised.toLocaleString();
  // Money bar: progress vs $50 goal; if past goal, show "goal passed · X%"
  const pct = Math.max(0, Math.min(999, Math.round((raised / GOAL_DOLLARS) * 100)));
  const fill = document.getElementById("mb-fill");
  const goalEl = document.getElementById("mb-goal");
  if (fill)  fill.style.width = `${Math.min(100, pct)}%`;
  if (goalEl) {
    goalEl.innerHTML = pct >= 100
      ? `<span class="mb-goal-hit">goal passed · ${pct}%</span>`
      : `$${GOAL_DOLLARS} goal · ${pct}%`;
  }
  // If the spots table is mounted, re-render so ordering reflects new bids.
  mountSpotTable();
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
  // Website input is type=text so users can enter "mypassage.ai" without
  // a scheme. Normalise here so the DB gets a real https:// URL.
  let website = brandWebEl.value.trim();
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
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

    // 3) Stash the pending bid so the post-purchase share modal can render
    //    the winner's details even before Supabase has caught up. Cleared by
    //    the handler on ?bid=success or ?bid=cancel.
    try {
      sessionStorage.setItem("bmb_pending_bid", JSON.stringify({
        spot_id: spotId,
        amount,
        brand,
        website: website || null,
        x_handle: xHandle || null,
        logo_url: logoUrl,
        at: Date.now(),
      }));
    } catch (_) { /* private mode etc — non-critical */ }

    // 4) Redirect. On return the URL will carry ?bid=success or ?bid=cancel —
    //    see the boot-time handler at the very bottom of this file.
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
// ?reset=1 wipes local optimistic state (bids that never made it to
// Supabase). Useful during dev — server-side data is untouched.
if (new URLSearchParams(location.search).get("reset") === "1") {
  localStorage.removeItem(STORAGE_KEY);
  const clean = location.pathname + location.hash;
  history.replaceState({}, "", clean);
  state = loadState();
}
mountSpotTable();
mountHistoryControls();
refreshTotals();
tickCountdown();
setInterval(tickCountdown, 30 * 1000);
resize();
syncFromSupabase();
// Poll every 20s for competing bids
setInterval(syncFromSupabase, 20 * 1000);

// ---------- Live visitor heartbeat ----------
// Every open tab gets an opaque uuid persisted in localStorage. Every 30s we
// POST it to the bmb-beat Edge Function, which upserts the row and returns the
// aggregate counts. Numbers here are REAL (5-min sliding window for "now").
(function initVisitorBeat() {
  const KEY = "bmb_visitor_token";
  let token = localStorage.getItem(KEY);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(KEY, token);
  }
  const now  = document.getElementById("visiting-now");
  const total = document.getElementById("total-visitors");
  async function beat() {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/bmb-beat`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (typeof data.visiting_now  === "number" && now)   now.textContent   = data.visiting_now.toLocaleString();
      if (typeof data.total_visitors === "number" && total) total.textContent = data.total_visitors.toLocaleString();
    } catch (_) { /* offline is fine — just don't update */ }
  }
  beat();
  setInterval(beat, 30_000);
})();

// ---------- Stripe return-from-Checkout: share modal (success) or toast (cancel) ----------
// Kept at the very bottom of the file to minimise conflict area with the 3D
// scene code above. When Stripe redirects the user back to the site the URL
// carries ?bid=success or ?bid=cancel. On success we show a small toast and
// force a fresh pull from Supabase — the webhook may still be in flight, so
// we retry a few times.
// Canonical site URL used in tweet text, native share, and copy-link. Kept
// at the top of this IIFE so all references are one place. Custom domain
// launched 2026-08-28.
const SITE_URL = "https://iwantabottle.com";
const SITE_URL_PRETTY = "iwantabottle.com";

(function handleCheckoutReturn() {
  try {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("bid");
    if (outcome !== "success" && outcome !== "cancel") return;

    // Strip the query param so a refresh doesn't re-open the modal.
    const cleanUrl = window.location.pathname + window.location.hash;
    window.history.replaceState({}, "", cleanUrl);

    if (outcome === "cancel") {
      // Payment cancelled — a plain toast is enough.
      showToast("Payment cancelled — nothing was charged.");
      // Also clear any stashed pending bid so a later success doesn't reuse it.
      try { sessionStorage.removeItem("bmb_pending_bid"); } catch (_) {}
      return;
    }

    // ---- SUCCESS: open the share modal ----
    // 1) Read the bid the user just placed (stashed right before the Stripe
    //    redirect). Fallback = anonymous placeholder for design-QA visits.
    let pending = null;
    try {
      const raw = sessionStorage.getItem("bmb_pending_bid");
      if (raw) pending = JSON.parse(raw);
      sessionStorage.removeItem("bmb_pending_bid");
    } catch (_) {}

    // 2) Kick off Supabase polling — the webhook may still be in flight. As
    //    rows arrive we refresh the modal fields with authoritative values.
    let latestFromSupabase = null;
    const poll = (tries = 0) => {
      if (typeof syncFromSupabase === "function") {
        // syncFromSupabase() updates state.spots in place. Re-populate the
        // modal once state settles.
        Promise.resolve(syncFromSupabase()).then(() => {
          if (pending && state && state.spots && state.spots[pending.spot_id]) {
            latestFromSupabase = state.spots[pending.spot_id];
            populateShareModal(pending, latestFromSupabase);
          }
        }).catch(() => {});
      }
      if (tries < 5) setTimeout(() => poll(tries + 1), 1500);
    };
    poll();

    // 3) Populate immediately from `pending` (or fallback), then open.
    populateShareModal(pending, null);
    openShareModal();
  } catch (err) {
    console.warn("[bmb] checkout-return handler failed:", err);
  }

  // ---------- helpers ----------

  function showToast(msg) {
    const toast = document.createElement("div");
    toast.style.cssText =
      "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:10000;" +
      "background:#0e0e0e;color:#f5f1ea;padding:12px 18px;border-radius:999px;" +
      "font:500 14px/1.3 Inter,-apple-system,sans-serif;" +
      "box-shadow:0 12px 28px rgba(0,0,0,0.25);max-width:88vw;text-align:center;" +
      "transition:opacity .4s ease,transform .4s ease;opacity:0;";
    toast.textContent = msg;
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = "1"; });
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(-50%) translateY(8px)";
      setTimeout(() => toast.remove(), 500);
    }, 4500);
  }

  function populateShareModal(pending, live) {
    // Merge: prefer `live` (Supabase authoritative) when present, else use
    // the pending stash we made pre-redirect. `state.spots[id]` shape uses
    // { brand, amount, logo, website, x_handle }; pending uses `logo_url`.
    const spotId  = (live && pending?.spot_id) || pending?.spot_id || null;
    const brand   = (live?.brand)   || pending?.brand   || "Anonymous";
    const amount  = (live?.amount)  ?? pending?.amount  ?? null;
    const logo    = (live?.logo)    || pending?.logo_url || null;
    const website = (live?.website) || pending?.website || null;
    const xHandle = (live?.x_handle) || pending?.x_handle || null;
    const meta    = (spotId && typeof SPOT_META !== "undefined" && SPOT_META[spotId]) || null;

    const $ = (id) => document.getElementById(id);

    // Headline
    const brandEl = $("share-title-brand");
    if (brandEl) brandEl.textContent = brand || "friend";
    // Sub: rotate between two lines depending on whether we know the spot.
    const subEl = $("share-sub");
    if (subEl) {
      subEl.textContent = spotId
        ? "You just claimed a piece of a moving billboard."
        : "Your spot is confirmed. Tell the world.";
    }

    // Details grid
    const spotEl = $("share-detail-spot");
    if (spotEl) spotEl.textContent = spotId ? `#${spotId}${meta ? " · " + meta.name : ""}` : "—";
    const sizeEl = $("share-detail-size");
    if (sizeEl) sizeEl.textContent = meta?.size || "—";
    const bidEl  = $("share-detail-bid");
    if (bidEl)  bidEl.textContent = (amount != null) ? `$${Number(amount).toLocaleString()}` : "—";

    // Link cell: prefer x handle, else website, else the site URL.
    const linkEl = $("share-detail-link");
    const linkLabel = $("share-detail-link-label");
    if (linkEl && linkLabel) {
      if (xHandle) {
        const handle = String(xHandle).replace(/^@/, "");
        linkLabel.textContent = "On X";
        linkEl.innerHTML = `<a href="https://x.com/${encodeURIComponent(handle)}" target="_blank" rel="noopener noreferrer">@${escapeHtmlSafe(handle)}</a>`;
      } else if (website) {
        const pretty = String(website).replace(/^https?:\/\//i, "").replace(/\/$/, "");
        const href = /^https?:\/\//i.test(website) ? website : `https://${website}`;
        linkLabel.textContent = "Website";
        linkEl.innerHTML = `<a href="${escapeAttrSafe(href)}" target="_blank" rel="noopener noreferrer">${escapeHtmlSafe(pretty)}</a>`;
      } else {
        linkLabel.textContent = "Bottle";
        linkEl.innerHTML = `<a href="${SITE_URL}" target="_blank" rel="noopener noreferrer">${SITE_URL_PRETTY}</a>`;
      }
    }

    // Bottle poster logo composite
    const logoEl = $("share-bottle-logo");
    if (logoEl) {
      if (logo) {
        logoEl.classList.remove("is-placeholder");
        logoEl.style.backgroundImage = `url("${logo}")`;
        logoEl.textContent = "";
      } else {
        logoEl.classList.add("is-placeholder");
        logoEl.style.backgroundImage = "";
        logoEl.textContent = (brand && brand !== "Anonymous")
          ? brand.trim().charAt(0).toUpperCase()
          : "?";
      }
    }

    // X-intent URL + stash the current text on the modal so Copy / Share
    // can reuse the exact same paragraph without re-computing.
    const xBtn = $("share-x");
    const tweet = buildTweet({ brand, spotId, amount });
    if (xBtn) {
      xBtn.href = "https://x.com/intent/tweet?text=" + encodeURIComponent(tweet);
    }
    const modalEl = document.getElementById("share-modal");
    if (modalEl) {
      modalEl.dataset.shareText = tweet;
      modalEl.dataset.shareLogo = logo || "";
    }
  }

  function buildTweet({ brand, spotId, amount }) {
    if (spotId && amount != null) {
      return `Just claimed sticker spot #${spotId} on the Brand My Bottle water bottle for $${amount}. My logo rides as long as the bottle lasts. ${SITE_URL}`;
    }
    if (spotId) {
      return `Just claimed sticker spot #${spotId} on the Brand My Bottle water bottle. My logo rides as long as the bottle lasts. ${SITE_URL}`;
    }
    return `Just claimed a sticker spot on the Brand My Bottle water bottle. My logo rides as long as the bottle lasts. ${SITE_URL}`;
  }

  // ---- Share helpers: fetch the logo as a File so Share/Copy can include it ----
  async function fetchLogoFile(url) {
    if (!url) return null;
    try {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) return null;
      const blob = await res.blob();
      const ext  = (blob.type.split("/")[1] || "png").split("+")[0];
      return new File([blob], `bmb-sticker.${ext}`, { type: blob.type || "image/png" });
    } catch (_) { return null; }
  }
  async function copyRichClipboard(text, logoUrl) {
    // Prefer navigator.clipboard.write() with a ClipboardItem containing BOTH
    // the paragraph and the logo image so a paste anywhere gets both. Fallback
    // to plain text if the ClipboardItem API isn't available (Firefox, Safari<15).
    try {
      if (typeof ClipboardItem === "function" && logoUrl) {
        const file = await fetchLogoFile(logoUrl);
        if (file && file.type.startsWith("image/")) {
          const item = new ClipboardItem({
            [file.type]: file,
            "text/plain": new Blob([text], { type: "text/plain" }),
          });
          await navigator.clipboard.write([item]);
          return true;
        }
      }
    } catch (_) { /* fall through to text-only */ }
    try { await navigator.clipboard.writeText(text); return true; } catch (_) {}
    // Legacy execCommand fallback
    try {
      const t = document.createElement("textarea");
      t.value = text; document.body.appendChild(t); t.select();
      document.execCommand("copy");
      t.remove();
      return true;
    } catch (_) { return false; }
  }

  function openShareModal() {
    const modal = document.getElementById("share-modal");
    if (!modal) return;
    modal.hidden = false;

    // Restart confetti animation on every open (reflow trick)
    const conf = document.getElementById("share-confetti");
    if (conf) {
      const clone = conf.cloneNode(true);
      conf.parentNode.replaceChild(clone, conf);
    }

    // Wire up controls (idempotent — safe if called more than once)
    const close = () => { modal.hidden = true; };
    const closeBtn = document.getElementById("share-close");
    const laterBtn = document.getElementById("share-later");
    if (closeBtn && !closeBtn._bmbBound) { closeBtn.addEventListener("click", close); closeBtn._bmbBound = true; }
    if (laterBtn && !laterBtn._bmbBound) { laterBtn.addEventListener("click", close); laterBtn._bmbBound = true; }
    if (!modal._bmbBackdropBound) {
      modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
      modal._bmbBackdropBound = true;
    }
    if (!modal._bmbEscBound) {
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !modal.hidden) close();
      });
      modal._bmbEscBound = true;
    }

    // Native share (mobile) — hide if unsupported. Attaches the logo image
    // as a File so the recipient app (Messages, Instagram DM, etc) can post
    // the paragraph WITH the sticker artwork, not just a plain URL.
    const nativeBtn = document.getElementById("share-native");
    const actionsRow = document.getElementById("share-actions");
    if (nativeBtn) {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        nativeBtn.hidden = false;
        if (actionsRow) actionsRow.setAttribute("data-has-native", "1");
        if (!nativeBtn._bmbBound) {
          nativeBtn.addEventListener("click", async () => {
            const text = modal.dataset.shareText
              || "I just claimed a sticker spot on the Brand My Bottle water bottle.";
            const logoUrl = modal.dataset.shareLogo || "";
            let payload = { title: "Brand My Bottle", text, url: SITE_URL };
            if (logoUrl) {
              const file = await fetchLogoFile(logoUrl);
              if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
                payload = { title: "Brand My Bottle", text, files: [file] };
              }
            }
            try { await navigator.share(payload); }
            catch (_) { /* user cancelled */ }
          });
          nativeBtn._bmbBound = true;
        }
      } else {
        nativeBtn.hidden = true;
        if (actionsRow) actionsRow.removeAttribute("data-has-native");
      }
    }

    // Copy link → copies the FULL paragraph and (when supported) the logo
    // image, so a paste anywhere lands both. Falls back to text-only.
    const copyBtn = document.getElementById("share-copy");
    const copyLabel = document.getElementById("share-copy-label");
    if (copyBtn && !copyBtn._bmbBound) {
      copyBtn.addEventListener("click", async () => {
        const text    = modal.dataset.shareText  || SITE_URL;
        const logoUrl = modal.dataset.shareLogo  || "";
        await copyRichClipboard(text, logoUrl);
        copyBtn.classList.add("share-btn-copied");
        if (copyLabel) {
          const orig = copyLabel.textContent;
          copyLabel.textContent = "Copied";
          setTimeout(() => {
            copyBtn.classList.remove("share-btn-copied");
            copyLabel.textContent = orig || "Copy link";
          }, 1800);
        }
      });
      copyBtn._bmbBound = true;
    }
  }

  function escapeHtmlSafe(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }
  function escapeAttrSafe(s) { return escapeHtmlSafe(s); }
})();
