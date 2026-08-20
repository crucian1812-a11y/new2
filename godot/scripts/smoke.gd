extends Node
## A smoke test that can fail.
##
## Walks the player into the skeletons, swings on a timer and writes four
## frames. It is the only way to see this build at all on a machine with no
## GPU, and it is how every screenshot of it so far was taken:
##
##   xvfb-run -a LIBGL_ALWAYS_SOFTWARE=1 godot --path godot \
##     --rendering-driver opengl3 --resolution 900x506 -- --shot
var t := 0.0
var i := 0
var shots := [[1.5, "camp"], [4.0, "approach"], [6.5, "fight"], [9.0, "after"]]

## An enemy is forty pixels tall at the camera the game actually uses, which
## is enough to judge a fight and nowhere near enough to judge a model. The
## close-up pass drops the view height so the art can be looked at.
var closeup := false
func _ready() -> void:
	closeup = "--closeup" in OS.get_cmdline_user_args()
	if closeup:
		shots = [[2.2, "close-idle"], [4.6, "close-walk"], [7.0, "close-fight"]]
		await get_tree().process_frame
		for c in get_parent().get_children():
			if c is IsoCamera:
				(c as IsoCamera).view_height = 3.4
				(c as IsoCamera).size = 3.4

func _process(d: float) -> void:
	t += d
	var g := get_parent()
	if t > 1.6 and t < 5.0:
		Input.action_press("move_up")
	elif t >= 5.0:
		Input.action_release("move_up")
	if t > 5.2 and fmod(t, 0.8) < d and g.player != null:
		g.player.try_attack(g.enemies)
	if i < shots.size() and t >= shots[i][0]:
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png("/tmp/shots/g2-%s.png" % shots[i][1])
		print("SHOT ", shots[i][1])
		i += 1
	if i >= shots.size() and t > (7.6 if closeup else 9.6):
		print("ALLDONE")
		get_tree().quit()
