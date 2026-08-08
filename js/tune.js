// 표시값 다듬기: (1) 감정 보정 (2) 시간 평활
// 둘 다 "표시" 단계에서만 적용된다. 모델이 준 값 자체를 바꿔 저장하지는 않는다.

import { EXPR_KEYS, SHOWN_KEYS } from './config.js';

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
// 2026-08-08 실사용 후 2차 조정: 무표정·슬픔 더 내리고 행복 더 올림
export const CAL_WEIGHTS = {
  neutral:   0.24,   // 너무 압도적이라 크게 누름
  happy:     4.20,   // 웃어도 잘 안 올라가서 크게 올림
  sad:       0.34,   // 무표정일 때 같이 튀어서 누름
  angry:     1.70,   // 처음 3.0은 과했음 (안 화났는데 분노가 이김)
  surprised: 2.00,   // 입 벌릴 때 확실히 뜨도록
  // 아래 둘은 화면에서 뺐다(config.js HIDDEN_KEYS). 되살릴 때를 위해 값만 남겨둠
  fearful:   1.80,
  disgusted: 3.50,
};

export const CAL_LEVELS = {
  off:  { T: 1.0, g: 0.0, floor: 0.000 },   // 모델 출력 그대로
  low:  { T: 1.4, g: 0.6, floor: 0.025 },
  // floor를 조금 올린 이유: happy 가중치가 커져서, 안 웃고 있을 때의 0.5% 잡음까지
  // 증폭돼 행복이 항상 10%대로 떠 있는 걸 막기 위함
  mid:  { T: 1.8, g: 1.0, floor: 0.046 },
  // 강: happy 가중치가 커지면서 T=2.3·g=1.5는 가만히 있어도 행복이 이겨버렸다.
  // 온도와 가중치 지수를 낮추고 잡음 바닥을 올려 과장은 하되 뒤집히지는 않게 조정.
  high: { T: 2.1, g: 1.25, floor: 0.075 },
};

/** 표시하는 감정끼리 합이 1이 되게 다시 나눈다 (화면에서 뺀 감정의 몫을 나눠 가짐) */
function normalizeShown(out) {
  let sum = 0;
  for (const k of SHOWN_KEYS) sum += out[k];
  if (sum > 0) for (const k of SHOWN_KEYS) out[k] /= sum;
  return out;
}

export function calibrate(e, level) {
  const L = CAL_LEVELS[level] || CAL_LEVELS.off;
  const out = {};
  for (const k of EXPR_KEYS) out[k] = 0;   // 화면에서 뺀 감정은 0으로 남는다

  // 보정 끔: 모델 출력 그대로 쓰되, 표시하는 5종끼리만 다시 정규화
  if (L.T === 1 && L.g === 0) {
    for (const k of SHOWN_KEYS) out[k] = Math.max(0, e?.[k] ?? 0);
    return normalizeShown(out);
  }

  let sum = 0;
  for (const k of SHOWN_KEYS) {
    const p = Math.max(0, e?.[k] ?? 0);
    let v = Math.pow(p, 1 / L.T) - L.floor;
    if (v <= 0) continue;
    v *= Math.pow(CAL_WEIGHTS[k], L.g);
    out[k] = v; sum += v;
  }
  if (sum <= 0) {                       // 전부 잘려나간 예외 상황
    for (const k of SHOWN_KEYS) out[k] = Math.max(0, e?.[k] ?? 0);
    return normalizeShown(out);
  }
  for (const k of SHOWN_KEYS) out[k] /= sum;
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
