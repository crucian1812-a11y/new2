// Put arcs.js back if the last solver died holding a candidate.
//
// route-arc tries a route by writing it into src/game/arcs.js and solving
// against it, so at any instant during a run the file holds something nobody
// has decided on. It keeps a backup and puts it back on the way out, and that
// covers every way of stopping except the one that keeps happening: the run
// spends nearly all of its life blocked inside `spawnSync`, ten minutes at a
// time, and a signal that arrives there is queued until the child returns. A
// container being torn down does not wait for that. Twice in one week a
// candidate was left sitting in the working tree as a one-line diff to VIAS,
// looking exactly like a result, with no log line behind it.
//
// The backup is only deleted when a run finishes, so finding one on the way in
// says precisely that the last run did not.
//
// It is a side-effecting import, and being imported first is not enough on its
// own. ES modules parse the entire graph before they evaluate any of it, so by
// the time this code runs arcs.js has already been read — the repair fixes the
// file on disk and the process carries on with the table it parsed a moment
// earlier. That was measured, not guessed: the repair printed its line and the
// very next line reported the route the file no longer held.
//
// So there is a second half, `readVias`, and the caller uses it to refresh
// what it imported. Two halves because they answer two questions — what is on
// disk, and what this process thinks is on disk — and the bug was the gap
// between them.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

export const ARCS_PATH = join(dirname(fileURLToPath(import.meta.url)), '../src/game/arcs.js');
export const ARCS_BACKUP = join(tmpdir(), 'bjj-arcs-backup.js');

if (existsSync(ARCS_BACKUP)) {
  try {
    const held = readFileSync(ARCS_BACKUP, 'utf8');
    if (readFileSync(ARCS_PATH, 'utf8') !== held) {
      writeFileSync(ARCS_PATH, held);
      console.log('the last run died mid-candidate; arcs.js put back the way it was');
    }
  } catch { /* the file is gone, or unreadable; there is nothing to put back */ }
}

// The VIAS table as it is on disk, parsed out of the text rather than
// imported. Same shape route-arc writes back — one quoted key and value a
// line — because the two are the same table read and written by the same tool.
export function readVias() {
  const src = readFileSync(ARCS_PATH, 'utf8');
  const m = /export const VIAS = \{\n([\s\S]*?)\n\};/.exec(src);
  const vias = {};
  for (const line of (m ? m[1] : '').split('\n')) {
    const kv = /^\s*'([^']+)':\s*'([^']+)',/.exec(line);
    if (kv) vias[kv[1]] = kv[2];
  }
  return vias;
}
