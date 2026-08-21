extends Node3D

## Firelight, and the fire itself.
##
## Two beats at rates that do not divide into each other, so the flame never
## repeats on a count the eye can pick up — the same trick the Canvas build's
## campfire uses.
##
## Attached to an OmniLight3D it drives the energy; attached to anything else
## it drives the shape, because a light with no flame under it reads as a lamp
## and that is what the middle of this camp looked like for a week. Properties
## are reached through `set`/`get` so one script can do both.

var base := 0.0
var lamp := false
var t := 0.0

func _ready() -> void:
	# `self is OmniLight3D` will not compile: inside the script `self` is typed
	# as the script itself, which the parser knows cannot be a light.
	lamp = is_class("OmniLight3D")
	if lamp:
		base = get("light_energy")
	t = randf() * 10.0

func _process(delta: float) -> void:
	t += delta
	var k := 0.86 + sin(t * 9.1) * 0.10 + sin(t * 23.7) * 0.05
	if lamp:
		set("light_energy", base * k)
	else:
		# Fire is tall and thin when it flares and squat when it drops, and it
		# leans. A flame that only pulsed in size would read as a balloon.
		scale = Vector3(1.86 - k, k, 1.86 - k)
		rotation.y = sin(t * 3.3) * 0.25
		rotation.z = sin(t * 5.7) * 0.06
