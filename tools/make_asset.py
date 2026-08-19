# A reference maquette, for judging proportion. Run it with:
#
#     blender --background --python tools/make_asset.py
#
# Nothing this produces ships. The game loads no assets and this does not
# change that — it writes a PNG into tools/ref/ that a person looks at while
# editing the drawing code, the same way `preview-heads.html` is looked at.
# What it adds over the preview page is a *third dimension*: the rig claims to
# be a 3D form seen through a particular camera, and until now the only thing
# that could check that claim was the same 2D code making it.
#
# The camera is the whole point, so it is derived rather than eyeballed.
#
# The game projects a point (x, y, z) to the screen as
#
#     screen_x    = x
#     screen_down = y * ISO_Y - z            (ISO_Y = 0.5)
#
# Two facts fall out of that, and both are used here:
#
#   * The directions that collapse to a single screen point — the kernel of
#     that map — are the true view ray. Solving x = 0 and y*ISO_Y - z = 0 gives
#     (0, 1, ISO_Y): a camera 26.57 degrees above the horizon, not the steep
#     overhead view the numbers look like at a glance.
#   * The projection is not rigid. Screen-up corresponds to the world direction
#     (0, -ISO_Y, 1), whose length is sqrt(1 + ISO_Y^2) = 1.118, so the image is
#     an ordinary orthographic view stretched vertically by that much. Blender
#     renders the rigid view and `pixel_aspect_y` puts the stretch back.
#
# Get either of those wrong and the reference agrees with nothing.

import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector

ISO_Y = 0.5
STRETCH = math.sqrt(1.0 + ISO_Y * ISO_Y)

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ref")
HEADINGS = 12
TILE = 320


# ---------------------------------------------------------------------------
# Scene plumbing
# ---------------------------------------------------------------------------

def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, rgb, rough=0.62):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    return mat


def ball(name, centre, radii, mat, segments=48):
    """An ellipsoid. Every form in the rig is one of these or a hull of them."""
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=segments // 2, radius=1.0)
    bm.to_mesh(mesh)
    bm.free()
    obj.location = Vector(centre)
    obj.scale = Vector(radii)
    obj.data.materials.append(mat)
    for p in mesh.polygons:
        p.use_smooth = True
    return obj


def limb(name, a, b, r0, r1, mat):
    """A tapered capsule between two joints — the same shape `capsule` draws."""
    a = Vector(a)
    b = Vector(b)
    d = b - a
    length = d.length
    if length < 1e-6:
        return None
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=True, segments=24,
        radius1=r0, radius2=r1, depth=length,
    )
    bm.to_mesh(mesh)
    bm.free()
    obj.location = a + d * 0.5
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = d.to_track_quat("Z", "Y")
    obj.data.materials.append(mat)
    for p in mesh.polygons:
        p.use_smooth = True
    return obj


def setup_camera_and_light(target_z, span):
    """The game's own projection, and a key light on the game's own bearing."""
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = span
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.collection.objects.link(cam)

    # Straight out of the kernel of the projection: mostly along +y, a little
    # up. Normalising is only for tidiness — direction is what matters.
    view = Vector((0.0, 1.0, ISO_Y)).normalized()
    cam.location = Vector((0.0, 0.0, target_z)) + view * span * 3.0
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = (-view).to_track_quat("-Z", "Y")
    bpy.context.scene.camera = cam

    # The rig's key light comes from the upper left. This is only so the
    # maquette reads as a solid; it is not trying to match `setKeyLight`.
    key_data = bpy.data.lights.new("key", type="SUN")
    key_data.energy = 3.2
    key = bpy.data.objects.new("key", key_data)
    bpy.context.collection.objects.link(key)
    key.rotation_euler = (math.radians(58), 0.0, math.radians(38))
    bpy.context.collection.objects.link(
        bpy.data.objects.new("fill", bpy.data.lights.new("fill", type="SUN"))
    )
    fill = bpy.data.objects["fill"]
    fill.data.energy = 0.9
    fill.rotation_euler = (math.radians(64), 0.0, math.radians(-150))
    return cam


def render_turntable(name, build, target_z, span):
    """One row of the contact sheet: the maquette spun through the headings."""
    scene = bpy.context.scene
    # Cycles on the CPU, because EEVEE wants a GL context and there is not one
    # in a headless container. This renders a maquette, not a game frame, so
    # the speed does not matter and the sample count is set low.
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 64
    # This Blender is built without OpenImageDenoise, so the noise is paid for
    # in samples instead.
    scene.cycles.use_denoising = False
    scene.render.resolution_x = TILE
    scene.render.resolution_y = TILE
    scene.render.resolution_percentage = 100
    # The vertical stretch the game's projection carries and a rigid camera
    # does not.
    scene.render.pixel_aspect_x = 1.0
    scene.render.pixel_aspect_y = STRETCH
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"

    root = bpy.data.objects.new("root", None)
    bpy.context.collection.objects.link(root)
    for obj in build():
        if obj is not None:
            obj.parent = root

    setup_camera_and_light(target_z, span)

    paths = []
    for i in range(HEADINGS):
        # Turning the model is the same as turning the camera and keeps the
        # light fixed in the world, which is what the game does too.
        root.rotation_euler = (0.0, 0.0, (i / HEADINGS) * math.tau)
        path = os.path.join(OUT_DIR, "%s-%02d.png" % (name, i))
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        paths.append(path)
    return paths


def contact_sheet(rows, out_path):
    """Stitch the tiles into one sheet, using Blender's own image buffers so
    the script needs nothing installed beyond Blender itself."""
    import numpy as np

    tile_h = int(round(TILE * STRETCH))
    sheet_w = TILE * HEADINGS
    sheet_h = tile_h * len(rows)
    sheet = np.zeros((sheet_h, sheet_w, 4), dtype=np.float32)
    sheet[:, :, :3] = 0.13

    for r, (_, paths) in enumerate(rows):
        for c, path in enumerate(paths):
            img = bpy.data.images.load(path)
            w, h = img.size
            px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
            a = px[:, :, 3:4]
            y0 = (len(rows) - 1 - r) * tile_h
            dst = sheet[y0:y0 + h, c * TILE:c * TILE + w]
            dst[:, :, :3] = px[:, :, :3] * a + dst[:, :, :3] * (1.0 - a)
            dst[:, :, 3] = 1.0
            bpy.data.images.remove(img)

    out = bpy.data.images.new("sheet", width=sheet_w, height=sheet_h, alpha=True)
    out.pixels = sheet.reshape(-1).tolist()
    out.filepath_raw = out_path
    out.file_format = "PNG"
    out.save()
    return out_path


# ---------------------------------------------------------------------------
# The maquettes, at the rig's own numbers
# ---------------------------------------------------------------------------

SKIN = None
CLOTH = None


def build_head():
    """The head `drawHead` claims to be drawing, as an actual solid.
    Coordinates are in head radii: +x forward, +y the head's left, +z up —
    exactly the frame `headFrame` projects through."""
    parts = []
    # Braincase. It projects to the r by r*1.118 ellipse the code draws.
    parts.append(ball("cranium", (0, 0, 0.12), (0.97, 0.97, 0.97), SKIN))
    # Jaw: from under the ears forward and down to the chin, as a hull of three
    # balls rather than a swept surface — proportion is what is being judged.
    parts.append(ball("jaw_l", (-0.24, 0.62, -0.22), (0.46, 0.32, 0.42), SKIN))
    parts.append(ball("jaw_r", (-0.24, -0.62, -0.22), (0.46, 0.32, 0.42), SKIN))
    parts.append(ball("chin", (0.46, 0.0, -0.78), (0.42, 0.4, 0.34), SKIN))
    # Brow and nose. The nose is the bump that makes the silhouette a head.
    parts.append(ball("brow", (0.72, 0.0, 0.42), (0.36, 0.62, 0.24), SKIN))
    parts.append(ball("nose", (1.02, 0.0, -0.14), (0.3, 0.16, 0.26), SKIN))
    # Ears, flat against the sides.
    for s, nm in ((1, "ear_l"), (-1, "ear_r")):
        parts.append(ball(nm, (-0.3, s * 0.94, -0.02), (0.16, 0.08, 0.26), SKIN))
    # Eyes, so the turntable shows when they should go out of sight.
    for s, nm in ((1, "eye_l"), (-1, "eye_r")):
        parts.append(ball(nm, (0.84, s * 0.4, 0.08), (0.14, 0.16, 0.12), CLOTH))
    return parts


def hair_plane(front, back):
    """The plane a hairline is cut by — the same construction as `hairPlane`."""
    fa, fc = math.cos(front), math.sin(front)
    ba, bc = -math.cos(back), math.sin(back)
    nx, nz = fc - bc, ba - fa
    n = math.hypot(nx, nz)
    nx, nz = nx / n, nz / n
    d = fa * nx + fc * nz
    return nx, nz, d


def build_hairline():
    """A ring on the head where the hair starts, so the plane cut can be seen
    for what it is: a circle, which is why its visible part is always one arc."""
    nx, nz, d = hair_plane(0.74, -0.42)
    rho = math.sqrt(max(0.0, 1.0 - d * d))
    vx, vz = -nz, nx
    parts = []
    steps = 40
    for i in range(steps):
        a = (i / steps) * math.tau
        c, s = math.cos(a) * rho, math.sin(a) * rho
        p = (d * nx + s * vx, c, d * nz + s * vz)
        parts.append(ball("hairline_%d" % i, [q * 1.03 for q in p], (0.05, 0.05, 0.05), CLOTH, 12))
    return parts


def build_wolf():
    """The wolf maquette, at `poseQuadruped`'s own numbers and standing still.
    Units are the rig's character units, not head radii."""
    body_len, body_h, leg_len, head_fwd, head_h = 40.0, 40.0, 30.0, 32.0, 46.0
    bz = body_h
    parts = []
    hind = (-body_len * 0.5, 0.0, bz - 2)
    chest = (body_len * 0.44, 0.0, bz + 4)
    neck = (body_len * 0.66, 0.0, bz + 7)
    head = (head_fwd, 0.0, head_h)
    snout = (head_fwd + 11, 0.0, head_h - 5.5)

    parts.append(limb("trunk", hind, neck, 10.5, 8.0, CLOTH))
    parts.append(ball("haunch", hind, (12.5, 11.0, 11.5), CLOTH))
    parts.append(ball("shoulder", chest, (13.0, 11.0, 12.5), CLOTH))
    parts.append(limb("neck", neck, head, 8.5, 8.0, CLOTH))
    parts.append(limb("muzzle", head, snout, 6.2, 2.9, SKIN))
    for i in range(3):
        t = (i + 1) / 4.0
        p = (hind[0] - 8 - i * 9, 0.0, bz - i * 7)
        parts.append(ball("tail_%d" % i, p, (3.4 - i, 3.0 - i, 3.0 - i), CLOTH))

    # The Z of a hind leg and the near-straight drop of a foreleg — the two
    # shapes the whole animal is read by.
    def leg(name, base_x, top_z, side, front):
        hip = (base_x, side * 8.0, top_z)
        foot = (base_x + (2 if front else -1), side * 8.0, 0.0)
        dx, dz = foot[0] - hip[0], foot[2] - hip[2]
        k = leg_len
        if front:
            knee = (base_x + dx * 0.34 - k * 0.1, side * 8.0, top_z + dz * 0.42)
            ankle = (base_x + dx * 0.8 + k * 0.05, side * 8.0, top_z + dz * 0.82)
        else:
            knee = (base_x + dx * 0.3 + k * 0.22, side * 8.0, top_z + dz * 0.36)
            ankle = (base_x + dx * 0.72 - k * 0.16, side * 8.0, top_z + dz * 0.76)
        out = [
            limb(name + "_a", hip, knee, 6.6, 4.2, SKIN),
            limb(name + "_b", knee, ankle, 4.0, 2.4, SKIN),
            limb(name + "_c", ankle, foot, 2.4, 2.0, SKIN),
            ball(name + "_paw", foot, (4.2, 3.0, 2.2), SKIN, 20),
        ]
        return out

    for side in (1, -1):
        parts += leg("fore_%d" % side, body_len * 0.4, bz + 2, side, True)
        parts += leg("hind_%d" % side, -body_len * 0.42, bz - 1, side, False)
    return parts


# ---------------------------------------------------------------------------

def main():
    global SKIN, CLOTH
    os.makedirs(OUT_DIR, exist_ok=True)
    rows = []

    clear_scene()
    SKIN = material("skin", (0.62, 0.47, 0.35))
    CLOTH = material("cloth", (0.16, 0.14, 0.13))
    rows.append(("head", render_turntable(
        "head", lambda: build_head() + build_hairline(), 0.0, 4.6)))

    clear_scene()
    SKIN = material("skin", (0.30, 0.27, 0.22))
    CLOTH = material("cloth", (0.20, 0.18, 0.15))
    rows.append(("wolf", render_turntable("wolf", build_wolf, 26.0, 118.0)))

    sheet = contact_sheet(rows, os.path.join(OUT_DIR, "maquette.png"))
    print("\nwrote %s" % sheet)
    print("camera: orthographic along %s, %.2f degrees above the horizon, "
          "vertical stretch %.4f" % ((0, 1, ISO_Y), math.degrees(math.atan2(ISO_Y, 1.0)), STRETCH))


if __name__ == "__main__":
    main()
    sys.exit(0)
