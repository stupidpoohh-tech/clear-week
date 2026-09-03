/*
 * 검사 — `node tests/run.mjs`
 *
 * 브라우저도 기기도 필요 없다. 손맛의 뼈대(획·지우개·칸 나누기·자리 계산)는
 * 전부 화면 없이 돌 수 있게 `src/core`와 `src/ui/layout.js`에 모아 두었다.
 * **화면이 있어야만 알 수 있는 것은 여기서 검사하지 않는다** — 그런 것은
 * README의 "실기기에서만 확인 가능"에 적어 둔다.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const files = readdirSync(new URL('.', import.meta.url))
  .filter(f => f.endsWith('.mjs') && f !== 'run.mjs' && !f.startsWith('_')).sort();

let pass = 0, fail = 0, broken = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--no-warnings', new URL(f, import.meta.url).pathname],
    { encoding: 'utf8' });
  process.stdout.write(r.stdout || '');
  if (r.stderr) process.stderr.write(r.stderr);
  const m = /통과 (\d+), 실패 (\d+)/.exec(r.stdout || '');
  if (m) { pass += Number(m[1]); fail += Number(m[2]); }
  if (r.status !== 0) broken++;
}
console.log(`\n${files.length}개 파일 — 검사 ${pass + fail}개 중 통과 ${pass}, 실패 ${fail}`);
process.exit(fail || broken ? 1 : 0);
