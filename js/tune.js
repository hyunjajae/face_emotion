// 표시값 다듬기: (1) 감정 보정 (2) 시간 평활
// 둘 다 "표시" 단계에서만 적용된다. 모델이 준 값 자체를 바꿔 저장하지는 않는다.

import { EXPR_KEYS } from './config.js';

/* ─────────────────────────────────────────────
   1) 감정 보정
   face-api의 표정 모델(FER-2013 계열)은 실사용에서 neutral과 sad로 쏠린다.
   happy·angry·disgusted는 표정을 크게 지어도 확률이 잘 안 올라간다.
   그래서 두 단계로 편향을 편다.
     ① 온도 T: p^(1/T) → 한 감정이 99%를 독식하는 걸 완화 (표준적인 temperature scaling)
     ② 클래스 가중치: 잘 안 나오는 감정에 이득을 주고 쏠리는 감정을 누른다
   ①에서 같이 커져버린 잡음(0.1% 수준)은 floor로 잘라내고, 마지막에 합이 100%가 되게 정규화한다.
   → 순위와 반응 방향은 모델 판정 그대로이고, 눈금의 축척만 바뀌는 셈이다.
   ───────────────────────────────────────────── */
// 2026-08-08 실사용 후 조정: 무표정·분노 더 내리고, 행복·놀람 더 올림
export const CAL_WEIGHTS = {
  neutral:   0.35,   // 너무 압도적이라 크게 누름
  happy:     3.40,   // 웃어도 잘 안 올라가서 크게 올림
  sad:       0.55,   // 무표정일 때 같이 튀어서 누름
  angry:     1.70,   // 처음 3.0은 과했음 (안 화났는데 분노가 이김)
  fearful:   1.80,
  disgusted: 3.50,   // 가장 잘 안 나옴
  surprised: 2.00,   // 입 벌릴 때 확실히 뜨도록
};

export const CAL_LEVELS = {
  off:  { T: 1.0, g: 0.0, floor: 0.000 },   // 모델 출력 그대로
  low:  { T: 1.4, g: 0.6, floor: 0.025 },
  mid:  { T: 1.8, g: 1.0, floor: 0.042 },
  high: { T: 2.3, g: 1.5, floor: 0.055 },
};

export function calibrate(e, level) {
  const L = CAL_LEVELS[level] || CAL_LEVELS.off;
  const out = {};
  if (L.T === 1 && L.g === 0) {
    for (const k of EXPR_KEYS) out[k] = e?.[k] ?? 0;
    return out;
  }
  let sum = 0;
  for (const k of EXPR_KEYS) {
    const p = Math.max(0, e?.[k] ?? 0);
    let v = Math.pow(p, 1 / L.T) - L.floor;
    if (v <= 0) { out[k] = 0; continue; }
    v *= Math.pow(CAL_WEIGHTS[k], L.g);
    out[k] = v; sum += v;
  }
  if (sum <= 0) {                       // 전부 잘려나간 예외 상황
    for (const k of EXPR_KEYS) out[k] = e?.[k] ?? 0;
    return out;
  }
  for (const k of EXPR_KEYS) out[k] /= sum;
  return out;
}

/* ─────────────────────────────────────────────
   2) 시간 평활 (지수이동평균)
   추론은 계속 10Hz로 돌지만, 화면에 뜨는 수치는 tau 시간 상수로 천천히 따라간다.
   tau가 클수록 값이 진득하게 움직이고, 순간적으로 튄 판정은 무시된다.
   refresh는 화면을 다시 그리는 간격(숫자가 초당 몇 번 바뀌는지).
   ───────────────────────────────────────────── */
export const SMOOTH_LEVELS = {
  off:   { tau: 0,    refresh: 100 },
  mid:   { tau: 600,  refresh: 160 },
  slow:  { tau: 1300, refresh: 260 },
  vslow: { tau: 2600, refresh: 420 },
};

export function zeros() {
  const z = {};
  for (const k of EXPR_KEYS) z[k] = 0;
  return z;
}

export class Smoother {
  constructor(tau = 0) { this.tau = tau; this.v = null; }

  setTau(tau) {
    this.tau = tau;
    if (tau <= 0) this.v = null;
  }

  /** dtMs = 직전 호출로부터 지난 시간. 프레임 간격이 흔들려도 속도가 일정하게 유지된다 */
  push(vals, dtMs) {
    if (this.tau <= 0 || !this.v) { this.v = { ...vals }; return this.v; }
    const k = 1 - Math.exp(-Math.min(dtMs, 1000) / this.tau);
    for (const key of EXPR_KEYS) {
      const t = vals[key] ?? 0;
      this.v[key] += (t - this.v[key]) * k;
    }
    return this.v;
  }

  get() { return this.v; }
  reset() { this.v = null; }
}
