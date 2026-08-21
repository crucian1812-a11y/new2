# Der Weg des Ritters — Godot rebuild

A rebuild of the game on Godot 4.3, using the asset packs uploaded to the
repository. The original vanilla-JavaScript build is untouched on
`claude/game-graphics-improvement-w23o4j` and still deploys to Pages.

## Running it

Godot 4.3 is required — the packs are Godot 4 projects (`config_version=5`),
so the `godot3` in Debian/Ubuntu cannot open them.

```bash
godot --path godot                     # editor
godot --path godot --rendering-driver opengl3   # run
```

Headless, on a machine with no GPU, it still renders through a virtual
display and Mesa's software rasteriser:

```bash
xvfb-run -a LIBGL_ALWAYS_SOFTWARE=1 godot --path godot --rendering-driver opengl3
```

The renderer is set to **GL Compatibility**, not Forward+: Forward+ wants
Vulkan, and the target for this game is a phone browser.

## What is where

| path | what |
|---|---|
| `scripts/iso_camera.gd` | the camera, derived rather than guessed — see below |
| `scripts/rig.gd` | poses the character's bones in code; there are no canned animations |
| `scripts/player.gd` | movement, and the phase the walk is driven by |
| `scripts/game.gd` | builds the camp from a seeded RNG |
| `scripts/enemy.gd` | the skeletons: chase, chop, take a hit, fall |
| `scripts/lineup.gd` | an animated model sheet — see below |
| `assets/` | the uploaded packs, unpacked |

## Two things carried over from the JavaScript build

**The camera is not a taste decision.** That renderer projects `(x, y, z)` to
`screen_x = x`, `screen_down = y * ISO_Y - z`, with `ISO_Y = 0.5`. The
directions that map collapses to a point are its kernel, and the kernel is the
view ray: `(0, 1, ISO_Y)`, a camera **26.57 degrees above the horizon**. A
shallow view, not the steep overhead one the 0.5 squash looks like. The old
code assumed the complement, 63 degrees, and every silhouette was out by a
fifth of a head radius before anybody noticed.

**The walk is driven by distance covered, not by a clock.** `phase` advances
by `moved / stride * TAU` and the leg swings through exactly `stride`; while a
foot is down, its hip angle is the *arcsine* of a linear ground position, so
the planted foot tracks backwards at body speed and stays where it was put.
Break that agreement and every foot skates — the one thing about a moving
figure everybody sees and nobody can name.

## Assets

Unpacked from the archives uploaded to the repository, all taken from the free
section of itch.io:

| pack | used for | licence file in the archive |
|---|---|---|
| POLY Medieval Camp | tents, barrels, carts, bonfire, pillars | none shipped |
| MedievalMarket | market stalls and goods | none shipped |
| demonic weapons pack | axe, dagger, greatsword, scythe, spear | none shipped |
| Human Character Dummy | the player mesh — rigged, 56 bones | none shipped |
| DarkMagicFX (Binbun3D) | spell effects, `.gdshader` | **CC0** |
| Foozle RPG UI Set 1 | interface plates | **CC0** |

Two of the six state their licence in the archive; the rest do not, and that
is worth settling before anything ships.

## Known gaps

- **No animations exist in the uploaded packs.** The character dummy is rigged
  but ships only its bind pose, which is why `rig.gd` poses it in code. Attack,
  hit and death still need writing.
- None of the game's actual content — five acts, twelve skills, thirteen boss
  abilities, real loot, saves — has been ported. This is one camp, one wave and
  one weapon.
- The player is still the uploaded dummy, untextured, posed in code. He is
  dressed in flat dark leather by `game.gd` so he is not a white mannequin
  standing next to the skeletons, but he is not a character yet.

## The web build

```bash
godot --headless --path godot --import      # a cold checkout has no .godot/
godot --headless --path godot --export-release "Web" ../build/web/index.html
node tools/web-check.mjs build/web /tmp/shots/web.png
```

`.github/workflows/godot-pages.yml` does exactly that on every push to this
branch and publishes to **gh-pages under `godot/`** — a subdirectory, and the
job clones what gh-pages already holds before replacing it, so publishing this
never takes the JavaScript build down. It pushes a single orphan commit each
time; a Godot web build is forty megabytes and keeping every one would make
the repository unclonable within a month.

Three things about the export are load-bearing rather than taste:

- **No thread support.** A threaded Godot 4 web build needs SharedArrayBuffer,
  which needs COOP/COEP response headers, which GitHub Pages does not send.
  Threaded builds refuse to start there and the page just stays black.
- **No VRAM texture compression.** Turning it on makes the export fail with
  `configuration errors` and no further detail, because the matching project
  setting (`import_etc2_astc` / `import_s3tc_bptc`) is off. It costs some
  memory on the device and saves an afternoon.
- **`exclude_filter` drops the originals.** The un-reproportioned skeletons
  stay in the repository because `tools/grim_skeletons.py` reads them;
  shipping both sets doubles the download for nothing.

What that comes to, and what a phone actually pays:

| file | on disk | over the wire |
|---|---|---|
| `index.wasm` | 33.7 MB | 7.6 MB — Pages gzips it |
| `index.pck` | 6.7 MB | 6.5 MB — already compressed inside |

The `.pck` is small because the enemies ship **21 of the pack's 95 clips**;
see `KEEP_CLIPS` in the tool. Widening that list is one line and one re-run.

`tools/web-check.mjs` serves the build, opens it in Chromium and waits for the
engine to report itself running. "It exported" and "it runs" are different
claims: a missing MIME type, a threaded template, or no WebGL2 all fail the
same way from outside — a black page — and none of them show up in the export
log.

## Playing it

WASD to walk, left mouse or space to swing. Six skeletons close in; the health
globe is bottom left and the count top right.

## Verifying it without a GPU

There is no GPU in the container this was built in, so every screenshot came
out of a smoke run:

```bash
xvfb-run -a LIBGL_ALWAYS_SOFTWARE=1 godot --path godot \
  --rendering-driver opengl3 --resolution 900x506 -- --shot
```

`scripts/smoke.gd` walks the player into the fight, swings, and writes four
frames to `/tmp/shots/`. It prints `ALLDONE` when it gets to the end — if it
does not, something threw.

## Where the enemies came from

The uploaded packs contain no enemy model and no animation of any kind, so the
skeletons are **KayKit Character Pack: Skeletons**, CC0, taken from the
author's GitHub mirror (itch.io is unreachable from this container). Their
licence sits beside them in `assets/enemies/LICENSE-KayKit.txt`. They are
animated — idle, walk, chop, hit, three deaths — which is why the enemies run
off an AnimationPlayer while the player, on the un-animated dummy, is posed in
code.

They are also, as they ship, chunky and cartoonish where Diablo II is gaunt
and grim — a skull nearly as tall as the body it sits on. `tools/grim_skeletons.py`
rebuilds them; see below.

## Making them grim

`tools/grim_skeletons.py` runs in Blender and writes `*_Grim.glb` beside the
originals, which stay put because the tool reads them.

```bash
blender --background --python tools/grim_skeletons.py
# --only Skeleton_Minion         just one, for a quicker turnaround
# --atlas /tmp/atlas.png         write the repainted texture out on its own
```

Ninety-five animations are worth more than the models' looks, so nothing is
re-rigged. What it does:

**Reshapes the meshes in rest pose.** A skinned vertex rides whichever bones
its groups name, so moving the vertex changes the shape and nothing else. The
head cluster — skull, jaw, eyes — scales to 0.46 about the underside of the
jaw, so the head shrinks without floating off the neck or sinking into the
shoulders. Torso, arms and legs are narrowed, and everything is thinned front
to back.

**Moves two bone chains, carefully.** Proportion is the thing rest-pose
reshaping cannot fix: shrink the head and the figure just gets shorter. So the
legs are stretched 1.75× below the hip joint and everything above rides up by
the same amount, and the arms are stretched 1.28× outward from the shoulder
socket. Both are continuous monotone maps applied to bones and mesh alike, so
no seam opens. This is safe only because the clips drive these bones almost
entirely by rotation — the largest translation on any deforming bone is eight
centimetres on the hips — and a rotation applied to a longer bone is exactly
the longer stride wanted. **Verify it after changing anything here** by
running the model sheet against both, below.

**Repaints the atlas.** KayKit's palette is cream bone, tan leather and bright
gold; Diablo II's undead are cold, dim and filthy. The remap works in HLS and
sorts by hue *and* lightness, because there are three and a half thousand
colours in there and because bone is painted two different ways — the limbs
are a warm cream and the skull is a near-neutral grey. Sorting those by hue
alone gives a charcoal head on ivory arms, which is what the first two
attempts produced.

**Drops the horned helm and the pointed hat.** Neither survives being shrunk;
they just become a small horned bucket. A bare skull is what Diablo II puts on
a skeleton. The Rogue keeps its hood.

Two traps worth writing down, because both look like a bad colour rule:

- The pack ships **custom split normals**, stored per loop, which do not
  follow the vertices. Reshape a mesh and leave them and the shading belongs
  to the old shape — a cloak that is now light grey renders black.
- `Image.save()` clears the dirty flag, and for an image that is not dirty the
  glTF exporter re-uses the **original packed bytes** rather than re-encoding.
  Write the atlas out for inspection and the model ships with the texture you
  just replaced.

## Looking at a model

A rest-pose render says nothing about a rig whose bones have moved. The model
sheet plays a clip on all four at a size where a misplaced elbow is visible,
and takes `--orig` so the same frame can be compared against the untouched
pack:

```bash
xvfb-run -a LIBGL_ALWAYS_SOFTWARE=1 godot --path godot \
  --rendering-driver opengl3 --resolution 1000x430 \
  res://scripts/lineup.tscn -- Walking_A          # add --orig for the originals
```

It writes to `/tmp/shots/lineup-*.png`. `smoke.gd` also takes `--closeup`,
which drops the camera in so the fight can be judged as art rather than as a
scoreboard — at the camera the game actually uses, an enemy is forty pixels
tall.
