extends CharacterBody3D
class_name Enemy

## A KayKit skeleton. Unlike the uploaded character dummy these ship with a
## real animation library — idle, walk, a chop, a hit reaction and three
## deaths — so this one is driven by an AnimationPlayer rather than posed in
## code, and the clip names are looked up by substring because packs rename.

signal died(where: Vector3)

@export var max_hp := 30.0
@export var speed := 2.1
@export var damage := 7.0
@export var attack_range := 1.9
@export var attack_cd := 1.5

var hp := 0.0
var anim: AnimationPlayer
var target: Node3D
var cd := 0.0
var state := "idle"
var hit_timer := 0.0

func _ready() -> void:
	hp = max_hp
	anim = _find_anim(self)
	_hide_probes(self)
	_play("Idle")

func _find_anim(n: Node) -> AnimationPlayer:
	if n is AnimationPlayer:
		return n
	for c in n.get_children():
		var r := _find_anim(c)
		if r != null:
			return r
	return null

func _hide_probes(n: Node) -> void:
	# The sample scenes ship a two-unit Icosphere light probe that renders as a
	# grey dome swallowing the character.
	if n is MeshInstance3D and not n.name.begins_with("Skeleton_"):
		(n as MeshInstance3D).visible = false
	for c in n.get_children():
		_hide_probes(c)

func _clip(want: String) -> String:
	if anim == null:
		return ""
	for a in anim.get_animation_list():
		if want.to_lower() in a.to_lower():
			return a
	return ""

func _play(want: String, loop := true) -> void:
	var c := _clip(want)
	if c == "" or anim == null:
		return
	if anim.current_animation == c:
		return
	var res := anim.get_animation(c)
	if res != null:
		res.loop_mode = Animation.LOOP_LINEAR if loop else Animation.LOOP_NONE
	anim.play(c)

func hurt(amount: float, from: Vector3) -> void:
	if state == "dead":
		return
	hp -= amount
	if hp <= 0.0:
		state = "dead"
		_play("Death_A", false)
		died.emit(global_position)
		set_physics_process(false)
		for c in get_children():
			if c is CollisionShape3D:
				(c as CollisionShape3D).set_deferred("disabled", true)
		get_tree().create_timer(6.0).timeout.connect(queue_free)
		return
	state = "hit"
	hit_timer = 0.45
	_play("Hit_A", false)
	# Knocked back a step, the way a blow should move something.
	var away := (global_position - from)
	away.y = 0
	if away.length() > 0.01:
		global_position += away.normalized() * 0.35

func _physics_process(delta: float) -> void:
	if state == "dead":
		return
	cd = maxf(0.0, cd - delta)
	if hit_timer > 0.0:
		hit_timer -= delta
		return
	if not is_instance_valid(target):
		_play("Idle")
		return

	var to := target.global_position - global_position
	to.y = 0.0
	var dist := to.length()
	if dist > attack_range:
		var dir := to.normalized()
		velocity = Vector3(dir.x * speed, 0, dir.z * speed)
		move_and_slide()
		rotation.y = lerp_angle(rotation.y, atan2(dir.x, dir.z), clampf(delta * 8.0, 0, 1))
		_play("Walking_A" if _clip("Walking_A") != "" else "Walk")
		state = "chase"
	else:
		velocity = Vector3.ZERO
		rotation.y = lerp_angle(rotation.y, atan2(to.x, to.z), clampf(delta * 8.0, 0, 1))
		if cd <= 0.0:
			cd = attack_cd
			state = "attack"
			_play("1H_Melee_Attack_Chop", false)
			# The blow lands part-way through the swing, not on the keypress.
			await get_tree().create_timer(0.35).timeout
			if state != "dead" and is_instance_valid(target) \
					and global_position.distance_to(target.global_position) <= attack_range + 0.5:
				if target.has_method("hurt"):
					target.hurt(damage, global_position)
		elif state != "attack":
			_play("Idle")
