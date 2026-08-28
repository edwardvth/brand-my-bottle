// Build a slim GLB containing ONLY the "Water Bottle_5" subtree used by the app,
// with all textures/materials stripped (the app replaces materials with a bare
// MeshStandardMaterial anyway). Run once locally when the source model changes;
// the resulting bottle-slim.glb is what deploy.ps1 ships.
import { NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { prune, dedup, weld, meshopt, resample } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";

const INPUT  = "stainless_steel_water_bottle.glb";
const OUTPUT = "bottle-slim.glb";
// Keep BOTH the bottle body node AND the chunky screw-cap node. The cap is a
// separate top-level node in this GLB (Object_14 under Water Bottle_5 is only
// a thin neck-collar ring — not the actual cap the user expects to see).
const KEEP_NODES = ["Water Bottle_5", "Bottle Cap _3"];

const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const doc = await io.read(INPUT);
const root = doc.getRoot();

// 1) Find EVERY KEEP node + all descendants.
const scene = root.listScenes()[0];
const keepRoots = [];
scene.traverse((n) => {
  if (KEEP_NODES.includes(n.getName())) keepRoots.push(n);
});
if (keepRoots.length !== KEEP_NODES.length) {
  const found = keepRoots.map((n) => n.getName());
  const missing = KEEP_NODES.filter((n) => !found.includes(n));
  throw new Error(`Could not find node(s): ${missing.join(", ")}`);
}

const keepNodes = new Set(keepRoots);
for (const kr of keepRoots) kr.traverse((n) => keepNodes.add(n));

// 2) Detach every scene child except the keep roots + their ancestor chains.
const ancestors = new Set();
for (const kr of keepRoots) {
  let n = kr.getParentNode?.() || null;
  while (n) { ancestors.add(n); n = n.getParentNode?.() || null; }
}
// Iterate over a snapshot because we're mutating the graph.
for (const node of root.listNodes()) {
  if (keepNodes.has(node) || ancestors.has(node)) continue;
  node.dispose();
}

// 3) Drop every material's textures. The app overrides materials at runtime, so
//    textures ship for no reason (~3.3 MB combined + huge GPU footprint).
for (const mat of root.listMaterials()) {
  mat.setBaseColorTexture(null);
  mat.setNormalTexture(null);
  mat.setMetallicRoughnessTexture(null);
  mat.setOcclusionTexture(null);
  mat.setEmissiveTexture(null);
}
// Delete all textures + samplers + images.
for (const tex of root.listTextures()) tex.dispose();

// 4) Prune orphaned accessors/buffers/etc.
await doc.transform(
  prune(),
  dedup(),
  weld(),           // merge co-located vertices
  resample(),       // resample animations (no-op here — none)
);

// 5) Meshopt geometry compression — halves file size again but requires the
//    MeshoptDecoder to be wired to GLTFLoader in app.js.
await MeshoptEncoder.ready;
await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" }));


await io.write(OUTPUT, doc);

// Size report
import fs from "node:fs";
const inBytes  = fs.statSync(INPUT).size;
const outBytes = fs.statSync(OUTPUT).size;
console.log(`${INPUT}: ${(inBytes/1e6).toFixed(2)} MB`);
console.log(`${OUTPUT}: ${(outBytes/1e6).toFixed(2)} MB`);
console.log(`shrink: ${((1 - outBytes/inBytes)*100).toFixed(1)}%`);
