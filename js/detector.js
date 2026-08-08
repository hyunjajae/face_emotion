// 얼굴 감지 + 표정 추론 루프
// 핵심: setInterval을 쓰지 않는다. 추론이 간격보다 오래 걸리면 콜백이 밀려 쌓이기 때문.
// 대신 "한 번 끝나면 다음을 예약"하는 방식이라 절대 겹치지 않는다.

import { DET_WIDTH, SCORE_THRESHOLD, MODEL_URI } from './config.js';

const faceapi = window.faceapi;

export class Detector {
  constructor({ onResult, onStatus }) {
    this.onResult = onResult;   // ({expressions, box, ms}) 또는 null
    this.onStatus = onStatus;   // (state, info)
    this.hz = 10;
    this.inputSize = 224;
    this.running = false;
    this.timer = null;
    this.video = null;
    this.emaMs = 0;
    this.errCount = 0;
    this.backend = '--';

    // 추론용 축소 캔버스 (매번 새로 만들지 않고 재사용)
    this.cv = document.createElement('canvas');
    this.cx = this.cv.getContext('2d', { willReadFrequently: false });
    this._makeOptions();
  }

  _makeOptions() {
    this.opts = new faceapi.TinyFaceDetectorOptions({
      inputSize: this.inputSize,
      scoreThreshold: SCORE_THRESHOLD,
    });
  }

  setHz(hz) { this.hz = Number(hz) || 10; }

  setInputSize(n) {
    this.inputSize = Number(n) || 224;
    this._makeOptions();
  }

  /** 모델 두 개를 받고, 첫 추론이 느린 문제를 없애기 위해 예열까지 한다 */
  async load() {
    this.onStatus('loading');
    await faceapi.tf.ready();
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URI),
      faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URI),
    ]);
    this.backend = faceapi.tf.getBackend?.() || '--';

    // 예열: 첫 추론은 GPU 셰이더 컴파일 때문에 2초 넘게 걸린다.
    // 미리 회색 캔버스로 한 번 돌려두면 실제 첫 얼굴에서 화면이 멈추지 않는다.
    this.onStatus('warmup', { backend: this.backend });
    const warm = document.createElement('canvas');
    warm.width = 224; warm.height = 224;
    const wx = warm.getContext('2d');
    wx.fillStyle = '#808080'; wx.fillRect(0, 0, 224, 224);
    try {
      await faceapi.detectSingleFace(warm, this.opts);
      await faceapi.nets.faceExpressionNet.predictExpressions(warm);
    } catch { /* 예열 실패는 치명적이지 않음 */ }
  }

  start(video) {
    this.video = video;
    if (this.running) return;
    this.running = true;
    this.errCount = 0;
    this._step();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = null;
  }

  async _step() {
    if (!this.running) return;

    // 탭이 숨겨지면 브라우저가 GPU를 초당 1회로 조여서 측정값이 무의미해진다. 그냥 쉰다.
    if (document.hidden) {
      this.timer = setTimeout(() => this._step(), 300);
      return;
    }

    const t0 = performance.now();
    let dt = 0;

    try {
      const v = this.video;
      if (v && v.readyState >= 2 && v.videoWidth > 0) {
        const w = DET_WIDTH;
        const h = Math.max(1, Math.round(DET_WIDTH * v.videoHeight / v.videoWidth));
        if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
        this.cx.drawImage(v, 0, 0, w, h);

        const res = await faceapi.detectSingleFace(this.cv, this.opts).withFaceExpressions();
        dt = performance.now() - t0;

        if (res && res.expressions) {
          const b = res.detection.box;
          this.onResult({
            // 모델이 준 값 7개를 손대지 않고 그대로 넘긴다
            expressions: res.expressions,
            // 박스는 0~1로 정규화해서 넘김 (화면 크기와 무관하게 만들기 위해)
            box: { x: b.x / w, y: b.y / h, w: b.width / w, h: b.height / h },
            score: res.detection.score,
            ms: dt,
          });
        } else {
          this.onResult(null, dt);
        }
        this.errCount = 0;
      } else {
        dt = performance.now() - t0;
        this.onResult(null, dt);
      }
    } catch (err) {
      dt = performance.now() - t0;
      this.errCount++;
      if (this.errCount >= 5) {
        this.stop();
        this.onStatus('error', { message: err?.message || String(err) });
        return;
      }
    }

    // 지수이동평균으로 추론 시간을 추적 (한 번 튄 값에 흔들리지 않게)
    this.emaMs = this.emaMs === 0 ? dt : this.emaMs * 0.8 + dt * 0.2;

    // 적응형 주기: 추론이 목표 간격의 60%를 넘게 먹으면 스스로 주기를 늘린다.
    // 화면이 밀리는 것보다 갱신이 느린 편이 낫다.
    const target = 1000 / this.hz;
    const effective = Math.max(target, this.emaMs / 0.6);
    this.effectiveHz = 1000 / effective;

    this.timer = setTimeout(() => this._step(), Math.max(0, effective - dt));
  }
}
