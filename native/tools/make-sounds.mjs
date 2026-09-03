/*
 * 소리를 굽는다 — `node tools/make-sounds.mjs`
 *
 * 웹은 Web Audio로 그때그때 만들었다(잡음 → 밴드패스). 네이티브에는 그
 * 합성기가 없으므로 **같은 방법으로 미리 구워 파일로 둔다.**
 * 값을 고쳤으면 다시 구울 것 — 손잡이는 `src/core/constants.js`의 SOUND 하나다.
 *
 * **두 파일의 음량은 여기서 이미 갈라 놓았다.** expo-audio의 volume은 0~1이라
 * 웹의 keyVolume 1.4를 그대로 줄 수 없다. 그래서 둘 다 1.4로 나눠 굽는다 —
 * 톡은 꽉 차게(1.0), 사각사각은 0.20/1.4 = 0.143으로. **귀에 들리는 비율은
 * 웹과 같다** (HANDOFF §4-4의 −4.5 dB).
 */
import { writeFileSync } from 'node:fs';
import { SOUND } from '../src/core/constants.js';

const FS = 44100;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* RBJ 밴드패스 — 웹의 BiquadFilterNode('bandpass')와 같은 식이다 */
function bandpass(input, f0, Q) {
  const w0 = (2 * Math.PI * f0) / FS;
  const alpha = Math.sin(w0) / (2 * Q);
  const b0 = alpha, b1 = 0, b2 = -alpha;
  const a0 = 1 + alpha, a1 = -2 * Math.cos(w0), a2 = 1 - alpha;
  const out = new Float64Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    out[i] = y0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
  }
  return out;
}

const noise = (n, seed) => {
  const r = rng(seed);
  const a = new Float64Array(n);
  for (let i = 0; i < n; i++) a[i] = r() * 2 - 1;
  return a;
};

function normalize(a, peak) {
  let m = 0;
  for (const v of a) m = Math.max(m, Math.abs(v));
  if (!m) return a;
  for (let i = 0; i < a.length; i++) a[i] = (a[i] / m) * peak;
  return a;
}

function wav(samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(FS, 24); buf.writeUInt32LE(FS * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

const SCALE = SOUND.keyVolume;      /* 둘을 이 값으로 나눈다 — 위 설명 참고 */

/* ── 사각사각 — 이어 돌릴 수 있게 끝과 앞을 겹쳐 준다 ────────── */
{
  const n = Math.round((SOUND.loopMs / 1000) * FS);
  const fade = Math.round(0.05 * FS);                 /* 이음매를 덮는 50ms */
  const raw = bandpass(noise(n + fade, 20260824), SOUND.bandHz, SOUND.bandQ);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = raw[i];
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    out[i] = out[i] * t + raw[n + i] * (1 - t);       /* 넘어가는 자리를 섞는다 */
  }
  normalize(out, SOUND.volume / SCALE);
  writeFileSync(new URL('../assets/scratch.wav', import.meta.url), wav(out));
  console.log(`scratch.wav  ${SOUND.loopMs}ms  ${SOUND.bandHz}Hz Q${SOUND.bandQ}` +
    `  peak ${(SOUND.volume / SCALE).toFixed(3)}`);
}

/* ── 타자 톡 — 26ms. 늘리면 톡이 아니라 쉭이 된다 ─────────────── */
{
  const n = Math.round((SOUND.keyMs / 1000) * FS);
  const raw = bandpass(noise(n, 8241), SOUND.keyHz, SOUND.keyQ);
  const out = new Float64Array(n);
  const attack = Math.round(0.001 * FS);
  for (let i = 0; i < n; i++) {
    const a = i < attack ? i / attack : 1;
    out[i] = raw[i] * a * Math.exp((-4.5 * i) / n);   /* 톡 — 빠르게 붙고 빠르게 진다 */
  }
  normalize(out, 1);
  writeFileSync(new URL('../assets/key.wav', import.meta.url), wav(out));
  console.log(`key.wav      ${SOUND.keyMs}ms  ${SOUND.keyHz}Hz Q${SOUND.keyQ}  peak 1.000`);
}
