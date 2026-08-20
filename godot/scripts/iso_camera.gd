extends Camera3D
class_name IsoCamera

## The camera the whole project is built around, carried over from the
## JavaScript build rather than re-guessed.
##
## That renderer projects a point (x, y, z) — z up — to the screen as
##
##     screen_x    = x
##     screen_down = y * ISO_Y - z          (ISO_Y = 0.5)
##
## The directions that map collapses to a single point are its kernel, and the
## kernel is the view ray: solving x = 0 and y*ISO_Y - z = 0 gives (0, 1, ISO_Y),
## which is a camera atan(0.5) = 26.57 degrees above the horizon. A shallow
## view, not the steep overhead one the 0.5 squash suggests at a glance — the
## old code assumed the complement, 63 degrees, and every silhouette was out by
## a fifth of a head radius before it was caught.
##
## Godot is Y-up where that renderer was Z-up, so the ground plane here is XZ
## and the elevation is measured off it.

const ISO_Y := 0.5
const ELEVATION := atan(ISO_Y)          ## 26.57 degrees

@export var target: Node3D
@export var view_height := 6.0          ## world units across the short axis
@export var distance := 40.0            ## irrelevant to framing; ortho
@export var follow_lag := 6.0

func _ready() -> void:
	projection = PROJECTION_ORTHOGONAL
	size = view_height
	near = 0.1
	far = 400.0
	_place(_focus(), true)

func _focus() -> Vector3:
	return target.global_position if is_instance_valid(target) else Vector3.ZERO

func _place(focus: Vector3, snap: bool) -> void:
	# Back off along the view ray. Azimuth is fixed: this is an isometric game,
	# the camera does not orbit.
	var dir := Vector3(0.0, sin(ELEVATION), cos(ELEVATION)).normalized()
	var want := focus + dir * distance
	global_position = want if snap else global_position.lerp(want, 1.0)
	look_at(focus, Vector3.UP)

func _process(delta: float) -> void:
	if not is_instance_valid(target):
		return
	var dir := Vector3(0.0, sin(ELEVATION), cos(ELEVATION)).normalized()
	var want := _focus() + dir * distance
	global_position = global_position.lerp(want, clampf(follow_lag * delta, 0.0, 1.0))
	look_at(_focus(), Vector3.UP)
