/*
 * Clear Week — 튜닝 손잡이
 *
 * 손과 귀로 맞춘 값들이다 (HANDOFF §6). 웹에서 실기기로 확인된 것은 ★로 적었다.
 * **여기 말고 다른 곳에 숫자를 흩지 않는다** — 손맛을 고치려면 이 파일만 연다.
 *
 * 단위: RN의 dp. 웹의 CSS px와 거의 같으므로 웹 값이 그대로 온다.
 * 웹이 pt로 적어 둔 것(9.5pt)은 ×4/3 해서 dp로 옮겼다.
 */

/* ── 획 ─────────────────────────────────────────────────────── */
export const STROKE = {
  noiseAmplitude: 0.4,    // 흔들림 진폭(dp). 0이면 완전 직선
  noiseFrequency: 0.012,  // 흔들림 주기(1/dp)
  widthMin: 1.6,          // 빠르게 그을 때
  widthMax: 3.2,          // 천천히 그을 때
  taperLen: 8,            // 양끝이 얇아지는 구간
  tiltMax: 0.015,         // 획 전체의 무작위 기울기
  followY: 0.15,          // 손가락 상하 움직임 반영 비율
  speedRef: 1.4,          // 이 속도(dp/ms)에서 widthMin
  widthNoise: 0.05,
  widthNoiseFreq: 0.08,
  stepPx: 3,              // 점 사이 간격(dp). 촘촘할수록 매끈하지만 무겁다

  commitRatio: 0.6,       // 줄 폭 대비 이만큼 지나가야 확정
  slopPx: 8,              // 긋기 vs 세로 판정
  tapPadPx: 10,           // 글자 오른쪽 이만큼까지는 아직 '항목 위'
  doubleTapMs: 260,
  longPressMs: 500,

  overshoot: 2,           // 자동 획이 글자 밖으로 삐져나가는 양
  autoStrokeMs: 220,
  autoStagger: 70,
  rewindMs: 200,          // 미달 시 되감기
};

/* ── 지우개 ─────────────────────────────────────────────────── */
export const ERASE = {
  radius: 16,
  reachPx: 14,            // 줄 위아래 이만큼까지 그 줄로 친다
  passStrength: 0.55,     // 한 번 지나갈 때 지워지는 정도
  doneThreshold: 0.85,
  finishRatio: 0.7,       // 손 뗄 때 이 이상이면 마저 지운다
  bucketPx: 8,
};

/* ── 소리 ★ (2026-08-21 실기기 확인) ───────────────────────────
   **두 음량은 같은 눈금이 아니다.** 사각사각은 이어지는 소리라 적힌 만큼
   들리지만, 톡은 26ms 한 순간이라 귀가 훨씬 작게 듣는다. keyVolume이 1을
   넘는 것은 오타가 아니다 (HANDOFF §4-4).
   웹은 Web Audio로 그때그때 만들었지만 네이티브에는 그 합성기가 없다 —
   `tools/make-sounds.mjs`가 **이 값들로** wav를 굽는다. 값을 고치면 다시 굽는다. */
export const SOUND = {
  volume: 0.20,           // 사각사각 최대 음량
  bandHz: 1900,           // 사각거림의 중심 주파수
  bandQ: 0.9,
  speedRef: 1.0,          // 이 속도(dp/ms)에서 음량 최대
  floor: 0.25,            // 아주 느리게 그어도 유지되는 최소 비율
  attackMs: 10,
  releaseMs: 80,
  loopMs: 1400,           // 구워 둘 사각사각 길이. 이어 붙여 돌린다

  keyVolume: 1.4,         // 순간값 — 4-4 참고
  keyHz: 2400,
  keyQ: 1.2,
  keyMs: 26,

  /* 기기 무음을 무시한다. **무시할 권리는 끌 자리를 준 다음에 생긴다** —
     머리말의 스피커가 그 자리다 (HANDOFF §4-3). */
  playsInSilentMode: true,
};

/* ── 칸 나누기 ──────────────────────────────────────────────── */
export const SPLIT = {
  maxColumns: 3,
  scales: [1, 0.84, 0.72],  // 1단 / 2단 / 3단일 때의 글씨 배율
  gap: 16,                  // 열 간격. **세로선이 없으므로 여백이 경계다**
};

/* ── 펜 판 (HANDOFF §4-1) ───────────────────────────────────── */
export const PAD = {
  fontPx: 26,     // 이만큼은 돼야 팔이 펴진다
  guardMs: 400,   // 손가락이 누른 직후의 포커스는 손가락 것
  minRoom: 22,    // 빈 자리가 이보다 좁으면 판을 두지 않는다
};

/* ── 당겨서 새로고침 ────────────────────────────────────────── */
export const PULL = {
  distance: 72,
  slopPx: 10,
};

/* ── 색 — 주간 표는 단색이다. 색은 안내 카드에서만 쓴다 ──────── */
export const COLOR = {
  paper: '#ffffff',
  ink: '#1d2b50',
  inkFaint: '#9a9eab',
  rule: '#dedede',
  stroke: '#26356b',      // 취소선 잉크
  guide: ['#f08a24', '#00b06a', '#e0453a', '#2870ff'],  // 안내 카드에서만
};

/* ── 크기 ───────────────────────────────────────────────────── */
export const SIZE = {
  itemFont: 12.7,     // 9.5pt
  sublabelFont: 8.7,  // 6.5pt 세미볼드
  itemHeight: 26,     // **미검증** — 초안은 "긋기를 위해 44 양보 불가"였다
  labelW: 38,
  freeWidth: 0.28,    // note 칸이 가로에서 차지하는 비율
  headerH: 44,
};
