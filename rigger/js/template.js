// ============================================================
// Humanoid joint template.
// Coordinates are NORMALIZED inside the model's bounding box:
//   x: -0.5 (character's right) .. +0.5 (character's left)
//   y:  0.0 (feet/bottom) .. 1.0 (top of head)
//   z: -0.5 (back) .. +0.5 (front)
// Arms are laid out horizontally => T-Pose authoring space.
// We author the CENTER + LEFT side, then mirror to the RIGHT.
// ============================================================

// Center spine chain + head
const CENTER = [
  { id: 'hips',    parent: null,    x: 0,    y: 0.52, z: 0.00 },
  { id: 'spine',   parent: 'hips',  x: 0,    y: 0.59, z: 0.00 },
  { id: 'chest',   parent: 'spine', x: 0,    y: 0.69, z: 0.00 },
  { id: 'neck',    parent: 'chest', x: 0,    y: 0.80, z: 0.01 },
  { id: 'head',    parent: 'neck',  x: 0,    y: 0.86, z: 0.02 },
  { id: 'headtop', parent: 'head',  x: 0,    y: 0.98, z: 0.02 },
];

// Left limbs (mirrored automatically). Bone naming uses ".L" / ".R".
const LEFT = [
  // arm
  { id: 'shoulder.L', parent: 'chest',      x: 0.06, y: 0.785, z: 0.00 },
  { id: 'upperarm.L', parent: 'shoulder.L', x: 0.14, y: 0.79,  z: 0.00 },
  { id: 'lowerarm.L', parent: 'upperarm.L', x: 0.28, y: 0.79,  z: -0.005 },
  { id: 'hand.L',     parent: 'lowerarm.L', x: 0.40, y: 0.79,  z: 0.00 },
  // leg
  { id: 'upperleg.L', parent: 'hips',       x: 0.085, y: 0.50, z: 0.00 },
  { id: 'lowerleg.L', parent: 'upperleg.L', x: 0.090, y: 0.27, z: 0.005 },
  { id: 'foot.L',     parent: 'lowerleg.L', x: 0.090, y: 0.04, z: -0.02 },
  { id: 'toe.L',      parent: 'foot.L',     x: 0.090, y: 0.015, z: 0.08 },
];

// Finger definitions per hand. Each finger is 2 joints (base, tip).
// Authored relative to hand.L; spread along z, length along x.
// order matters for the 3-finger subset (thumb, index, middle).
const FINGERS = [
  { name: 'thumb',  z: 0.045, dx0: 0.015, dx1: 0.05, dz1: 0.03 },
  { name: 'index',  z: 0.030, dx0: 0.04,  dx1: 0.085, dz1: 0.0 },
  { name: 'middle', z: 0.000, dx0: 0.045, dx1: 0.095, dz1: 0.0 },
  { name: 'ring',   z: -0.025,dx0: 0.04,  dx1: 0.085, dz1: 0.0 },
  { name: 'pinky',  z: -0.045,dx0: 0.035, dx1: 0.07,  dz1: 0.0 },
];

function mirror(j) {
  return {
    id: j.id.endsWith('.L') ? j.id.slice(0, -2) + '.R' : j.id + '.R',
    parent: j.parent && j.parent.endsWith('.L') ? j.parent.slice(0, -2) + '.R' : j.parent,
    x: -j.x, y: j.y, z: j.z,
    mirrorOf: j.id,
  };
}

// Build the full joint list for a given finger count (0, 3, or 5).
export function buildTemplate(fingerCount = 5) {
  const left = [...LEFT];

  if (fingerCount > 0) {
    const set = fingerCount === 3 ? FINGERS.filter(f => ['thumb','index','middle'].includes(f.name)) : FINGERS;
    const hand = LEFT.find(j => j.id === 'hand.L');
    for (const f of set) {
      const base = { id: `${f.name}.L`, parent: 'hand.L',
        x: hand.x + f.dx0, y: hand.y, z: hand.z + f.z };
      const tip  = { id: `${f.name}_tip.L`, parent: `${f.name}.L`,
        x: hand.x + f.dx1, y: hand.y, z: hand.z + f.z + f.dz1 };
      left.push(base, tip);
    }
  }

  const right = left.map(mirror);
  // tag the left ones so we can find their mirror partner
  const leftTagged = left.map(j => ({ ...j, mirrorOf: j.id.replace('.L', '.R') }));

  // Link mirror partners both ways by id
  const all = [...CENTER.map(j => ({ ...j })), ...leftTagged, ...right];

  // Resolve mirror partner ids -> store sibling reference id
  for (const j of all) {
    if (j.id.endsWith('.L')) j.mirror = j.id.slice(0, -2) + '.R';
    else if (j.id.endsWith('.R')) j.mirror = j.id.slice(0, -2) + '.L';
    else j.mirror = null;
  }
  return all;
}

// A human-friendly ordering for the bone list UI.
export const DISPLAY_ORDER = [
  'hips','spine','chest','neck','head','headtop',
  'shoulder','upperarm','lowerarm','hand',
  'thumb','index','middle','ring','pinky',
  'upperleg','lowerleg','foot','toe',
];
