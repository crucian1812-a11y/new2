// The position graph.
//
// Every node is a paired pose; every edge is a thing one of the two people can
// try to do about it. An edge belongs to a role — top or bottom — and is fired
// by a direction on the right thumb, which is where the UFC control scheme
// lives and why it transfers to a phone at all: one stick to carry your base,
// one pad to throw and to deny.
//
// `deny` is the direction the person on the receiving end has to flick, inside
// the window, to stop it. That single field is the whole defensive game: it
// turns a transition from a dice roll into a read.
//
// Points follow the IBJJF sheet — takedown and sweep 2, guard pass 3, knee on
// belly 2, mount and back 4 — and are only ever awarded for arriving somewhere
// and holding it, which is what `hold` is for.

export const DIRS = ['up', 'down', 'left', 'right'];

// from, role, dir, to, { ... }
const T = (from, role, dir, to, o = {}) => ({ from, role, dir, to, ...o });

export const TRANSITIONS = [
  /* ------------------------------------------------------------ standing */
  T('STANDING', 'any', 'up', 'OPEN_GUARD', {
    name: 'Проход в ноги', en: 'Double leg', points: 2, cost: 22, base: 0.5,
    time: 0.85, deny: 'down', becomes: 'top', note: 'сбил в партер',
  }),
  T('STANDING', 'any', 'left', 'CLINCH', {
    name: 'Клинч', en: 'Tie up', points: 0, cost: 8, base: 0.82, time: 0.5, deny: 'right',
  }),
  T('STANDING', 'any', 'right', 'CLINCH', {
    name: 'Клинч', en: 'Tie up', points: 0, cost: 8, base: 0.82, time: 0.5, deny: 'left',
  }),
  T('STANDING', 'any', 'down', 'CLOSED_GUARD', {
    name: 'Сесть в гвардию', en: 'Pull guard', points: 0, cost: 10, base: 0.95,
    time: 0.7, becomes: 'bottom',
  }),

  /* -------------------------------------------------------------- clinch */
  T('CLINCH', 'any', 'up', 'SIDE_CONTROL', {
    name: 'Бросок', en: 'Throw', points: 2, cost: 30, base: 0.36, time: 1.0,
    deny: 'down', becomes: 'top', big: true, note: 'бросок',
  }),
  T('CLINCH', 'any', 'right', 'TURTLE', {
    name: 'Сдёрг', en: 'Snap down', points: 0, cost: 16, base: 0.5, time: 0.7,
    deny: 'left', becomes: 'top',
  }),
  T('CLINCH', 'any', 'left', 'CLOSED_GUARD', {
    name: 'Сесть в гвардию', en: 'Pull guard', points: 0, cost: 12, base: 0.9,
    time: 0.6, becomes: 'bottom',
  }),
  T('CLINCH', 'any', 'down', 'STANDING', {
    name: 'Разрыв', en: 'Break', points: 0, cost: 8, base: 0.85, time: 0.4,
  }),

  /* -------------------------------------------------------- closed guard */
  T('CLOSED_GUARD', 'top', 'up', 'OPEN_GUARD', {
    name: 'Раскрыть гвардию', en: 'Open the guard', points: 0, cost: 16,
    base: 0.6, time: 0.8, deny: 'down',
  }),
  T('CLOSED_GUARD', 'top', 'down', 'STANDING', {
    name: 'Встать в стойку', en: 'Stand up', points: 0, cost: 18, base: 0.55,
    time: 0.8, deny: 'up',
  }),
  T('CLOSED_GUARD', 'bottom', 'up', 'TRIANGLE', {
    name: 'Треугольник', en: 'Triangle', points: 0, cost: 26, base: 0.32,
    time: 0.9, deny: 'down', sub: true,
  }),
  T('CLOSED_GUARD', 'bottom', 'down', 'GUILLOTINE', {
    name: 'Гильотина', en: 'Guillotine', points: 0, cost: 22, base: 0.3,
    time: 0.8, deny: 'up', sub: true,
  }),
  T('CLOSED_GUARD', 'bottom', 'left', 'MOUNT', {
    name: 'Переворот', en: 'Hip bump sweep', points: 2, cost: 26, base: 0.38,
    time: 0.95, deny: 'right', swap: true, becomes: 'top',
  }),
  T('CLOSED_GUARD', 'bottom', 'right', 'BACK', {
    name: 'Выход на спину', en: 'Take the back', points: 4, cost: 30, base: 0.24,
    time: 1.0, deny: 'left', swap: true, becomes: 'top', big: true,
  }),

  /* ---------------------------------------------------------- open guard */
  T('OPEN_GUARD', 'top', 'up', 'SIDE_CONTROL', {
    name: 'Проход гвардии', en: 'Guard pass', points: 3, cost: 24, base: 0.42,
    time: 0.95, deny: 'down', big: true, note: 'прошёл гвардию',
  }),
  T('OPEN_GUARD', 'top', 'left', 'HALF_GUARD', {
    name: 'Проход коленом', en: 'Knee slice', points: 0, cost: 16, base: 0.62,
    time: 0.75, deny: 'right',
  }),
  T('OPEN_GUARD', 'top', 'down', 'STANDING', {
    name: 'Разорвать', en: 'Disengage', points: 0, cost: 12, base: 0.8, time: 0.6,
  }),
  T('OPEN_GUARD', 'bottom', 'up', 'CLOSED_GUARD', {
    name: 'Закрыть гвардию', en: 'Close the guard', points: 0, cost: 12,
    base: 0.7, time: 0.6, deny: 'down', becomes: 'bottom',
  }),
  T('OPEN_GUARD', 'bottom', 'left', 'MOUNT', {
    name: 'Свип', en: 'Sweep', points: 2, cost: 26, base: 0.36, time: 0.95,
    deny: 'right', swap: true, becomes: 'top',
  }),
  T('OPEN_GUARD', 'bottom', 'right', 'STANDING', {
    name: 'Подъём', en: 'Technical stand-up', points: 0, cost: 20, base: 0.55,
    time: 0.8, deny: 'left',
  }),

  /* ---------------------------------------------------------- half guard */
  T('HALF_GUARD', 'top', 'up', 'SIDE_CONTROL', {
    name: 'Дожать проход', en: 'Complete the pass', points: 3, cost: 20,
    base: 0.5, time: 0.85, deny: 'down', big: true, note: 'прошёл гвардию',
  }),
  T('HALF_GUARD', 'top', 'right', 'BACK', {
    name: 'Выход на спину', en: 'Take the back', points: 4, cost: 26, base: 0.3,
    time: 1.0, deny: 'left', big: true,
  }),
  T('HALF_GUARD', 'bottom', 'down', 'OPEN_GUARD', {
    name: 'Восстановить гвардию', en: 'Recompose', points: 0, cost: 18,
    base: 0.55, time: 0.8, deny: 'up', becomes: 'bottom',
  }),
  T('HALF_GUARD', 'bottom', 'left', 'SIDE_CONTROL', {
    name: 'Свип из-под низа', en: 'Underhook sweep', points: 2, cost: 28,
    base: 0.32, time: 1.0, deny: 'right', swap: true, becomes: 'top',
  }),
  T('HALF_GUARD', 'bottom', 'right', 'BACK', {
    name: 'Выход на спину', en: 'Back take', points: 4, cost: 30, base: 0.22,
    time: 1.0, deny: 'left', swap: true, becomes: 'top', big: true,
  }),

  /* -------------------------------------------------------- side control */
  T('SIDE_CONTROL', 'top', 'up', 'MOUNT', {
    name: 'Маунт', en: 'Mount', points: 4, cost: 20, base: 0.48, time: 0.9,
    deny: 'down', big: true, note: 'вышел в маунт',
  }),
  T('SIDE_CONTROL', 'top', 'left', 'KNEE_ON_BELLY', {
    name: 'Колено на живот', en: 'Knee on belly', points: 2, cost: 12,
    base: 0.68, time: 0.6, deny: 'right',
  }),
  T('SIDE_CONTROL', 'top', 'right', 'KIMURA', {
    name: 'Кимура', en: 'Kimura', points: 0, cost: 24, base: 0.34, time: 0.9,
    deny: 'left', sub: true,
  }),
  T('SIDE_CONTROL', 'bottom', 'down', 'HALF_GUARD', {
    name: 'Вернуть гвардию', en: 'Recover guard', points: 0, cost: 20,
    base: 0.45, time: 0.85, deny: 'up', becomes: 'bottom',
  }),
  T('SIDE_CONTROL', 'bottom', 'left', 'SIDE_CONTROL', {
    name: 'Мост и переворот', en: 'Bridge and roll', points: 2, cost: 30,
    base: 0.26, time: 1.0, deny: 'right', swap: true, becomes: 'top',
  }),
  T('SIDE_CONTROL', 'bottom', 'right', 'TURTLE', {
    name: 'В черепаху', en: 'Turtle up', points: 0, cost: 16, base: 0.6,
    time: 0.7, deny: 'left', becomes: 'bottom',
  }),

  /* ------------------------------------------------------ knee on belly - */
  T('KNEE_ON_BELLY', 'top', 'up', 'MOUNT', {
    name: 'Маунт', en: 'Step to mount', points: 4, cost: 16, base: 0.6,
    time: 0.75, deny: 'down', big: true, note: 'вышел в маунт',
  }),
  T('KNEE_ON_BELLY', 'top', 'down', 'SIDE_CONTROL', {
    name: 'Обратно в сторону', en: 'Back to side', points: 0, cost: 8, base: 0.9, time: 0.5,
  }),
  T('KNEE_ON_BELLY', 'bottom', 'left', 'HALF_GUARD', {
    name: 'Сбить колено', en: 'Shrimp out', points: 0, cost: 22, base: 0.42,
    time: 0.85, deny: 'right', becomes: 'bottom',
  }),

  /* --------------------------------------------------------------- mount */
  T('MOUNT', 'top', 'up', 'ARMBAR', {
    name: 'Рычаг локтя', en: 'Armbar', points: 0, cost: 24, base: 0.38,
    time: 0.95, deny: 'down', sub: true,
  }),
  T('MOUNT', 'top', 'right', 'BACK', {
    name: 'На спину', en: 'Take the back', points: 4, cost: 18, base: 0.55,
    time: 0.8, deny: 'left', big: true,
  }),
  T('MOUNT', 'bottom', 'left', 'CLOSED_GUARD', {
    name: 'Мост (упа)', en: 'Upa escape', points: 2, cost: 32, base: 0.26,
    time: 1.05, deny: 'right', swap: true, becomes: 'top',
  }),
  T('MOUNT', 'bottom', 'down', 'HALF_GUARD', {
    name: 'Выкрут бедром', en: 'Elbow escape', points: 0, cost: 24, base: 0.4,
    time: 0.9, deny: 'up', becomes: 'bottom',
  }),
  T('MOUNT', 'bottom', 'right', 'TURTLE', {
    name: 'Развернуться', en: 'Turn out', points: 0, cost: 20, base: 0.45,
    time: 0.8, deny: 'left', becomes: 'bottom',
  }),

  /* ---------------------------------------------------------------- back */
  T('BACK', 'top', 'up', 'RNC', {
    name: 'Удушение сзади', en: 'Rear naked choke', points: 0, cost: 22,
    base: 0.46, time: 0.9, deny: 'down', sub: true,
  }),
  T('BACK', 'top', 'down', 'MOUNT', {
    name: 'В маунт', en: 'Roll to mount', points: 0, cost: 14, base: 0.7, time: 0.7,
  }),
  T('BACK', 'bottom', 'left', 'TURTLE', {
    name: 'Скинуть крюки', en: 'Shake the hooks', points: 0, cost: 26,
    base: 0.34, time: 0.95, deny: 'right', becomes: 'bottom',
  }),
  T('BACK', 'bottom', 'down', 'SIDE_CONTROL', {
    name: 'Съехать вниз', en: 'Slide down', points: 0, cost: 22, base: 0.38,
    time: 0.9, deny: 'up', becomes: 'bottom',
  }),

  /* -------------------------------------------------------------- turtle */
  T('TURTLE', 'top', 'up', 'BACK', {
    name: 'Поставить крюки', en: 'Get the hooks', points: 4, cost: 20,
    base: 0.5, time: 0.9, deny: 'down', big: true, note: 'вышел на спину',
  }),
  T('TURTLE', 'top', 'right', 'SIDE_CONTROL', {
    name: 'Передний захват', en: 'Front headlock', points: 3, cost: 18,
    base: 0.5, time: 0.85, deny: 'left', note: 'прошёл в сторону',
  }),
  T('TURTLE', 'bottom', 'down', 'OPEN_GUARD', {
    name: 'Сесть в гвардию', en: 'Sit to guard', points: 0, cost: 18,
    base: 0.55, time: 0.8, deny: 'up', becomes: 'bottom',
  }),
  T('TURTLE', 'bottom', 'left', 'STANDING', {
    name: 'Встать', en: 'Stand up', points: 0, cost: 24, base: 0.4,
    time: 0.9, deny: 'right',
  }),
];

// Index for the hot path: the sim asks "what can this role do from here" every
// frame to light the control ring, and rescanning 50 records to answer is the
// kind of waste that adds up on a phone.
export const BY_POSITION = {};
for (const t of TRANSITIONS) {
  (BY_POSITION[t.from] ||= { top: {}, bottom: {} });
  const roles = t.role === 'any' ? ['top', 'bottom'] : [t.role];
  for (const r of roles) BY_POSITION[t.from][r][t.dir] = t;
}

export function optionsFor(position, role) {
  const p = BY_POSITION[position];
  if (!p) return {};
  return p[role] || {};
}

// Submissions differ by what they threaten, and therefore by how they are
// survived: a choke is a clock, a joint lock is a wall of pain you can still
// spin out of. The numbers say the same thing — a choke's meter barely cares
// how strong you are, an armbar's cares a great deal.
export const SUB_KIND = {
  choke: { rate: 0.21, escapeCost: 16, strengthWeight: 0.25, tapAt: 1.0, name: 'УДУШЕНИЕ' },
  joint: { rate: 0.17, escapeCost: 22, strengthWeight: 0.6, tapAt: 1.0, name: 'БОЛЕВОЙ' },
};

// Nobody holds a finishing position for a minute. If it has not come by here it
// was never on, and the graph puts both of them back where the attack started.
export const SUB_TIMEOUT = 13;

export const POINTS_TO_HOLD = 3.0; // seconds a position must be held to score
