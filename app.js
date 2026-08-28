// v6 — clean rewrite. Curved-plane overlay stickers on a filtered bottle mesh.
// The stickers are actual curved geometry that matches the cylinder radius, so
// their dashed borders truly wrap the surface (no DecalGeometry gymnastics).

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// ---------- Config ----------
const MODEL_URL = "stainless_steel_water_bottle.glb";
const BODY_NODE_NAME = "Water Bottle_5";
const STORAGE_KEY = "bmb.state.v7";
const AUCTION_END = Date.now() + 12 * 86400 * 1000 + 14 * 3600 * 1000;
const MIN_INCREMENT = 1;
const STARTING_BID = 1;

// 10 stickers, 3-2-3-2 checkerboard on the LOWER barrel — proper alternation,
// no vertical overlap, completed bottom row. All rows sit under the taper.
const _TAU3 = (Math.PI * 2) / 3;   // 120°
const _TAU6 = Math.PI / 3;         // 60° stagger for odd rows
const SPOT_CONFIG = [
  // Row 0 (upper barrel): y = +0.75  — 3 spots at 0°, ±120°
  { id: 1,  y:  0.75, theta:  0,           sizeMul: 1.15 },
  { id: 2,  y:  0.75, theta:  _TAU3,       sizeMul: 1.10 },
  { id: 3,  y:  0.75, theta: -_TAU3,       sizeMul: 1.10 },
  // Row 1 (staggered):    y = +0.25  — 2 spots at ±60° (skip the back so it
  //                                     doesn't line up with row 3's back spot)
  { id: 4,  y:  0.25, theta:  _TAU6,       sizeMul: 1.20 },
  { id: 5,  y:  0.25, theta: -_TAU6,       sizeMul: 1.20 },
  // Row 2: y = -0.25 — 3 spots at 0°, ±120°
  { id: 6,  y: -0.25, theta:  0,           sizeMul: 1.15 },
  { id: 7,  y: -0.25, theta:  _TAU3,       sizeMul: 1.10 },
  { id: 8,  y: -0.25, theta: -_TAU3,       sizeMul: 1.10 },
  // Row 3 (staggered):    y = -0.75  — 2 spots at ±60°  (fills the bottom band
  //                                     that used to only have a single sticker)
  { id: 9,  y: -0.75, theta:  _TAU6,       sizeMul: 1.20 },
  { id: 10, y: -0.75, theta: -_TAU6,       sizeMul: 1.20 },
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

// Debug overlay
function setDebug(text) {
  let d = document.getElementById("debug");
  if (!d) {
    d = document.createElement("div");
    d.id = "debug";
    d.style.cssText = "position:fixed;top:8px;left:8px;z-index:9999;background:rgba(14,14,14,0.85);color:#f5f1ea;font:11px/1.4 ui-monospace,Menlo,monospace;padding:8px 10px;border-radius:6px;max-width:360px;pointer-events:none;white-space:pre-wrap;";
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
  setDebug(`GLB failed to load: ${err.message || err}`);
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
function makeStickerTexture(spotId, price, taken, geomAspect = 1.35) {
  const c = document.createElement("canvas");
  // Match canvas aspect to the sticker's world-geometry aspect so text renders
  // at true proportions instead of getting horizontally squashed.
  c.width = 640;
  c.height = Math.round(c.width / geomAspect);
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);

  const pad = Math.round(Math.min(c.width, c.height) * 0.07);
  const paper = "#f5f1ea";

  if (taken) {
    ctx.fillStyle = paper;
    ctx.fillRect(pad, pad, c.width - pad * 2, c.height - pad * 2);
  } else {
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

  // Scale text sizes to canvas height so text stays big regardless of aspect
  const labelSize = Math.round(c.height * 0.12);
  const priceSize = Math.round(c.height * 0.42);

  ctx.font = `bold ${labelSize}px Inter, -apple-system, sans-serif`;
  ctx.fillStyle = taken ? "rgba(14,14,14,0.55)" : paper;
  ctx.fillText(`SPOT ${String(spotId).padStart(2, "0")}`, c.width / 2, c.height * 0.28);

  ctx.font = `bold ${priceSize}px Georgia, "Times New Roman", serif`;
  ctx.fillStyle = taken ? "#0e0e0e" : paper;
  ctx.fillText(`$${price.toLocaleString()}`, c.width / 2, c.height * 0.62);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
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

  // y in SPOT_CONFIG is normalized [-1, +1]. Band tightened + baseHeight reduced
  // so 4 rows of MEDIUM+LARGE stickers (max 1.20x) don't overlap vertically.
  // Verification: rows are 0.50 units apart → world Δy = 0.50 * bandHalfHeight
  // = 0.50 * 0.30 * body_height = 0.15 * body_height. Max sticker height =
  // 1.20 * 0.09 * body_height = 0.108 * body_height. Gap ≈ 0.04 * body_height.
  const bandHalfHeight = bodyGeom.height * 0.30;
  const baseArc    = (Math.PI * 2) / 3 * 0.50;  // baseline sticker arc
  const baseHeight = bodyGeom.height * 0.09;    // reduced from 0.12 → no vertical overlap

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

    const arcAngle = baseArc * cfg.sizeMul;
    const stickerH = baseHeight * cfg.sizeMul;
    const yWorld   = bodyGeom.centerY + cfg.y * bandHalfHeight;

    // Local radius at this sticker's exact position (handles taper)
    const localR = localRadiusAt(cfg.theta, yWorld);
    const stickerRadius = localR * 1.005;

    const arcLength = stickerRadius * arcAngle;
    const geomAspect = arcLength / stickerH;

    const geom = createCurvedRect(stickerRadius, cfg.theta, arcAngle, stickerH, yWorld);
    const texture = makeStickerTexture(cfg.id, price, taken, geomAspect);
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
canvasEl.addEventListener("pointerleave", () => {
  hoveredSpotId = null;
  pillEl.hidden = true;
});
// Pill is pointer-events:none. Clicks pass through to the canvas which already
// raycasts + opens the modal. No pill click handler needed.

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
  document.getElementById("high-bid").textContent = `$${high.toLocaleString()}`;
}

// ---------- Bid modal ----------
const bidInput   = document.getElementById("bid-input");
const bidCurrent = document.getElementById("bid-current");
const bidMinEl   = document.getElementById("bid-min");
const bidQuickEl = document.getElementById("bid-quick");
const bidSubmit  = document.getElementById("bid-submit");
const bidSubmitAmt = document.getElementById("bid-submit-amt");
const bidTitleEl = document.getElementById("bid-modal-title");

function openBidModal(spotId) {
  const spot = state.spots[spotId];
  const current = spot ? spot.amount : 0;
  const min = current ? current + MIN_INCREMENT : STARTING_BID;

  document.getElementById("bid-spot-label").textContent = String(spotId).padStart(2, "0");
  bidCurrent.textContent = current.toLocaleString();
  bidMinEl.textContent = min;
  bidTitleEl.textContent = current ? "Outbid this spot" : "Bid on this spot";

  // Quick-bid chips: min, +$1, +$2, +$5
  const presets = [min, min + 1, min + 2, min + 5];
  bidQuickEl.innerHTML = presets
    .map((p, i) => `<button type="button" class="chip${i === 0 ? " active" : ""}" data-val="${p}">$${p}</button>`)
    .join("");
  bidQuickEl.querySelectorAll(".chip").forEach(btn => {
    btn.addEventListener("click", () => {
      bidInput.value = btn.dataset.val;
      syncSubmit();
      highlightActiveChip();
    });
  });

  bidInput.min = min;
  bidInput.value = min;
  bidInput.oninput = () => { syncSubmit(); highlightActiveChip(); };
  syncSubmit();

  document.getElementById("bid-form").dataset.spotId = spotId;
  document.getElementById("bid-modal").hidden = false;
  bidInput.focus();
  bidInput.select();
}
function syncSubmit() {
  const v = parseInt(bidInput.value, 10);
  bidSubmitAmt.textContent = isFinite(v) ? v.toLocaleString() : "—";
}
function highlightActiveChip() {
  const v = parseInt(bidInput.value, 10);
  bidQuickEl.querySelectorAll(".chip").forEach(c => {
    c.classList.toggle("active", parseInt(c.dataset.val, 10) === v);
  });
}
function closeBidModal() { document.getElementById("bid-modal").hidden = true; }
document.getElementById("modal-close").addEventListener("click", closeBidModal);
document.getElementById("bid-modal").addEventListener("click", (e) => {
  if (e.target.id === "bid-modal") closeBidModal();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeBidModal(); });
document.getElementById("bid-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target;
  const spotId = parseInt(form.dataset.spotId, 10);
  const email = form.email.value.trim();
  const amount = parseInt(form.amount.value, 10);
  const current = state.spots[spotId] ? state.spots[spotId].amount : 0;
  const min = current ? current + MIN_INCREMENT : STARTING_BID;
  if (amount < min) { alert(`Minimum bid is $${min}`); return; }
  state.spots[spotId] = {
    amount, bidder: email, bidderMasked: maskEmail(email), at: Date.now(),
  };
  saveState(state);
  buildStickers();
  refreshGrid();
  refreshTotals();
  closeBidModal();
  form.reset();
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

// ---------- Init ----------
mountGrid();
refreshTotals();
tickCountdown();
setInterval(tickCountdown, 30 * 1000);
resize();
