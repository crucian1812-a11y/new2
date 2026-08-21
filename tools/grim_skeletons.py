"""Turn the KayKit skeletons grim.

The packs are CC0 and come rigged with ninety-five animations, which is worth
far more than their looks — so nothing here re-rigs anything. Two edits, both
of which leave the armature untouched:

  * The meshes are reshaped in their rest position. A skinned vertex rides
    whichever bones its groups name; moving the vertex changes the shape and
    nothing else, so every clip in the library still plays. Move a *bone* and
    you would have to rescale the location channels of all ninety-five actions
    to match, which is where this kind of job usually dies.

  * The atlas is repainted. KayKit's palette is a warm cartoon one: cream
    bone, tan leather, bright gold. Diablo II's undead are cold, dim and
    filthy. The remap works in HLS and separates the materials by hue and
    lightness rather than by hand-listing colours, because there are three and
    a half thousand of them.

The one proportion that makes these read as toys is the skull: it is 0.86
units tall on a 1.31-unit body, about two and a half heads to the whole
figure. Shrinking it about the underside of the jaw — so the head keeps
sitting on the neck rather than floating or sinking — is the single largest
change in here.

    blender --background --python tools/grim_skeletons.py
"""
import math
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "godot", "assets", "enemies")
OUT = os.path.join(HERE, "..", "godot", "assets", "enemies")

MODELS = ["Skeleton_Minion", "Skeleton_Rogue", "Skeleton_Warrior", "Skeleton_Mage"]

# The pack ships ninety-five clips — sitting on chairs, reloading a crossbow,
# strafing — and each model carries the whole library. That is five megabytes
# apiece, and this game has to load in a phone browser. So the export keeps a
# working set: what the fight uses today, plus the ones the next few rounds of
# content will obviously want (a village needs Interact and PickUp, a level
# needs skeletons climbing out of the ground). The originals stay in the
# repository, so widening this list is one line and one re-run.
#
# Matched exactly, not by prefix: `Death_A` and `Death_A_Pose` are different
# clips and the game looks its animations up by substring.
KEEP_CLIPS = {
    "Idle", "Idle_Combat", "Walking_A", "Running_A",
    "1H_Melee_Attack_Chop", "1H_Melee_Attack_Stab", "2H_Melee_Attack_Chop",
    "Unarmed_Melee_Attack_Punch_A", "Spellcast_Raise", "Spellcast_Shoot",
    "Hit_A", "Hit_B", "Death_A", "Death_B", "Death_C_Skeletons",
    "Skeletons_Awaken_Standing", "Skeletons_Awaken_Floor",
    "Taunt", "PickUp", "Interact", "Block",
}

# Optional: --atlas <path> writes the repainted texture out on its own, which
# is the only way to tell a bad colour rule from a bad UV.
_a = sys.argv.index("--atlas") if "--atlas" in sys.argv else -1
ATLAS_OUT = sys.argv[_a + 1] if _a > 0 else ""
_m = sys.argv.index("--only") if "--only" in sys.argv else -1
if _m > 0:
    MODELS = [x for x in MODELS if x in sys.argv[_m + 1].split(",")]

# The skull, everything worn on it, and the eyes, scaled together about the
# underside of the jaw so the head keeps sitting on the neck.
HEAD_PARTS = {"Head", "Skull", "Jaw", "Helmet", "Hat", "Hood", "Eyes"}

# A horned bucket helm and a witch's pointed hat are the last two cartoon
# notes in the set, and neither survives being shrunk — they just become a
# small horned bucket. A bare skull is what Diablo II puts on a skeleton, and
# the Rogue's hood is the one head covering here that already reads that way.
DROP_PARTS = {"Helmet", "Hat"}
HEAD_SCALE = 0.46
JAW_BOTTOM_Z = 1.19

# The legs are a quarter of this figure's height; on anything gaunt they are
# nearer half. Everything below the hip joint is stretched and everything
# above it rides up by the same amount, which makes one continuous monotone
# map — so no seam opens anywhere, in the mesh or in the skeleton.
LEG_TOP_Z = 0.519
LEG_STRETCH = 1.75
RISE = LEG_TOP_Z * (LEG_STRETCH - 1.0)

# The atlas is a grid of flat colour blocks — a palette, not a painting — so
# a thousand pixels across buys nothing but download. Each model embeds its
# own copy, so this is four times whatever it saves.
ATLAS_MAX = 512

TORSO_PARTS = {"Body", "Cloak", "Cape"}
TORSO_X = 0.78          # narrower across the shoulders and hips
DEPTH = 0.80            # thinner front to back, everywhere

LIMB_THIN = 0.70        # arms and legs, perpendicular to their own axis

# The same trick as the legs, along x: the arm bones run outward from a
# shoulder socket at 0.14, so stretching everything beyond that point leaves
# the joint where it is and lengthens the arm. Long spare arms are half of
# what makes a figure read as starved.
SHOULDER_X = 0.14
ARM_STRETCH = 1.28
ARM_BONES = ("upperarm", "lowerarm", "wrist", "hand", "elbowik", "handik")
ARM_AXIS_Z = 1.107      # the arm bones run along x at this height


def stretch_z(z):
    """Longer legs, the rest lifted to match. Applied to bones and mesh alike."""
    return np.where(z < LEG_TOP_Z, z * LEG_STRETCH, z + RISE)


def stretch_x(x):
    """Longer arms, hinged at the shoulder socket so the joint does not move."""
    a = np.abs(x)
    return np.sign(x) * np.where(a < SHOULDER_X, a, SHOULDER_X + (a - SHOULDER_X) * ARM_STRETCH)


def lengthen_legs(arm):
    """Move the rest pose of the skeleton itself: longer legs and longer arms.

    Reshaping a mesh is free; moving a bone is not, because every action in
    the library was authored against the old rest pose. It is safe here for
    one reason: the clips drive these bones almost entirely by rotation. The
    largest translation on any deforming bone is eight centimetres on the
    hips, and a rotation applied to a longer bone is exactly the longer stride
    we are after.
    """
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    rest = [(b, b.head.copy(), b.tail.copy(), b.roll) for b in arm.data.edit_bones]
    for b, h, t, roll in rest:
        b.use_connect = False
    for b, h, t, roll in rest:
        arm = any(k in b.name.lower() for k in ARM_BONES)
        hx = float(stretch_x(h.x)) if arm else h.x
        tx = float(stretch_x(t.x)) if arm else t.x
        b.head = (hx, h.y, float(stretch_z(h.z)))
        b.tail = (tx, t.y, float(stretch_z(t.z)))
        b.roll = roll
    bpy.ops.object.mode_set(mode="OBJECT")


def reshape(obj):
    """Move rest-pose vertices. A skinned vertex rides whichever bones its
    groups name, so changing the shape leaves every clip playing."""
    part = obj.name.split("_")[-1]
    M = np.array(obj.matrix_world)
    Mi = np.array(obj.matrix_world.inverted())
    n = len(obj.data.vertices)
    co = np.empty(n * 3, dtype=np.float32)
    obj.data.vertices.foreach_get("co", co)
    hom = np.concatenate([co.reshape(-1, 3).astype(np.float64), np.ones((n, 1))], axis=1)
    world = hom @ M.T
    x, y, z = world[:, 0].copy(), world[:, 1].copy(), world[:, 2].copy()

    z = stretch_z(z)
    pivot = JAW_BOTTOM_Z + RISE

    if part in HEAD_PARTS:
        x *= HEAD_SCALE
        y *= HEAD_SCALE
        z = pivot + (z - pivot) * HEAD_SCALE
    elif part in TORSO_PARTS:
        x *= TORSO_X
    elif part.startswith("Arm"):
        # The arm runs along x, so it lengthens along x and thins in the
        # other two.
        az = ARM_AXIS_Z + RISE
        x = stretch_x(x)
        y *= LIMB_THIN
        z = az + (z - az) * LIMB_THIN
    elif part.startswith("Leg"):
        # The leg runs along z, and its own centre line is off to one side.
        cx = 0.5 * (x.min() + x.max())
        cy = 0.5 * (y.min() + y.max())
        x = cx + (x - cx) * LIMB_THIN
        y = cy + (y - cy) * LIMB_THIN

    y *= DEPTH
    world = np.stack([x, y, z, np.ones_like(x)], axis=1)
    local = (world @ Mi.T)[:, :3]
    obj.data.vertices.foreach_set("co", local.reshape(-1).astype(np.float32))
    # The pack ships custom split normals, which are stored per-loop and do
    # not follow the vertices. Squash a mesh and leave them and the shading
    # goes with the old shape — a cloak that is now a light grey renders
    # black. These are flat-shaded low-poly models, so the honest normals are
    # the ones the faces imply.
    if obj.data.has_custom_normals:
        bpy.context.view_layer.objects.active = obj
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    obj.data.update()


def rgb_to_hls(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = np.max(rgb, axis=-1)
    mn = np.min(rgb, axis=-1)
    l = (mx + mn) * 0.5
    d = mx - mn
    s = np.zeros_like(l)
    nz = d > 1e-6
    s[nz] = np.where(l[nz] < 0.5, d[nz] / (mx[nz] + mn[nz]), d[nz] / (2.0 - mx - mn)[nz])
    h = np.zeros_like(l)
    rm = nz & (mx == r)
    gm = nz & (mx == g) & ~rm
    bm = nz & ~rm & ~gm
    h[rm] = ((g - b)[rm] / d[rm]) % 6.0
    h[gm] = ((b - r)[gm] / d[gm]) + 2.0
    h[bm] = ((r - g)[bm] / d[bm]) + 4.0
    return h / 6.0, l, s


def hls_to_rgb(h, l, s):
    def f(n):
        k = (n + h * 12.0) % 12.0
        a = s * np.minimum(l, 1.0 - l)
        return l - a * np.clip(np.minimum(k - 3.0, 9.0 - k), -1.0, 1.0)
    return np.stack([f(0.0), f(8.0), f(4.0)], axis=-1)


def value_noise(w, h, cells, seed):
    """Deterministic smooth noise, so re-running the tool is a no-op."""
    rng = np.random.default_rng(seed)
    g = rng.random((cells + 1, cells + 1))
    ys = np.linspace(0, cells, h, endpoint=False)
    xs = np.linspace(0, cells, w, endpoint=False)
    y0, x0 = ys.astype(int), xs.astype(int)
    fy, fx = ys - y0, xs - x0
    fy = (fy * fy * (3 - 2 * fy))[:, None]
    fx = (fx * fx * (3 - 2 * fx))[None, :]
    a = g[np.ix_(y0, x0)]
    b = g[np.ix_(y0, x0 + 1)]
    c = g[np.ix_(y0 + 1, x0)]
    d = g[np.ix_(y0 + 1, x0 + 1)]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def lin_to_srgb(v):
    return np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(np.maximum(v, 1e-8), 1 / 2.4) - 0.055)


def srgb_to_lin(v):
    return np.where(v <= 0.04045, v / 12.92, np.power((v + 0.055) / 1.055, 2.4))


def repaint(img):
    """Cold, dim and filthy, sorted by hue and lightness rather than by hand."""
    w, h = img.size
    flat = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(flat)
    px = flat.astype(np.float64).reshape(h, w, 4)
    rgb = lin_to_srgb(px[..., :3])
    hu, li, sa = rgb_to_hls(rgb)

    gold = (hu >= 0.115) & (hu < 0.22) & (sa > 0.35)
    # Bone is whatever is bright *or* whatever is grey, because KayKit paints
    # it as both: the limbs and ribs are a warm cream and the skull is a
    # near-neutral mid grey. Sorting those two by hue puts them in different
    # buckets and the model comes out with a charcoal head on ivory arms,
    # which is exactly what went wrong the first two times.
    bone = ~gold & ((li > 0.80) | ((sa <= 0.20) & (li > 0.42)))
    steel = ~gold & ~bone & (sa <= 0.20)
    hide = ~gold & ~bone & ~steel & (li > 0.30)
    murk = ~gold & ~bone & ~steel & ~hide

    nh, nl, ns = hu.copy(), li.copy(), sa.copy()

    # Bone: cold, dingy, and still the brightest thing on the model. An
    # undead reads by its skeleton, so this is the one range that cannot go
    # to mud.
    nh = np.where(bone, 0.13, nh)
    nl = np.where(bone, 0.50 + (li - 0.64) * 0.88, nl)
    ns = np.where(bone, 0.09, ns)

    # What grey is left is metal: colder and harder than pewter.
    nh = np.where(steel, 0.58, nh)
    nl = np.where(steel, li * 0.75, nl)
    ns = np.where(steel, 0.12, ns)

    # Gold trim goes to tarnished brass. Left bright it is the first thing
    # the eye finds, and it is the most cartoon note in the palette.
    nh = np.where(gold, 0.105, nh)
    nl = np.where(gold, li * 0.42, nl)
    ns = np.where(gold, sa * 0.32, ns)

    # Leather, cloth and straps.
    nh = np.where(hide, 0.07, nh)
    nl = np.where(hide, li * 0.42, nl)
    ns = np.where(hide, sa * 0.26, ns)

    # Crevices and seams, down to near black.
    nl = np.where(murk, li * 0.55, nl)
    ns = np.where(murk, sa * 0.40, ns)

    out = hls_to_rgb(nh, np.clip(nl, 0.0, 1.0), np.clip(ns, 0.0, 1.0))

    # Grime. Two octaves of smooth noise darkening the texture unevenly, so
    # the flat cartoon fills stop reading as plastic.
    n = 0.62 * value_noise(w, h, 24, 4711) + 0.38 * value_noise(w, h, 96, 991)
    grime = (0.84 + 0.22 * n)[..., None]
    out = np.clip(out * grime, 0.0, 1.0)
    # A cold cast in the shadows, warm nothing anywhere.
    lum = out[..., 0] * 0.3 + out[..., 1] * 0.6 + out[..., 2] * 0.1
    k = np.clip(1.0 - lum * 2.1, 0.0, 1.0)[..., None]
    out = out * (1 - k * 0.45) + np.array([0.055, 0.062, 0.075]) * (k * 0.45)

    px[..., :3] = srgb_to_lin(out)
    buf = px.reshape(-1).astype(np.float32)
    img.pixels.foreach_set(buf)
    return buf


def convert(name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, name + ".glb"))

    # The sample scenes ship a two-unit light probe that renders as a grey
    # dome swallowing the character. It has no business in a game asset.
    for o in list(bpy.data.objects):
        if o.type == "MESH" and not o.name.startswith("Skeleton_"):
            bpy.data.objects.remove(o, do_unlink=True)

    for o in list(bpy.data.objects):
        if o.type == "MESH" and o.name.split("_")[-1] in DROP_PARTS:
            bpy.data.objects.remove(o, do_unlink=True)

    for o in bpy.data.objects:
        if o.type == "ARMATURE":
            lengthen_legs(o)
    for o in bpy.data.objects:
        if o.type == "MESH":
            reshape(o)

    for img in bpy.data.images:
        if img.size[0] > 1:
            buf = repaint(img)
            if ATLAS_OUT:
                img.filepath_raw = ATLAS_OUT
                img.file_format = "PNG"
                img.save()
                # Saving clears the dirty flag, and for an image that is not
                # dirty the glTF exporter re-uses the original packed bytes
                # rather than re-encoding — so the model would ship with the
                # texture we just spent all this effort replacing.
                img.pixels.foreach_set(buf)
            if img.size[0] > ATLAS_MAX:
                img.scale(ATLAS_MAX, ATLAS_MAX)

    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        for node in m.node_tree.nodes:
            if node.type != "BSDF_PRINCIPLED":
                continue
            if m.name == "Glow":
                # Two coals in an empty skull. Yellow is a cartoon; the ember
                # colour is what makes it read as something dead and lit.
                node.inputs["Emission Color"].default_value = (1.0, 0.16, 0.035, 1.0)
                node.inputs["Emission Strength"].default_value = 5.5
                node.inputs["Base Color"].default_value = (0.25, 0.03, 0.01, 1.0)
                node.inputs["Metallic"].default_value = 0.0
            else:
                node.inputs["Roughness"].default_value = 0.86
                node.inputs["Metallic"].default_value = 0.0

    kept = []
    for a in list(bpy.data.actions):
        # Blender names the imported action after the action *and* its object,
        # so `Walking_A` arrives as `Walking_A_Rig`; the exporter writes back
        # the bare name.
        bare = a.name[:-4] if a.name.endswith("_Rig") else a.name
        if bare in KEEP_CLIPS:
            kept.append(bare)
        else:
            bpy.data.actions.remove(a)
    missing = KEEP_CLIPS - set(kept)
    if missing:
        print("[grim] %s: no such clip: %s" % (name, ", ".join(sorted(missing))))

    path = os.path.join(OUT, name + "_Grim.glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_bake_animation=False,
        export_optimize_animation_size=True,
        export_yup=True,
        export_apply=False,
    )
    n = 0
    with open(path, "rb") as f:
        n = len(f.read())
    print(f"[grim] {name}: {n/1024:.0f} KB, {len(bpy.data.actions)} clips kept")


for m in MODELS:
    convert(m)
