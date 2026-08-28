// Diagnostic: dump mesh names + parent node paths + bounding boxes + transforms.
import { NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

const files = ["stainless_steel_water_bottle.glb", "bottle-slim.glb"];

const io = new NodeIO()
  .registerExtensions(KHRONOS_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder });

for (const file of files) {
  console.log("\n=====================================");
  console.log("FILE:", file);
  console.log("=====================================");
  let doc;
  try {
    doc = await io.read(file);
  } catch (e) {
    console.log("Error reading:", e.message);
    continue;
  }
  const root = doc.getRoot();
  const scenes = root.listScenes();

  function nodePath(node) {
    const parts = [];
    let n = node;
    while (n) {
      parts.unshift(n.getName() || "(unnamed)");
      n = n.getParentNode?.() || null;
    }
    return parts.join(" / ");
  }

  function worldTransform(node) {
    // multiply all ancestor matrices
    const chain = [];
    let n = node;
    while (n) { chain.unshift(n); n = n.getParentNode?.() || null; }
    // apply translation+rotation+scale chain — quick manual accumulator
    let t = [0,0,0], s = [1,1,1];
    for (const nd of chain) {
      const lt = nd.getTranslation();
      const ls = nd.getScale();
      // ignore rotation for this quick check
      t = [t[0] + lt[0]*s[0], t[1] + lt[1]*s[1], t[2] + lt[2]*s[2]];
      s = [s[0]*ls[0], s[1]*ls[1], s[2]*ls[2]];
    }
    return { t, s };
  }

  function bboxOfMesh(mesh) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const arr = pos.getArray();
      const count = pos.getCount();
      for (let i = 0; i < count; i++) {
        const x = arr[i*3], y = arr[i*3+1], z = arr[i*3+2];
        if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
        if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
      }
    }
    return { minX, minY, minZ, maxX, maxY, maxZ, dx: maxX-minX, dy: maxY-minY, dz: maxZ-minZ };
  }

  console.log("\n-- ALL NODES (name / T / R / S) --");
  for (const node of root.listNodes()) {
    const t = node.getTranslation();
    const r = node.getRotation();
    const s = node.getScale();
    console.log(`  "${node.getName()}"`);
    console.log(`    T=(${t[0].toFixed(3)}, ${t[1].toFixed(3)}, ${t[2].toFixed(3)})  R=(${r[0].toFixed(3)}, ${r[1].toFixed(3)}, ${r[2].toFixed(3)}, ${r[3].toFixed(3)})  S=(${s[0].toFixed(3)}, ${s[1].toFixed(3)}, ${s[2].toFixed(3)})`);
  }

  for (const scene of scenes) {
    console.log("\n-- SCENE:", scene.getName() || "(unnamed)");
    scene.traverse((node) => {
      const mesh = node.getMesh();
      if (mesh) {
        const bb = bboxOfMesh(mesh);
        const w = worldTransform(node);
        console.log(`  MESH node="${node.getName()}" mesh="${mesh.getName()}"`);
        console.log(`    path: ${nodePath(node)}`);
        console.log(`    LOCAL bbox min=(${bb.minX.toFixed(3)},${bb.minY.toFixed(3)},${bb.minZ.toFixed(3)}) max=(${bb.maxX.toFixed(3)},${bb.maxY.toFixed(3)},${bb.maxZ.toFixed(3)})`);
        console.log(`    WORLD-ish T=(${w.t[0].toFixed(3)},${w.t[1].toFixed(3)},${w.t[2].toFixed(3)}) S=(${w.s[0].toFixed(3)},${w.s[1].toFixed(3)},${w.s[2].toFixed(3)})`);
        console.log(`    WORLD-ish bbox Y ≈ [${(w.t[1] + bb.minY*w.s[1]).toFixed(3)}, ${(w.t[1] + bb.maxY*w.s[1]).toFixed(3)}]`);
      }
    });
  }
}
