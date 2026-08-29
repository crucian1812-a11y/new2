// A pack of paired animation delivered as one GLB: both skeletons in one
// scene, bones named `A_Hips` and `B_Hips`, every clip an animation in the
// same file. See clips-fbx.mjs for the other shape packs arrive in.
//
// Everything here was inside clip-check until a pack turned up as a hundred
// separate FBX files and the measurements had to stay the same while the
// reading changed.

import { readGLB } from './glb.mjs';

export function openPack(path) {
  const glb = readGLB(path);

  // The top of the mat, not the middle of it. The node sits at its own centre
  // and carries the slab's thickness in its scale, and taking the node's
  // height for the floor flatters every clip by half a mat.
  const matY = (() => {
    const w = glb.world(0, 0);
    const i = glb.byName.get('Training_Mat');
    if (i === undefined) return 0;
    const m = glb.at(w, 'Training_Mat');
    const node = glb.json.nodes[i];
    const mesh = glb.json.meshes[node.mesh];
    const acc = glb.json.accessors[mesh.primitives[0].attributes.POSITION];
    return m[13] + acc.max[1] * ((node.scale && node.scale[1]) || 1);
  })();

  const accessor = (world) => (role, joint) => glb.at(world, `${role}_${joint}`) || null;

  return {
    label: path,
    matY,
    clips: () => glb.clips(),
    rest: () => accessor(glb.world(0, 0)),
    frame: (index, t) => accessor(glb.world(index, t)),
  };
}
