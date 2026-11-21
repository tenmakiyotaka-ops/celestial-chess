/**
 * chess-3d.js — 3D chess pieces (lathe-turned profiles), board sync,
 * move animation, selection highlight, promotion UI hooks.
 */
import * as THREE from './three.min.js';
import { WORLD } from './celestial-world.js';

export const BOARD = {
  topY: 1.5,
  squareSize: 1,
  originX: -3.5,
  originZ: -3.5
};

export function squareToWorld(sq) {
  const r = Math.floor(sq / 8), c = sq % 8;
  return new THREE.Vector3(c - 3.5, BOARD.topY, r - 3.5);
}

// ---------------------------------------------------------------- profiles
// Each profile is a list of [radius, height] revolved into a lathe mesh.
const PROFILES = {
  p: [[0, 0], [0.30, 0], [0.30, 0.05], [0.18, 0.09], [0.15, 0.16], [0.13, 0.30],
      [0.10, 0.38], [0.20, 0.46], [0.22, 0.54], [0.19, 0.60], [0.12, 0.64], [0, 0.66]],
  r: [[0, 0], [0.34, 0], [0.34, 0.06], [0.26, 0.12], [0.24, 0.34], [0.28, 0.40],
      [0.26, 0.66], [0.30, 0.72], [0.31, 0.80], [0.24, 0.82], [0.24, 0.90], [0, 0.90]],
  n: null, // knight is built from boxes/cylinders (see below)
  b: [[0, 0], [0.30, 0], [0.30, 0.05], [0.20, 0.10], [0.16, 0.20], [0.14, 0.34],
      [0.20, 0.42], [0.21, 0.50], [0.16, 0.60], [0.13, 0.72], [0.16, 0.80],
      [0.13, 0.88], [0.06, 0.94], [0.05, 1.00], [0, 1.04]],
  q: [[0, 0], [0.36, 0], [0.36, 0.06], [0.26, 0.12], [0.22, 0.26], [0.20, 0.40],
      [0.26, 0.48], [0.22, 0.60], [0.18, 0.74], [0.22, 0.84], [0.24, 0.94],
      [0.18, 1.00], [0.10, 1.04], [0.13, 1.10], [0, 1.14]],
  k: [[0, 0], [0.38, 0], [0.38, 0.06], [0.28, 0.12], [0.24, 0.26], [0.22, 0.42],
      [0.28, 0.50], [0.24, 0.62], [0.20, 0.76], [0.24, 0.86], [0.26, 0.98],
      [0.20, 1.04], [0.12, 1.08], [0.14, 1.14], [0, 1.16]]
};

const IVORY = new THREE.MeshPhysicalMaterial({
  color: 0xf7f1e2, roughness: 0.24, metalness: 0.03,
  clearcoat: 0.7, clearcoatRoughness: 0.25,
  sheen: 0.35, sheenColor: new THREE.Color(0xfff4dc)
});
const EBONY = new THREE.MeshPhysicalMaterial({
  color: 0x17130f, roughness: 0.22, metalness: 0.18,
  clearcoat: 0.85, clearcoatRoughness: 0.2,
  sheen: 0.25, sheenColor: new THREE.Color(0x8a6a33)
});
const GOLD_TRIM = new THREE.MeshStandardMaterial({
  color: 0xd8b25c, roughness: 0.25, metalness: 0.95,
  emissive: new THREE.Color(0x2a1e06), emissiveIntensity: 0.35
});

function latheMesh(profile, scaleY) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y * scaleY));
  const geo = new THREE.LatheGeometry(pts, 26);
  geo.computeVertexNormals();
  return geo;
}

function buildKnight(material) {
  const g = new THREE.Group();
  // base
  const baseGeo = latheMesh([[0,0],[0.34,0],[0.34,0.06],[0.26,0.12],[0.24,0.20],[0.22,0.26],[0,0.28]], 1);
  const base = new THREE.Mesh(baseGeo, material);
  g.add(base);
  // neck / head built from a tapered box + snout
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.20, 0.34, 10), material);
  neck.position.y = 0.44; neck.rotation.x = 0.10; g.add(neck);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.30, 0.44), material);
  head.position.set(0, 0.62, 0.04); head.rotation.x = 0.30; g.add(head);
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.16, 0.26), material);
  snout.position.set(0, 0.70, 0.26); snout.rotation.x = 0.42; g.add(snout);
  const ear = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.16, 6), material);
  ear.position.set(0.075, 0.84, -0.06); g.add(ear);
  const ear2 = ear.clone(); ear2.position.x = -0.075; g.add(ear2);
  const mane = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.30, 0.20), material);
  mane.position.set(0, 0.64, -0.16); mane.rotation.x = -0.15; g.add(mane);
  return g;
}

export function buildPiece(type, isWhite) {
  const mat = isWhite ? IVORY : EBONY;
  let obj;
  if (type === 'n') {
    obj = buildKnight(mat);
  } else {
    const scaleY = { p: 1.0, r: 1.28, b: 1.42, q: 1.6, k: 1.68 }[type] || 1;
    const geo = latheMesh(PROFILES[type], scaleY);
    obj = new THREE.Group();
    const mesh = new THREE.Mesh(geo, mat);
    obj.add(mesh);

    // gold accents: collar ring + crown details
    const h = { p: 0.66, r: 0.90, b: 1.04, q: 1.14, k: 1.16 }[type] * scaleY;
    if (type !== 'p') {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(
        { r: 0.30, b: 0.20, q: 0.22, k: 0.24 }[type], 0.022, 6, 24), GOLD_TRIM);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = h * 0.52;
      obj.add(ring);
    }
    if (type === 'k') {
      // cross
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.20, 0.05), GOLD_TRIM);
      v.position.y = h + 0.10; obj.add(v);
      const hbar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.05), GOLD_TRIM);
      hbar.position.y = h + 0.12; obj.add(hbar);
    }
    if (type === 'q') {
      const crown = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), GOLD_TRIM);
      crown.position.y = h + 0.04; obj.add(crown);
    }
    if (type === 'b') {
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), GOLD_TRIM);
      tip.position.y = h + 0.02; obj.add(tip);
    }
  }
  obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  obj.userData.type = type;
  obj.userData.isWhite = isWhite;
  return obj;
}

// ---------------------------------------------------------------- board state
const pieces = new Map();     // square -> mesh group
let group = null;
let highlightGroup = null;
let sceneRef = null;

export function initPieces(scene) {
  sceneRef = scene;
  group = new THREE.Group();
  scene.add(group);
  highlightGroup = new THREE.Group();
  scene.add(highlightGroup);
  return group;
}

export function clearPieces() {
  if (!group) return;
  for (const [, mesh] of pieces) group.remove(mesh);
  pieces.clear();
}

/** board = array of 64 (null | 'P','p', ...) */
export function setPosition(board, animate = false) {
  const wanted = {};
  for (let i = 0; i < 64; i++) if (board[i]) wanted[i] = board[i];

  // remove stale
  for (const [sq, mesh] of Array.from(pieces.entries())) {
    if (!wanted[sq]) {
      group.remove(mesh);
      pieces.delete(sq);
    } else {
      const p = wanted[sq];
      const type = p.toLowerCase();
      const white = p === p.toUpperCase();
      if (mesh.userData.type !== type || mesh.userData.isWhite !== white) {
        group.remove(mesh);
        pieces.delete(sq);
      }
    }
  }
  // add / position
  for (const k of Object.keys(wanted)) {
    const sq = +k, p = wanted[k];
    const type = p.toLowerCase(), white = p === p.toUpperCase();
    const target = squareToWorld(sq);
    let mesh = pieces.get(sq);
    if (!mesh) {
      mesh = buildPiece(type, white);
      mesh.position.copy(target);
      mesh.position.y = target.y;
      group.add(mesh);
      pieces.set(sq, mesh);
      if (animate) {
        mesh.position.y = target.y + 0.5;
        mesh.userData.dropT = 0.001;
      }
    } else {
      mesh.position.copy(target);
    }
  }
}

/** animate a move; returns a promise resolved when the piece lands */
export function animateMove(fromSq, toSq, duration = 0.42, captured = false) {
  const mesh = pieces.get(fromSq);
  if (!mesh) return Promise.resolve();
  const victim = pieces.get(toSq);
  if (victim) {
    // capture: sink + fade the taken piece
    animateCapture(victim);
    pieces.delete(toSq);
  }
  pieces.delete(fromSq);
  pieces.set(toSq, mesh);

  const a = squareToWorld(fromSq);
  const b = squareToWorld(toSq);
  return new Promise(resolve => {
    mesh.userData.anim = {
      t: 0, dur: duration, a: a.clone(), b: b.clone(), resolve
    };
  });
}

function animateCapture(victim) {
  victim.userData.capture = { t: 0, dur: 0.42 };
}

export function applySquareHighlight(selected, targets, lastMove, checkSq) {
  if (!highlightGroup) return;
  while (highlightGroup.children.length) {
    const c = highlightGroup.children.pop();
    highlightGroup.remove(c);
    if (c.geometry) c.geometry.dispose();
  }
  const add = (sq, color, opacity, scale = 0.92) => {
    const w = squareToWorld(sq);
    const geo = new THREE.PlaneGeometry(scale, scale);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(w.x, BOARD.topY + 0.035, w.z);
    highlightGroup.add(m);
  };
  if (lastMove) {
    add(lastMove.from, 0xffd98a, 0.18);
    add(lastMove.to, 0xffd98a, 0.24);
  }
  if (checkSq !== null && checkSq !== undefined && checkSq >= 0) {
    add(checkSq, 0xff4b3a, 0.42);
  }
  if (selected !== null && selected >= 0) {
    add(selected, 0xffc94d, 0.34, 0.98);
  }
  if (targets) {
    for (const sq of targets) add(sq, 0x7ce8a8, 0.26, 0.5);
  }
}

export function updatePieces(dt, t) {
  if (!group) return;
  for (const [, mesh] of pieces) {
    // travel arc
    const anim = mesh.userData.anim;
    if (anim) {
      anim.t += dt;
      const p = Math.min(1, anim.t / anim.dur);
      const ease = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
      mesh.position.x = anim.a.x + (anim.b.x - anim.a.x) * ease;
      mesh.position.z = anim.a.z + (anim.b.z - anim.a.z) * ease;
      mesh.position.y = anim.a.y + (anim.b.y - anim.a.y) * ease + Math.sin(p * Math.PI) * 0.55;
      if (p >= 1) {
        mesh.position.copy(anim.b);
        delete mesh.userData.anim;
        if (anim.resolve) anim.resolve();
        mesh.userData.settle = 0.001;
      }
    }
    // drop-in
    if (mesh.userData.dropT !== undefined) {
      mesh.userData.dropT += dt;
      const p = Math.min(1, mesh.userData.dropT / 0.5);
      mesh.position.y = BOARD.topY + (1 - p) * 0.5;
      if (p >= 1) delete mesh.userData.dropT;
    }
    // settle squash
    if (mesh.userData.settle !== undefined) {
      mesh.userData.settle += dt;
      const p = Math.min(1, mesh.userData.settle / 0.22);
      const s = 1 + Math.sin(p * Math.PI) * 0.05;
      mesh.scale.set(s, 1 + Math.sin(p * Math.PI) * -0.04, s);
      if (p >= 1) { mesh.scale.set(1, 1, 1); delete mesh.userData.settle; }
    }
    // selected piece bob
    if (mesh.userData.selected) {
      mesh.position.y = BOARD.topY + Math.sin(t * 3) * 0.03 + 0.02;
    } else if (!mesh.userData.anim && mesh.userData.dropT === undefined) {
      if (Math.abs(mesh.position.y - BOARD.topY) > 0.001) mesh.position.y = BOARD.topY;
    }
  }
  // captures sink away
  if (group) {
    group.children.slice().forEach(child => {
      const cap = child.userData.capture;
      if (!cap) return;
      cap.t += dt;
      const p = Math.min(1, cap.t / cap.dur);
      child.position.y = BOARD.topY - p * 1.2;
      child.scale.setScalar(1 - p * 0.6);
      if (child.material) {
        // materials are shared; only fade via scale to stay cheap
      }
      if (p >= 1) group.remove(child);
    });
  }
}

export function setSelected(sq) {
  for (const [s, mesh] of pieces) {
    mesh.userData.selected = (s === sq);
  }
}

/** raycast a screen position against board squares */
export function pickSquare(raycaster, camera, pointer) {
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(WORLD.squares || [], false);
  if (hits.length) return hits[0].object.userData.square;
  // fallback: intersect the mathematical board plane
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BOARD.topY);
  const pt = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(plane, pt)) {
    const c = Math.round(pt.x + 3.5);
    const r = Math.round(pt.z + 3.5);
    if (c >= 0 && c < 8 && r >= 0 && r < 8) return r * 8 + c;
  }
  return -1;
}

export function getPieceCount() { return pieces.size; }
