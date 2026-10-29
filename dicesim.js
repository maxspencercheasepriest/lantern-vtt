// Throws 3D dice on the server with a physics engine and records the throw, so every screen plays back
// exactly the same tumble. The server has already rolled the numbers (crypto); the dice are then painted
// so that whichever face each one lands on shows the number that was rolled.
//
// Units: one unit is about a d6's edge. x is right, y is up the screen (north), z is up off the table.
import * as CANNON from 'cannon-es';
import { dieShape, readFace, labelsFor, valuesFor, TOP_HEAVY } from './shared/dice3d.js';

const DT = 1 / 60;
const RECORD_EVERY = 2;       // 30 frames a second; the browser smooths between them
const MAX_SECONDS = 6;
const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;

const polyCache = new Map();
function diePolyhedron(sides) {
  if (polyCache.has(sides)) return polyCache.get(sides);
  const s = dieShape(sides);
  const shape = { vertices: s.vertices.map((v) => new CANNON.Vec3(...v)), faces: s.faces };
  polyCache.set(sides, shape);
  return shape;
}

/**
 * dice:   [{ sides, kind, value, kept }]
 * arena:  { w, h } in units; the floor runs from (0, -h) to (w, 0) (top-left corner at the origin)
 * tokens: [{ id, x, y, r, h, mass }] centres in units — they can be shoved and knocked over
 * walls:  [[ax, ay, bx, by]] in units — dice and tokens bounce off them
 * random: () => number in [0, 1), for the throw itself (not the result)
 */
export function simulateThrow({ dice, arena, tokens = [], walls = [], random = Math.random }) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, -60) });
  world.allowSleep = true;
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.solver.iterations = 12;
  const diceMat = new CANNON.Material('dice'), floorMat = new CANNON.Material('floor'), tokenMat = new CANNON.Material('token');
  world.addContactMaterial(new CANNON.ContactMaterial(floorMat, diceMat, { friction: 0.35, restitution: 0.4 }));
  world.addContactMaterial(new CANNON.ContactMaterial(diceMat, diceMat, { friction: 0.2, restitution: 0.5 }));
  world.addContactMaterial(new CANNON.ContactMaterial(tokenMat, diceMat, { friction: 0.25, restitution: 0.45 }));
  world.addContactMaterial(new CANNON.ContactMaterial(tokenMat, floorMat, { friction: 0.45, restitution: 0.1 }));
  world.addContactMaterial(new CANNON.ContactMaterial(tokenMat, tokenMat, { friction: 0.3, restitution: 0.2 }));

  const W = arena.w, H = arena.h;
  const floor = new CANNON.Body({ mass: 0, material: floorMat, shape: new CANNON.Plane() });
  world.addBody(floor);
  // the edges of the table, and any walls on the map
  const wall = (ax, ay, bx, by, thick = 0.25, tall = 40) => {
    const L = Math.hypot(bx - ax, by - ay);
    if (L < 1e-3) return;
    const b = new CANNON.Body({ mass: 0, material: floorMat, shape: new CANNON.Box(new CANNON.Vec3(L / 2 + thick, thick, tall / 2)) });
    b.position.set((ax + bx) / 2, (ay + by) / 2, tall / 2);
    b.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), Math.atan2(by - ay, bx - ax));
    world.addBody(b);
  };
  wall(0, 0.5, W, 0.5, 0.5); wall(0, -H - 0.5, W, -H - 0.5, 0.5);
  wall(-0.5, 0, -0.5, -H, 0.5); wall(W + 0.5, 0, W + 0.5, -H, 0.5);
  for (const s of walls.slice(0, 400)) wall(s[0], s[1], s[2], s[3], 0.08, 3);

  // tokens stand on the table like chunky playing pieces
  const upright = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI / 2); // cylinder's y axis → up
  const tokenBodies = tokens.slice(0, 80).map((t) => {
    const b = new CANNON.Body({ mass: t.mass ?? 0.6, material: tokenMat, linearDamping: 0.3, angularDamping: 0.3 });
    // top-heavy, like a miniature: the body's centre sits TOP_HEAVY of the way up the token
    b.addShape(new CANNON.Cylinder(t.r, t.r, t.h, 16), new CANNON.Vec3(0, -t.h * (TOP_HEAVY - 0.5), 0));
    b.quaternion.copy(upright);
    b.position.set(t.x, t.y, t.h * TOP_HEAVY);
    b.allowSleep = true; b.sleepSpeedLimit = 0.15; b.sleepTimeLimit = 0.3;
    world.addBody(b);
    b.sleep(); // they wake when something hits them
    return b;
  });

  // throw the dice in from one side, towards the middle
  const side = Math.floor(random() * 4);
  const cx = W / 2, cy = -H / 2;
  const dieBodies = dice.map((d, k) => {
    const shape = diePolyhedron(d.sides);
    const b = new CANNON.Body({ mass: 1, material: diceMat, linearDamping: 0.1, angularDamping: 0.12 });
    b.addShape(new CANNON.ConvexPolyhedron(shape));
    const along = (k + 0.5) / dice.length - 0.5; // spread along the edge
    const jitter = () => (random() - 0.5) * 1.2;
    const m = 1.2;
    const start = [
      [m, cy + along * Math.min(H * 0.6, dice.length * 1.3) + jitter()],
      [W - m, cy + along * Math.min(H * 0.6, dice.length * 1.3) + jitter()],
      [cx + along * Math.min(W * 0.6, dice.length * 1.3) + jitter(), -m],
      [cx + along * Math.min(W * 0.6, dice.length * 1.3) + jitter(), -H + m],
    ][side];
    b.position.set(start[0], start[1], 2.5 + random() * 2 + (k % 3) * 0.8);
    b.quaternion.setFromEuler(random() * 6.3, random() * 6.3, random() * 6.3);
    // aim past the middle, with a bit of spread
    const tx = cx + (random() - 0.5) * W * 0.35, ty = cy + (random() - 0.5) * H * 0.35;
    const dx = tx - start[0], dy = ty - start[1], dl = Math.hypot(dx, dy) || 1;
    const speed = Math.min(34, 12 + dl * 0.9) * (0.85 + random() * 0.3);
    b.velocity.set((dx / dl) * speed, (dy / dl) * speed, 2 + random() * 4);
    b.angularVelocity.set((random() - 0.5) * 40, (random() - 0.5) * 40, (random() - 0.5) * 30);
    b.allowSleep = true; b.sleepSpeedLimit = 0.25; b.sleepTimeLimit = 0.25;
    world.addBody(b);
    return b;
  });

  // run it, recording as we go
  const bodies = [...dieBodies, ...tokenBodies];
  const frames = [];
  const snap = () => {
    const f = [];
    for (const b of bodies) f.push(r2(b.position.x), r2(b.position.y), r2(b.position.z), r3(b.quaternion.x), r3(b.quaternion.y), r3(b.quaternion.z), r3(b.quaternion.w));
    frames.push(f);
  };
  snap();
  const steps = MAX_SECONDS / DT;
  let settledFor = 0;
  for (let i = 1; i <= steps; i++) {
    world.step(DT);
    // a die that falls through the table or off the edge (rare) goes back in the middle
    for (const b of dieBodies) if (b.position.z < -2 || b.position.x < -3 || b.position.x > W + 3 || b.position.y > 3 || b.position.y < -H - 3) {
      b.position.set(cx, cy, 3); b.velocity.set(0, 0, 0);
    }
    if (i % RECORD_EVERY === 0) snap();
    const still = bodies.every((b) => b.sleepState === CANNON.Body.SLEEPING || (b.velocity.length() < 0.05 && b.angularVelocity.length() < 0.05));
    settledFor = still ? settledFor + 1 : 0;
    if (settledFor > 10 && i > 30) break;
  }
  snap(); // the final resting frame

  // paint the numbers so the landed faces show what was rolled
  const diceOut = dice.map((d, k) => {
    const shape = dieShape(d.sides);
    const q = dieBodies[k].quaternion;
    const landed = readFace(shape, [q.x, q.y, q.z, q.w]);
    return { sides: d.sides, kind: d.kind, kept: d.kept !== false, value: d.value, labels: labelsFor(shape, landed, d.value, valuesFor(d.kind, d.sides)) };
  });

  // which tokens moved, and where they ended up
  const first = frames[0], last = frames[frames.length - 1];
  const nd = dieBodies.length;
  const tokensOut = [];
  tokens.slice(0, 80).forEach((t, k) => {
    const o = (nd + k) * 7;
    const moved = Math.hypot(last[o] - first[o], last[o + 1] - first[o + 1]);
    const b = tokenBodies[k];
    // the token's own up axis (its cylinder's y) in the world
    const up = b.quaternion.vmult(new CANNON.Vec3(0, 1, 0));
    const fallen = up.z < 0.5;
    // ignore a token that only trembled
    const touched = fallen || moved > 0.08 || frames.some((f) => Math.abs(f[o + 3] - first[o + 3]) > 0.04 || Math.abs(f[o + 4] - first[o + 4]) > 0.04
      || Math.hypot(f[o] - first[o], f[o + 1] - first[o + 1]) > 0.15);
    if (!touched) return;
    tokensOut.push({ id: t.id, slot: k, x: last[o], y: last[o + 1], moved, fallen, fallAngle: fallen ? Math.atan2(-up.y, up.x) : null });
  });

  // only send the tracks of tokens that were touched
  const keep = new Set([...dieBodies.keys(), ...tokensOut.map((t) => nd + t.slot)]);
  const slim = frames.map((f) => {
    const out = [];
    for (let b = 0; b < bodies.length; b++) if (keep.has(b)) out.push(...f.slice(b * 7, b * 7 + 7));
    return out;
  });
  return {
    dt: DT * RECORD_EVERY,
    duration: (slim.length - 1) * DT * RECORD_EVERY,
    frames: slim,
    dice: diceOut,
    tokens: tokensOut.map(({ slot, ...rest }) => rest),
  };
}
