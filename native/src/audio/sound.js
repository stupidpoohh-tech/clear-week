/*
 * 소리 — 사각사각과 타자 톡.
 *
 * **기기 무음은 무시한다** (`playsInSilentMode`). iOS는 무음이면 소리를 막는데,
 * 그러면 왜 안 나는지 알 길이 없다 — 아이패드는 물리 스위치도 없다.
 * 대신 **끌 손잡이를 머리말에 내놓았다**(스피커).
 * **무시할 권리는 끌 자리를 준 다음에 생긴다** (HANDOFF §4-3).
 *
 * **끌 때는 재생 갈래도 놓아 준다.** 끄고도 오디오 세션을 붙들고 있으면
 * 소리는 안 나는데 남의 앱 소리를 계속 가로챈다 (HANDOFF §4-5).
 * 켜 있을 때도 `mixWithOthers`라 남의 음악을 멈추지 않는다.
 *
 * 음량 곡선은 웹과 같다. 두 파일의 상대 음량은 구울 때 이미 갈라 놓았다
 * (`tools/make-sounds.mjs`) — 여기서는 0~1만 다룬다.
 */
import { createAudioPlayer, setAudioModeAsync, setIsAudioActiveAsync } from 'expo-audio';
import { SOUND } from '../core/constants.js';

let scratch = null, key = null;
let on = true, ready = false;
let target = 0, level = 0, ramp = null;

async function activate() {
  await setAudioModeAsync({
    playsInSilentMode: SOUND.playsInSilentMode,
    shouldPlayInBackground: false,
    interruptionMode: 'mixWithOthers',
  });
  await setIsAudioActiveAsync(true);
}

/* 첫 손짓 전에 미리 깨워 둔다. 긋기를 시작할 때 처음 깨우면
   **그 첫 획이 통째로 조용하다** (spec §4-5) */
export async function prepare(enabled) {
  on = enabled;
  if (!ready) {
    scratch = createAudioPlayer(require('../../assets/scratch.wav'));
    scratch.loop = true;
    scratch.volume = 0;
    key = createAudioPlayer(require('../../assets/key.wav'));
    ready = true;
  }
  if (on) await activate();
  else await setIsAudioActiveAsync(false);
}

export async function setEnabled(v) {
  on = v;
  if (!ready) return;
  if (!on) {
    stopScratch();
    /* 갈래를 놓아 준다 — 안 그러면 조용한 채로 남의 소리를 붙든다 */
    await setIsAudioActiveAsync(false);
  } else {
    await activate();
  }
}

export const isEnabled = () => on;

/* 앱이 뒤에서 돌아왔을 때. 사파리의 `interrupted`를 깨우던 자리와 같은 일 */
export function resume() {
  if (on && ready) activate().catch(() => {});
}

/* ── 사각사각 — 긋는 동안 속도를 따라 커졌다 작아진다 ────────── */

export function scratchAt(speed) {
  if (!on || !ready) return;
  const s = Math.min(1, Math.max(0, speed / SOUND.speedRef));
  target = SOUND.floor + (1 - SOUND.floor) * s;
  if (!ramp) {
    try { scratch.play(); } catch (e) {}
    ramp = setInterval(tick, 16);
  }
}

export function stopScratch() {
  target = 0;
  if (!ramp && ready) { try { scratch.pause(); } catch (e) {} }
}

/* attack/release는 웹의 그것과 같은 시간 상수다. expo-audio에는 램프가 없어
   16ms마다 손으로 민다 — 긋는 동안 이 일은 소리 쪽에서만 돈다 */
function tick() {
  const ms = 16;
  const rate = target > level ? ms / SOUND.attackMs : ms / SOUND.releaseMs;
  level += (target - level) * Math.min(1, rate);
  if (ready) { try { scratch.volume = Math.max(0, Math.min(1, level)); } catch (e) {} }
  if (target === 0 && level < 0.01) {
    clearInterval(ramp); ramp = null; level = 0;
    if (ready) { try { scratch.pause(); scratch.seekTo(0); } catch (e) {} }
  }
}

/* ── 타자 톡 — 글자가 실제로 바뀔 때만. 방향키에는 울지 않는다 ── */
export function tap() {
  if (!on || !ready) return;
  try { key.seekTo(0); key.play(); } catch (e) {}
}
