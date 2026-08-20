extends Node3D

## Builds the camp in code rather than by hand-authoring a scene.
##
## Same reason the JavaScript build scatters its props from a seeded RNG: a
## level laid out by hand is a level that cannot be re-rolled, and every prop
## placed by hand is a prop somebody has to place again when the art changes.

const CAMP := "res://assets/camp/Models/%s.gltf"
const FX_AREA := "res://assets/BinbunVFX_Vol2/DarkMagicFX/effects/area/vfx_evil_area_01.tscn"
const PLAYER_MESH := "res://assets/character/HumanCharacterDummy_M.fbx"

# name, count, radius band, scale
const SCATTER := [
	["Tent_01", 2, 7.0, 11.0], ["Tent_03", 2, 8.0, 12.0],
	["Barrel_01", 5, 4.0, 10.0], ["Box_01", 4, 4.0, 9.0],
	["Broken_Barrel_01", 2, 5.0, 10.0], ["Chest_01", 2, 3.5, 8.0],
	["Cart", 1, 6.0, 9.0], ["BigCart", 1, 9.0, 12.0],
	["Pillar_01", 4, 6.0, 13.0], ["Bottle_01", 3, 2.5, 6.0],
]

var player: CharacterBody3D
var rng := RandomNumberGenerator.new()
var fx_scene: PackedScene

func _ready() -> void:
	rng.seed = 20260820
	_ground()
	_light()
	_scatter()
	_bonfire()
	_spawn_player()
	_camera()
	fx_scene = load(FX_AREA)

func _ground() -> void:
	var ground := StaticBody3D.new()
	var mesh := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(60, 60)
	mesh.mesh = plane
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.13, 0.14, 0.12)
	mat.roughness = 1.0
	mesh.material_override = mat
	ground.add_child(mesh)
	var col := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(60, 0.4, 60)
	col.shape = box
	col.position.y = -0.2
	ground.add_child(col)
	add_child(ground)

func _light() -> void:
	# Cold moon from the upper left, the way the old renderer lit everything.
	var moon := DirectionalLight3D.new()
	moon.rotation_degrees = Vector3(-42, 38, 0)
	moon.light_energy = 0.55
	moon.light_color = Color(0.68, 0.76, 0.95)
	moon.shadow_enabled = true
	add_child(moon)
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color(0.04, 0.05, 0.08)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.20, 0.24, 0.34)
	e.ambient_light_energy = 0.5
	e.fog_enabled = true
	e.fog_light_color = Color(0.09, 0.11, 0.16)
	e.fog_density = 0.012
	env.environment = e
	add_child(env)

func _load_prop(name: String) -> Node3D:
	var ps := load(CAMP % name)
	if ps == null:
		return null
	return (ps as PackedScene).instantiate()

func _scatter() -> void:
	for row in SCATTER:
		for i in range(row[1]):
			var n := _load_prop(row[0])
			if n == null:
				continue
			var a := rng.randf() * TAU
			var r: float = rng.randf_range(row[2], row[3])
			n.position = Vector3(cos(a) * r, 0, sin(a) * r)
			n.rotation.y = rng.randf() * TAU
			add_child(n)

func _bonfire() -> void:
	var fire := _load_prop("Bonfire_01")
	if fire != null:
		add_child(fire)
	# The fire is the one warm thing in the scene, same as the title screen.
	var glow := OmniLight3D.new()
	glow.position = Vector3(0, 1.1, 0)
	glow.light_color = Color(1.0, 0.62, 0.26)
	glow.light_energy = 4.0
	glow.omni_range = 14.0
	glow.shadow_enabled = false
	glow.set_script(preload("res://scripts/flicker.gd"))
	add_child(glow)

func _spawn_player() -> void:
	player = CharacterBody3D.new()
	player.name = "Player"
	var body := load(PLAYER_MESH)
	if body != null:
		player.add_child((body as PackedScene).instantiate())
	var col := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.height = 1.7
	cap.radius = 0.35
	col.shape = cap
	col.position.y = 0.85
	player.add_child(col)
	player.position = Vector3(0, 0.1, 4.0)
	player.set_script(preload("res://scripts/player.gd"))
	add_child(player)

func _findskel(n: Node) -> Skeleton3D:
	if n is Skeleton3D: return n
	for c in n.get_children():
		var r := _findskel(c)
		if r: return r
	return null

func _camera() -> void:
	var cam := IsoCamera.new()
	cam.target = player
	cam.view_height = 9.0
	add_child(cam)

func _unhandled_input(e: InputEvent) -> void:
	if e.is_action_pressed("cast") and fx_scene != null and player != null:
		var fx := fx_scene.instantiate()
		add_child(fx)
		(fx as Node3D).global_position = player.global_position + player.global_transform.basis.z * -2.5
		_expire(fx, 4.0)

func _expire(node: Node, secs: float) -> void:
	await get_tree().create_timer(secs).timeout
	if is_instance_valid(node):
		node.queue_free()
