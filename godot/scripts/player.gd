extends CharacterBody3D
class_name Player

## Movement, the walk phase, and a swing.
##
## The uploaded dummy ships no animation at all, so everything here is posed in
## code — the same bargain the JavaScript build made, and the reason its walk
## never skated: `phase` advances by distance covered, not by a clock.

signal health_changed(cur: float, maxv: float)
signal died()

@export var speed := 3.6
@export var turn_rate := 10.0
@export var max_hp := 120.0
@export var damage := 18.0
@export var attack_range := 2.3
@export var attack_time := 0.55

var rig: Rig
var phase := 0.0
var gait := 0.0
var t := 0.0
var hp := 0.0
var swing := -1.0            ## -1 idle, otherwise 0..1 through the blow
var hurt_flash := 0.0
var dead := false

## Where he was told to go, and what he was told to hit.
##
## Diablo is played by pointing at the ground, and that turns out to be the
## only scheme that works on a phone as well: there is no WASD on a touch
## screen, and a virtual thumbstick under a thumb covers the quarter of a
## small screen you most need to see. Pointing needs no on-screen furniture
## at all.
var move_to := Vector3.ZERO
var has_move := false
var foe: Node3D = null
const ARRIVE := 0.28

func _ready() -> void:
	hp = max_hp
	rig = Rig.new()
	add_child(rig)
	var skel := _find_skeleton(self)
	if skel == null or not rig.setup(skel):
		push_warning("player: no usable skeleton")
	health_changed.emit(hp, max_hp)

func _find_skeleton(n: Node) -> Skeleton3D:
	if n is Skeleton3D:
		return n
	for c in n.get_children():
		var r := _find_skeleton(c)
		if r != null:
			return r
	return null

func hurt(amount: float, _from: Vector3) -> void:
	if dead:
		return
	hp = maxf(0.0, hp - amount)
	hurt_flash = 0.25
	health_changed.emit(hp, max_hp)
	if hp <= 0.0:
		dead = true
		died.emit()

func _physics_process(delta: float) -> void:
	t += delta
	if hurt_flash > 0.0:
		hurt_flash -= delta
	if dead:
		if rig != null:
			rig.pose_dead(minf(1.0, (t - 0.0)))
		return

	if swing >= 0.0:
		swing += delta / attack_time
		if swing >= 1.0:
			swing = -1.0

	var input := Vector2(
		Input.get_action_strength("move_right") - Input.get_action_strength("move_left"),
		Input.get_action_strength("move_down") - Input.get_action_strength("move_up"))
	var wish := Vector3(input.x, 0, input.y)
	if wish.length() > 1.0:
		wish = wish.normalized()
	# The keys win while they are held, so a keyboard player is never fighting
	# a destination he set with the mouse three seconds ago.
	if wish.length() > 0.01:
		has_move = false
		foe = null
	else:
		wish = _pointed_wish()
	# A body committed to a blow does not stroll through it.
	if swing >= 0.0:
		wish *= 0.25

	var before := global_position
	velocity = Vector3(wish.x * speed, velocity.y - 12.0 * delta, wish.z * speed)
	if is_on_floor():
		velocity.y = 0.0
	move_and_slide()

	var moved := Vector2(global_position.x - before.x, global_position.z - before.z).length()
	if rig != null and rig.stride > 0.0:
		phase = fposmod(phase + (moved / rig.stride) * TAU, TAU)
	var want_gait := clampf(moved / maxf(0.0001, speed * delta), 0.0, 1.0)
	gait = lerpf(gait, want_gait, clampf(delta * 10.0, 0, 1))

	if wish.length() > 0.01:
		rotation.y = lerp_angle(rotation.y, atan2(wish.x, wish.z), clampf(turn_rate * delta, 0, 1))

	if rig != null:
		rig.pose(phase, gait, t)
		if swing >= 0.0:
			rig.pose_swing(swing)

func order_move(where: Vector3) -> void:
	move_to = where
	has_move = true
	foe = null

func order_attack(e: Node3D) -> void:
	## Walk in and keep swinging until it stops being a target — the whole of
	## what a click on a monster means.
	foe = e
	has_move = false

func _pointed_wish() -> Vector3:
	if is_instance_valid(foe) and foe.get("state") != "dead":
		var to: Vector3 = foe.global_position - global_position
		to.y = 0.0
		# Stop a little inside reach: walking to exactly `attack_range` leaves
		# him dithering on the boundary as the target shuffles.
		if to.length() > attack_range - 0.45:
			return to.normalized()
		if swing < 0.0:
			try_attack([foe])
		return Vector3.ZERO
	foe = null

	if not has_move:
		return Vector3.ZERO
	var d := move_to - global_position
	d.y = 0.0
	if d.length() <= ARRIVE:
		has_move = false
		return Vector3.ZERO
	# Ease off over the last stride so he settles instead of jittering across
	# the spot he was sent to.
	return d.normalized() * clampf(d.length() / 0.9, 0.35, 1.0)


func try_attack(enemies: Array) -> void:
	if dead or swing >= 0.0:
		return
	swing = 0.0
	await get_tree().create_timer(attack_time * 0.45).timeout
	# The blow lands mid-arc. Everything in front of him inside reach takes it.
	for e in enemies:
		if not is_instance_valid(e) or e.state == "dead":
			continue
		var to: Vector3 = e.global_position - global_position
		to.y = 0
		if to.length() > attack_range:
			continue
		var facing := -global_transform.basis.z
		if facing.dot(to.normalized()) < 0.25:
			continue
		e.hurt(damage, global_position)
