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
- No web export, so this branch does not deploy anywhere yet.
- The KayKit enemies do not match the art direction; see above.

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

They are also chunky and cartoonish where Diablo II is gaunt and grim. That
mismatch is the main thing standing between this and the reference.
