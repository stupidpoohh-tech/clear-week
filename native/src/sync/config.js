/*
 * 서버·계정 설정.
 *
 * **로그인은 검증 도구다** (spec §11). 최종 형태에서는 iCloud가 계정 없이
 * 맞춰 주므로 통째로 사라질 자리다 — 그래서 뿌리를 깊게 내리지 않았다.
 * **로그아웃 상태의 앱은 서버를 전혀 건드리지 않는다.**
 * 지금 Firebase를 그대로 쓰는 이유는 하나다: 캘린더(Dada Calendar)와
 * **같은 계정**이라 연동이 딸려 온다 (HANDOFF §8).
 *
 * 두 값은 공개돼도 되는 것이다. 실제 보안 경계는 캘린더 쪽 firestore.rules다.
 * **비어 있으면 로그인 자체가 나타나지 않는다** (spec §13).
 */
export const FIREBASE = {
  apiKey: 'AIzaSyDwcPMMGmYFjFqcb-3yJcbYeMhJgLGXz84',
  projectId: 'dada-calendar-524ec',
};

/* 웹과 같은 서버를 본다. 주는 `week:<email>:<weekId>`에 담긴다 */
export const SERVER = 'https://clear-week.pages.dev';

export const SYNC = {
  tokenTtlMs: 45 * 60 * 1000,   // idToken은 한 시간짜리다. 넉넉히 앞서 갱신한다
  pushDelayMs: 900,             // 손이 멎고 이만큼 뒤에 올린다
  pollMs: 30000,
};

export const CAL = {
  kind: 'task',        // 할 일만 받아 온다. 아이디어·가계부까지 들이면 표가 무너진다
  pullDelayMs: 1200,   // 주를 옮기고 이만큼 쉬었다 받아 온다
};

export const configured = () => !!(FIREBASE.apiKey && FIREBASE.projectId);
