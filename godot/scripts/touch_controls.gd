extends CanvasLayer
class_name TouchControls

## A thumbstick on the left, abilities on the right.
##
## Two things make this work on a phone rather than merely exist.
##
## The stick **floats**: it appears wherever the left thumb lands rather than
## sitting in a fixed corner. A stick painted at a fixed spot has to be found
## by looking, and the quarter of a small screen it occupies is a quarter you
## can no longer see the fight in. Landing it under the thumb costs nothing
## and never covers anything the player was already watching.
##
## And it reads **real touch events**, not the mouse events Godot can
## synthesise from them. That emulation is single-pointer, so with it on you
## can steer or you can swing, never both — which on an action game is the
## whole thing. `emulate_mouse_from_touch` is off in project.godot for this
## reason; mouse is handled separately here and in game.gd, for a desktop.

signal used(slot: int)

const STICK_REACH := 92.0        ## pixels from origin to full tilt
const DEADZONE := 0.16

var stick := Vector2.ZERO        ## -1..1 on each axis, screen space
var cooldowns: Array = []        ## seconds left per slot, fed by the player
var labels: Array = []           ## short names per slot, fed by the player

var _origin := Vector2.ZERO
var _thumb := Vector2.ZERO
var _steering := false
var _fingers := {}               ## finger index -> "stick" or slot number
var _flash := {}                 ## slot -> seconds of press highlight left
var _buttons: Array = []
var _panel: Control

func _ready() -> void:
	layer = 2
	_panel = Control.new()
	_panel.set_anchors_preset(Control.PRESET_FULL_RECT)
	_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_panel.draw.connect(_paint)
	add_child(_panel)

func _layout() -> void:
	var vp := _panel.size
	if vp.x < 1.0:
		vp = get_viewport().get_visible_rect().size
	# The main attack sits deepest in the corner, where the thumb rests; the
	# rest arc away from it so none of them is a stretch.
	var c := Vector2(vp.x - 92.0, vp.y - 88.0)
	_buttons = [
		{"pos": c, "r": 52.0},
		{"pos": c + Vector2(-116.0, -20.0), "r": 38.0},
		{"pos": c + Vector2(-88.0, -100.0), "r": 38.0},
		{"pos": c + Vector2(-6.0, -132.0), "r": 38.0},
	]

func _hit(at: Vector2) -> int:
	_layout()
	for i in _buttons.size():
		# A fingertip is about forty pixels across and lands short of where
		# its owner thinks it did, so the target is bigger than the paint.
		if at.distance_to(_buttons[i]["pos"]) < float(_buttons[i]["r"]) * 1.35:
			return i
	return -1

func _press(finger: int, at: Vector2) -> bool:
	var slot := _hit(at)
	if slot >= 0:
		_fingers[finger] = slot
		if slot < cooldowns.size() and cooldowns[slot] <= 0.0:
			_flash[slot] = 0.16
			used.emit(slot)
		return true
	var vp := get_viewport().get_visible_rect().size
	if at.x < vp.x * 0.52:
		_fingers[finger] = "stick"
		_steering = true
		_origin = at
		_thumb = at
		stick = Vector2.ZERO
		return true
	return false

func _drag(finger: int, at: Vector2) -> void:
	if _fingers.get(finger) != "stick":
		return
	_thumb = at
	var d := (at - _origin) / STICK_REACH
	if d.length() > 1.0:
		d = d.normalized()
		# Once past full tilt the origin follows, so a long drag never leaves
		# the stick pinned somewhere the thumb has walked away from.
		_origin = at - d * STICK_REACH
	stick = d if d.length() > DEADZONE else Vector2.ZERO

func _release(finger: int) -> void:
	var role: Variant = _fingers.get(finger)
	_fingers.erase(finger)
	if role == "stick":
		_steering = false
		stick = Vector2.ZERO

func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventScreenTouch:
		var t := e as InputEventScreenTouch
		if t.pressed:
			if _press(t.index, t.position):
				get_viewport().set_input_as_handled()
		else:
			_release(t.index)
	elif e is InputEventScreenDrag:
		var d := e as InputEventScreenDrag
		_drag(d.index, d.position)
	elif e is InputEventMouseButton and (e as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
		# Desktop: the buttons are clickable, but the stick is not — a mouse
		# has point-and-click to walk with, which is better than dragging.
		var m := e as InputEventMouseButton
		if m.pressed:
			var slot := _hit(m.position)
			if slot >= 0:
				if slot < cooldowns.size() and cooldowns[slot] <= 0.0:
					_flash[slot] = 0.16
					used.emit(slot)
				get_viewport().set_input_as_handled()

func _process(delta: float) -> void:
	for k in _flash.keys():
		_flash[k] = _flash[k] - delta
		if _flash[k] <= 0.0:
			_flash.erase(k)
	_panel.queue_redraw()

func _paint() -> void:
	_layout()
	var f := ThemeDB.fallback_font

	if _steering:
		_panel.draw_circle(_origin, STICK_REACH, Color(0.85, 0.82, 0.72, 0.07))
		_panel.draw_arc(_origin, STICK_REACH, 0, TAU, 40, Color(0.80, 0.76, 0.64, 0.30), 2.0)
		_panel.draw_circle(_thumb, 34.0, Color(0.88, 0.84, 0.72, 0.18))
		_panel.draw_arc(_thumb, 34.0, 0, TAU, 28, Color(0.92, 0.88, 0.76, 0.45), 2.0)

	for i in _buttons.size():
		var p: Vector2 = _buttons[i]["pos"]
		var r: float = _buttons[i]["r"]
		var cd: float = cooldowns[i] if i < cooldowns.size() else 0.0
		var ready := cd <= 0.0
		var lit: bool = _flash.has(i)
		var fill := Color(0.30, 0.10, 0.09, 0.42) if ready else Color(0.10, 0.10, 0.12, 0.40)
		if lit:
			fill = Color(0.72, 0.26, 0.14, 0.62)
		_panel.draw_circle(p, r, fill)
		_panel.draw_arc(p, r, 0, TAU, 34,
			Color(0.72, 0.62, 0.42, 0.75) if ready else Color(0.40, 0.40, 0.44, 0.55), 2.0)
		if not ready and i < cooldowns.size():
			# A wedge that empties clockwise: the shape of waiting.
			var total: float = maxf(0.001, float(labels[i]["cd"])) if i < labels.size() else 1.0
			var k: float = clampf(cd / total, 0.0, 1.0)
			_panel.draw_arc(p, r * 0.72, -PI * 0.5, -PI * 0.5 + TAU * k, 28,
				Color(0.06, 0.06, 0.08, 0.75), r * 0.55)
		var name: String = labels[i]["name"] if i < labels.size() else ""
		var w := f.get_string_size(name, HORIZONTAL_ALIGNMENT_LEFT, -1, 15).x
		_panel.draw_string(f, p + Vector2(-w * 0.5, 5), name,
			HORIZONTAL_ALIGNMENT_LEFT, -1, 15,
			Color(0.95, 0.90, 0.78) if ready else Color(0.55, 0.55, 0.58))
