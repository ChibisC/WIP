import * as THREE from 'three';

/**
 * Static scenery in culled chunks (performance v3, CHANGE_PLAN §31): a map-wide merged mesh or instanced mesh is one
 * object to the renderer, never outside the view, so every one of its triangles is shaded every frame — and again in
 * the shadow pass. Split into square chunks of the ground (each with its own bounding sphere), the renderer culls the
 * chunks out of the camera's or the light's view. The same triangles with the same vertex data, each in exactly one
 * chunk and in their order (opaque, depth-tested: which chunk draws first changes nothing drawn).
 */

/** Ground-plane bins of `cell` mm for items at (x, z): bin key → item indices, in item order. */
function binByGround(n: number, xz: (i: number, out: { x: number; z: number }) => void, cell: number): Map<string, number[]> {
  const bins = new Map<string, number[]>();
  const p = { x: 0, z: 0 };
  for (let i = 0; i < n; i++) {
    xz(i, p);
    const k = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
    let l = bins.get(k);
    if (!l) bins.set(k, (l = []));
    l.push(i);
  }
  return bins;
}

function copyMeshSettings(from: THREE.Mesh, to: THREE.Mesh): void {
  to.castShadow = from.castShadow;
  to.receiveShadow = from.receiveShadow;
  to.renderOrder = from.renderOrder;
  to.name = from.name;
  to.layers.mask = from.layers.mask;
  to.customDepthMaterial = from.customDepthMaterial;
  to.customDistanceMaterial = from.customDistanceMaterial;
}

/** Can this mesh be split (one material, no groups, morphs or skinning, at the origin, culled normally)? */
function splittable(m: THREE.Mesh): boolean {
  const g = m.geometry;
  return (
    !Array.isArray(m.material) &&
    !(m as THREE.SkinnedMesh).isSkinnedMesh &&
    g.groups.length === 0 &&
    Object.keys(g.morphAttributes).length === 0 &&
    m.frustumCulled &&
    m.position.lengthSq() === 0 &&
    m.quaternion.w === 1 &&
    m.scale.x === 1 &&
    m.scale.y === 1 &&
    m.scale.z === 1 &&
    m.children.length === 0 &&
    !Object.prototype.hasOwnProperty.call(m, 'onBeforeRender') &&
    Object.values(g.attributes).every((a) => !(a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute)
  );
}

/**
 * A merged mesh (geometry in world coordinates) split by its triangles' centres into `cell` mm squares: a group of
 * meshes sharing the material, each with the triangles of its square (in their order) and the vertices they use.
 * Returns the mesh itself when it cannot be split or would be a single chunk.
 */
export function chunkMerged(mesh: THREE.Mesh, cell: number): THREE.Object3D {
  if (!splittable(mesh)) return mesh;
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const index = g.index;
  const nTri = (index ? index.count : pos.count) / 3;
  const vi = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
  const bins = binByGround(
    nTri,
    (t, out) => {
      out.x = (pos.getX(vi(t, 0)) + pos.getX(vi(t, 1)) + pos.getX(vi(t, 2))) / 3;
      out.z = (pos.getZ(vi(t, 0)) + pos.getZ(vi(t, 1)) + pos.getZ(vi(t, 2))) / 3;
    },
    cell,
  );
  if (bins.size <= 1) return mesh;
  const group = new THREE.Group();
  group.name = mesh.name;
  const names = Object.keys(g.attributes);
  for (const tris of bins.values()) {
    const cg = new THREE.BufferGeometry();
    // the vertices the chunk's triangles use, in the order they are first met
    const remap = new Map<number, number>();
    const order: number[] = [];
    const idx: number[] = [];
    for (const t of tris)
      for (let k = 0; k < 3; k++) {
        const v = vi(t, k);
        let r = remap.get(v);
        if (r === undefined) {
          r = order.length;
          remap.set(v, r);
          order.push(v);
        }
        idx.push(r);
      }
    for (const name of names) {
      const a = g.attributes[name] as THREE.BufferAttribute;
      const size = a.itemSize;
      const Arr = a.array.constructor as new (n: number) => THREE.TypedArray;
      const out = new Arr(order.length * size);
      const src = a.array as ArrayLike<number>;
      for (let i = 0; i < order.length; i++) for (let c = 0; c < size; c++) out[i * size + c] = src[order[i] * size + c];
      cg.setAttribute(name, new THREE.BufferAttribute(out, size, a.normalized));
    }
    if (index) cg.setIndex(new THREE.BufferAttribute(order.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
    else {
      // (a non-indexed mesh stays non-indexed: its triangles' vertices, in order)
      for (const name of names) {
        const a = cg.attributes[name] as THREE.BufferAttribute;
        const size = a.itemSize;
        const Arr = a.array.constructor as new (n: number) => THREE.TypedArray;
        const out = new Arr(idx.length * size);
        for (let i = 0; i < idx.length; i++) for (let c = 0; c < size; c++) out[i * size + c] = (a.array as ArrayLike<number>)[idx[i] * size + c];
        cg.setAttribute(name, new THREE.BufferAttribute(out, size, a.normalized));
      }
    }
    cg.computeBoundingBox();
    cg.computeBoundingSphere();
    const cm = new THREE.Mesh(cg, mesh.material);
    copyMeshSettings(mesh, cm);
    group.add(cm);
  }
  return group;
}

/**
 * An instanced mesh split by its instances' positions into `cell` mm squares: a group of instanced meshes sharing the
 * geometry and material, each with its square's instances (matrices and colours, in their order) and a bounding sphere
 * over them. Returns the mesh itself when it cannot be split or would be a single chunk.
 */
export function chunkInstanced(mesh: THREE.InstancedMesh, cell: number): THREE.Object3D {
  if (Array.isArray(mesh.material) || !mesh.frustumCulled || mesh.position.lengthSq() !== 0 || mesh.children.length || mesh.morphTexture) return mesh;
  const m = mesh.instanceMatrix.array as Float32Array;
  const bins = binByGround(
    mesh.count,
    (i, out) => {
      out.x = m[i * 16 + 12];
      out.z = m[i * 16 + 14];
    },
    cell,
  );
  if (bins.size <= 1) return mesh;
  const group = new THREE.Group();
  group.name = mesh.name;
  const col = mesh.instanceColor ? (mesh.instanceColor.array as Float32Array) : null;
  for (const list of bins.values()) {
    const cm = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
    const cmArr = cm.instanceMatrix.array as Float32Array;
    const cc = col ? new Float32Array(list.length * 3) : null;
    list.forEach((i, j) => {
      cmArr.set(m.subarray(i * 16, i * 16 + 16), j * 16);
      if (cc && col) cc.set(col.subarray(i * 3, i * 3 + 3), j * 3);
    });
    if (cc) cm.instanceColor = new THREE.InstancedBufferAttribute(cc, 3);
    cm.instanceMatrix.needsUpdate = true;
    cm.count = list.length;
    cm.computeBoundingSphere();
    copyMeshSettings(mesh, cm);
    group.add(cm);
  }
  return group;
}

/**
 * Split a static scenery group's big meshes in place (into its plain sub-groups too) (merged meshes of over `minTris` triangles, instanced
 * meshes of over `minInstances` instances). Returns how many chunks it made.
 */
export function chunkStatic(group: THREE.Object3D, cell: number, minTris = 20000, minInstances = 64): number {
  let made = 0;
  for (const child of [...group.children]) {
    const im = child as THREE.InstancedMesh;
    // (a plain group of scenery: its own children)
    if (!(child as THREE.Mesh).isMesh && child.type === 'Group') {
      made += chunkStatic(child, cell, minTris, minInstances);
      continue;
    }
    let out: THREE.Object3D = child;
    if (im.isInstancedMesh) {
      if (im.count >= minInstances) out = chunkInstanced(im, cell);
    } else if ((child as THREE.Mesh).isMesh) {
      const g = (child as THREE.Mesh).geometry;
      const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
      if (tris >= minTris) out = chunkMerged(child as THREE.Mesh, cell);
    }
    if (out !== child) {
      group.add(out);
      group.remove(child);
      // (an instanced chunk shares the geometry; a merged one copied it: the original's buffers can go)
      if (!im.isInstancedMesh) (child as THREE.Mesh).geometry.dispose();
      else im.dispose();
      made += out.children.length;
    }
  }
  return made;
}
