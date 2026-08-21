extends CharacterBody3D
class_name Player

## Movement, the walk phase, and a swing.
##
## The uploaded dummy ships no animation at all, so everything here is posed in
## code — the same bargain the JavaScript build made, and the reason its walk
## never skated: `phase` advances by distance covered, not by a clock.

signal health_changed(cur: float, maxv: float)
signal died()
signal cast_bolt(from: Vector3, dir: Vector3, damage: float, reach: float)
signal cast_nova(at: Vector3, radius: float, damage: float)

@export var speed := 3.6
@export var turn_rate := 10.0
@export var max_hp := 120.0
@export var damage := 18.0
@export var attack_range := 2.3
@export var attack_time := 0.55

## What the four buttons do.
##
## `arc` is the dot product a target has to clear to be in front of him: 0.25
## is the sixty-degree wedge an axe covers, and a negative number is a swing
## that comes round far enough to catch what is beside him.
const ABILITIES := [
	{"name": "Удар", "cd": 0.0, "time": 0.52, "dmg": 18.0, "reach": 2.3,
		"arc": 0.25, "kind": "melee", "wind": -0.9, "through": 1.5},
	{"name": "Мах", "cd": 3.2, "time": 0.86, "dmg": 34.0, "reach": 3.1,
		"arc": -0.45, "kind": "melee", "wind": -1.7, "through": 2.3},
	{"name": "Залп", "cd": 2.2, "time": 0.62, "dmg": 26.0, "reach": 13.0,
		"arc": 0.0, "kind": "bolt", "wind": 0.0, "through": 0.0},
	{"name": "Круг", "cd": 10.0, "time": 0.95, "dmg": 30.0, "reach": 4.6,
		"arc": -1.0, "kind": "nova", "wind": 0.0, "through": 0.0},
]

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

## The thumbstick, in screen axes, fed in by the controls each frame. Screen
## right is world +X and screen down is world +Z at this camera, so it drops
## straight into a wish vector with no conversion.
var stick := Vector2.ZERO
var cooldowns := [0.0, 0.0, 0.0, 0.0]
var slot := 0

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

	for i in cooldowns.size():
		cooldowns[i] = maxf(0.0, cooldowns[i] - delta)
	if swing >= 0.0:
		swing += delta / float(ABILITIES[slot]["time"])
		if swing >= 1.0:
			swing = -1.0

	var input := Vector2(
		Input.get_action_strength("move_right") - Input.get_action_strength("move_left"),
		Input.get_action_strength("move_down") - Input.get_action_strength("move_up"))
	var wish := Vector3(input.x, 0, input.y)
	if wish.length() > 1.0:
		wish = wish.normalized()
	# The stick outranks everything: a thumb on it is a live instruction, and
	# it should never be arguing with somewhere he was sent a moment ago.
	if stick.length() > 0.01:
		wish = Vector3(stick.x, 0, stick.y)
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
			var a: Dictionary = ABILITIES[slot]
			if a["kind"] == "melee":
				rig.pose_swing(swing, a["wind"], a["through"])
			else:
				rig.pose_cast(swing)

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
	use(0, enemies)


func use(which: int, enemies: Array) -> void:
	if dead or swing >= 0.0 or which < 0 or which >= ABILITIES.size():
		return
	if cooldowns[which] > 0.0:
		return
	var a: Dictionary = ABILITIES[which]
	slot = which
	swing = 0.0
	cooldowns[which] = a["cd"]
	# Everything lands mid-action rather than on the press, so the blow has
	# visibly travelled before anything falls over.
	await get_tree().create_timer(float(a["time"]) * 0.45).timeout
	if dead:
		return
	var facing := -global_transform.basis.z
	match a["kind"]:
		"bolt":
			cast_bolt.emit(global_position + Vector3(0, 1.15, 0) + facing * 0.6,
				facing, a["dmg"], a["reach"])
		"nova":
			cast_nova.emit(global_position, a["reach"], a["dmg"])
			for e in enemies:
				if not is_instance_valid(e) or e.state == "dead":
					continue
				var d: Vector3 = e.global_position - global_position
				d.y = 0
				if d.length() <= float(a["reach"]):
					e.hurt(a["dmg"], global_position)
		_:
			for e in enemies:
				if not is_instance_valid(e) or e.state == "dead":
					continue
				var to: Vector3 = e.global_position - global_position
				to.y = 0
				if to.length() > float(a["reach"]):
					continue
				if facing.dot(to.normalized()) < float(a["arc"]):
					continue
				e.hurt(a["dmg"], global_position)
