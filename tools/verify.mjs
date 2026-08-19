// Runs the whole verification suite against a locally served build.
//   node tools/verify.mjs [--port 8099]
// Exits non-zero if any check fails.
import { spawn } from 'node:child_process';

const port = process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : '8099';

const checks = [
  ['lint', 'npx', ['--yes', 'eslint', '.']],
  ['navigation', 'node', ['tools/nav-check.mjs', '--port', port]],
  ['skills & bosses', 'node', ['tools/skills-check.mjs', '--port', port]],
  ['audio', 'node', ['tools/audio-check.mjs', '--port', port]],
  ['sprite lighting', 'node', ['tools/light-check.mjs', '--port', port]],
  ['gait', 'node', ['tools/gait-check.mjs', '--port', port]],
  ['posture', 'node', ['tools/pose-check.mjs', '--port', port]],
  ['heads', 'node', ['tools/head-check.mjs', '--port', port]],
  ['gpu composite', 'node', ['tools/gl-check.mjs', '--port', port]],
  ['single-file build', 'node', ['tools/bundle-check.mjs']],
  ['save/reload', 'node', ['tools/save-check.mjs', '--port', port]],
  ['endings', 'node', ['tools/endgame-check.mjs', '--port', port]],
];

const run = (cmd, args) =>
  new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });

let failed = 0;
for (const [name, cmd, args] of checks) {
  process.stdout.write(name.padEnd(18));
  const { code, out } = await run(cmd, args);
  if (code === 0) {
    console.log('PASS');
  } else {
    failed++;
    console.log('FAIL');
    console.log(
      out
        .split('\n')
        .filter((l) => l.trim())
        .slice(-14)
        .map((l) => '    ' + l)
        .join('\n')
    );
  }
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
