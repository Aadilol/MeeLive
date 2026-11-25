import * as THREE from 'three';

export function addMiiBust(group, root, mask) {
  // Only head-only Mii exports get a generated body. Keep rigged imports as authored.
  const miiHead = root.getObjectByName('miiHead');
  if (!miiHead || miiHead !== mask?.parent) return null;
  const face = root.getObjectByName('Faceline');
  const hair = root.getObjectByName('Hair');
  if (!face || root.getObjectsByProperty('isMesh', true).some((mesh) => mesh.parent !== miiHead)) return null;
  group.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(face);
  if (hair) bounds.expandByObject(hair);
  const size = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(size) || size <= 0) return null;
  const center = bounds.getCenter(new THREE.Vector3());
  const torso = new THREE.Group();
  group.add(torso);
  const hips = new THREE.Vector3(center.x, bounds.min.y - size * 0.91, center.z - size * 0.09);
  torso.position.copy(group.worldToLocal(hips.clone()));
  torso.attach(root);
  const scale = size / group.scale.x;
  const shirt = new THREE.MeshStandardMaterial({ color: 0x36589e, roughness: 0.84 });
  const skin = face.material?.color ? face.material.clone() : new THREE.MeshStandardMaterial({ color: 0xe4ad81 });
  function part(parent, geometry, material, x, y, z) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x * scale, y * scale, z * scale);
    parent.add(mesh);
    return mesh;
  }
  const chest = part(torso, new THREE.SphereGeometry(scale * 0.51, 32, 20), shirt, 0, 0.36, 0);
  chest.scale.set(1.08, 1.12, 0.66);
  part(torso, new THREE.CylinderGeometry(scale * 0.15, scale * 0.18, scale * 0.26, 24), skin, 0, 0.85, 0.07);
  function arm(side) {
    const upper = new THREE.Group();
    upper.position.set(side * scale * 0.45, scale * 0.69, 0);
    torso.add(upper);
    upper.rotation.z = side * 0.18;
    const elbow = new THREE.Group();
    elbow.position.y = -0.43 * scale;
    upper.add(elbow);
    const down = new THREE.Vector3(0, -1, 0);
    part(upper, new THREE.CapsuleGeometry(scale * 0.132, scale * 0.28, 8, 16), shirt, 0, -0.19, 0);
    part(elbow, new THREE.CapsuleGeometry(scale * 0.093, scale * 0.23, 8, 16), shirt, 0, -0.15, 0);
    const hand = part(elbow, new THREE.SphereGeometry(scale * 0.115, 20, 14), skin, 0, -0.35, 0);
    hand.scale.set(1, 1.15, 0.86);
    return [joint(upper, down), joint(elbow, down)];
  }
  return { bounds, torso: joint(torso), left: arm(1), right: arm(-1) };
}

function joint(node, direction = null) {
  const rest = node.quaternion.clone();
  return { node, rest, direction: direction?.clone().applyQuaternion(rest), sample: null, seen: -Infinity };
}

export function findBodyRig(root) {
  const weighted = new Set();
  root.traverse((node) => { if (node.isSkinnedMesh) node.skeleton.bones.forEach((bone) => weighted.add(bone)); });
  const byName = new Map(Array.from(weighted, (bone) => [
    bone.name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^(mixamorig|bip0*1|valvebiped)/, ''), bone,
  ]));
  const named = (names) => names.map((name) => byName.get(name)).find(Boolean);
  const spine = named(['spine', 'spine1', 'spine01', 'chest', 'spine2']);

  function arm(side) {
    const letter = side[0];
    function part(names) {
      return named(names.flatMap((name) => [side + name, name + side, letter + name, name + letter]));
    }
    function segment(bone, next) {
      if (!bone || !next) return null;
      const direction = bone.worldToLocal(next.getWorldPosition(new THREE.Vector3()));
      return direction.lengthSq() > 1e-8 ? joint(bone, direction.normalize()) : null;
    }
    const upper = part(['upperarm', 'arm', 'arm1']);
    const elbow = part(['lowerarm', 'forearm', 'elbow', 'arm2']);
    const wrist = part(['hand', 'wrist']);
    return [segment(upper, elbow), segment(elbow, wrist)];
  }
  const left = arm('left');
  const right = arm('right');
  return spine || left.some(Boolean) || right.some(Boolean) ? { torso: spine && joint(spine), left, right } : null;
}

const up = new THREE.Vector3(0, 1, 0);
const axis = new THREE.Vector3();
const sideAxis = new THREE.Vector3();
const upAxis = new THREE.Vector3();
const frontAxis = new THREE.Vector3();
const basis = new THREE.Matrix4();
const rotation = new THREE.Quaternion();
const swing = new THREE.Quaternion();
const cameraRotation = new THREE.Quaternion();
const worldToParent = new THREE.Quaternion();
const target = new THREE.Quaternion();

export function createBodyMotion(rig) {
  const joints = [rig.torso, ...rig.left, ...rig.right].filter(Boolean);
  const neutral = {};
  function track(entry, sample, now) {
    if (!entry || !sample) return;
    if (!entry.sample) entry.sample = sample.clone();
    else entry.sample.copy(sample);
    entry.seen = now;
  }
  return {
    reset() {
      for (const entry of joints) {
        entry.node.quaternion.copy(entry.rest);
        entry.seen = -Infinity;
      }
      delete neutral.shoulders;
      delete neutral.waist;
    },
    capture(result, now, calibrating) {
      const image = result.landmarks?.[0];
      const world = result.worldLandmarks?.[0];
      if (!image || !world) return;
      const visible = (index) => {
        const point = image[index];
        return point && world[index] && (point.visibility ?? 0) >= 0.58 && point.x > 0.015 && point.x < 0.985 && point.y > 0.015 && point.y < 0.985;
      };
      const point = (index) => new THREE.Vector3(-world[index].x, -world[index].y, -world[index].z);
      if (visible(11) && visible(12)) {
        const left = point(11);
        const right = point(12);
        sideAxis.subVectors(right, left);
        if (sideAxis.lengthSq() > 0.001) {
          const waist = visible(23) && visible(24);
          const key = waist ? 'waist' : 'shoulders';
          if (waist) upAxis.copy(left).add(right).sub(point(23)).sub(point(24));
          else upAxis.copy(up);
          sideAxis.normalize();
          frontAxis.crossVectors(sideAxis, upAxis).normalize();
          upAxis.crossVectors(frontAxis, sideAxis).normalize();
          if (frontAxis.lengthSq() > 0.5) {
            rotation.setFromRotationMatrix(basis.makeBasis(sideAxis, upAxis, frontAxis));
            const center = (image[11].x + image[12].x) / 2;
            if (!neutral[key]) neutral[key] = { rotation: rotation.clone(), center };
            else if (calibrating) {
              neutral[key].rotation.slerp(rotation, 0.22);
              neutral[key].center = THREE.MathUtils.lerp(neutral[key].center, center, 0.22);
            }
            if (!calibrating) {
              rotation.multiply(swing.copy(neutral[key].rotation).invert());
              if (!waist) {
                // Shoulder translation gives a little side lean when hips are below the frame.
                frontAxis.set(0, 0, 1);
                const lean = THREE.MathUtils.clamp((center - neutral[key].center) * 1.6, -0.23, 0.23);
                rotation.premultiply(swing.setFromAxisAngle(frontAxis, lean));
              }
              swing.identity().slerp(rotation, 0.9);
              track(rig.torso, swing, now);
            }
          }
        }
      }
      if (calibrating) return;
      function arm(joints, shoulder) {
        for (let segment = 0; segment < joints.length; segment++) {
          const start = shoulder + segment * 2;
          const end = start + 2;
          if (!joints[segment] || !visible(start) || !visible(end)) continue;
          const direction = point(end).sub(point(start));
          if (direction.lengthSq() > 0.002) track(joints[segment], direction.normalize(), now);
        }
      }
      arm(rig.right, 11);
      arm(rig.left, 12);
    },
    animate(now, elapsed, facing) {
      let changed = false;
      cameraRotation.setFromAxisAngle(up, facing);
      const amount = 1 - Math.exp(-elapsed / 115);
      for (const entry of joints) {
        target.copy(entry.rest);
        if (now - entry.seen < 260) {
          entry.node.parent.getWorldQuaternion(worldToParent).invert();
          if (entry.direction) {
            axis.copy(entry.sample).applyQuaternion(cameraRotation).applyQuaternion(worldToParent);
            target.premultiply(swing.setFromUnitVectors(entry.direction, axis));
          } else {
            worldToParent.multiply(cameraRotation);
            target.premultiply(rotation.copy(worldToParent).multiply(entry.sample).multiply(swing.copy(worldToParent).invert()));
          }
        }
        if (entry.node.quaternion.angleTo(target) > 0.001) {
          entry.node.quaternion.slerp(target, amount);
          changed = true;
        }
      }
      return changed;
    },
  };
}
