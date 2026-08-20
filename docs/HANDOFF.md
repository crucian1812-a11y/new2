# Der Weg des Ritters — handoff

Everything a fresh session needs to pick this up in a new branch. Written
2026-08-19, from branch `claude/sprite-baking-sdf-lighting-kqz43a` at
`63e657a`, deployed and playable at <https://crucian1812-a11y.github.io/new2/>.

---

## 1. What this is

A Diablo-style action RPG set in 13th-century Prussia, in **vanilla JavaScript
with no assets, no libraries and no build step**. Every texture, prop,
character, icon, sound and piece of music is *generated at runtime* — there is
not one image or audio file in the repository. `index.html` loads plain ES
modules; `tools/bundle.mjs` flattens the whole thing into a single
`spiel.html` that boots from `file://`.

Rendering is Canvas2D into a low-resolution world buffer (~1200px wide),
upscaled nearest-neighbour to the screen, plus **one WebGL2 fragment shader**
that does all the lighting and grading in a single pass. UI text is Russian.

### The three rules that shape every decision

1. **Nothing is loaded.** If you want a texture, you write the function that
   draws it. If you want a wolf howl, you write the oscillators.
2. **Every claim gets a check.** New subsystems ship with a script in `tools/`
   that measures the thing the subsystem claims to do, and fails if the sign is
   flipped. See §5 — this is the most important cultural rule in the project.
3. **The GPU path is an improvement, never a requirement.** `?nogl` on the URL
   forces the Canvas2D path and must stay a fair comparison.

---

## 2. Layout

```
index.html                71     module loader + the boot screen
styles.css                       page chrome only; the game is one canvas
src/core/
  math.js                105     clamp/lerp/damp/angle helpers
  rng.js                  99     seeded RNG — worldgen must be reproducible
  input.js               219     keyboard, mouse, touch sticks
  save.js                 48     localStorage
  audio.js               864     ALL sound: WebAudio synthesis, positional
                                 stereo, per-act ambient beds, music
src/render/
  palette.js             177     PAL, hex(), mixc(), css()
  noise.js               181     value/fbm noise
  textures.js            738     ground, water, stone, bark, cloth materials
  sdf.js                 515     signed distance fields → bevel, normals,
                                 cavity; bakes a 4-layer shade basis per sprite
  props.js              1850     every tree, rock, ruin, brazier — drawn once,
                                 cached, then relit per frame from `shade`
  actors.js             3568     THE CHARACTER RIG — see §4
  fx.js                  742     particles, weather, floating text
  icons.js               850     every UI icon, drawn
  renderer.js           1442     camera, painter's-algorithm queue, light map,
                                 fog, bloom, roofs, water, the composite chain
  gl.js                  466     the one-pass WebGL2 shader
src/game/
  content.js            1498     LOOKS, MOB_LOOKS, SKILLS, MOBS, ACTS, loot
  worldgen.js            436     zone, road, prop scatter, shoreline, the hall
  loot.js                269     items, affixes, stat computation
  game.js               3328     the loop: update, AI, combat, draw order
src/ui/hud.js           1817     health globes, bag, character sheet, menus,
                                 and the campfire title screen (§4a)
tools/                           node + Playwright drivers (§5)
docs/HANDOFF.md                  this file
```

---

## 3. How the frame is built

`Game.draw()` → `Renderer`:

1. `R.beginFrame(dt)` — swaps `lights`/`prevLights` (so a spell cast this
   frame lights the scenery *next* frame, which is why `keyLightDir` reads
   `prevLights`), clears the world buffer, the emissive buffer and the fog.
2. Everything pushes itself into a depth queue keyed on world `y`
   (`R.push(y, fn)`) — ground decals, props, actors, projectiles.
3. Sprites are drawn **unlit**. Props carry a baked `shade` basis (four
   greyscale layers: light from +x, −x, +y, −y). `relightSprite` reconstructs
   any in-plane light direction with two `overlay` blits, because N·L is linear
   in L. Characters are drawn live and take `setKeyLight(dx, dy)` per actor.
4. `fx.drawWeather()`.
5. `R.composite()` — on the GPU path this only *prepares* buffers (`drawFog()`
   returns early leaving the fog unlit; `buildBloom()` blurs the emissive
   buffer). On the CPU path it runs the old chain: lightmap → multiply →
   bloom → fog.
6. `R.finish()` — the grade, CPU path only.
7. `fx.drawText()`.
8. `R.presentWorld()` — uploads frame/fog/emissive/bloom as textures, builds
   the light list and the room rects **in world-buffer pixels**, and runs the
   shader at `this.w × this.h` (not device resolution — the frame is chunky
   pixels blown up anyway, and the ordered dither belongs on world pixels).
   Then blits nearest onto the screen canvas the HUD draws on.

### The shader (`src/render/gl.js`)

One pass: Sobel normal recovered from the picture's own luminance → ambient
gradient → roof rectangles multiply the sky away → up to 16 lights with a
squashed-y falloff, diffuse + tight specular → fog × light, added → emissive
sharp + blurred + wide, **each multiplied by its own alpha** → overlay contrast
curve → zone colour wash → vignette → grain → Bayer dither + quantise.

Two traps, both already hit and fixed — do not reintroduce them:

- Canvas textures upload **un-premultiplied**, so `.rgb` is full strength and
  the coverage lives in `.a`. Reading `.rgb` alone turns every soft spark into
  a flat saturated disc. Canvas2D's `lighter` blend is exactly `rgb*a`.
- The overlay curve is only defined on 0..1; its upper branch turns over at
  1.707 and *dives*. Values above white must be carried over the curve, not
  pushed through it, or bright highlights come out dark and colour-shifted.

A **backtick inside the shader source ends the template literal** and produces
a silent compile failure. This has happened twice. Never put one in a comment
inside `FRAG`/`VERT`.

The stage self-checks once, on a throwaway frame with lighting forced wide
open, and retires itself (`ok = false`) if the readback is black. It must test
a forced-bright frame, not the scene — a legitimately dark scene used to make
it retire a working stage.

---

## 4. The character rig (`src/render/actors.js`)

Characters are **not sprites**. They are articulated rigs posed in 3D and
projected through the same 2.5D transform as the world, which is why they face
any of 360 directions and their limbs occlude correctly.

Local axes: `+x` forward, `+y` the character's left, `+z` up. After rotating by
`facing`, a point `(dx,dy,dz)` lands at `(dx, dy*ISO_Y - dz)`.

### Four legs

`poseQuadruped` keeps the same contract as the humanoid: the game advances
`phase` by `moved / strideOf(a) * TAU` and the paw travels backwards by exactly
one stride's worth per cycle while it is down. `strideOf` dispatches on
`look.plan` — quadrupeds are measured by `strideQuad` (their own leg), and when
they were measured by `strideChar` instead every wolf in act I skated and
nothing noticed. `gait-check` covers both plans now.

Each leg has four joints — hip, knee, ankle, foot — and the *bends do not
vanish* when the leg extends: a foreleg keeps its elbow behind the line and a
hind leg keeps its hock behind, which is the Z that makes a dog a dog. The
`slack` that deepens them is measured against the height the leg actually has
to cover, not against a nominal bone length, or a hip standing higher than the
leg is long reports a permanently straight leg and the animal walks on stilts.

### `poseHumanoid(st, build)` → joint dictionary

`st` = `{ t, anim, animT, facing, speed, phase, turn, seed, lookAt, dieBack,
flash, alpha }`. `build` = proportions **plus six gait dials**: `stoop`,
`sway`, `bounce`, `armSwing`, `limp`, `jitter`.

What it produces beyond the obvious joints: `waist`, `groin`, `headYaw`
(scalar — the head has its own heading), `ankleL`/`ankleR` (scalars, radians,
positive = toes up), `weaponSpin`.

Things in there that are load-bearing and easy to break:

- **The walk cycle is driven by distance covered, not by a clock.**
  `game.js` advances `phase` by `moved / strideOf(a) * TAU`; the leg swings
  through exactly `strideChar(build)`. During stance the hip angle is the
  *arcsine* of a linear ground position, so the planted foot tracks backwards
  at body speed. Break the agreement and every foot in the game skates.
- **Pelvis tilt must not drive the legs.** `legL`/`legR` are copies of the hip
  points taken *before* the list is applied. If the tilt drove the legs, the
  standing leg would lift its own foot off the ground.
- Pelvis and shoulders counter-rotate; the head subtracts part of the bob.
- Attacks sample `swingCurve(k, back, through)` **twice** — once for the
  shoulders and once at `k + LEAD` for the pelvis. That lag is the kinetic
  chain.
- A limp is **vertical only** (a bob dip + knee/lift asymmetry). A horizontal
  limp would fail `gait-check`.

### The head (`headFrame`, `crownCap`)

Everything on a head is a place on a sphere, not a place on the screen. `hp(a,
b, c)` projects a local point (+a forward, +b the head's left, +c up, in radii)
through the same transform as the rig; `vis` is that point's dot with the view
direction, which under this camera is one fixed vector. Two consequences do all
the work:

- **The edge of the head is the great circle square to the view direction** —
  so anything closed off along the head's own outline (hair, a cowl, a
  helmet's rim) takes that arc from the geometry instead of guessing it.
  `crownCap` does; guessing it dropped the hair off every head turned between
  about 200° and 300°.
- **The view direction is the kernel of the projection, and `hp` carries a
  stretch.** `hp` treats the head as an ellipsoid pulled up by √1.25, so the
  view direction is the kernel of *that* map — `(sinF, cosF, ISO_Y/√1.25)`,
  a camera 26.6° above the horizon. This was written as its complement, 63°,
  which looks plausible in every screenshot because the error is symmetric and
  is out by a fifth of a radius where it matters. `head-check` now derives the
  kernel from `hp` itself and asserts the silhouette is square to it, and
  `tools/make_asset.py` renders the same head as a solid through the real
  camera. Change the stretch in `hp` and the view direction must follow it.
- **A cap's boundary must be a plane cut**, not an elevation that varies with
  heading. A plane circle is split by the silhouette into exactly one visible
  arc and one hidden one, always; a wavy ring can go over the horizon in two
  places and then the outline cannot be closed. `hairPlane(front, back)` builds
  one from the two elevations it crosses at the brow and the nape;
  `HAIR_PLANE`, `HAIR_UNDER` (hair under a hat), `HELM_PLANE`, `KETTLE_PLANE`
  and `HOOD_PLANE` are all the same construction.

Two more traps, both hit: the skull's cranium, jaw and muzzle are filled
**separately** out of the same gradient, because as subpaths of one path their
windings cancel where they overlap and punch a hole through the face — one that
appears and vanishes as the head turns. And the nose and jaw stand *outside*
the sphere, so on the far side of the head they have to be pulled back in
(`faceOn`), or they spike out through the back of the skull.

### The title screen

`drawMenu` in `hud.js` stands the three classes round a fire rather than
showing three cards with a sigil on each. Worth knowing before touching it:

- The HUD draws on the **screen** canvas, after the shader — so none of the
  world's lighting applies. `setKeyLight` still decides which side of a figure
  the shading falls on, but it cannot make that side warm, because the rig only
  knows its own colours. Each figure is therefore drawn into a scratch buffer,
  the buffer is refilled `source-atop` with the fire's gradient so the tint
  lands on the figure and nothing else, and that is blitted back with
  `lighter`. Skip it and you get a row of cold figures round a fire.
- The fire is two passes with the figures between them: `campfireGround` lays
  the lit snow down *before* they stand on it, so their contact shadows have
  something to fall on; `campfire` puts the logs, flame and sparks in front
  afterwards. One pass and the pool washes every shadow out.
- The hit targets are the figures (`cls:<id>` rects), not cards.

### Drawing

`drawActor` projects every joint once, sorts body parts by depth and paints
them. Shared helpers: `capsule(…, belly, mid)` (limbs bow through a mid
station — `belly = 0` is the old straight taper, for blades and straps),
`cylinderFill` (core shadow + reflected light, which is what makes a limb read
as a cylinder), `sphereFill`, `contactAO`.

Body pieces are separate functions: `drawPelvis`, `drawTorso`, `drawNeck`,
`drawHead`, `drawHelm`, `drawMantle`, `drawFace`, `drawEar`, `drawHairBack`,
`drawHairCap`, `drawBeard`, `drawHand`, `drawBoot`, `drawSkirt`, `drawSleeve`,
`drawCape`, `drawWeapon`, `drawOffhand`, `drawQuiver`, `drawCarapace`,
`drawEyestalks`. Plus `poseQuadruped`/`drawQuadruped` and `drawWraith`, which
share the head machinery for their cowls.

A cowl's **mantle belongs to the body, not the head** — it is drawn from the
shoulder joints, because a hood that swivels its own shoulder cape reads as a
puppet.

`drawSkirt` is deliberately **not simulated**: a hem swings where a knee drives
through it, trails along the line of travel, and opens as far as the legs have
parted — all three read straight off the pose.

Appearance lives entirely in `content.js` (`LOOKS`, `MOB_LOOKS`); the drawing
code never names a character.

---

## 5. Verification — read this before writing anything

```bash
npx http-server -p 8099 -c-1 .      # serve first, everything drives a browser
node tools/verify.mjs               # 12 checks, all must be green
```

Playwright is **not** in `package.json` (there isn't one). The container ships
Chromium build 1194 at `/opt/pw-browsers`, which matches **playwright 1.56.0**:

```bash
npm install --no-save playwright@1.56.0
```

The suite:

| check | proves |
|---|---|
| `lint` | eslint clean |
| `nav-check` | every act's walkable space is one region, everything reachable |
| `skills-check` | 12 class skills + 13 boss abilities run in every act |
| `audio-check` | every sound produces signal; distance attenuates; the stress filter measurably eats highs; mute is silent |
| `light-check` | every baked sprite, mirrored copies included, brightens on the side the light is on |
| `gait-check` | planted feet do not skate — quadrupeds included, measured against the game's own `strideOf` (worst slip 1.3%, budget 12%) |
| `pose-check` | counter-rotation, pelvic drop, head carriage, heel-to-toe roll, contrapposto, banking, head lead, kinetic chain, and each gait dial |
| `head-check` | the face travels round the skull, none of it survives on the back of the head, the hair is drawn at all 24 headings, a beard reads head-on, and the head's silhouette ring is square to the view |
| `gl-check` | the shader honours emissive alpha and never goes darker for brighter input |
| `bundle-check` | `spiel.html` builds and boots from `file://` |
| `save-check` | a run survives reload |
| `endgame-check` | victory screen + the escalating Eternal Hunt |

**A check must be able to fail.** Every one of these was verified by breaking
the thing on purpose and watching it go red. `gl-check` catches the old flare
bug 4 ways; `pose-check` catches an inverted pelvis 48 ways. A check that
cannot fail is decoration.

Preview pages (open through the server, they are ES modules):
`tools/preview-art.html`, `preview-actors.html`, `preview-walk.html`
(`?who=drowned,skeleton,raider`), `preview-lighting.html`, `preview-one.html`,
`preview-heads.html` (every head spun through twelve headings at 5x).

A 3D ruler, for when the question is whether the 2D code's idea of the camera
is right — no page drawn by that code can answer it:

```bash
apt-get install -y --no-install-recommends blender python3-numpy
blender --background --python tools/make_asset.py   # writes tools/ref/maquette.png
```

It builds the head and the wolf as solids at the rig's own numbers. EEVEE
needs a GL context there is none of here, so it renders on Cycles/CPU, and
this Blender is built without OpenImageDenoise. Nothing it makes ships and
`tools/ref/` is gitignored.

Screenshots: `node tools/shot.mjs /tools/preview-actors.html out.png --w 1500
--h 1000 --dpr 1 --wait 3000 --full`. Note that a headless browser will not
composite a raw WebGL canvas into a screenshot — but this game blits the GL
result into a 2D canvas, so in-game shots *do* show the shader. Anything that
tests the shader in isolation must use `readPixels`.

Benchmarks under SwiftShader are meaningless — the shader runs on the CPU
there. Do not claim a GPU speed win from a headless number.

---

## 6. Deploying

`.github/workflows/pages.yml` publishes to the `gh-pages` branch. It triggers
on pushes to `claude/hero-journey-game-p69u3c` **or** on `workflow_dispatch`,
so a feature branch deploys by dispatching the workflow on that ref:

```
mcp__github__actions_run_trigger  method=run_workflow
  owner=crucian1812-a11y repo=new2
  workflow_id=pages.yml ref=<your branch>
```

Then wait for `gh-pages` to move. `curl` to the Pages URL is blocked by the
agent proxy (403) — check with git instead:

```bash
git fetch origin gh-pages && git show FETCH_HEAD --oneline --no-patch
git show FETCH_HEAD:src/render/gl.js | grep -c <a marker from your change>
```

There is no `gh` CLI; use the GitHub MCP tools. The workflow copies `index.html
styles.css src/` and runs `tools/bundle.mjs` for `spiel.html`.

---

## 7. Traps this project has already sprung

- **The single-file bundler flattens every module into one scope**, so every
  top-level name in the codebase must be unique. `const clamp` in `audio.js`
  collided with `math.js`; `MATERIALS` collided across two files. Nothing but
  `bundle-check` notices, and only the offline build breaks.
- **Worldgen order matters**: the hall must be generated *before* the prop
  scatter, or `inRoom()` answers about a room that does not exist yet.
- **The hero stands inside his own torchlight** and the contrast pass lifts
  whatever is already bright. Several palettes are deliberately pitched dark
  (the surcoat, the hexer's arms) so they do not clip to white and take their
  detail with them.
- **`Math.hypot` is ~3× slower than `sqrt`** in per-pixel loops.
- **Compositing a sculpt as a canvas layer fattens the alpha** and leaves a
  grey halo; blend in ImageData space instead (`sdf.js applySculpt`).
- Per-pixel closures in hot loops cost real time — hoist them.

---

## 8. Where the work stands

Recent commits, newest first:

```
63e657a README: note what pose-check proves
eee50ae Put the body into the blow, and give each thing its own walk
9710ddd Give the figures weight: a pelvis, muscle, and a body that stands on one leg
0c516bc Fix the flares the GPU lighting introduced
25c56df Light the frame on the GPU, in one pass
354a34b Let a hammer land like a hammer
0ee1d22 Make a blow know what it landed on, and a champion announce itself
eba06d0 Give the Ordensburg a roof to stand under
69afdce Put the Haff in act I, and boots on the ground
971ecad Make them walk, and stop the packs coming out of a mould
27c1a6c Give the figures bodies, and the monsters their own anatomy
c1c70b6 Keep the offline build from breaking in the dark
a8a726a Put the sound in the world, and the light in the air
81e51d3 Bake a surface into every sprite, and let the fire light it
```

### Known rough edges

- **The wraith's shoulders** read as two lobes stacked under the cowl at close
  range; they hold together at game size but not in `preview-one`.
- **Quadrupeds have legs and a gait now but no pose dials** — no
  counter-rotation across the shoulders, no lead/lag between the diagonal
  pairs, and `pose-check` still does not look at them at all.
- **The direwolf's trunk** is one long spindle; from the side it still reads
  closer to a barrel than to a deep chest over a tucked loin.
- **The skeleton's skull** is still the old flat ellipse with two dots — it is
  the one head that did not get the sphere treatment.
- The **wide bloom halo** on the GPU path is one extra texture fetch that
  approximates a scaled Canvas2D blit; it is close, not identical.

### Backlog, roughly by value

1. **Music with a motif** — a melodic line per act and a boss sting; music
   ducking under big hits. The audio engine is there; only the composition
   is missing.
2. **Quadruped posture** to the same standard as the humanoids: the shoulders
   and hips of a running animal counter-rotate too, and nothing measures it.
3. **Real-hardware performance numbers.** Nothing in this repo has ever been
   measured on a phone, only on SwiftShader, which measures nothing.
5. **Hit reactions per material** — the material table exists for debris and
   sound but does not yet change the recoil animation.
6. **A second boss-arena layout**; act V reuses act IV's shape.

### The user's standing preferences

- Speaks Russian; replies should be in Russian.
- Works from a phone, plays the deployed build, and reports what he sees
  ("странные вспышки", "фигуры простоваты"). Take the report literally and
  find the actual defect — both times so far there was a real, specific bug.
- Wants each round to end **deployed and playable**, not just committed.
- Never push to a branch other than the designated one; never open a PR unless
  asked.
