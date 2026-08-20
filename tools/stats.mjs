#!/usr/bin/env node
/*
 * Clear Week — 행동로그 읽기
 *
 *   CF_ACCOUNT_ID=… CF_API_TOKEN=… node tools/stats.mjs
 *   node tools/stats.mjs --days 30
 *   node tools/stats.mjs --sql "SELECT blob1, count() FROM clearweek_log GROUP BY blob1"
 *
 * 이 도구는 **앱 밖에 둔다.** 주간 화면에는 머리말과 표뿐이라는 §12를 지키려면
 * 숫자를 보는 자리가 앱 안에 생기면 안 된다. 터미널에서 본다.
 *
 * 토큰은 대시보드에서 만든다 — 권한은 `Account Analytics: Read` 하나면 된다.
 * 만드는 법은 SETUP.md.
 */

const DATASET = 'clearweek_log';
/* CF_API_BASE는 검사할 때 모의 서버를 물리려고 둔다. 평소엔 건드리지 않는다 */
const API = process.env.CF_API_BASE || 'https://api.cloudflare.com/client/v4/accounts';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const account = process.env.CF_ACCOUNT_ID;
const token = process.env.CF_API_TOKEN;
if (!account || !token) {
  console.error('CF_ACCOUNT_ID와 CF_API_TOKEN이 필요합니다. 만드는 법은 SETUP.md.');
  process.exit(1);
}

const days = Number(flag('days', 14));
if (!isFinite(days) || days < 1 || days > 90) {
  console.error('--days는 1~90 (Analytics Engine은 90일까지 보관합니다)');
  process.exit(1);
}

/* 만든 사람의 기기는 빼고 본다 — 안 그러면 통계가 자기 자신이다.
   내 기기 ID는 브라우저 콘솔에서 localStorage['clearweek:did'] */
const mine = (process.env.CW_LOG_EXCLUDE || '').split(',').map(s => s.trim()).filter(Boolean);
const notMine = mine.length
  ? ` AND blob2 NOT IN (${mine.map(v => `'${v.replace(/[^a-z0-9]/g, '')}'`).join(', ')})`
  : '';
const since = `timestamp > NOW() - INTERVAL '${days}' DAY${notMine}`;

async function sql(query) {
  const res = await fetch(`${API}/${account}/analytics_engine/sql`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: query,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
  try { return JSON.parse(text).data || []; }
  catch (e) { throw new Error('응답을 읽지 못했습니다: ' + text.slice(0, 300)); }
}

/* 표본추출이 걸리면 실제 수는 더 많다. _sample_interval을 더해야 진짜 수가 된다 */
const N = 'SUM(_sample_interval)';

const table = (rows, cols) => {
  if (!rows.length) return '     (없음)';
  const head = cols.map(c => c[0]);
  const body = rows.map(r => cols.map(c => String(c[1](r))));
  const w = head.map((h, i) =>
    Math.max(width(h), ...body.map(b => width(b[i]))));
  const pad = (v, i) => v + ' '.repeat(Math.max(0, w[i] - width(v)));
  const line = cells => '     ' + cells.map(pad).join('  ');
  return [line(head), '     ' + w.map(n => '─'.repeat(n)).join('  '),
          ...body.map(line)].join('\n');
};
/* 한글은 두 칸을 차지한다 — 안 세면 표가 어긋난다 */
const width = s => Array.from(String(s))
  .reduce((n, ch) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/.test(ch) ? 2 : 1), 0);

const EVENT_NAMES = {
  open: '열었다', add: '적었다', edit: '고쳤다', strike: '그었다(드래그)',
  strike2: '그었다(더블탭)', erase: '지웠다(지우개)', del: '지웠다(롱프레스)',
  del_sweep: '지웠다(훑기)', week: '주 이동', today: 'today', note: '요일 메모',
  split: '칸 나뉨', overflow: '칸 넘침', guide: '안내', account: '내 계정',
  backup: '백업', login: '로그인', save_fail: '저장 막힘',
};

const reports = [
  ['날마다', `SELECT toDate(timestamp) AS day, ${N} AS hits,
       COUNT(DISTINCT blob3) AS sessions, COUNT(DISTINCT blob2) AS devices
     FROM ${DATASET} WHERE ${since} GROUP BY day ORDER BY day DESC`,
    [['날짜', r => r.day], ['이벤트', r => r.hits], ['방문', r => r.sessions], ['기기', r => r.devices]]],

  ['무엇을 쓰나', `SELECT blob1 AS ev, ${N} AS hits, COUNT(DISTINCT blob2) AS devices
     FROM ${DATASET} WHERE ${since} GROUP BY ev ORDER BY hits DESC`,
    [['이벤트', r => EVENT_NAMES[r.ev] || r.ev], ['횟수', r => r.hits], ['쓴 기기', r => r.devices]]],

  ['다시 오나 (기기별 방문한 날 수)',
    `SELECT visits AS days_used, COUNT(*) AS devices FROM (
       SELECT blob2 AS did, COUNT(DISTINCT toDate(timestamp)) AS visits
       FROM ${DATASET} WHERE ${since} AND blob2 != '' GROUP BY did
     ) GROUP BY days_used ORDER BY days_used`,
    [['방문한 날', r => r.days_used + '일'], ['기기 수', r => r.devices]]],

  ['어떤 기기 · 어디서', `SELECT blob7 AS platform, blob6 AS country, ${N} AS hits,
       COUNT(DISTINCT blob2) AS devices
     FROM ${DATASET} WHERE ${since} GROUP BY platform, country ORDER BY hits DESC LIMIT 20`,
    [['갈래', r => r.platform], ['나라', r => r.country], ['이벤트', r => r.hits], ['기기', r => r.devices]]],

  ['홈 화면 앱인가 브라우저인가', `SELECT blob4 AS mode, ${N} AS opens,
       COUNT(DISTINCT blob2) AS devices
     FROM ${DATASET} WHERE ${since} AND blob1 = 'open' GROUP BY mode ORDER BY opens DESC`,
    [['어떻게 열었나', r => r.mode || '(모름)'], ['연 횟수', r => r.opens], ['기기', r => r.devices]]],

  ['화면 크기 — 26px 항목 높이를 판단할 근거',
    `SELECT double4 AS w, double5 AS h, ${N} AS hits, COUNT(DISTINCT blob2) AS devices
     FROM ${DATASET} WHERE ${since} AND blob1 = 'open' AND double4 > 0
     GROUP BY w, h ORDER BY hits DESC LIMIT 12`,
    [['가로', r => r.w], ['세로', r => r.h], ['횟수', r => r.hits], ['기기', r => r.devices]]],

  ['칸이 나뉘나 · 넘치나', `SELECT blob1 AS ev, double2 AS n, ${N} AS hits
     FROM ${DATASET} WHERE ${since} AND blob1 IN ('split', 'overflow')
     GROUP BY ev, n ORDER BY ev, n`,
    [['무엇', r => (r.ev === 'split' ? '나뉜 단 수' : '넘친 항목 수')],
     ['값', r => r.n], ['횟수', r => r.hits]]],

  ['긋기 — 얼마나 긋고 얼마나 지우나',
    `SELECT blob1 AS ev, ${N} AS hits, ROUND(AVG(double2)) AS avg_pct
     FROM ${DATASET} WHERE ${since} AND blob1 IN ('strike', 'strike2', 'erase')
     GROUP BY ev ORDER BY hits DESC`,
    [['이벤트', r => EVENT_NAMES[r.ev] || r.ev], ['횟수', r => r.hits],
     ['평균값', r => r.avg_pct]]],

  ['첫 안내 · 백업 · 로그인', `SELECT blob1 AS ev, blob4 AS d, ${N} AS hits,
       COUNT(DISTINCT blob2) AS devices
     FROM ${DATASET} WHERE ${since} AND blob1 IN ('guide', 'backup', 'login', 'account', 'save_fail')
     GROUP BY ev, d ORDER BY hits DESC`,
    [['이벤트', r => EVENT_NAMES[r.ev] || r.ev], ['무엇', r => r.d || '—'],
     ['횟수', r => r.hits], ['기기', r => r.devices]]],
];

const custom = flag('sql', null);
if (custom) {
  console.log(JSON.stringify(await sql(custom), null, 2));
  process.exit(0);
}

console.log(`\nClear Week 행동로그 — 최근 ${days}일` +
  (mine.length ? ` (내 기기 ${mine.length}개 제외)` : ''));

let failed = 0;
for (const [title, query, cols] of reports) {
  console.log(`\n── ${title} ──`);
  try {
    console.log(table(await sql(query), cols));
  } catch (e) {
    failed++;
    console.log('     읽지 못함: ' + e.message);
  }
}

if (failed === reports.length) {
  console.log(`\n하나도 읽지 못했습니다. 흔한 원인:
  · 대시보드에서 Analytics Engine 데이터셋(${DATASET})을 아직 안 묶었다
  · 토큰에 'Account Analytics: Read' 권한이 없다
  · 아직 아무도 안 들어와서 데이터셋이 만들어지지 않았다 (첫 이벤트가 만든다)
자세한 것은 SETUP.md.`);
}
console.log('');
