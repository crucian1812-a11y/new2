extends CharacterBody3D
class_name Player

## Movement, and the phase the walk cycle is driven by.
##
## The phase is advanced by distance actually covered — not by a timer — so
## that whatever the frame rate or the speed, one stride of the cycle is one
## stride across the ground.

@export var speed := 3.4
@export var turn_rate := 9.0

var rig: Rig
var phase := 0.0
var gait := 0.0
var t := 0.0

func _ready() -> void:
	rig = Rig.new()
	add_child(rig)
	var skel := _find_skeleton(self)
	if skel == null or not rig.setup(skel):
		push_warning("player: no usable skeleton found")

func _find_skeleton(n: Node) -> Skeleton3D:
	if n is Skeleton3D:
		return n
	for c in n.get_children():
		var r := _find_skeleton(c)
		if r != null:
			return r
	return null

func _physics_process(delta: float) -> void:
	t += delta
	var input := Vector2(
		Input.get_action_strength("move_right") - Input.get_action_strength("move_left"),
		Input.get_action_strength("move_down") - Input.get_action_strength("move_up")
	)
	var wish := Vector3(input.x, 0, input.y)
	if wish.length() > 1.0:
		wish = wish.normalized()

	var before := global_position
	velocity = Vector3(wish.x * speed, velocity.y - 9.8 * delta, wish.z * speed)
	if is_on_floor():
		velocity.y = 0.0
	move_and_slide()

	var moved := Vector2(global_position.x - before.x, global_position.z - before.z).length()
	if rig != null and rig.stride > 0.0:
		phase = fposmod(phase + (moved / rig.stride) * TAU, TAU)
	gait = lerpf(gait, clampf(moved / maxf(0.0001, speed * delta), 0.0, 1.0), clampf(delta * 10.0, 0, 1))

	if wish.length() > 0.01:
		var want := atan2(wish.x, wish.z)
		rotation.y = lerp_angle(rotation.y, want, clampf(turn_rate * delta, 0.0, 1.0))

	if rig != null:
		rig.pose(phase, gait, t)
