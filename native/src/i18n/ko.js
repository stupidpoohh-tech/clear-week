/*
 * 한국어. **말투는 제품의 일부다** — 격식 있는 경어체, 짧게, 다그치지 않는다.
 * 새 말을 넣을 때는 `en.js`에도 같은 열쇠를 넣는다 (`tests/i18n.mjs`가 본다).
 */
export default {
  /* 머리말 */
  'date.range': '{y}. {m1}.{d1}-{m2}.{d2}',
  'header.today': 'today',
  'header.note': 'note',

  /* 첫 실행 안내 (spec §4-4) */
  'guide.add': '빈 곳을 눌러 생성 (요일 아래, 요일 칸, 노트)',
  'guide.strike': '오른쪽으로 그어 완료. 왼쪽으로 되짚으면 지우기',
  'guide.delete': '꾹 누르면 삭제',
  'guide.sync': '로그인하면 기기간 연동할 수 있습니다',
  'guide.never': '다시 보지 않기',
  'guide.close': '닫기',

  /* 되돌리기 (P1-2) */
  'undo.item': '지웠습니다',
  'undo.note': '메모를 지웠습니다',
  'undo.action': '되돌리기',

  /* 잘린 것 보기 (P1-2) */
  'overflow.title': '{label} · 안 보이던 것',
  'overflow.hint': '눌러서 고치고, 꾹 눌러 지웁니다',
  'overflow.close': '닫기',

  /* 내 계정 */
  'account.title': '내 계정',
  'account.sync': '이어져 있습니다',
  'account.offline': '연결 안 됨',
  'account.logout': '로그아웃',
  'account.login': '로그인 / 가입',
  'account.loginHint': '로그인하면 폰·PC·캘린더가 함께 맞춰집니다. 없는 계정이면 만들어 둡니다.',
  'account.email': '이메일',
  'account.password': '비밀번호',
  'backup.added': '{n}주를 가져왔습니다 · 있던 주는 그대로입니다',
  'backup.none': '새로 가져올 주가 없습니다',
  'account.backup': '백업',
  'account.export': '내보내기',
  'account.import': '가져오기',
  'account.importNote': '가져오기는 덮어쓰지 않습니다 — 지금 없는 주만 채웁니다.',
  'account.guide': '쓰는 법',
  'account.wipe': '전부 비우기',
  'account.wipeArmed': '정말 비웁니다 — 한 번 더',
  'account.language': '말',
  'account.made': 'Clear Week — 종이 주간 플래너를 그대로',

  /* 메일 인증 (P0-1 · P1-1) */
  'verify.waiting': '인증 메일을 확인해 주세요 · 그전까지 이 기기에만 저장됩니다',
  'verify.sent': '인증 메일을 보냈습니다 · 메일의 링크를 누른 뒤 [인증 확인]',
  'verify.resent': '인증 메일을 다시 보냈습니다',
  'verify.tooSoon': '조금 전에 보냈습니다 · {sec}초 뒤에 다시 보낼 수 있습니다',
  'verify.notYet': '아직 인증 전입니다 · 메일의 링크를 누른 뒤 다시 눌러 주세요',
  'verify.check': '인증 확인',
  'verify.resend': '메일 다시 보내기',
  'verify.checking': '확인하는 중…',
  'verify.failed': '확인하지 못했습니다 · 잠시 뒤에 다시',
  'verify.mailFailed': '인증 메일을 보내지 못했습니다 · 잠시 뒤에 다시',

  /* 구매 (P1-4) */
  'buy.title': '평생 소장',
  'buy.locked': '기기간 연동은 구매한 뒤에 열립니다',
  'buy.owned': '구매하셨습니다 · 고맙습니다',
  'buy.action': '{price}에 구매',
  'buy.actionPlain': '구매',
  'buy.restore': '구매 복원',
  'buy.restored': '구매를 되살렸습니다',
  'buy.nothing': '되살릴 구매가 없습니다',
  'buy.canceled': '구매를 그만두었습니다',
  'buy.failed': '구매하지 못했습니다 · 잠시 뒤에 다시',
  'buy.unavailable': '지금은 스토어에 닿지 못합니다',
  'buy.already': '이미 구매하신 계정입니다',
  'buy.once': '한 번만 내면 됩니다. 구독이 아닙니다.',

  /* 계정 삭제 (P1-5) */
  'gone.title': '계정 삭제',
  'gone.what': '계정과 서버에 올린 주가 지워집니다. 이 기기의 기록은 남습니다.',
  'gone.alsoLocal': '이 기기의 기록도 함께 지우기',
  'gone.action': '계정 삭제',
  'gone.armed': '정말 지웁니다 — 한 번 더',
  'gone.done': '계정을 지웠습니다',
  'gone.failed': '지우지 못했습니다 · 다시 로그인한 뒤에 해 주세요',

  /* 알림 */
  'notice.storage': '저장이 막혀 있습니다 — 이 기기에 남지 않습니다',
  'notice.linkAsk': '이 기기와 서버 양쪽에 적은 것이 있습니다. 어떻게 할까요.',
  'notice.linkTitle': '기기를 잇습니다',
  'notice.linkMerge': '합치기',
  'notice.linkMine': '이 기기',
  'notice.linkServer': '서버',

  /* 오류 */
  'err.network': '연결되지 않습니다',
  'err.exists': '이미 있는 계정입니다 — 비밀번호를 확인해 주세요',
  'err.password': '비밀번호가 맞지 않습니다',
  'err.weak': '비밀번호는 여섯 자 이상이어야 합니다',
  'err.email': '이메일 모양이 아닙니다',
  'err.again': '다시 로그인해 주세요',
  'err.unknown': '되지 않았습니다',
};
