// 얼굴을 따라다니는 얇은 네모 박스
// 추론은 10Hz지만 그리기는 매 프레임(rAF) 보간해서 부드럽게 움직인다.

const TAU_POS = 70;   // 위치가 목표에 수렴하는 속도(ms). 작을수록 민감
const TAU_A   = 110;  // 나타나고 사라지는 속도(ms)

export class BoxOverlay {
  constructor(canvas, videoEl, container) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.video = videoEl;
    this.container = container;

    this.onBox = null;                        // 매 프레임 박스 위치를 알려주는 콜백
    this.target = null;                       // 정규화 박스 {x,y,w,h}
    this.cur = { x:0, y:0, w:0, h:0, a:0 };   // 화면 좌표 + 알파
    this.cw = 0; this.ch = 0;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.raf = null;
    this.last = 0;

    this.color = (getComputedStyle(document.documentElement)
      .getPropertyValue('--accent') || '#ffb020').trim();

    this._resize();
    this.ro = new ResizeObserver(() => this._resize());
    this.ro.observe(container);
  }

  _resize() {
    const r = this.container.getBoundingClientRect();
    this.cw = r.width; this.ch = r.height;
    const w = Math.max(1, Math.round(r.width * this.dpr));
    const h = Math.max(1, Math.round(r.height * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
  }

  setTarget(box) { this.target = box; }

  /** 정규화 좌표 → 화면 좌표. object-fit(cover/contain) 크롭을 그대로 계산해준다 */
  _map(nb) {
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    if (!vw || !vh || !this.cw || !this.ch) return null;
    const fit = document.body.dataset.fit === 'contain' ? 'contain' : 'cover';
    const s = fit === 'contain'
      ? Math.min(this.cw / vw, this.ch / vh)
      : Math.max(this.cw / vw, this.ch / vh);
    const dw = vw * s, dh = vh * s;
    const ox = (this.cw - dw) / 2, oy = (this.ch - dh) / 2;
    return { x: ox + nb.x * dw, y: oy + nb.y * dh, w: nb.w * dw, h: nb.h * dh };
  }

  start() {
    if (this.raf) return;
    this.last = performance.now();
    const tick = (now) => {
      const dt = Math.min(100, now - this.last);
      this.last = now;
      this._update(dt);
      this._draw();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  _update(dt) {
    // 지수 감쇠 보간: 프레임 간격이 들쭉날쭉해도 체감 속도가 일정하다
    const kp = 1 - Math.exp(-dt / TAU_POS);
    const ka = 1 - Math.exp(-dt / TAU_A);
    const c = this.cur;

    if (this.target) {
      const m = this._map(this.target);
      if (m) {
        if (c.a < 0.02) {              // 처음 나타날 땐 미끄러져 오지 않고 제자리에서 뜬다
          c.x = m.x; c.y = m.y; c.w = m.w; c.h = m.h;
        } else {
          c.x += (m.x - c.x) * kp;
          c.y += (m.y - c.y) * kp;
          c.w += (m.w - c.w) * kp;
          c.h += (m.h - c.h) * kp;
        }
        c.a += (1 - c.a) * ka;
      }
    } else {
      c.a += (0 - c.a) * ka;
    }
  }

  _draw() {
    const ctx = this.ctx, c = this.cur;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cw, this.ch);

    const visible = c.a >= 0.01 && c.w > 0;
    if (visible) {
      ctx.globalAlpha = c.a;
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 1.5;
      // 0.5px 보정으로 선이 흐려지지 않게
      ctx.strokeRect(Math.round(c.x) + .5, Math.round(c.y) + .5, Math.round(c.w), Math.round(c.h));
      ctx.globalAlpha = 1;
    }

    // 얼굴 옆 패널이 따라올 수 있게 박스 위치를 넘겨준다.
    // 캔버스가 CSS로 좌우 반전돼 있으므로 화면에 실제로 보이는 x는 뒤집어서 계산한다.
    if (this.onBox) {
      this.onBox(visible ? {
        left: this.cw - (c.x + c.w),
        right: this.cw - c.x,
        top: c.y, height: c.h, alpha: c.a,
        cw: this.cw, ch: this.ch,
      } : null);
    }
  }
}
