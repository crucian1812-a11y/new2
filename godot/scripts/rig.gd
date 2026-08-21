extends Node
class_name Rig

## Poses the character's skeleton in code, the way the JavaScript build did.
##
## The uploaded dummy is rigged — 56 bones, clean names, even a `B-handProp.R`
## to hang a weapon on — but it ships **no animation**, only its bind pose. So
## rather than hunt for a canned walk cycle, the rule the old renderer lived by
## is carried over: the walk is driven by distance covered, not by a clock.
##
## `phase` is advanced by the mover as `moved / stride * TAU`, and the leg
## swings through exactly `stride`. While a foot is down its hip angle is the
## *arcsine* of a linear ground position, so the planted foot tracks backwards
## at body speed and stays on its patch of earth. Break that agreement and
## every foot in the game skates — which is the single thing about a moving
## figure everybody sees and nobody can name.

const BONES := {
	"hips": "B-hips", "spine": "B-spine", "chest": "B-chest", "head": "B-head",
	"thighL": "B-thigh.L", "shinL": "B-shin.L", "footL": "B-foot.L",
	"thighR": "B-thigh.R", "shinR": "B-shin.R", "footR": "B-foot.R",
	"armL": "B-upperArm.L", "foreL": "B-forearm.L",
	"armR": "B-upperArm.R", "foreR": "B-forearm.R",
	"propR": "B-handProp.R",
}

var skel: Skeleton3D
var idx := {}
var rest := {}
## Which local axis swings a limb forward. Rigs disagree; this is measured
## once against the actual rest pose rather than assumed.
var swing_axis := Vector3(1, 0, 0)
var stride := 1.0
## The dummy ships in a T-pose. A nineteen-degree arm swing out of a T-pose is
## still a T-pose, so the arms are first brought down to the sides and
## everything else swings from there.
const ARM_DOWN := 1.25
var base := {}

func setup(s: Skeleton3D) -> bool:
	skel = s
	for key in BONES:
		var i := skel.find_bone(BONES[key])
		if i < 0:
			push_warning("rig: missing bone %s" % BONES[key])
			continue
		idx[key] = i
		rest[key] = skel.get_bone_rest(i).basis.get_rotation_quaternion()
	base["armR"] = Quaternion(Vector3(0, 0, 1), ARM_DOWN)
	base["armL"] = Quaternion(Vector3(0, 0, 1), -ARM_DOWN)
	base["foreR"] = Quaternion(Vector3(1, 0, 0), -0.25)
	base["foreL"] = Quaternion(Vector3(1, 0, 0), -0.25)
	if not idx.has("thighL") or not idx.has("shinL"):
		return false
	# One stride is about two and a half leg-lengths, measured off the rig
	# itself so a tall figure takes long slow steps without being tuned.
	var hip := skel.get_bone_global_rest(idx["thighL"]).origin
	var foot := skel.get_bone_global_rest(idx["footL"]).origin
	stride = maxf(0.4, hip.distance_to(foot) * 2.5)
	return true

func _bend(key: String, angle: float, axis := swing_axis) -> void:
	if not idx.has(key):
		return
	var b: Quaternion = base.get(key, Quaternion.IDENTITY)
	skel.set_bone_pose_rotation(idx[key], rest[key] * b * Quaternion(axis.normalized(), angle))

## phase: radians, advanced by distance. gait: 0 standing, 1 walking.
func pose(phase: float, gait: float, t: float) -> void:
	if skel == null:
		return
	gait = clampf(gait, 0.0, 1.0)
	var amp := 0.62 * gait

	for side in ["L", "R"]:
		var ph: float = fposmod(phase + (0.0 if side == "L" else PI), TAU)
		var hip_a := 0.0
		var knee_a := 0.0
		if ph < PI:
			# Stance. The foot is down, so its ground position must move
			# linearly; the hip angle is therefore the arcsine of it.
			var k := ph / PI
			hip_a = asin(clampf(sin(amp) * (1.0 - 2.0 * k), -0.999, 0.999))
			knee_a = 0.06 + sin(ph) * 0.12
		else:
			# Swing. The leg folds and carries forward.
			var k := (ph - PI) / PI
			hip_a = lerp(-amp, amp, k) * 1.0
			knee_a = sin(k * PI) * 1.15 * gait
		_bend("thigh" + side, hip_a)
		_bend("shin" + side, -knee_a)
		_bend("foot" + side, knee_a * 0.35)
		# Arms swing against the legs — the opposite one to each leg.
		var arm := -hip_a * 0.55
		_bend("arm" + ("R" if side == "L" else "L"), arm)
		_bend("fore" + ("R" if side == "L" else "L"), -absf(arm) * 0.5 - 0.25)

	# The trunk. Shoulders and hips counter-rotate; the body rises twice a
	# stride; standing still, it breathes.
	var bob := sin(phase * 2.0) * 0.035 * gait
	var breathe := sin(t * 1.6) * 0.012 * (1.0 - gait)
	if idx.has("hips"):
		var p := skel.get_bone_pose_position(idx["hips"])
		skel.set_bone_pose_position(idx["hips"], Vector3(p.x, skel.get_bone_rest(idx["hips"]).origin.y + bob + breathe, p.z))
	_bend("spine", sin(phase) * 0.05 * gait, Vector3(0, 1, 0))
	_bend("chest", -sin(phase) * 0.09 * gait, Vector3(0, 1, 0))
	_bend("head", sin(phase) * 0.04 * gait, Vector3(0, 1, 0))


## A swing, sampled twice.
##
## A blow starts at the ground and goes up through the hips, across the
## shoulders and out along the arm last of all, and each link peaks a moment
## after the one below it. That lag is the whole reason a strike reads as
## carrying force rather than being waved, so the curve is sampled once for the
## shoulders and once slightly earlier for the pelvis.
func _swing_curve(k: float, back: float, through: float) -> float:
	if k < 0.35:
		return back * (k / 0.35)
	if k < 0.55:
		var e := (k - 0.35) / 0.2
		return lerp(back, through, e * e * (3.0 - 2.0 * e))
	var e2 := (k - 0.55) / 0.45
	# Past the mark, then back to it: a body that has thrown its weight one way
	# cannot stop dead on it.
	return through * ((1.0 - e2) - 0.2 * sin(PI * e2))

func pose_swing(k: float, back := -0.9, through := 1.5) -> void:
	## `back` and `through` are how far the blow winds up and how far it
	## carries. A quick chop is a short wind and a short follow-through; a
	## two-handed cleave is both of them doubled, which is what makes one look
	## fast and the other look heavy without changing a line of the timing.
	if skel == null:
		return
	k = clampf(k, 0.0, 1.0)
	var shoulder := _swing_curve(k, back, through)
	var hips := _swing_curve(minf(1.0, k + 0.1), back * 0.55, through * 0.53)
	_bend("armR", shoulder)
	_bend("foreR", -absf(shoulder) * 0.35 - 0.2)
	_bend("armL", -shoulder * 0.35 + 0.2)
	_bend("chest", hips * 0.5, Vector3(0, 1, 0))
	_bend("spine", hips * 0.3, Vector3(0, 1, 0))


func pose_cast(k: float) -> void:
	## Both arms up, a beat held at the top, then thrown forward. A spell that
	## used the same arc as an axe reads as hitting the air with a stick.
	if skel == null:
		return
	k = clampf(k, 0.0, 1.0)
	var raise := 0.0
	if k < 0.42:
		var e := k / 0.42
		raise = e * e * (3.0 - 2.0 * e)
	elif k < 0.58:
		raise = 1.0
	else:
		raise = 1.0 - (k - 0.58) / 0.42
	var out := 0.0 if k < 0.55 else sin(minf(1.0, (k - 0.55) / 0.45) * PI)
	for side in ["L", "R"]:
		_bend("arm" + side, -1.55 * raise - 0.7 * out)
		_bend("fore" + side, -0.25 - 0.9 * raise + 0.7 * out)
	_bend("chest", -0.22 * raise + 0.30 * out)
	_bend("spine", -0.12 * raise + 0.18 * out)
	_bend("head", -0.25 * raise)

func pose_dead(k: float) -> void:
	if skel == null:
		return
	k = clampf(k, 0.0, 1.0)
	_bend("spine", k * 1.2)
	_bend("chest", k * 0.5)
	_bend("thighL", -k * 0.9)
	_bend("thighR", -k * 0.7)
	_bend("shinL", k * 1.2)
	_bend("shinR", k * 1.0)
