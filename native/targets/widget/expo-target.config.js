/** @type {import('@bacons/apple-targets').Config} */
module.exports = {
  type: 'widget',
  name: 'Clear Week',
  /* **앱과 위젯이 만나는 자리는 이 그룹 하나뿐이다.** 위젯은 Swift라
     JS가 닿지 않는다 — 앱이 여기에 적어 두면 위젯이 읽는다 (HANDOFF §11) */
  entitlements: {
    'com.apple.security.application-groups': ['group.dev.clearweek'],
  },
};
