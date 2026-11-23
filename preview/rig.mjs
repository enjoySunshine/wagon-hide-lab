import { SkinnedMesh } from '../src/objects/SkinnedMesh.js';
import { Bone } from '../src/objects/Bone.js';
import { Skeleton } from '../src/objects/Skeleton.js';
import { Mesh } from '../src/objects/Mesh.js';
import { BufferGeometry } from '../src/core/BufferGeometry.js';
import { Float32BufferAttribute, Uint32BufferAttribute } from '../src/core/BufferAttribute.js';
import { Raycaster } from '../src/core/Raycaster.js';
import { Vector3 } from '../src/math/Vector3.js';
import { BoxGeometry } from '../src/geometries/BoxGeometry.js';
import { DoubleSide } from '../src/constants.js';
import { Group } from '../src/objects/Group.js';

export const COLS = 70;
export const ROWS = 40;
export const BONES = 10;
export const RAYS = 24;

export function makeGrid(cols, rows, x0, y0, x1, y1, zAmp) {
  const positions = [];
  const morph = [];
  for (let y = 0; y <= rows; y++) {
    for (let x = 0; x <= cols; x++) {
      const u = x / cols;
      const v = y / rows;
      const px = x0 + (x1 - x0) * u;
      const py = y0 + (y1 - y0) * v;
      positions.push(px, py, 0);
      morph.push(0, 0, Math.sin(u * Math.PI) * Math.cos(v * Math.PI) * zAmp);
    }
  }
  const indices = [];
  const stride = cols + 1;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const a = y * stride + x;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.morphAttributes.position = [new Float32BufferAttribute(morph, 3)];
  geo.morphTargetsRelative = true;
  geo.setIndex(new Uint32BufferAttribute(indices, 1));
  return geo;
}

export function skinFor(geo, bones, y0, y1) {
  const pos = geo.attributes.position;
  const idx = new Float32Array(pos.count * 4);
  const w = new Float32Array(pos.count * 4);
  const span = (y1 - y0) / (bones.length - 1);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    let f = (y - y0) / span;
    if (f < 0) f = 0;
    if (f > bones.length - 1) f = bones.length - 1;
    const i0 = Math.floor(f);
    const i1 = Math.min(bones.length - 1, i0 + 1);
    const t = f - i0;
    idx[i * 4] = i0;
    idx[i * 4 + 1] = i1;
    w[i * 4] = 1 - t;
    w[i * 4 + 1] = t;
  }
  geo.setAttribute('skinIndex', new Float32BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new Float32BufferAttribute(w, 4));
}

export function makeBones(count, length) {
  const bones = [];
  const root = new Bone();
  root.name = 'root';
  bones.push(root);
  let parent = root;
  const step = length / (count - 1);
  for (let i = 1; i < count; i++) {
    const b = new Bone();
    b.name = 'b' + i;
    b.position.y = step;
    parent.add(b);
    bones.push(b);
    parent = b;
  }
  return bones;
}

export function applyPose(bones, bend) {
  for (let i = 0; i < bones.length; i++) bones[i].rotation.set(0, 0, 0);
  bones[3].rotation.z = bend;
  bones[6].rotation.x = bend * 0.5;
}

export function createRig() {
  const y0 = 0;
  const y1 = 8;
  const bones = makeBones(BONES, y1 - y0);
  const skeleton = new Skeleton(bones);
  const bodyGeo = makeGrid(COLS, ROWS, -2, y0, 2, y1, 0.35);
  const capeGeo = makeGrid(COLS, ROWS, 2.2, y0, 4.2, y1, 0.2);
  skinFor(bodyGeo, bones, y0, y1);
  skinFor(capeGeo, bones, y0, y1);

  const mat = { side: DoubleSide };
  const body = new SkinnedMesh(bodyGeo, mat);
  const cape = new SkinnedMesh(capeGeo, mat);
  body.name = 'body';
  cape.name = 'cape';
  const rig = new Group();
  rig.add(body);
  rig.add(cape);
  body.add(bones[0]);
  body.bind(skeleton);
  cape.bind(skeleton);

  const prop = new Mesh(new BoxGeometry(1, 1, 1), mat);
  prop.position.set(8, 1, 0);
  rig.add(prop);

  const raycaster = new Raycaster();
  const dir = new Vector3(0, 0, -1);
  const origins = [];
  for (let i = 0; i < RAYS; i++) {
    const u = (i + 0.5) / RAYS;
    origins.push(new Vector3(-1.5 + u * 5.6, 0.6 + (i % 6) * 1.15, 6));
  }

  return { rig, body, cape, prop, bones, skeleton, raycaster, dir, origins };
}

export function hitPack(ctx, mesh) {
  const out = [];
  for (const o of ctx.origins) {
    ctx.raycaster.set(o, ctx.dir);
    const hits = ctx.raycaster.intersectObject(mesh, false);
    if (hits.length === 0) out.push(null);
    else {
      const h = hits[0];
      out.push([h.distance, h.point.x, h.point.y, h.point.z, h.face.a, h.face.b, h.face.c]);
    }
  }
  return out;
}

export function boundsPack(mesh) {
  const b = mesh.boundingBox;
  const s = mesh.boundingSphere;
  return {
    box: [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z],
    sphere: [s.center.x, s.center.y, s.center.z, s.radius]
  };
}

export function measureFrame(ctx, bend, morph) {
  const { rig, body, cape, prop, bones, skeleton, raycaster, dir } = ctx;
  applyPose(bones, bend);
  body.morphTargetInfluences[0] = morph;
  cape.morphTargetInfluences[0] = morph * 0.5;
  rig.updateMatrixWorld(true);
  const t0 = performance.now();
  skeleton.update();
  body.computeBoundingBox();
  body.computeBoundingSphere();
  cape.computeBoundingBox();
  cape.computeBoundingSphere();
  const bodyHits = hitPack(ctx, body);
  const capeHits = hitPack(ctx, cape);
  raycaster.set(new Vector3(8, 1, 6), dir);
  const propHits = raycaster.intersectObject(prop, false);
  const t1 = performance.now();
  const ph = propHits[0];
  return {
    ms: t1 - t0,
    body: boundsPack(body),
    cape: boundsPack(cape),
    bodyHits,
    capeHits,
    prop: ph ? [ph.distance, ph.point.x, ph.point.y, ph.point.z, ph.face.a, ph.face.b, ph.face.c] : null
  };
}

export function runBenchmark(ctx) {
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const flat = measureFrame(ctx, 0, 0);
    const bent = measureFrame(ctx, 0.35, 0.4);
    runs.push({ flat, bent });
  }
  return runs;
}

export function fmt(n) {
  return Number(n).toFixed(6);
}

export function lineHit(h) {
  if (!h) return '打不中';
  return [fmt(h[0]), fmt(h[1]), fmt(h[2]), fmt(h[3]), String(h[4]), String(h[5]), String(h[6])].join(' ');
}

export function reportLines(runs) {
  const lines = [];
  for (let i = 0; i < runs.length; i++) {
    lines.push('第' + (i + 1) + '次 平 ' + runs[i].flat.ms.toFixed(1) + ' 弯 ' + runs[i].bent.ms.toFixed(1));
  }
  const last = runs[runs.length - 1];
  const dump = (title, pack) => {
    lines.push(title + ' 盒 ' + pack.box.map(fmt).join(' '));
    lines.push(title + ' 球 ' + pack.sphere.map(fmt).join(' '));
  };
  dump('平身体', last.flat.body);
  dump('平披风', last.flat.cape);
  dump('弯身体', last.bent.body);
  dump('弯披风', last.bent.cape);
  lines.push('木箱 ' + last.flat.prop.map((n, i) => i < 4 ? fmt(n) : String(n)).join(' '));
  for (let i = 0; i < RAYS; i++) {
    lines.push('平身体射线 ' + i + ' ' + lineHit(last.flat.bodyHits[i]));
    lines.push('弯身体射线 ' + i + ' ' + lineHit(last.bent.bodyHits[i]));
    lines.push('平披风射线 ' + i + ' ' + lineHit(last.flat.capeHits[i]));
    lines.push('弯披风射线 ' + i + ' ' + lineHit(last.bent.capeHits[i]));
  }
  return lines;
}
