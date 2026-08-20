extends Node3D

## The camp, the fight, and the light.
##
## Built in code from a seeded RNG for the same reason the JavaScript build
## scatters its props that way: a level laid out by hand cannot be re-rolled,
## and every prop placed by hand has to be placed again when the art changes.

const CAMP := "res://assets/camp/Models/%s.gltf"
const ENEMY := "res://assets/enemies/Skeleton_%s_Grim.glb"
const AXE := "res://assets/weapons/axe/demonicaxegodot.glb"
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
	fx_scene = load(FX_AREA)
	for i in WAVE.size():
		_spawn_enemy(WAVE[i], i)
	_refresh_counts()
	if "--shot" in OS.get_cmdline_user_args():
		add_child(preload("res://scripts/smoke.gd").new())

func _ground() -> void:
	var body := StaticBody3D.new()
	var mesh := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(80, 80)
	mesh.mesh = plane
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.10, 0.11, 0.10)
	mat.roughness = 1.0
	mesh.material_override = mat
	body.add_child(mesh)
	var col := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(80, 0.4, 80)
	col.shape = box
	col.position.y = -0.2
	body.add_child(col)
	add_child(body)

func _light() -> void:
	# Cold moon, and almost nothing else. Diablo's world is dark and what you
	# can see is what your own torch reaches.
	var moon := DirectionalLight3D.new()
	moon.rotation_degrees = Vector3(-40, 38, 0)
	moon.light_energy = 0.62
	moon.light_color = Color(0.58, 0.68, 0.92)
	moon.shadow_enabled = false
	add_child(moon)
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color(0.03, 0.035, 0.055)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.20, 0.24, 0.34)
	e.ambient_light_energy = 0.72
	e.fog_enabled = true
	e.fog_light_color = Color(0.06, 0.075, 0.11)
	e.fog_density = 0.018
	e.adjustment_enabled = true
	e.adjustment_contrast = 1.18
	e.adjustment_saturation = 0.88
	env.environment = e
	add_child(env)

func _prop(name: String) -> Node3D:
	var ps := load(CAMP % name)
	return (ps as PackedScene).instantiate() if ps != null else null

func _scatter() -> void:
	for row in SCATTER:
		for i in range(row[1]):
			var n := _prop(row[0])
			if n == null:
				continue
			var a := rng.randf() * TAU
			var r: float = rng.randf_range(row[2], row[3])
			n.position = Vector3(cos(a) * r, 0, sin(a) * r)
			n.rotation.y = rng.randf() * TAU
			add_child(n)

func _bonfire() -> void:
	var fire := _prop("Bonfire_01")
	if fire != null:
		add_child(fire)
	var glow := OmniLight3D.new()
	glow.position = Vector3(0, 1.1, 0)
	glow.light_color = Color(1.0, 0.60, 0.24)
	glow.light_energy = 5.0
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
		m.albedo_color = Color(0.32, 0.29, 0.26)
		m.roughness = 0.88
		m.metallic = 0.0
		(n as MeshInstance3D).material_override = m
	for c in n.get_children():
		_clothe(c)


func _give_axe() -> void:
	var res := load(AXE)
	if res == null or player.rig == null or not player.rig.idx.has("propR"):
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

func _hud() -> void:
	hud = HUD.new()
	add_child(hud)
	player.health_changed.connect(hud.set_health)
	player.died.connect(func() -> void: hud.dead = true)
	hud.set_health(player.hp, player.max_hp)

func _unhandled_input(e: InputEvent) -> void:
	if player == null or player.dead:
		return
	if e.is_action_pressed("cast") or (e is InputEventMouseButton and e.pressed \
			and (e as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT):
		player.try_attack(enemies)
		_refresh_counts()

func _process(_d: float) -> void:
	_refresh_counts()
