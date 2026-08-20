extends Node3D

## An animated model sheet.
##
## A rest-pose render says nothing about a rig that has been re-proportioned:
## the bones moved, and ninety-five clips were authored against where they
## used to be. The only honest check is to watch the clips play on the new
## skeleton, at a size where an elbow in the wrong place is visible.
##
##   xvfb-run -a LIBGL_ALWAYS_SOFTWARE=1 godot --path godot \
##     --rendering-driver opengl3 --resolution 1000x420 res://scripts/lineup.tscn
##
## Pass a clip name after `--` to look at a different one.

const MODELS := ["Minion", "Rogue", "Warrior", "Mage"]
const PATH := "res://assets/enemies/Skeleton_%s_Grim.glb"
const PATH_ORIG := "res://assets/enemies/Skeleton_%s.glb"

var players: Array[AnimationPlayer] = []
var clip := "Walking_A"
var t := 0.0
var shot := 0
var orig := false

func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	orig = "--orig" in args
	for a in args:
		if not a.begins_with("-"):
			clip = a

	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color(0.045, 0.05, 0.065)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.30, 0.34, 0.44)
	e.ambient_light_energy = 0.9
	env.environment = e
	add_child(env)

	var key := DirectionalLight3D.new()
	key.rotation_degrees = Vector3(-34, 28, 0)
	key.light_energy = 1.1
	key.light_color = Color(1.0, 0.78, 0.56)
	add_child(key)

	for i in MODELS.size():
		var res := load((PATH_ORIG if orig else PATH) % MODELS[i])
		if res == null:
			continue
		var n := (res as PackedScene).instantiate() as Node3D
		n.position = Vector3((float(i) - (MODELS.size() - 1) * 0.5) * 1.25, 0, 0)
		n.rotation.y = PI
		add_child(n)
		var ap := _anim(n)
		if ap != null:
			players.append(ap)
			var name := _clip(ap, clip)
			if name != "":
				ap.get_animation(name).loop_mode = Animation.LOOP_LINEAR
				ap.play(name)
			else:
				push_warning("no clip matching '%s'" % clip)

	var cam := IsoCamera.new()
	var focus := Node3D.new()
	focus.position.y = 1.0
	add_child(focus)
	cam.target = focus
	cam.view_height = 3.0
	cam.position.y = 1.0
	add_child(cam)

func _anim(n: Node) -> AnimationPlayer:
	if n is AnimationPlayer:
		return n
	for c in n.get_children():
		var r := _anim(c)
		if r != null:
			return r
	return null

func _clip(ap: AnimationPlayer, want: String) -> String:
	for a in ap.get_animation_list():
		if want.to_lower() in a.to_lower():
			return a
	return ""

func _process(d: float) -> void:
	t += d
	if shot < 4 and t >= 0.6 + shot * 0.28:
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png(
			"/tmp/shots/lineup-%s%s-%d.png" % [clip, "-orig" if orig else "", shot])
		print("SHOT ", shot, " at ", players[0].current_animation_position if players.size() > 0 else -1.0)
		shot += 1
	if shot >= 4:
		print("ALLDONE")
		get_tree().quit()
