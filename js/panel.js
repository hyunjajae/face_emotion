// 감정 수치 패널 (7줄 게이지 + 상태줄)

import { SHOWN_KEYS, LABELS, STATE_TEXT } from './config.js';

// 최고값 강조가 두 감정 사이에서 깜빡이지 않도록, 이만큼 앞서야 자리를 넘겨준다
const TOP_MARGIN = 0.03;

const CAL_TEXT = {
  ko: { off:'보정 끔', low:'보정 약', mid:'보정 중', high:'보정 강' },
  en: { off:'cal off', low:'cal low', mid:'cal mid', high:'cal high' },
};

export class Panel {
  constructor(rowsEl, statusEl) {
    this.rowsEl = rowsEl;
    this.statusEl = statusEl;
    this.lang = 'ko';
    this.state = 'boot';
    this.cal = 'mid';
    this.topKey = null;
    this.rows = {};

    this.el = {
      dot: statusEl.querySelector('#stDot'),
      state: statusEl.querySelector('#stState'),
      hz: statusEl.querySelector('#stHz'),
      ms: statusEl.querySelector('#stMs'),
      back: statusEl.querySelector('#stBack'),
      cal: statusEl.querySelector('#stCal'),
    };

    this._build();
  }

  _build() {
    this.rowsEl.innerHTML = '';
    for (const k of SHOWN_KEYS) {
      const li = document.createElement('li');
      li.className = 'row';
      li.dataset.k = k;
      li.innerHTML =
        `<span class="lab"></span>` +
        `<span class="bar"><i class="fill"></i></span>` +
        `<span class="val">00.00</span><span class="pct">%</span>`;
      this.rowsEl.appendChild(li);
      this.rows[k] = { li, lab: li.querySelector('.lab'), fill: li.querySelector('.fill'), val: li.querySelector('.val') };
    }
    this.setLang(this.lang);
  }

  setLang(lang) {
    this.lang = lang === 'en' ? 'en' : 'ko';
    for (const k of SHOWN_KEYS) this.rows[k].lab.textContent = LABELS[this.lang][k];
    this._paintState();
    this._paintCal();
  }

  /** values: 0~1 값 7개 / hasFace: 얼굴이 잡히고 있는지 */
  update(values, hasFace) {
    const top = hasFace && values ? this._pickTop(values) : null;
    if (!hasFace) this.topKey = null;

    for (const k of SHOWN_KEYS) {
      const r = this.rows[k];
      const pct = Math.max(0, Math.min(100, (values?.[k] ?? 0) * 100));
      r.fill.style.width = pct.toFixed(3) + '%';
      // 소수 2자리 + 앞자리 0 채움 → 값이 변해도 자릿수가 흔들리지 않는다
      r.val.textContent = pct.toFixed(2).padStart(5, '0');
      r.li.classList.toggle('top', k === top);
    }
  }

  /** 최고값이 두 감정 사이에서 왔다갔다하는 걸 막는 히스테리시스 */
  _pickTop(v) {
    let best = null, bv = -1;
    for (const k of SHOWN_KEYS) {
      const x = v[k] ?? 0;
      if (x > bv) { bv = x; best = k; }
    }
    if (!this.topKey || !(this.topKey in v)) { this.topKey = best; return best; }
    const cur = v[this.topKey] ?? 0;
    if (best !== this.topKey && bv > cur + TOP_MARGIN) this.topKey = best;
    return this.topKey;
  }

  setState(state) {
    if (this.state === state) return;   // 같은 상태면 DOM을 건드리지 않는다
    this.state = state;
    this._paintState();
  }

  setCal(level) {
    this.cal = level;
    this._paintCal();
  }

  _paintState() {
    this.el.state.textContent = STATE_TEXT[this.lang][this.state] || this.state;
    this.statusEl.classList.toggle('live', this.state === 'live');
  }

  _paintCal() {
    this.el.cal.textContent = CAL_TEXT[this.lang][this.cal] || this.cal;
  }

  setMeters({ hz, ms, backend }) {
    if (hz != null) this.el.hz.textContent = hz.toFixed(1) + ' hz';
    if (ms != null) this.el.ms.textContent = Math.round(ms) + ' ms';
    if (backend != null) this.el.back.textContent = backend;
  }
}
