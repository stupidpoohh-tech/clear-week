/** @type {import('@bacons/apple-targets').Config} */
module.exports = {
  type: 'widget',
  name: 'Clear Week',
  /* 위젯의 번들 ID. 점으로 시작하면 앱 번들 ID 뒤에 붙는다 →
     `dev.clearweek.app.widget`. **애플 개발자 계정에서 App Group을 붙일 때
     이 ID로 찾는다** — 자동으로 정해지게 두면 나중에 무엇이었는지 헷갈린다 */
  bundleIdentifier: '.widget',
  /* **앱과 위젯이 만나는 자리는 이 그룹 하나뿐이다.** 위젯은 Swift라
     JS가 닿지 않는다 — 앱이 여기에 적어 두면 위젯이 읽는다 (HANDOFF §11) */
  entitlements: {
    'com.apple.security.application-groups': ['group.dev.clearweek'],
  },
};
