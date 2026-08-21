extends Node3D

## The camp, the fight, and the light.
##
## Built in code from a seeded RNG for the same reason the JavaScript build
## scatters its props that way: a level laid out by hand cannot be re-rolled,
## and every prop placed by hand has to be placed again when the art changes.

const CAMP := "res://assets/camp/Models/%s.gltf"
const ENEMY := "res://assets/enemies/Skeleton_%s_Grim.glb"
const AXE := "res://assets/weapons/demonic weapons pack/axe/demonicaxegodot.glb"
const FX_AREA := "res://assets/BinbunVFX_Vol2/DarkMagicFX/effects/area/vfx_evil_area_01.tscn"
const PLAYER_MESH := "res://assets/character/HumanCharacterDummy_M.fbx"

const SCATTER := [
	["Tent_01", 2, 8.0, 13.0], ["Tent_03", 2, 9.0, 14.0],
	["Barrel_01", 6, 4.0, 12.0], ["Box_01", 5, 4.0, 11.0],
	["Broken_Barrel_01", 3, 5.0, 12.0], ["Chest_01", 2, 3.5, 9.0],
	["Cart", 1, 7.0, 10.0], ["BigCart", 1, 10.0, 13.0],
	["Pillar_01", 5, 6.0, 14.0], ["Bottle_01", 4, 2.5, 7.0],
]
const WAVE := ["Warrior", "Minion", "Rogue", "Warrior", "Minion", "Warrior"]

var player: Player
var hud: HUD
var controls: TouchControls
var ground_at: Callable = func(_x: float, _z: float) -> float: return 0.0
var enemies: Array = []
var rng := RandomNumberGenerator.new()
var fx_scene: PackedScene
var kills := 0

func _ready() -> void:
	rng.seed = 20260820
	_ground()
	_light()
	_scatter()
	_bonfire()
	_spawn_player()
	_camera()
	_hud()
	_controls()
	fx_scene = load(FX_AREA)
	_probe_setup()
	for i in WAVE.size():
		_spawn_enemy(WAVE[i], i)
	_refresh_counts()
	if "--shot" in OS.get_cmdline_user_args():
		add_child(preload("res://scripts/smoke.gd").new())

func _ground() -> void:
	## Earth, built as a mesh rather than painted on a plane.
	##
	## The ground is seventy per cent of every frame in an isometric game, and
	## Diablo II puts all of its painting there. This was one flat quad of
	## `Color(0.10, 0.11, 0.10)` — no texture, no relief, no variation — which
	## is why the whole thing read as props floating in a void. Nothing about
	## the lighting was going to fix that.
	##
	## The relief is real geometry, not a normal map: with the moon low, real
	## bumps catch real light and throw real shadow, and the ground stops
	## being a surface and starts being terrain. It is built on the CPU
	## because a vertex-shader displacement would have to recompute its own
	## normals, and a silent failure on somebody's phone looks exactly like
	## the flat plane this replaces.
	var n := FastNoiseLite.new()
	n.seed = 71
	n.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	n.frequency = 0.035
	n.fractal_octaves = 3
	var patch := FastNoiseLite.new()
	patch.seed = 903
	patch.noise_type = FastNoiseLite.TYPE_SIMPLEX
	patch.frequency = 0.055
	patch.fractal_octaves = 2

	const HALF := 34.0
	const CELLS := 56
	const RELIEF := 0.26
	var step := HALF * 2.0 / CELLS
	var verts := PackedVector3Array()
	var norms := PackedVector3Array()
	var cols := PackedColorArray()
	var uvs := PackedVector2Array()
	var idx := PackedInt32Array()

	# Dry trodden earth, damp mud in the hollows, and a little dead moss.
	var dry := Color(0.42, 0.365, 0.280)
	var mud := Color(0.175, 0.150, 0.125)
	var moss := Color(0.200, 0.235, 0.150)

	var h := func(x: float, z: float) -> float:
		return n.get_noise_2d(x, z) * RELIEF
	# Kept so the game can be asked, at any point, how high its own ground is
	# there. A figure standing lower than that is a figure buried in it.
	ground_at = h

	for j in CELLS + 1:
		for i in CELLS + 1:
			var x := -HALF + i * step
			var z := -HALF + j * step
			var y: float = h.call(x, z)
			verts.push_back(Vector3(x, y, z))
			# Worked out from the height function rather than from the faces.
			# `SurfaceTool.generate_normals()` on indexed geometry is a bet,
			# and the way it loses is a ground that takes no light from the
			# moon at all — which is exactly what this looked like: black
			# earth with a lit patch round the fire, and no clue why.
			var e := step * 0.5
			norms.push_back(Vector3(
				h.call(x - e, z) - h.call(x + e, z),
				2.0 * e,
				h.call(x, z - e) - h.call(x, z + e)).normalized())
			uvs.push_back(Vector2(x, z) * 0.34)
			# Low ground is wet and dark, high ground is dry and pale — the
			# reading anyone has of a rutted campsite.
			var lift := clampf(y / RELIEF * 0.5 + 0.5, 0.0, 1.0)
			var c := mud.lerp(dry, lift)
			var m := patch.get_noise_2d(x * 1.7, z * 1.7)
			if m > 0.24:
				c = c.lerp(moss, clampf((m - 0.24) * 2.6, 0.0, 0.75))
			cols.push_back(c)

	for j in CELLS:
		for i in CELLS:
			var a0 := j * (CELLS + 1) + i
			var b0 := a0 + 1
			var c0 := a0 + CELLS + 1
			var d0 := c0 + 1
			# Clockwise seen from above. Godot treats clockwise as the front
			# face, and the counter-clockwise order this had first meant every
			# triangle of the ground was a back face and every one of them was
			# culled. The ground was not dark — it was not being drawn, and an
			# hour went into the lighting of a mesh that was never on screen.
			idx.append_array([a0, b0, c0, b0, d0, c0])

	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = verts
	arr[Mesh.ARRAY_NORMAL] = norms
	arr[Mesh.ARRAY_TEX_UV] = uvs
	arr[Mesh.ARRAY_COLOR] = cols
	arr[Mesh.ARRAY_INDEX] = idx
	var am := ArrayMesh.new()
	am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)

	var mesh := MeshInstance3D.new()
	mesh.mesh = am
	var mat := StandardMaterial3D.new()
	# Grit, tiled small. The vertex colours carry the metre-scale variation;
	# this is what stops the metre between them being a smooth gradient.
	var grain := FastNoiseLite.new()
	grain.seed = 5
	grain.noise_type = FastNoiseLite.TYPE_SIMPLEX
	grain.frequency = 0.06
	grain.fractal_octaves = 4
	var tex := NoiseTexture2D.new()
	tex.noise = grain
	tex.seamless = true
	tex.width = 256
	tex.height = 256
	var ramp := Gradient.new()
	ramp.set_color(0, Color(0.80, 0.78, 0.74))
	ramp.set_color(1, Color(1.16, 1.14, 1.09))
	tex.color_ramp = ramp
	mat.albedo_texture = tex
	mat.vertex_color_use_as_albedo = true
	mat.roughness = 1.0
	mat.specular_mode = BaseMaterial3D.SPECULAR_DISABLED
	mesh.material_override = mat
	mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mesh)

	# The collision follows the relief, and this is not an optimisation to
	# skip.
	#
	# It was a flat box, on the reasoning that the bumps were "under a tenth of
	# a stride". They are not: the relief runs plus and minus three tenths of a
	# metre against a figure one metre eighty tall. Everything walks at y=0
	# while the ground in front of it rises, so a body gets cut off at the shin
	# by earth standing in front of it — which, on a small screen, reads as the
	# figures being see-through. Hero and monsters alike, because they all
	# stand on the same lie.
	var body := StaticBody3D.new()
	var col := CollisionShape3D.new()
	var hm := HeightMapShape3D.new()
	# HeightMapShape3D's cells are one unit across and it centres itself on
	# its origin, so the point count is the span plus one.
	var n_pts := int(HALF * 2.0) + 1
	hm.map_width = n_pts
	hm.map_depth = n_pts
	var data := PackedFloat32Array()
	data.resize(n_pts * n_pts)
	for j in n_pts:
		for i in n_pts:
			data[j * n_pts + i] = float(h.call(-HALF + i, -HALF + j))
	hm.map_data = data
	col.shape = hm
	body.add_child(col)
	add_child(body)

	_stones(n)
	_palisade(n)


func _light() -> void:
	## Two lights and a fire.
	##
	## The moon now casts. Without shadows every figure floated a hand above
	## the ground it was standing on, and no amount of raising the brightness
	## was going to fix a picture where nothing was attached to anything.
	## Orthogonal shadows out to thirty units is the cheap mode; the camera
	## cannot see further than that anyway.
	var moon := DirectionalLight3D.new()
	moon.rotation_degrees = Vector3(-38, 34, 0)
	moon.light_energy = 0.85
	moon.light_color = Color(0.55, 0.66, 0.95)
	moon.shadow_enabled = true
	moon.directional_shadow_mode = DirectionalLight3D.SHADOW_ORTHOGONAL
	moon.directional_shadow_max_distance = 24.0
	moon.shadow_bias = 0.04
	moon.shadow_normal_bias = 1.2
	add_child(moon)

	# A cold edge from behind, casting nothing. Diablo II is warm firelight
	# against cold blue-black, and with one warm bonfire doing all the work
	# the whole screen was a single orange. This is what puts a rim on a
	# skull and separates a figure from the ground behind it.
	var rim := DirectionalLight3D.new()
	rim.rotation_degrees = Vector3(-16, -142, 0)
	rim.light_energy = 0.55
	rim.light_color = Color(0.42, 0.56, 0.95)
	rim.shadow_enabled = false
	add_child(rim)

	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color(0.022, 0.026, 0.040)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.24, 0.29, 0.40)
	e.ambient_light_energy = 0.62
	e.fog_enabled = true
	e.fog_light_color = Color(0.045, 0.055, 0.085)
	e.fog_density = 0.024
	e.adjustment_enabled = true
	e.adjustment_contrast = 1.10
	e.adjustment_saturation = 1.00
	env.environment = e
	add_child(env)


func _stones(n: FastNoiseLite) -> void:
	## Loose rock, in one draw call. Bare ground reads as a floor; ground with
	## something lying on it reads as a place.
	var m := SphereMesh.new()
	m.radius = 0.17
	m.height = 0.22
	m.radial_segments = 6
	m.rings = 3
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = m
	mm.instance_count = 150
	var r2 := RandomNumberGenerator.new()
	r2.seed = 4242
	for i in mm.instance_count:
		var a := r2.randf() * TAU
		var rad: float = sqrt(r2.randf()) * 18.0
		var x := cos(a) * rad
		var z := sin(a) * rad
		var t := Transform3D.IDENTITY
		t = t.scaled(Vector3(r2.randf_range(0.5, 1.7), r2.randf_range(0.3, 0.8), r2.randf_range(0.5, 1.7)))
		t = t.rotated(Vector3.UP, r2.randf() * TAU)
		t.origin = Vector3(x, n.get_noise_2d(x, z) * 0.30 - 0.03, z)
		mm.set_instance_transform(i, t)
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = mm
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.20, 0.195, 0.18)
	mat.roughness = 1.0
	mat.specular_mode = BaseMaterial3D.SPECULAR_DISABLED
	mi.material_override = mat
	add_child(mi)


func _palisade(n: FastNoiseLite) -> void:
	## A wall of stakes round the camp.
	##
	## Diablo's areas are enclosed — cliffs, walls, trees — and the eye needs
	## that edge. Without one the camp sat in infinite identical nothing and
	## there was nothing to hold on to past the first ten metres.
	const RAD := 17.0
	const GATE := 0.55            ## radians of gap, so it is a camp and not a pen
	var m := CylinderMesh.new()
	m.top_radius = 0.075
	m.bottom_radius = 0.115
	m.height = 2.4
	m.radial_segments = 5
	m.rings = 1
	var r2 := RandomNumberGenerator.new()
	r2.seed = 1717
	var steps := 130
	var picked: Array[Transform3D] = []
	for i in steps:
		var a := (float(i) / steps) * TAU
		if absf(wrapf(a - PI * 0.25, -PI, PI)) < GATE:
			continue
		var rad := RAD + r2.randf_range(-0.22, 0.22)
		var x := cos(a) * rad
		var z := sin(a) * rad
		var hgt := r2.randf_range(0.78, 1.25)
		var t := Transform3D.IDENTITY
		t = t.scaled(Vector3(1.0, hgt, 1.0))
		t = t.rotated(Vector3.FORWARD, r2.randf_range(-0.09, 0.09))
		t = t.rotated(Vector3.RIGHT, r2.randf_range(-0.09, 0.09))
		t.origin = Vector3(x, 2.4 * hgt * 0.5 - 0.25 + n.get_noise_2d(x, z) * 0.3, z)
		picked.push_back(t)
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = m
	mm.instance_count = picked.size()
	for i in picked.size():
		mm.set_instance_transform(i, picked[i])
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = mm
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.21, 0.160, 0.108)
	mat.roughness = 1.0
	mat.specular_mode = BaseMaterial3D.SPECULAR_DISABLED
	mi.material_override = mat
	add_child(mi)

	# Something to actually stop at, in thirty-two arcs rather than two
	# hundred stakes.
	var body := StaticBody3D.new()
	for i in 32:
		var a := (float(i) / 32.0) * TAU
		if absf(wrapf(a - PI * 0.25, -PI, PI)) < GATE:
			continue
		var col := CollisionShape3D.new()
		var box := BoxShape3D.new()
		box.size = Vector3(0.4, 2.4, RAD * TAU / 32.0 + 0.3)
		col.shape = box
		col.transform = Transform3D(Basis(Vector3.UP, -a), Vector3(cos(a) * RAD, 1.0, sin(a) * RAD))
		body.add_child(col)
	add_child(body)


func _mesh_of(n: Node) -> MeshInstance3D:
	if n is MeshInstance3D:
		return n
	for c in n.get_children():
		var r := _mesh_of(c)
		if r != null:
			return r
	return null


func _instance_all(batches: Dictionary, shadows := true) -> void:
	## One draw call per kind of prop instead of one per prop.
	##
	## Ninety barrels, crates and bottles were ninety draw calls, and ninety
	## more for the shadow pass — which halved the frame rate the moment the
	## camp got dense enough to look like a camp. They are all the same handful
	## of meshes, so they go through a MultiMesh and the density is free.
	for name in batches:
		var proto := _prop(name)
		if proto == null:
			continue
		var mi := _mesh_of(proto)
		if mi == null or mi.mesh == null:
			proto.queue_free()
			continue
		# The mesh usually sits at an offset inside its own scene, sometimes
		# under an intermediate node, and that whole chain has to be folded
		# into each instance or the props land somewhere else. The prototype
		# is never added to the tree, so `get_global_transform` is not
		# available and the chain is walked by hand.
		var local := Transform3D.IDENTITY
		var walk: Node = mi
		while walk != null and walk != proto.get_parent():
			if walk is Node3D:
				local = (walk as Node3D).transform * local
			walk = walk.get_parent()
		var rows: Array = batches[name]
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = mi.mesh
		mm.instance_count = rows.size()
		for i in rows.size():
			mm.set_instance_transform(i, (rows[i] as Transform3D) * local)
		var node := MultiMeshInstance3D.new()
		node.multimesh = mm
		if not shadows:
			node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(node)
		proto.queue_free()


func _prop(name: String) -> Node3D:
	var ps := load(CAMP % name)
	return (ps as PackedScene).instantiate() if ps != null else null

func _scatter() -> void:
	## Camp sites, not confetti.
	##
	## The old version drew each prop's angle and radius from a flat random,
	## which is the one distribution a camp never has: it spreads everything
	## evenly and reads as noise. People pitch a tent and then put their
	## barrels against it. So the sites come first and the clutter hangs off
	## them, and what is left over is scattered as litter.
	const SITES := [
		[Vector2(-8.5, -6.0), "Tent_03"], [Vector2(7.5, -8.0), "Tent_02"],
		[Vector2(11.0, 4.5), "Tent_01"], [Vector2(-10.5, 6.5), "Tent_04"],
		[Vector2(-2.0, 12.0), "Tent_02"], [Vector2(4.0, 13.5), "Tent_01"],
	]
	const GOODS := ["Barrel_01", "Box_01", "Box_02", "Box_03", "Broken_Barrel_01", "Chest_01"]
	const LITTER := ["Bottle_01", "Bottle_02", "Bottle_03", "Plate_01", "Pouch_01",
		"Helmet", "Shield", "Sword", "Box_cap"]

	var goods := {}
	var litter := {}
	var put := func(bag: Dictionary, key: String, t: Transform3D) -> void:
		if not bag.has(key):
			bag[key] = []
		bag[key].append(t)

	for row in SITES:
		var at: Vector2 = row[0]
		var tent := _prop(row[1])
		if tent != null:
			tent.position = Vector3(at.x, 0, at.y)
			# Every tent faces roughly the fire, the way they would be pitched.
			tent.rotation.y = atan2(-at.x, -at.y) + rng.randf_range(-0.5, 0.5)
			tent.scale = Vector3.ONE * rng.randf_range(1.05, 1.35)
			add_child(tent)
		# Goods stacked against the side of it.
		for i in range(rng.randi_range(3, 6)):
			var off := Vector2(rng.randf_range(-2.6, 2.6), rng.randf_range(-2.6, 2.6))
			# The pack is built small: a barrel forty centimetres tall next to
			# a man of one metre eighty reads as a toy.
			var sc := rng.randf_range(1.4, 1.9)
			var t := Transform3D(Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3.ONE * sc),
				Vector3(at.x + off.x, 0, at.y + off.y))
			put.call(goods, GOODS[rng.randi() % GOODS.size()], t)

	# Two carts and some pillars, to break the ring of tents.
	for row in [["Cart", Vector2(14.0, -3.0)], ["BigCart", Vector2(-14.5, -1.0)]]:
		var c := _prop(row[0])
		if c != null:
			var at: Vector2 = row[1]
			c.position = Vector3(at.x, 0, at.y)
			c.rotation.y = atan2(-at.x, -at.y) + PI * 0.5
			c.scale = Vector3.ONE * 1.5
			add_child(c)
	for i in 7:
		var a := rng.randf() * TAU
		var r := rng.randf_range(14.0, 16.5)
		var sc := rng.randf_range(1.2, 1.8)
		put.call(goods, "Pillar_01", Transform3D(
			Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3.ONE * sc),
			Vector3(cos(a) * r, -0.1, sin(a) * r)))

	# Litter, everywhere people have walked. It lies flat on the ground and
	# casts nothing worth a second geometry pass.
	for i in 30:
		var a := rng.randf() * TAU
		var r: float = sqrt(rng.randf()) * 15.0
		var sc := rng.randf_range(1.3, 1.8)
		put.call(litter, LITTER[rng.randi() % LITTER.size()], Transform3D(
			Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3.ONE * sc),
			Vector3(cos(a) * r, 0, sin(a) * r)))

	_instance_all(goods)
	_instance_all(litter, false)

	# Cold ashes of older fires, so the camp has a history.
	for at in [Vector2(-5.0, 8.5), Vector2(9.0, 1.0), Vector2(-11.0, -1.0)]:
		var f := _prop("Fire_02" if rng.randf() < 0.5 else "Fire_01")
		if f == null:
			continue
		f.position = Vector3(at.x, 0.02, at.y)
		f.rotation.y = rng.randf() * TAU
		f.scale = Vector3.ONE * 2.2
		add_child(f)

func _bonfire() -> void:
	# A laid stone floor round the fire: the one patch of the camp that is
	# built rather than trodden, and the thing that makes the middle of the
	# screen worth looking at.
	var tiles := []
	for i in 26:
		var a := rng.randf() * TAU
		var r: float = sqrt(rng.randf()) * 2.6
		tiles.append(Transform3D(
			Basis(Vector3.UP, rng.randf() * TAU).scaled(
				Vector3(rng.randf_range(1.1, 1.6), 1.0, rng.randf_range(1.1, 1.6))),
			Vector3(cos(a) * r, 0.015, sin(a) * r)))
	_instance_all({"Stone_Floor_01": tiles}, false)

	var fire := _prop("Bonfire_01")
	if fire != null:
		fire.scale = Vector3.ONE * 1.8
		add_child(fire)
	# There was no flame. `Bonfire_01` is logs and a tripod — the light was
	# coming from an invisible point above a cold pile of wood, which is why
	# the middle of the camp read as a lamp rather than a fire.
	var flame := Node3D.new()
	flame.position = Vector3(0, 0.30, 0)
	# Additive and translucent, in several tongues. One opaque emissive cone
	# is a traffic cone: fire has no silhouette, it is brightness stacked on
	# brightness, and the only thing that reads that way is blending.
	# Each tongue flickers on its own phase. Driven as one body they move
	# like a single object breathing, which is what made the first version
	# read as a glowing tent rather than a fire.
	var tongues := [
		[0.30, 0.95, Color(0.90, 0.22, 0.03), 0.42, Vector3(0.00, 0.00, 0.00)],
		[0.19, 1.35, Color(1.00, 0.45, 0.06), 0.40, Vector3(0.10, 0.00, -0.07)],
		[0.16, 1.10, Color(1.00, 0.38, 0.05), 0.40, Vector3(-0.11, 0.00, 0.05)],
		[0.12, 1.65, Color(1.00, 0.74, 0.26), 0.46, Vector3(-0.03, 0.05, 0.08)],
		[0.10, 1.25, Color(1.00, 0.86, 0.45), 0.50, Vector3(0.06, 0.08, 0.03)],
	]
	for spec in tongues:
		var tongue := Node3D.new()
		tongue.position = spec[4]
		tongue.set_script(preload("res://scripts/flicker.gd"))
		var cone := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = 0.0
		cm.bottom_radius = spec[0]
		cm.height = spec[1]
		cm.radial_segments = 6
		cm.rings = 1
		cone.mesh = cm
		cone.position = Vector3(0, spec[1] * 0.5, 0)
		var fm := StandardMaterial3D.new()
		fm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		fm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		fm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
		fm.cull_mode = BaseMaterial3D.CULL_DISABLED
		fm.albedo_color = Color(spec[2].r, spec[2].g, spec[2].b, spec[3])
		fm.disable_receive_shadows = true
		cone.material_override = fm
		cone.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		tongue.add_child(cone)
		flame.add_child(tongue)
	add_child(flame)

	var glow := OmniLight3D.new()
	glow.position = Vector3(0, 1.1, 0)
	glow.light_color = Color(1.0, 0.60, 0.24)
	glow.light_energy = 3.4
	glow.omni_range = 16.0
	glow.set_script(preload("res://scripts/flicker.gd"))
	add_child(glow)

func _spawn_player() -> void:
	player = Player.new()
	player.name = "Player"
	var body := load(PLAYER_MESH)
	if body != null:
		var mesh := (body as PackedScene).instantiate()
		player.add_child(mesh)
		_clothe(mesh)
	var col := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.height = 1.7
	cap.radius = 0.35
	col.shape = cap
	col.position.y = 0.85
	player.add_child(col)
	player.position = Vector3(0, 0.2, 5.0)
	add_child(player)
	# A torch of his own, so he carries his light with him — held off his
	# shoulder rather than buried in his chest. A point light inside a body
	# lights everything except that body: every surface faces away from it, so
	# he was the one thing in the camp standing in his own shadow.
	var torch := OmniLight3D.new()
	torch.position = Vector3(0.30, 1.95, 0.30)
	torch.light_color = Color(1.0, 0.72, 0.40)
	torch.light_energy = 4.2
	torch.omni_range = 14.0
	torch.set_script(preload("res://scripts/flicker.gd"))
	player.add_child(torch)
	_give_axe()

func _clothe(n: Node) -> void:
	## The uploaded dummy ships untextured, which the renderer reads as pure
	## white — a mannequin lit like a lamp, standing next to skeletons that
	## were just spent an afternoon making dim. Until there is a real
	## character here, dressing him in dark leather at least puts him in the
	## same painting.
	if n is MeshInstance3D:
		var m := StandardMaterial3D.new()
		m.albedo_color = Color(0.46, 0.42, 0.37)
		m.roughness = 0.88
		m.metallic = 0.0
		(n as MeshInstance3D).material_override = m
	for c in n.get_children():
		_clothe(c)


func _give_axe() -> void:
	# Loudly, because this was silently doing nothing: the path was wrong, the
	# `load` returned null, the early return swallowed it, and the player
	# fought six skeletons bare-handed for a week without anyone noticing.
	var res := load(AXE)
	if res == null:
		push_error("no axe at %s" % AXE)
		return
	if player.rig == null or not player.rig.idx.has("propR"):
		push_error("no propR bone to hang the axe on")
		return
	var att := BoneAttachment3D.new()
	att.bone_idx = player.rig.idx["propR"]
	player.rig.skel.add_child(att)
	var axe := (res as PackedScene).instantiate()
	axe.scale = Vector3(0.9, 0.9, 0.9)
	att.add_child(axe)

func _spawn_enemy(kind: String, i: int) -> void:
	var res := load(ENEMY % kind)
	if res == null:
		return
	var e := Enemy.new()
	# Not all the same. A wave of identical health is a wave with one tactic,
	# and it makes any area spell either useless or absolute.
	match kind:
		"Warrior":
			e.max_hp = 46.0
			e.speed = 1.85
			e.damage = 9.0
		"Rogue":
			e.max_hp = 30.0
			e.speed = 2.55
			e.damage = 6.0
		_:
			e.max_hp = 24.0
			e.speed = 2.15
			e.damage = 5.0
	var model := (res as PackedScene).instantiate() as Node3D
	# Nothing in a horde should look stamped out. The models are one mesh with
	# one texture, so the variation has to come from the silhouette: a hand's
	# width of height between them and a little difference in how spare they
	# are. Scaling the model rather than the body keeps the physics shape
	# uniform, which Godot insists on.
	var tall := rng.randf_range(0.94, 1.14)
	var lean := rng.randf_range(0.88, 1.02)
	model.scale = Vector3(lean, tall, lean)
	e.add_child(model)
	e.ember_hue = rng.randf_range(-0.03, 0.07)
	var col := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.height = 1.8
	cap.radius = 0.28
	col.shape = cap
	col.position.y = 0.9
	e.add_child(col)
	var a := (float(i) / WAVE.size()) * TAU + rng.randf() * 0.5
	var r := rng.randf_range(11.0, 16.0)
	e.position = Vector3(cos(a) * r, 0.2, sin(a) * r)
	e.target = player
	e.died.connect(_on_enemy_died)
	add_child(e)
	enemies.append(e)

func _on_enemy_died(where: Vector3) -> void:
	kills += 1
	_refresh_counts()
	# Something to show for it: a coin on the ground where it fell.
	var coin := MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = 0.14
	cyl.bottom_radius = 0.14
	cyl.height = 0.03
	coin.mesh = cyl
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.95, 0.74, 0.28)
	m.emission_enabled = true
	m.emission = Color(0.7, 0.5, 0.15)
	m.emission_energy_multiplier = 0.9
	coin.material_override = m
	coin.position = where + Vector3(0, 0.06, 0)
	coin.rotation.x = PI / 2.4
	add_child(coin)

func _refresh_counts() -> void:
	var alive := 0
	for e in enemies:
		if is_instance_valid(e) and e.state != "dead":
			alive += 1
	if hud != null:
		hud.set_counts(kills, alive)

func _camera() -> void:
	var cam := IsoCamera.new()
	cam.target = player
	cam.view_height = 11.0
	add_child(cam)

func _controls() -> void:
	controls = TouchControls.new()
	controls.labels = Player.ABILITIES
	controls.cooldowns = player.cooldowns
	controls.used.connect(func(slot: int) -> void:
		player.use(slot, enemies)
		_refresh_counts())
	add_child(controls)
	player.cast_bolt.connect(_bolt)
	player.cast_nova.connect(_nova)


func _bolt(from: Vector3, dir: Vector3, dmg: float, reach: float) -> void:
	## A dart of dark light that travels. Damage on the button press would be
	## indistinguishable from a melee hit at range; the flight is the whole
	## difference between a spell and a very long arm.
	var head := MeshInstance3D.new()
	var sph := SphereMesh.new()
	sph.radius = 0.26
	sph.height = 0.52
	sph.radial_segments = 8
	sph.rings = 5
	head.mesh = sph
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = Color(0.85, 0.30, 1.0)
	m.emission_enabled = true
	m.emission = Color(0.62, 0.18, 1.0)
	m.emission_energy_multiplier = 4.0
	head.material_override = m
	head.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var lamp := OmniLight3D.new()
	lamp.light_color = Color(0.66, 0.30, 1.0)
	lamp.light_energy = 3.2
	lamp.omni_range = 6.5
	lamp.shadow_enabled = false
	head.add_child(lamp)
	head.position = from
	add_child(head)

	var travelled := 0.0
	var step := 13.0
	while travelled < reach and is_instance_valid(head):
		var d: float = get_process_delta_time() * step
		head.position += dir * d
		travelled += d
		var hit := _enemy_near(head.position, 1.0)
		if hit != null:
			hit.hurt(dmg, head.position)
			break
		await get_tree().process_frame
	if is_instance_valid(head):
		head.queue_free()
	_refresh_counts()


func _nova(at: Vector3, radius: float, _dmg: float) -> void:
	## The pack's own area effect where it loads, and a ring of light where it
	## does not — the spell must be visible either way, because a blow nobody
	## can see is a bug report.
	if fx_scene != null:
		var fx := fx_scene.instantiate() as Node3D
		add_child(fx)
		fx.position = at
		fx.scale = Vector3.ONE * (radius * 0.5)
		get_tree().create_timer(2.5).timeout.connect(func() -> void:
			if is_instance_valid(fx):
				fx.queue_free())
	var ring := MeshInstance3D.new()
	var tor := TorusMesh.new()
	tor.inner_radius = radius * 0.86
	tor.outer_radius = radius
	tor.rings = 24
	tor.ring_segments = 6
	ring.mesh = tor
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.albedo_color = Color(1.0, 0.62, 0.20, 0.85)
	ring.material_override = m
	ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	ring.position = at + Vector3(0, 0.12, 0)
	ring.scale = Vector3(0.15, 1.0, 0.15)
	add_child(ring)
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(ring, "scale", Vector3(1.15, 1.0, 1.15), 0.5)
	tw.tween_property(m, "albedo_color:a", 0.0, 0.6)
	tw.chain().tween_callback(ring.queue_free)


func _hud() -> void:
	hud = HUD.new()
	add_child(hud)
	player.health_changed.connect(hud.set_health)
	player.died.connect(func() -> void: hud.dead = true)
	hud.set_health(player.hp, player.max_hp)

var pointer_held := false

func _unhandled_input(e: InputEvent) -> void:
	if player == null or player.dead:
		return
	# Space still swings on the spot, for a keyboard, and the number row runs
	# the abilities — the HUD promises that, so it has to be true.
	if e.is_action_pressed("cast"):
		player.use(0, enemies)
		return
	if e is InputEventKey and (e as InputEventKey).pressed and not (e as InputEventKey).echo:
		var slot := (e as InputEventKey).keycode - KEY_1
		if slot >= 0 and slot < Player.ABILITIES.size():
			player.use(slot, enemies)
			_refresh_counts()
			return

	# Touch is read through the emulated mouse events Godot already sends for
	# it, so one path covers a finger and a mouse. Handling both raw touch and
	# the emulation would act on every tap twice.
	var at := Vector2.INF
	if e is InputEventMouseButton and (e as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
		pointer_held = (e as InputEventMouseButton).pressed
		if pointer_held:
			at = (e as InputEventMouseButton).position
	elif e is InputEventMouseMotion and pointer_held:
		at = (e as InputEventMouseMotion).position
	if at == Vector2.INF:
		return

	var ground := _ground_under(at)
	if ground == Vector3.INF:
		return
	# Pointing at a monster means going for it; pointing at the floor means
	# walking there. The tolerance is generous because a fingertip is about
	# forty pixels wide and the enemies are forty pixels tall.
	var near := _enemy_near(ground, 1.6)
	if near != null:
		player.order_attack(near)
	else:
		player.order_move(ground)

func _ground_under(at: Vector2) -> Vector3:
	var cam := get_viewport().get_camera_3d()
	if cam == null:
		return Vector3.INF
	var o := cam.project_ray_origin(at)
	var d := cam.project_ray_normal(at)
	if absf(d.y) < 0.0001:
		return Vector3.INF
	return o + d * (-o.y / d.y)

func _enemy_near(where: Vector3, radius: float) -> Node3D:
	var best: Node3D = null
	var best_d := radius
	for e in enemies:
		if not is_instance_valid(e) or e.state == "dead":
			continue
		var d := Vector2(e.global_position.x - where.x, e.global_position.z - where.z).length()
		if d < best_d:
			best_d = d
			best = e
	return best

## A window a test can look through, opened only by `?probe` in the URL.
##
## Checking a web build by looking at the picture does not work here. The
## camera keeps the player dead centre and his own torch is the brightest
## thing in the frame, so "where the light is" is the middle of the screen no
## matter where he walks — a whole afternoon of pixel metrics measuring the
## campfire flickering. This reports the facts instead.
var _probe := false

func _probe_setup() -> void:
	if not OS.has_feature("web"):
		return
	_probe = bool(JavaScriptBridge.eval("location.search.indexOf('probe') >= 0", true))

func _process(_d: float) -> void:
	_refresh_counts()
	if controls != null and player != null:
		player.stick = controls.stick
		controls.cooldowns = player.cooldowns
	if _probe and player != null:
		var info := func(k: int) -> int: return RenderingServer.get_rendering_info(k)
		JavaScriptBridge.eval(("window.__weg={x:%f,z:%f,hp:%f,kills:%d,alive:%d,fps:%d," +
			"tris:%d,draws:%d,objects:%d,texmem:%d,bufmem:%d,cd:[%.2f,%.2f,%.2f,%.2f]," +
			"vw:%d,vh:%d,sx:%.3f,sy:%.3f,y:%.3f,gy:%.3f}") % [
			player.global_position.x, player.global_position.z,
			player.hp, kills, enemies.size(),
			Engine.get_frames_per_second(),
			info.call(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME),
			info.call(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME),
			info.call(RenderingServer.RENDERING_INFO_TOTAL_OBJECTS_IN_FRAME),
			info.call(RenderingServer.RENDERING_INFO_TEXTURE_MEM_USED),
			info.call(RenderingServer.RENDERING_INFO_BUFFER_MEM_USED),
			player.cooldowns[0], player.cooldowns[1],
			player.cooldowns[2], player.cooldowns[3],
			get_viewport().get_visible_rect().size.x,
			get_viewport().get_visible_rect().size.y,
			player.stick.x, player.stick.y,
			player.global_position.y,
			float(ground_at.call(player.global_position.x, player.global_position.z))], true)
