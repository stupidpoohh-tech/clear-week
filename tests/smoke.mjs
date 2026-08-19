/*
 * Clear Week — 회귀 테스트
 *
 *   node tests/smoke.mjs
 *
 * 정적 서버를 직접 띄우고 크로미움으로 주요 흐름을 훑는다.
 * 손맛·소리·햅틱처럼 사람이 판단할 것은 검증 대상이 아니다.
 * 실기기(아이폰)에서만 확인 가능한 것: 키보드 밀어올림, 확대 차단, 진동, 소리.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

/* playwright는 전역 설치본도 허용한다 (PLAYWRIGHT_MODULE로 경로 지정 가능) */
const chromium = await (async () => {
  const tries = [process.env.PLAYWRIGHT_MODULE, 'playwright',
                 '/opt/node22/lib/node_modules/playwright/index.mjs'].filter(Boolean);
  for (const m of tries) { try { return (await import(m)).chromium; } catch {} }
  throw new Error('playwright를 찾지 못했습니다. `npm i -D playwright` 또는 PLAYWRIGHT_MODULE에 경로를 지정하세요.');
})();

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 8231;
const TYPES = { '.html': 'text/html', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const server = createServer(async (req, res) => {
  const path = join(ROOT, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(PORT, r));

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '  OK  ' : '  실패'} ${name}` + (ok ? '' : `\n         받음: ${JSON.stringify(got)}\n         기대: ${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
};

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 760 } })).newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${PORT}/index.html`);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(400);

const cell = i => page.locator('.days .cell').nth(i);
const days = key => page.evaluate(k => App.week.days[k].map(i => i.text), key);

async function tapLabel(i) {
  const b = await cell(i).locator('.cell-label').boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(150);
}
async function type(lines) {
  for (const t of lines) { await page.keyboard.type(t); await page.keyboard.press('Enter'); }
  await page.waitForTimeout(180);
}
async function strikeFirst(key) {
  const r = await page.evaluate(k => {
    const el = App.cells[k].listEl.querySelector('.item-text');
    const q = document.createRange(); q.selectNodeContents(el);
    const x = Array.from(q.getClientRects()).filter(v => v.width > 1)[0];
    return { x: x.x, y: x.y, w: x.width, h: x.height };
  }, key);
  const y = r.y + r.h / 2;
  await page.mouse.move(r.x + 1, y); await page.mouse.down();
  for (let i = 1; i <= 14; i++) { await page.mouse.move(r.x + 1 + r.w * 0.95 * (i / 14), y); await page.waitForTimeout(8); }
  await page.mouse.up(); await page.waitForTimeout(400);
}
async function splitCell(i, frac = 0.55) {
  const b = await cell(i).boundingBox();
  const x = b.x + b.width * frac;
  await page.mouse.move(x, b.y + 5); await page.mouse.down();
  for (let k = 1; k <= 12; k++) { await page.mouse.move(x, b.y + 5 + (b.height - 10) * (k / 12)); await page.waitForTimeout(9); }
  await page.mouse.up(); await page.waitForTimeout(700);
}

console.log('\n── 화면 ──');
check('8칸(요일 7 + note)', await page.locator('.cell').count(), 8);
check('페이지 스크롤 없음', await page.evaluate(() =>
  document.documentElement.scrollHeight <= document.documentElement.clientHeight), true);
check('상단 날짜 범위 형식', /^\d{4}\. \d{1,2}\.\d{1,2}-\d{1,2}\.\d{1,2}$/.test(
  await page.locator('#weekTitle').textContent()), true);
check('날짜 라벨 형식', /^\d{1,2}\.[MTWFS]$/.test(
  await page.locator('.cell-label').first().textContent()), true);
check('외곽선은 아래만', await page.evaluate(() => {
  const w = getComputedStyle(document.querySelector('.week'));
  return [w.borderTopWidth, w.borderLeftWidth, w.borderRightWidth, w.borderBottomWidth];
}), ['0px', '0px', '0px', '1px']);

console.log('\n── 적기 ──');
await tapLabel(3);
await type(['멜팅의원', '웨비나']);
check('엔터로 연속 입력', await days('thu'), ['멜팅의원', '웨비나']);

await page.keyboard.type('낭만백수달');
await page.locator('#weekTitle').click();          // 엔터 없이 딴 데 누르기
await page.waitForTimeout(300);
check('엔터 없이 딴 데 눌러도 저장', await days('thu'), ['멜팅의원', '웨비나', '낭만백수달']);
check('입력창 닫힘', await page.locator('.entry').count(), 0);

console.log('\n── 편집 · 삭제 ──');
await cell(3).locator('.item').nth(1).click();
await page.waitForTimeout(420);
await page.locator('.entry').fill('웨비나 참석');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
check('탭 편집 — 자리 유지', await days('thu'), ['멜팅의원', '웨비나 참석', '낭만백수달']);

const one = await cell(3).locator('.item').nth(2).boundingBox();
await page.mouse.move(one.x + 30, one.y + one.height / 2); await page.mouse.down();
await page.waitForTimeout(680); await page.mouse.up(); await page.waitForTimeout(300);
check('롱프레스 삭제', await days('thu'), ['멜팅의원', '웨비나 참석']);

console.log('\n── 긋기 · 지우기 ──');
await strikeFirst('thu');
check('가로 드래그로 긋기', await page.evaluate(() => App.week.days.thu.filter(i => i.struck).length), 1);
check('획은 시드+비율로 저장', await page.evaluate(() =>
  Object.keys(App.week.days.thu[0].strikes[0]).sort()), ['a', 'b', 'line', 'seed']);

console.log('\n── 칸 나누기 ──');
await tapLabel(4);
await type(['J41', 'G45', '장보기', '은행', '회의 준비', '서류', '운동', '독서']);
const before = await page.evaluate(() => getComputedStyle(App.cells.fri.listEl.querySelector('.item-text')).fontSize);
await splitCell(4);
check('세로선 → 2단', await page.evaluate(() => getComputedStyle(App.cells.fri.listEl).columnCount), '2');
check('확정된 선은 표의 실선(rect)', await page.evaluate(() => ({
  path: App.cells.fri.splits.svg.querySelectorAll('path').length,
  rect: App.cells.fri.splits.svg.querySelectorAll('rect').length })), { path: 0, rect: 1 });
const after = await page.evaluate(() => getComputedStyle(App.cells.fri.listEl.querySelector('.item-text')).fontSize);
check('나누면 그 칸 글씨가 작아짐', parseFloat(after) < parseFloat(before), true);
check('안 나눈 칸은 그대로', await page.evaluate(() =>
  getComputedStyle(App.cells.thu.listEl.querySelector('.item-text')).fontSize), before);

const lineX = await page.evaluate(() => App.cells.fri.splits.lines[0].x + App.cells.fri.section.getBoundingClientRect().left);
const fb = await cell(4).boundingBox();
await page.mouse.move(lineX, fb.y + fb.height / 2); await page.mouse.down();
await page.waitForTimeout(680); await page.mouse.up(); await page.waitForTimeout(400);
check('뒤 단이 차 있으면 선 삭제 거부', await page.evaluate(() => App.week.splits.fri.length), 1);

await page.evaluate(() => { App.week.days.fri = App.week.days.fri.slice(0, 3); App.save(); App.render(); });
await page.waitForTimeout(500);
const lx2 = await page.evaluate(() => App.cells.fri.splits.lines[0].x + App.cells.fri.section.getBoundingClientRect().left);
const fb2 = await cell(4).boundingBox();
await page.mouse.move(lx2, fb2.y + fb2.height / 2); await page.mouse.down();
await page.waitForTimeout(680); await page.mouse.up(); await page.waitForTimeout(500);
check('뒤 단이 비면 선 삭제 가능', await page.evaluate(() => App.week.splits.fri.length), 0);

console.log('\n── 저장 · 주 이동 ──');
await page.reload(); await page.waitForTimeout(500);
check('새로고침 후 항목 유지', await days('thu'), ['멜팅의원', '웨비나 참석']);
check('새로고침 후 획 복원', await page.evaluate(() =>
  App.cells.thu.listEl.querySelectorAll('g path').length), 1);

const title = await page.locator('#weekTitle').textContent();
await page.locator('#next').click(); await page.waitForTimeout(300);
check('다음 주는 빈 주', await page.evaluate(() =>
  Object.values(App.week.days).reduce((n, a) => n + a.length, 0)), 0);
check('다음 주도 편집 가능', await page.locator('.cell-label').first().evaluate(e => e.tagName), 'BUTTON');
await page.locator('#prev').click(); await page.locator('#prev').click(); await page.waitForTimeout(300);
check('지난 주는 열람 전용', await page.locator('.cell-label').first().evaluate(e => e.tagName), 'DIV');
await page.locator('#next').click(); await page.waitForTimeout(400);
check('원래 주로 복귀', await page.locator('#weekTitle').textContent(), title);

console.log('\n── 넘친 항목 ──');
/* 칸 높이가 고정이라 넘치면 잘린다. 잘렸다는 사실은 화면에 남아야 한다 */
await page.evaluate(() => {
  App.week.days.tue = ['회의자료 정리', '장보기', '은행', '약국', '세탁물 찾기',
                       '전화하기', '운동', '독서', '정산', '메일 회신']
    .map((text, i) => ({ id: 'ov' + i, text, struck: false, createdAt: 0, strikes: [] }));
  App.save(); App.render();
});
await page.waitForTimeout(500);
const markOf = key => page.evaluate(k => {
  const m = App.cells[k].section.querySelector('.overflow-mark');
  return m ? m.textContent : null;
}, key);
const over1 = await markOf('tue');
check('칸이 넘치면 잘렸다고 표시', /^\+\d+$/.test(over1 || ''), true);
check('넘치지 않는 칸엔 표시 없음', await markOf('mon'), null);
await splitCell(1);
check('나누면 숨은 항목이 줄어듦',
  parseInt(await markOf('tue') || '+0', 10) < parseInt(over1, 10), true);

console.log('\n── 백업 ──');
check('평소엔 백업 줄이 닫혀 있음', await page.locator('#backup').isVisible(), false);
const tbox = await page.locator('#weekTitle').boundingBox();
await page.mouse.move(tbox.x + tbox.width / 2, tbox.y + tbox.height / 2);
await page.mouse.down(); await page.waitForTimeout(680); await page.mouse.up();
await page.waitForTimeout(300);
check('제목 롱프레스로 백업 줄이 열림', await page.locator('#backup').isVisible(), true);

const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('#exportBtn').click(),
]);
let dumpText = '';
for await (const chunk of await download.createReadStream()) dumpText += chunk;
const dump = JSON.parse(dumpText);
check('내보낸 파일 이름', /^clear-week-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename()), true);
check('저장된 주가 전부 파일에 들어감', Object.keys(dump.weeks).length, await page.evaluate(() =>
  Object.keys(localStorage).filter(k => /^clearweek:\d{4}-W\d{2}$/.test(k)).length));

/* 가져오기는 덮어쓰지 않는다 — 되돌리기가 없으므로 지우는 쪽으로 기울지 않는다 */
const brought = await page.evaluate(txt => {
  const data = JSON.parse(txt);
  const id = Object.keys(data.weeks)[0];
  data.weeks[id].days.mon = [{ id: 'zz', text: '덮어쓰기 시도', struck: false, createdAt: 0, strikes: [] }];
  data.weeks['2019-W01'] = {
    weekId: '2019-W01',
    days: { mon: [{ id: 'old', text: '옛 주', struck: false, createdAt: 0, strikes: [] }] },
    splits: {}, notes: {},
  };
  const before = localStorage.getItem('clearweek:' + id);
  const r = importBackup(JSON.stringify(data));
  return { r, untouched: localStorage.getItem('clearweek:' + id) === before,
           filled: localStorage.getItem('clearweek:2019-W01') !== null };
}, dumpText);
check('없던 주만 채움', brought.r.added, 1);
check('이미 있는 주는 그대로 둠', brought.untouched, true);
check('가져온 주가 실제로 생김', brought.filled, true);
check('백업 파일이 아니면 거절', await page.evaluate(() => importBackup('{"a":1}').error), 'Clear Week 백업 파일이 아님');
check('깨진 파일은 거절', await page.evaluate(() => importBackup('nope').error), '읽을 수 없는 파일');

console.log('\n── 저장 실패 ──');
/* 사파리 사생활 모드처럼 저장이 막힌 상황 */
await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('blocked'); }; });
await page.evaluate(() => App.save());
await page.waitForTimeout(150);
check('저장이 막히면 알린다', await page.locator('#note').isVisible(), true);
check('알림 문구', /^저장 안 됨/.test(await page.locator('#note').textContent()), true);

console.log('\n── 확대 차단 ──');
check('확대 제스처 preventDefault', await page.evaluate(() =>
  ['gesturestart', 'gesturechange', 'gestureend'].every(t => {
    const e = new Event(t, { cancelable: true, bubbles: true });
    document.dispatchEvent(e); return e.defaultPrevented;
  })), true);
check('문서 touch-action: none', await page.evaluate(() =>
  getComputedStyle(document.body).touchAction), 'none');

check('콘솔 오류 없음', errors, []);

await browser.close();
server.close();
console.log(`\n통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
