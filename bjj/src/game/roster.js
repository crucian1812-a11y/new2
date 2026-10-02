// Who is on the mat: the kimono, the weight classes and the men in them.
//
// The ladder had five men and one of each: the white belt was a wrestler
// because he was the white belt, and the player was nobody — «ВЫ» in a white
// kimono, the same stat block every time. A tournament in this sport is
// fought inside a weight class, by men who each fight their own way, and the
// player is one of them.
//
// So: four classes, six men in each. The player picks one — his face, his
// build and his game come with him — and the tournament he climbs is his own
// class, the other five in the order below, one per belt. How a man fights is
// his style (STYLES in ai.js): what the AI goes for when he is the opponent,
// and for everybody, the player included, the kind of move he lands a little
// more often (STYLE_EDGE). His build is his class's plus his own share of it,
// solved against the pose library (src/render/build.js); his face is one of
// the four baked heads, a skin and a head of hair.
//
// Pure data and a few questions about it. No DOM, no storage: main.js keeps
// what was picked in the progress record, and the tools read the same table.

import { rgbToLab, deltaE } from '../core/color.js';

// The three colours a competition kimono comes in.
//
// Measured against the mat by gi-check, not picked: the competition square is
// dark blue, so a navy kimono on it loses its outline, and the blue here is
// the one that keeps it.
export const GI = {
  white: { label: 'БЕЛОЕ', col: [0.88, 0.89, 0.87] },
  blue:  { label: 'СИНЕЕ', col: [0.10, 0.24, 0.66] },
  black: { label: 'ЧЁРНОЕ', col: [0.05, 0.06, 0.07] },
};
export const GI_ORDER = ['white', 'blue', 'black'];

// How far apart the two kimonos on one mat have to be, in CIELAB. The line is
// the one gi-check draws between a man and the mat behind him — two men who
// are closer than that to each other are one shape tangled on the floor, and
// grappling is two bodies in one silhouette already.
export const GI_APART = 25;

// What the other man wears: his own kimono when it stands apart from yours,
// and otherwise the first of the three, in the order a bracket dresses them —
// white, then blue, then black — that does. White against blue is what a
// competition puts on the mat; black against white is the next best thing.
export function rivalGi(mine, his) {
  const a = rgbToLab(GI[mine].col);
  const apart = (k) => k !== mine && deltaE(a, rgbToLab(GI[k].col)) >= GI_APART;
  if (his && apart(his)) return his;
  return GI_ORDER.find(apart) || GI_ORDER.find((k) => k !== mine);
}

// Weight classes. `mass` places the class between the lightest build the pose
// library holds (−1) and the heaviest (+1) — see build-room.js — and each man
// is his class plus his own `mass` on top, a little either way. The stat
// shift is the same for everybody in a class, so inside a tournament it
// cancels and only says what kind of fight the class is: the heavier men hit
// harder and tire sooner.
export const WEIGHTS = [
  { id: 'feather', label: 'ПЕРО', limit: 'до 70 кг', mass: -0.85, strength: -0.04, cardio: +0.04 },
  { id: 'light', label: 'ЛЁГКИЙ', limit: 'до 76 кг', mass: -0.35, strength: -0.02, cardio: +0.02 },
  { id: 'middle', label: 'СРЕДНИЙ', limit: 'до 82 кг', mass: +0.2, strength: 0, cardio: 0 },
  { id: 'heavy', label: 'ТЯЖЁЛЫЙ', limit: 'до 94 кг', mass: +0.85, strength: +0.04, cardio: -0.04 },
];
export const WEIGHT_OF = Object.fromEntries(WEIGHTS.map((w) => [w.id, w]));

// What a style is, in the words of the menu, and what it does to the three
// numbers a Fighter carries. Each sums to zero: a style is a way of fighting,
// not a better man.
export const STYLE_INFO = {
  wrestler: { label: 'борец', long: 'валит и проходит сверху', strength: +0.05, technique: -0.03, cardio: -0.02 },
  guard: { label: 'гардовый', long: 'играет снизу, свипает', technique: +0.04, strength: -0.04, cardio: 0 },
  escape: { label: 'выворотливый', long: 'уходит из-под контроля', cardio: +0.05, strength: -0.05, technique: 0 },
  pressure: { label: 'давит сверху', long: 'держит и набирает очки', strength: +0.05, cardio: -0.05, technique: 0 },
  finisher: { label: 'добивает', long: 'ищет болевой и удушение', technique: +0.05, cardio: -0.05, strength: 0 },
};

// The kind of move each style lands more often, and by how much. The same
// door the drills use (skills.js): a multiplier on the chance of that move,
// for whoever is fighting that way.
export const STYLE_EDGE = 1.1;
const ESCAPES_FROM = new Set(['SIDE_CONTROL', 'KNEE_ON_BELLY', 'MOUNT', 'BACK', 'TURTLE']);
const ON_FEET = new Set(['STANDING', 'CLINCH']);
export const STYLE_MOVE = {
  wrestler: (tr) => ON_FEET.has(tr.from) && tr.becomes === 'top',
  guard: (tr) => tr.role === 'bottom' && /GUARD/.test(tr.from),
  escape: (tr) => tr.role === 'bottom' && ESCAPES_FROM.has(tr.from.replace(/_X$/, '')),
  pressure: (tr) => tr.role === 'top' && !tr.sub && !ON_FEET.has(tr.from),
  finisher: (tr) => !!tr.sub,
};
export const styleEdge = (style, tr) => (style && STYLE_MOVE[style] && STYLE_MOVE[style](tr) ? STYLE_EDGE : 1);

// Faces: which baked head, the skin over it, and the hair on it.
const SKIN = {
  fair: [0.66, 0.50, 0.40], light: [0.60, 0.42, 0.31], olive: [0.56, 0.41, 0.32],
  tan: [0.58, 0.40, 0.30], brown: [0.46, 0.31, 0.23], dark: [0.40, 0.26, 0.19],
};
export const HAIR = {
  black: [0.035, 0.028, 0.026], dark: [0.07, 0.045, 0.03], brown: [0.13, 0.08, 0.05],
  sandy: [0.26, 0.19, 0.11], grey: [0.20, 0.19, 0.18],
};
// `look` is the portrait's and nothing else's: the haircut and whether there
// is a beard, for the face drawn on the fighter's card (hud.js, _avatar). The
// men on the mat are the four baked heads; a card can afford more variety than
// a mesh, and a list of twenty-four men needs it to be told apart at a glance.
//
// The heads (art/mixamo/README.md): A and B are the first two characters, C is
// Brian, shaved, so he goes to the men whose card is bald or buzzed, and D is
// David, short dark hair. Every class has one of each of C and D.
const F = (id, name, of, style, head, skin, hair, gi, mass = 0, look = 'crop') =>
  ({ id, name, of, style, head, skinCol: SKIN[skin], hairCol: HAIR[hair], gi, mass, look });

// Six a class. The order is the ladder: whichever five the player did not
// pick, first to last, are the white belt to the black.
export const FIGHTERS = {
  feather: [
    F('mark', 'МАРК', 'МАРКА', 'wrestler', 'A', 'fair', 'sandy', 'blue', -0.1, 'crop'),
    F('tiago', 'ТИАГО', 'ТИАГО', 'guard', 'B', 'tan', 'black', 'white', 0, 'curly'),
    F('ilya', 'ИЛЬЯ', 'ИЛЬИ', 'escape', 'A', 'light', 'brown', 'white', -0.15, 'quiff'),
    F('kaio', 'КАЙО', 'КАЙО', 'finisher', 'C', 'brown', 'black', 'black', 0.05, 'buzz'),
    F('timur', 'ТИМУР', 'ТИМУРА', 'pressure', 'D', 'olive', 'dark', 'blue', 0.1, 'crop+beard'),
    F('lev', 'ЛЕВ', 'ЛЬВА', 'guard', 'B', 'fair', 'brown', 'white', 0, 'long'),
  ],
  light: [
    F('denis', 'ДЕНИС', 'ДЕНИСА', 'guard', 'A', 'tan', 'dark', 'blue', 0, 'quiff'),
    F('joao', 'ЖОАН', 'ЖОАНА', 'wrestler', 'B', 'brown', 'black', 'white', 0.1, 'curly+beard'),
    F('artyom', 'АРТЁМ', 'АРТЁМА', 'escape', 'A', 'fair', 'sandy', 'white', -0.1, 'crop'),
    F('ruslan', 'РУСЛАН', 'РУСЛАНА', 'pressure', 'D', 'olive', 'black', 'black', 0.15, 'buzz+beard'),
    F('mateus', 'МАТЕУС', 'МАТЕУСА', 'finisher', 'C', 'dark', 'black', 'blue', 0, 'bald'),
    F('gleb', 'ГЛЕБ', 'ГЛЕБА', 'wrestler', 'B', 'light', 'brown', 'white', 0.05, 'quiff+beard'),
  ],
  middle: [
    F('rafael', 'РАФАЭЛ', 'РАФАЭЛА', 'escape', 'B', 'brown', 'black', 'white', -0.1, 'curly'),
    F('andrey', 'АНДРЕЙ', 'АНДРЕЯ', 'pressure', 'A', 'olive', 'dark', 'blue', 0.1, 'crop+beard'),
    F('kirill', 'КИРИЛЛ', 'КИРИЛЛА', 'wrestler', 'A', 'light', 'brown', 'white', 0.05, 'quiff'),
    F('bruno', 'БРУНО', 'БРУНО', 'guard', 'C', 'tan', 'black', 'black', 0, 'bald+beard'),
    F('savva', 'САВВА', 'САВВЫ', 'pressure', 'A', 'fair', 'sandy', 'white', 0.1, 'long+beard'),
    F('olavo', 'ОЛАВО', 'ОЛАВО', 'finisher', 'D', 'dark', 'grey', 'black', 0, 'buzz+beard'),
  ],
  heavy: [
    F('ivan', 'ИВАН', 'ИВАНА', 'pressure', 'A', 'fair', 'brown', 'white', 0.1, 'crop+beard'),
    F('rodrigo', 'РОДРИГО', 'РОДРИГО', 'guard', 'B', 'tan', 'black', 'blue', 0, 'curly'),
    F('bogdan', 'БОГДАН', 'БОГДАНА', 'wrestler', 'A', 'light', 'dark', 'white', 0.15, 'buzz'),
    F('felipe', 'ФЕЛИПЕ', 'ФЕЛИПЕ', 'escape', 'B', 'brown', 'black', 'black', -0.1, 'quiff'),
    F('maksim', 'МАКСИМ', 'МАКСИМА', 'finisher', 'C', 'olive', 'grey', 'blue', 0, 'bald+beard'),
    F('eduardo', 'ЭДУАРДО', 'ЭДУАРДО', 'pressure', 'D', 'dark', 'black', 'white', 0.05, 'curly+beard'),
  ],
};
export const FIGHTER_BY_ID = Object.fromEntries(
  Object.entries(FIGHTERS).flatMap(([w, list]) => list.map((f) => [f.id, { ...f, weight: w }])));
export const DEFAULT_FIGHTER = 'kirill';

// The five he fights, white belt first.
export function rungsFor(id) {
  const me = FIGHTER_BY_ID[id] || FIGHTER_BY_ID[DEFAULT_FIGHTER];
  return FIGHTERS[me.weight].filter((f) => f.id !== me.id).slice(0, 5).map((f) => FIGHTER_BY_ID[f.id]);
}

// A man's build, as a mass between the library's two ends.
export const massOf = (f) => Math.max(-1, Math.min(1, WEIGHT_OF[f.weight].mass + (f.mass || 0)));

// And his three numbers: the base the side has always had, his class, his style.
export function statsOf(f, base) {
  const w = WEIGHT_OF[f.weight], s = STYLE_INFO[f.style];
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  return {
    technique: clamp01(base.technique + (s.technique || 0)),
    strength: clamp01(base.strength + (s.strength || 0) + w.strength),
    cardio: clamp01(base.cardio + (s.cardio || 0) + w.cardio),
  };
}
