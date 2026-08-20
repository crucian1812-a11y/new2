extends OmniLight3D

## Two beats at different rates, so the fire never repeats on a count the eye
## can pick up — the same trick the Canvas build's campfire uses.
var base := 0.0
var t := 0.0

func _ready() -> void:
	base = light_energy

func _process(delta: float) -> void:
	t += delta
	light_energy = base * (0.86 + sin(t * 9.1) * 0.10 + sin(t * 23.7) * 0.05)
