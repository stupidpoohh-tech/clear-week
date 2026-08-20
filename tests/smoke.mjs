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
/* 합치기는 서버에만 있다. 모의 서버도 같은 함수를 쓴다 — 규칙이 갈라지지 않게 */
import { mergeWeek, sanitizeWeek, blankWeek } from '../functions/_lib.js';

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

/* ── 모의 서버 — Pages Functions 자리를 대신한다 ─────────────
   KV·메일은 흉내만 낸다. 합치기와 주고받는 모양은 진짜와 같다. */
const api = { weeks: {}, sessions: new Map(), codes: new Map(), lastCode: null };
const readBody = req => new Promise(r => {
  let b = ''; req.on('data', c => (b += c)); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } });
});
const cookieOf = req => {
  const m = /(?:^|;\s*)cw_session=([^;]+)/.exec(req.headers.cookie || '');
  return m ? m[1] : null;
};
const send = (res, code, data, headers = {}) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(data));
};

async function handleApi(req, res, url) {
  const email = api.sessions.get(cookieOf(req)) || null;

  if (url === '/api/me') return send(res, 200, { email, ready: true });

  if (url === '/api/auth/request') {
    const { email: to } = await readBody(req);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to || ''))) return send(res, 400, { error: 'bad-email' });
    api.lastCode = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
    api.codes.set(String(to).toLowerCase(), api.lastCode);
    return send(res, 200, { ok: true });
  }

  if (url === '/api/auth/verify') {
    const b = await readBody(req);
    const want = api.codes.get(String(b.email || '').toLowerCase());
    if (!want || want !== String(b.code)) return send(res, 400, { error: 'wrong-code' });
    api.codes.delete(String(b.email).toLowerCase());
    const token = 'a'.repeat(48) + api.sessions.size;
    api.sessions.set(token, String(b.email).toLowerCase());
    return send(res, 200, { ok: true, email: String(b.email).toLowerCase() },
      { 'set-cookie': `cw_session=${token}; Path=/; SameSite=Lax; Max-Age=999999` });
  }

  if (url === '/api/auth/logout') {
    api.sessions.delete(cookieOf(req));
    return send(res, 200, { ok: true }, { 'set-cookie': 'cw_session=; Path=/; Max-Age=0' });
  }

  if (!email) return send(res, 401, { error: 'unauthorized' });

  if (url === '/api/sync') {
    const b = await readBody(req);
    const id = String(b.weekId || '');
    const merged = mergeWeek(sanitizeWeek(b.week, id),
      api.weeks[id] ? sanitizeWeek(api.weeks[id], id) : blankWeek(id));
    api.weeks[id] = merged;
    return send(res, 200, { week: merged });
  }

  if (url === '/api/sync/all') {
    const b = await readBody(req);
    const incoming = b.weeks || {};
    const ids = new Set([...Object.keys(api.weeks), ...Object.keys(incoming)]);
    const weeks = {};
    for (const id of ids) {
      const merged = mergeWeek(sanitizeWeek(incoming[id], id),
        api.weeks[id] ? sanitizeWeek(api.weeks[id], id) : blankWeek(id));
      api.weeks[id] = merged;
      weeks[id] = merged;
    }
    return send(res, 200, { weeks });
  }
  return send(res, 404, { error: 'not-found' });
}

const server = createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (url.startsWith('/api/')) return handleApi(req, res, url);
  const path = join(ROOT, url === '/' ? 'index.html' : url);
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
console.log('\n── 첫 실행 안내 ──');
/* 버튼이 하나도 없는 화면이라 첫 단서가 필요하다. 단, 한 번 거절하면 다시 안 뜬다 */
check('첫 실행에 안내가 뜬다', await page.locator('#guide').isVisible(), true);
check('설명은 다섯 마디', await page.locator('.guide-hint').count(), 5);
check('설명이 서로 겹치지 않는다', await page.evaluate(() => {
  const rs = Array.from(document.querySelectorAll('.guide-hint')).map(e => e.getBoundingClientRect());
  let hit = 0;
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const a = rs[i], b = rs[j];
    if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) hit++;
  }
  return hit;
}), 0);
check('설명이 요일 열을 넘지 않는다', await page.evaluate(() => {
  const right = document.querySelector('.days').getBoundingClientRect().right;
  return Array.from(document.querySelectorAll('.guide-hint'))
    .filter(e => e.getBoundingClientRect().right > right + 1).length;
}), 0);
check('표본 주가 그려진다', await page.evaluate(() => App.week.days.thu.map(i => i.text)),
  ['낭만백수달', '영상편집']);
check('표본은 저장하지 않는다', await page.evaluate(() =>
  localStorage.getItem('clearweek:' + App.week.weekId)), null);
check('셀로판지가 주간 표를 덮는다', await page.evaluate(() => {
  const s = document.getElementById('guideSheet').getBoundingClientRect();
  const b = document.getElementById('weekBody').getBoundingClientRect();
  return s.left <= b.left && s.right >= b.right && s.top <= b.top && s.height > 100;
}), true);
check('모서리가 접혀 있다', await page.evaluate(() =>
  (document.querySelector('#guideSheet .flap').getAttribute('d') || '').length > 10), true);
await page.mouse.click(195, 120);
await page.waitForTimeout(200);
check('아무 데나 누르면 닫힌다', await page.locator('#guide').isVisible(), false);
await page.reload(); await page.waitForTimeout(400);
check('닫기만 했으면 다음에 다시 뜬다', await page.locator('#guide').isVisible(), true);
await page.locator('#guideNever').click();
await page.waitForTimeout(200);
check('다시 보지 않기 — 그 자리에서 닫힘', await page.locator('#guide').isVisible(), false);
await page.reload(); await page.waitForTimeout(400);
check('다시 보지 않기 — 새로고침해도 안 뜸', await page.locator('#guide').isVisible(), false);
check('닫으면 표본이 사라진다', await page.evaluate(() =>
  Object.values(App.week.days).reduce((n, a) => n + a.length, 0)), 0);

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

await cell(3).locator('.item').nth(1).click();
await page.waitForTimeout(420);
check('편집 중에는 원본이 안 보인다', await page.evaluate(() => {
  const hidden = Array.from(document.querySelectorAll('.item[hidden]'));
  return hidden.every(el => getComputedStyle(el).display === 'none');
}), true);
check('편집 중 같은 글이 두 번 보이지 않는다', await page.evaluate(() => {
  const shown = Array.from(App.cells.thu.listEl.querySelectorAll('.item'))
    .filter(el => getComputedStyle(el).display !== 'none')
    .map(el => el.textContent);
  const typed = App.cells.thu.listEl.querySelector('.entry').value;
  return shown.filter(v => v === typed).length;
}), 0);
await page.keyboard.press('Escape');
await page.locator('#weekTitle').click();
await page.waitForTimeout(300);
check('편집을 마치면 원본이 돌아온다', await days('thu'), ['멜팅의원', '웨비나 참석', '낭만백수달']);

const one = await cell(3).locator('.item').nth(2).boundingBox();
await page.mouse.move(one.x + 30, one.y + one.height / 2); await page.mouse.down();
await page.waitForTimeout(680); await page.mouse.up(); await page.waitForTimeout(300);
check('롱프레스 삭제', await days('thu'), ['멜팅의원', '웨비나 참석']);

console.log('\n── 긋기 · 지우기 ──');
await strikeFirst('thu');
check('가로 드래그로 긋기', await page.evaluate(() => App.week.days.thu.filter(i => i.struck).length), 1);
check('획은 시드+비율로 저장', await page.evaluate(() =>
  Object.keys(App.week.days.thu[0].strikes[0]).sort()), ['a', 'b', 'line', 'seed']);

console.log('\n── 칸이 스스로 나뉜다 ──');
/* 한 열에 몇 줄이 들어가는지는 화면 높이가 정한다. 그래서 개수를 못 박고 검사하지 않고,
   "넘칠 때만 나뉜다"는 성질을 검사한다. */
const colsOf = key => page.evaluate(k => getComputedStyle(App.cells[k].listEl).columnCount, key);
const growth = await page.evaluate(() => {
  const out = [];
  for (let n = 1; n <= 20; n++) {
    App.week.days.fri = Array.from({ length: n }, (_, i) =>
      ({ id: 'f' + i, text: '항목 ' + (i + 1), struck: false, createdAt: 0, strikes: [] }));
    App.render(); App.relayoutAll();
    out.push({
      n,
      cols: Number(getComputedStyle(App.cells.fri.listEl).columnCount),
      hidden: App.hiddenCount(App.cells.fri),
      font: parseFloat(getComputedStyle(App.cells.fri.listEl.querySelector('.item-text')).fontSize),
    });
  }
  return out;
});
check('한 열로 시작한다', growth[0].cols, 1);
check('열 수는 줄어들지 않는다',
  growth.every((r, i) => i === 0 || r.cols >= growth[i - 1].cols), true);
check('한 열에 들어가는 동안은 나누지 않는다',
  growth.filter(r => r.cols === 1 && r.hidden > 0).length, 0);
check('넘치면 2단이 된다', growth.some(r => r.cols === 2), true);
check('2단으로도 모자라면 3단', growth.some(r => r.cols === 3), true);
check('3단이 되기 전에는 잘리지 않는다',
  growth.filter(r => r.cols < 3 && r.hidden > 0).length, 0);
check('나누면 그 칸 글씨가 작아짐',
  growth.find(r => r.cols === 2).font < growth[0].font, true);
check('더 나누면 더 작아짐',
  growth.find(r => r.cols === 3).font < growth.find(r => r.cols === 2).font, true);

await page.evaluate(() => { App.week.days.fri = App.week.days.fri.slice(0, 1); App.save(); App.render(); });
await page.waitForTimeout(400);
check('줄이면 다시 한 열', await colsOf('fri'), '1');
check('안 나눈 칸은 그대로', await page.evaluate(() =>
  getComputedStyle(App.cells.thu.listEl.querySelector('.item-text')).fontSize ===
  getComputedStyle(App.cells.fri.listEl.querySelector('.item-text')).fontSize), true);

check('세로선은 그리지 않는다', await page.evaluate(() =>
  document.querySelectorAll('.split-svg').length), 0);
await page.evaluate(() => {
  App.week.days.free = Array.from({ length: 12 }, (_, i) =>
    ({ id: 'v' + i, text: '단어 ' + i, struck: false, createdAt: 0, strikes: [] }));
  App.render();
});
await page.waitForTimeout(400);
check('note 칸은 나뉘지 않는다', await colsOf('free'), '1');
await page.evaluate(() => { App.week.days.free = []; App.week.days.fri = []; App.save(); App.render(); });
await page.waitForTimeout(300);

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
check('지난 주도 편집 가능', await page.locator('.cell-label').first().evaluate(e => e.tagName), 'BUTTON');
await tapLabel(0);
await type(['지난 주에 적기']);
check('지난 주에도 적힌다', await days('mon'), ['지난 주에 적기']);
check('머리말 아래 안내는 없다', await page.locator('#note').isVisible(), false);
await page.evaluate(() => { App.week.days.mon = []; App.save(); App.render(); });
await page.waitForTimeout(300);
await page.locator('#next').click(); await page.waitForTimeout(400);
check('원래 주로 복귀', await page.locator('#weekTitle').textContent(), title);

console.log('\n── 넘친 항목 ──');
/* 칸 높이가 고정이라 넘치면 잘린다. 잘렸다는 사실은 화면에 남아야 한다 */
await page.evaluate(() => {
  /* 3단으로 나뉘고도 남을 만큼 — 여기서부터가 진짜로 잘리는 구간 */
  App.week.days.tue = Array.from({ length: 24 }, (_, i) =>
    ({ id: 'ov' + i, text: '할 일 ' + (i + 1), struck: false, createdAt: 0, strikes: [] }));
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
check('넘쳐도 3단까지는 자동으로 나뉜다', await page.evaluate(() =>
  getComputedStyle(App.cells.tue.listEl).columnCount), '3');
await page.evaluate(() => { App.week.days.tue = App.week.days.tue.slice(0, 3); App.save(); App.render(); });
await page.waitForTimeout(400);
check('항목을 줄이면 표시가 사라짐', await markOf('tue'), null);

console.log('\n── 백업 ──');
check('평소엔 계정 화면이 닫혀 있다', await page.locator('#account').isVisible(), false);
const tbox = await page.locator('#weekTitle').boundingBox();
await page.mouse.move(tbox.x + tbox.width / 2, tbox.y + tbox.height / 2);
await page.mouse.down(); await page.waitForTimeout(680); await page.mouse.up();
await page.waitForTimeout(300);
check('제목 롱프레스로 계정 화면이 열린다', await page.locator('#account').isVisible(), true);

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
check('안내 기록은 주 데이터가 아니다', await page.evaluate(() =>
  Object.keys(collectWeeks().weeks).some(id => id.indexOf('guide') >= 0)), false);
await page.locator('#guideBtn').click();
await page.waitForTimeout(250);
check('백업 줄에서 안내를 다시 열 수 있다', await page.locator('#guide').isVisible(), true);
check('안내를 열면 계정 화면은 닫힌다', await page.locator('#account').isVisible(), false);
await page.mouse.click(195, 700);
await page.waitForTimeout(200);

console.log('\n── 삭제하면 아래가 위로 올라온다 ──');
/* 지운 자리가 비어 있으면 안 된다. 지운 경로가 여럿이라 전부 확인한다 */
const tops = key => page.evaluate(k => {
  const box = App.cells[k].listEl.getBoundingClientRect();
  return Array.from(App.cells[k].listEl.querySelectorAll('.item')).map(el => {
    const r = el.getBoundingClientRect();
    return el.textContent + '@' + Math.round(r.top - box.top) + ',' + Math.round(r.left - box.left);
  });
}, key);
const seedCell = (key, texts) => page.evaluate(([k, list]) => {
  const now = Date.now();
  App.week.days[k] = list.map((text, i) =>
    ({ id: k + i, text, struck: false, createdAt: now + i, updatedAt: now + i, strikes: [] }));
  App.save(); App.render();
}, [key, texts]);

await seedCell('wed', ['하나', '둘', '셋']);
await page.waitForTimeout(400);
await page.evaluate(() => App.removeItem(App.cells.wed.items[1], 'wed'));
await page.waitForTimeout(300);
check('가운데를 지우면 아래가 올라온다', await tops('wed'), ['하나@0,0', '셋@26,0']);

await seedCell('wed', ['하나', '둘', '셋']);
await page.waitForTimeout(400);
await page.evaluate(() => {
  const it = App.cells.wed.items[0];
  it.data.struck = true;
  it.data.strikes = [{ line: 0, a: 0.02, b: 0.97, seed: 12345 }];
  it.clearStrokes(); it.restore();
});
await page.waitForTimeout(250);
await page.evaluate(() => App.removeItem(App.cells.wed.items[0], 'wed'));
await page.waitForTimeout(300);
check('그어진 것을 지워도 올라온다', await tops('wed'), ['둘@0,0', '셋@26,0']);
check('지운 항목의 획도 같이 사라진다', await page.evaluate(() =>
  App.cells.wed.listEl.querySelectorAll('svg path').length), 0);

await seedCell('wed', ['하나', '둘', '셋', '넷']);
await page.waitForTimeout(400);
{
  const b = await cell(2).locator('.item').nth(0).boundingBox();
  await page.mouse.move(b.x + 30, b.y + b.height / 2);
  await page.mouse.down(); await page.waitForTimeout(700);
  await page.mouse.move(b.x + 30, b.y + b.height * 1.5, { steps: 5 });
  await page.waitForTimeout(150); await page.mouse.up(); await page.waitForTimeout(400);
}
check('훑어 지워도 남은 것이 맨 위로', await tops('wed'), ['셋@0,0', '넷@26,0']);
await page.evaluate(() => { App.week.days.wed = []; App.save(); App.render(); });
await page.waitForTimeout(300);

console.log('\n── 만든 사람은 계정 화면 안에 ──');
check('주간 화면에는 푸터가 없다', await page.locator('.made').isVisible(), false);
{
  const b = await page.locator('#weekTitle').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down(); await page.waitForTimeout(680); await page.mouse.up();
  await page.waitForTimeout(250);
}
check('계정 화면 안에 있다', await page.locator('.made').isVisible(), true);
check('홈 링크', await page.locator('#homeLink').getAttribute('href'),
  'https://dada-portfolio.stupidpoohh.workers.dev/');
check('새 창으로 연다', await page.locator('#homeLink').getAttribute('rel'), 'noopener noreferrer');
check('계정 화면은 주간 표를 줄이지 않는다', await page.evaluate(() => {
  const w = document.querySelector('.week').getBoundingClientRect();
  return getComputedStyle(document.getElementById('account')).position === 'fixed' && w.height > 300;
}), true);
await page.locator('#acctClose').click();
await page.waitForTimeout(250);
check('닫기로 닫힌다', await page.locator('#account').isVisible(), false);

console.log('\n── 저장 실패 ──');
/* 사파리 사생활 모드처럼 저장이 막힌 상황 */
await page.evaluate(() => {
  window.origSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = () => { throw new Error('blocked'); };
});
await page.evaluate(() => App.save());
await page.waitForTimeout(150);
check('저장이 막히면 알린다', await page.locator('#note').isVisible(), true);
check('알림 문구', /^저장 안 됨/.test(await page.locator('#note').textContent()), true);

console.log('\n── 로그인 · 동기화 ──');
check('서버가 없으면 로그인 버튼을 내보이지 않는다', await page.evaluate(() => {
  const was = Sync.ready;
  Sync.ready = false; App.renderAuth();
  const hidden = document.getElementById('loginBtn').hidden;
  const msg = document.getElementById('authMsg').textContent;
  Sync.ready = was; App.renderAuth();
  return { hidden, msg };
}), { hidden: true, msg: '이 기기에만 저장됩니다' });
/* 로그아웃 상태의 앱은 예전과 완전히 같아야 한다 */
await page.evaluate(() => { Storage.prototype.setItem = origSetItem; });
await page.reload(); await page.waitForTimeout(500);
check('로그아웃 상태에서는 이 기기에만 저장', await page.evaluate(() => Sync.email), null);

async function openDrawer(pg) {
  const b = await pg.locator('#weekTitle').boundingBox();
  await pg.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await pg.mouse.down(); await pg.waitForTimeout(680); await pg.mouse.up();
  await pg.waitForTimeout(250);
}
async function login(pg, mail) {
  await openDrawer(pg);
  await pg.locator('#loginBtn').click();
  await pg.locator('#loginEmail').fill(mail);
  await pg.locator('#authGo').click();
  await pg.waitForTimeout(250);
  await pg.locator('#loginCode').fill(api.lastCode);
  await pg.locator('#authGo').click();
  await pg.waitForFunction(() => Sync.email !== null, null, { timeout: 5000 });
  await pg.waitForTimeout(400);
}

await login(page, 'me@example.com');
check('로그인하면 주소가 잡힌다', await page.evaluate(() => Sync.email), 'me@example.com');

/* PC에서 적은 것이 서버로 올라간다 */
await page.locator('#acctClose').click();      // 계정 화면 닫기
await page.waitForTimeout(200);
await tapLabel(0);
await type(['PC에서 적음']);
await page.locator('#weekTitle').click();      // 입력 끝내기
await page.waitForTimeout(1400);
check('적은 것이 서버에 올라간다',
  Object.values(api.weeks).some(w => w.days.mon.some(i => i.text === 'PC에서 적음')), true);

/* 폰 = 저장소가 다른 새 브라우저 */
const phone = await (await browser.newContext({ viewport: { width: 390, height: 760 } })).newPage();
await phone.goto(`http://127.0.0.1:${PORT}/index.html`);
await phone.waitForTimeout(400);
await phone.evaluate(() => { markGuideSeen(); document.getElementById('guide').hidden = true; App.closeGuide && App.closeGuide(); });
await phone.reload(); await phone.waitForTimeout(500);
check('폰은 처음엔 비어 있다', await phone.evaluate(() => App.week.days.mon.length), 0);

await login(phone, 'me@example.com');
check('폰에서 로그인하면 받아온다',
  await phone.evaluate(() => App.week.days.mon.map(i => i.text)), ['PC에서 적음']);

/* 양쪽에서 따로 적으면 둘 다 남는다 */
await phone.locator('#acctClose').click();
await phone.waitForTimeout(200);
await phone.evaluate(() => {
  const now = Date.now();
  App.week.days.mon.push({ id: 'phone-1', text: '폰에서 적음', struck: false,
    createdAt: now, updatedAt: now, strikes: [] });
  App.save();
});
await phone.waitForTimeout(1500);
await page.evaluate(() => Sync.push());
await page.waitForTimeout(600);
check('양쪽에서 적은 것이 둘 다 남는다',
  await page.evaluate(() => App.week.days.mon.map(i => i.text)), ['PC에서 적음', '폰에서 적음']);

/* 한쪽에서 지우면 다른 쪽에서도 지워진다 (되살아나지 않는다) */
await page.evaluate(() => {
  const item = App.cells.mon.items.find(i => i.data.text === '폰에서 적음');
  App.removeItem(item, 'mon');
});
await page.waitForTimeout(1500);
await phone.evaluate(() => Sync.push());
await phone.waitForTimeout(600);
check('지운 것은 다른 기기에서도 사라진다',
  await phone.evaluate(() => App.week.days.mon.map(i => i.text)), ['PC에서 적음']);
await phone.evaluate(() => Sync.push());
await phone.waitForTimeout(600);
check('지운 것이 되살아나지 않는다',
  await phone.evaluate(() => App.week.days.mon.map(i => i.text)), ['PC에서 적음']);

await openDrawer(page);
await page.locator('#logoutBtn').click();
await page.waitForTimeout(300);
check('로그아웃해도 이 기기 기록은 남는다',
  await page.evaluate(() => App.week.days.mon.map(i => i.text)), ['PC에서 적음']);
check('로그아웃하면 더 이상 올리지 않는다', await page.evaluate(() => Sync.email), null);
await phone.close();
await page.locator('#acctClose').click();
await page.waitForTimeout(200);

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
