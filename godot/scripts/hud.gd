extends CanvasLayer
class_name HUD

## Health, an enemy count, and the damage flash. Drawn rather than assembled
## out of plates: the Foozle set is a bright cartoon UI and this game is pitched
## dark, so its frame is used for the border and the globe itself is painted.

var hp := 1.0
var hp_max := 1.0
var kills := 0
var remaining := 0
var flash := 0.0
var dead := false
var panel: Control
var hint := ""

func _ready() -> void:
	panel = Control.new()
	panel.set_anchors_preset(Control.PRESET_FULL_RECT)
	panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	panel.draw.connect(_draw_hud)
	add_child(panel)
	# Telling a phone about WASD is worse than telling it nothing.
	hint = "Тапни, куда идти  ·  тапни по врагу — бить" \
		if DisplayServer.is_touchscreen_available() \
		else "Клик — идти  ·  клик по врагу — бить  ·  WASD, пробел"

func set_health(cur: float, maxv: float) -> void:
	if maxv > 0.0 and cur < hp * hp_max:
		flash = 0.35
	hp = cur / maxv if maxv > 0.0 else 0.0
	hp_max = maxv
	panel.queue_redraw()

func set_counts(k: int, r: int) -> void:
	kills = k
	remaining = r
	panel.queue_redraw()

var _tick := 0.0

func _process(delta: float) -> void:
	if flash > 0.0:
		flash = maxf(0.0, flash - delta)
	# The readout would otherwise only refresh when something else did.
	_tick += delta
	if _tick > 0.4:
		_tick = 0.0
		panel.queue_redraw()

func _draw_hud() -> void:
	var vp := panel.get_viewport_rect().size
	var r := minf(64.0, vp.y * 0.11)
	var c := Vector2(r + 22.0, vp.y - r - 22.0)

	# The globe: a dark well with blood standing in it to the level of health.
	panel.draw_circle(c, r + 4.0, Color(0.05, 0.05, 0.07, 0.9))
	panel.draw_circle(c, r, Color(0.10, 0.04, 0.05))
	# Blood standing in the well: fill the whole globe, then take the empty part
	# back off the top. Building the waterline as a polygon looked right in the
	# arithmetic and drew a square.
	var fill := clampf(hp, 0.0, 1.0)
	panel.draw_circle(c, r, Color(0.62, 0.09, 0.10))
	var top := c.y + r - 2.0 * r * fill
	if fill < 1.0:
		panel.draw_rect(Rect2(c.x - r - 1.0, c.y - r - 1.0, r * 2.0 + 2.0, top - (c.y - r) + 1.0),
			Color(0.10, 0.04, 0.05))
	if fill > 0.02 and fill < 1.0:
		panel.draw_line(Vector2(c.x - r, top), Vector2(c.x + r, top), Color(0.85, 0.24, 0.18, 0.85), 2.0)
	# Mask the corners the rectangle just squared off.
	panel.draw_arc(c, r + 6.0, 0, TAU, 48, Color(0.05, 0.05, 0.07), 13.0)
	panel.draw_arc(c, r, 0, TAU, 40, Color(0.69, 0.60, 0.40), 3.0)

	var f := ThemeDB.fallback_font
	panel.draw_string(f, c + Vector2(-26, 6), "%d" % roundi(hp * hp_max),
		HORIZONTAL_ALIGNMENT_LEFT, -1, 18, Color(0.94, 0.88, 0.72))
	panel.draw_string(f, Vector2(vp.x - 190, 34), "Врагов: %d" % remaining,
		HORIZONTAL_ALIGNMENT_LEFT, -1, 17, Color(0.85, 0.80, 0.68))
	panel.draw_string(f, Vector2(vp.x - 190, 58), "Убито: %d" % kills,
		HORIZONTAL_ALIGNMENT_LEFT, -1, 15, Color(0.62, 0.58, 0.50))
	panel.draw_string(f, Vector2(20, 30), hint,
		HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Color(0.60, 0.58, 0.52))
	# Small, dim, and always on. There is no GPU in the machine this is built
	# on, so every frame-rate number I have is from a software rasteriser and
	# says nothing about a real phone. This is the only way the number from
	# the device that matters ever reaches me.
	panel.draw_string(f, Vector2(vp.x - 190, vp.y - 16), "%d fps" % Engine.get_frames_per_second(),
		HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Color(0.42, 0.44, 0.40))

	if flash > 0.0:
		panel.draw_rect(Rect2(Vector2.ZERO, vp), Color(0.7, 0.05, 0.05, flash * 0.5))
	if dead:
		panel.draw_rect(Rect2(Vector2.ZERO, vp), Color(0.0, 0.0, 0.0, 0.6))
		panel.draw_string(f, Vector2(vp.x * 0.5 - 90, vp.y * 0.5), "ТЫ ПАЛ",
			HORIZONTAL_ALIGNMENT_LEFT, -1, 34, Color(0.75, 0.14, 0.12))
