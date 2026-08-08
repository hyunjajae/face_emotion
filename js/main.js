// 앱 조립: 모델 로딩과 카메라 시작을 동시에 걸고, 둘 다 준비되면 분석 루프를 켠다.
//
// 흐름:  추론(10Hz) → 감정 보정 → 시간 평활(EMA) → 화면 갱신(설정한 주기)
// 얼굴 박스만 추론 결과를 바로 받아서 즉각 반응한다(수치와 달리 늦으면 어색하므로).

import { loadSettings, saveSettings } from './config.js';
import { startCamera, listCameras, cameraErrorText } from './camera.js';
import { Detector } from './detector.js';
import { BoxOverlay } from './overlay.js';
import { Panel } from './panel.js';
import { SourceController } from './video/source.js';
import { calibrate, Smoother, SMOOTH_LEVELS, zeros } from './tune.js';
import { applySettings, initUI, fillCameraSelect } from './ui.js';

const $ = (id) => document.getElementById(id);

const camVideo = $('cam');
const camView  = $('camView');
const camMsg   = $('camMsg');

const settings = loadSettings();

// 상태는 갈래별로 따로 들고, 화면 표시는 refreshState()가 한 곳에서 정한다.
// (모델 로딩과 카메라 시작이 동시에 진행돼서 서로 상태를 덮어쓰는 걸 막기 위함)
let modelPhase = 'loading';   // loading | warmup
let modelOk = false;
let camOk = false;
let camTried = false;
let fatal = false;

let hasFace = false;
let lastPush = 0;
let displayTimer = null;

const panelEl = $('panel');
const panel = new Panel($('rows'), $('status'));
const overlay = new BoxOverlay($('overlay'), camVideo, camView);
const smoother = new Smoother(0);

/* ── 얼굴 옆 따라다니기 모드 ──
   매 프레임 offsetWidth를 읽으면 강제 레이아웃이 생기므로 값을 캐시하되,
   비어 있거나 30프레임(약 0.5초)마다 한 번씩만 다시 잰다. */
let panelW = 0, panelH = 0, boxFrame = 0;

overlay.onBox = (b) => {
  if (settings.panel !== 'follow') return;
  if (!b) { panelEl.style.opacity = '0'; return; }

  if (!panelW || !panelH || (boxFrame++ % 30) === 0) {
    panelW = panelEl.offsetWidth;
    panelH = panelEl.offsetHeight;
  }

  const gap = Math.max(8, b.cw * 0.02);
  const roomRight = b.cw - (b.right + gap);
  const roomLeft  = b.left - gap;

  // 오른쪽 우선. 안 들어가면 왼쪽. 둘 다 좁으면 그나마 넓은 쪽 끝에 붙인다
  let x;
  if (roomRight >= panelW)     x = b.right + gap;
  else if (roomLeft >= panelW) x = b.left - gap - panelW;
  else                         x = roomRight >= roomLeft ? b.cw - panelW : 0;

  // 세로는 박스 위쪽에 맞추되 화면 밖으로 나가지 않게
  const y = Math.max(0, Math.min(b.ch - panelH, b.top));

  panelEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  panelEl.style.opacity = String(b.alpha);
};

const detector = new Detector({
  onResult: (res) => {
    const now = performance.now();
    const dt = lastPush ? now - lastPush : 0;
    lastPush = now;

    if (res) {
      hasFace = true;
      smoother.push(calibrate(res.expressions, settings.cal), dt);
      overlay.setTarget(res.box);
      if (modelOk && camOk && !fatal) panel.setState('live');
    } else {
      hasFace = false;
      smoother.push(zeros(), dt);     // 0으로 서서히 내려간다
      overlay.setTarget(null);
      if (modelOk && camOk && !fatal) panel.setState('noface');
    }
  },
  onStatus: (state, info) => {
    if (state === 'error') {
      fatal = true;
      showCamMsg({ head: 'analysis error', body: `분석을 계속할 수 없습니다.\n${info?.message || ''}` });
    } else {
      modelPhase = state;
    }
    if (info?.backend) panel.setMeters({ backend: info.backend });
    refreshState();
  },
});

const source = new SourceController({
  frameEl:   $('videoFrame'),
  ytMountEl: $('ytPlayer'),
  videoEl:   $('localVideo'),
  msgEl:     $('videoMsg'),
});

const app = { settings, panel, detector, overlay, source, restartCamera, applyTuning };

/** 평활 강도와 화면 갱신 주기를 설정값에 맞춰 다시 건다 */
function applyTuning() {
  // 따라다니기 모드가 아니면 인라인으로 밀어놨던 위치·투명도를 되돌린다
  if (settings.panel !== 'follow') {
    panelEl.style.transform = '';
    panelEl.style.opacity = '';
  }
  const L = SMOOTH_LEVELS[settings.smooth] || SMOOTH_LEVELS.slow;
  smoother.setTau(L.tau);
  // 게이지가 갱신 간격 동안 끊기지 않고 이어서 움직이도록 트랜지션 길이를 맞춘다
  document.body.style.setProperty('--tv', L.refresh + 'ms linear');
  clearInterval(displayTimer);
  displayTimer = setInterval(paintPanel, L.refresh);
}

function paintPanel() {
  panel.update(smoother.get() || zeros(), hasFace);
}

/** 지금 보여줘야 할 상태를 한 곳에서 결정 */
function refreshState() {
  if (fatal) { panel.setState('error'); return; }
  if (!modelOk) { panel.setState(modelPhase); return; }
  if (!camOk) { panel.setState(camTried ? 'nocam' : 'warmup'); return; }
  // 여기서부터는 추론 결과(onResult)가 live / noface를 정한다
}

// ── 화면 메시지 ────────────────────────────────
function showCamMsg({ head, body }) {
  camMsg.innerHTML = '';
  const b = document.createElement('b'); b.textContent = head;
  const s = document.createElement('span'); s.textContent = body;
  camMsg.append(b, s);
  camMsg.hidden = false;
}
function hideCamMsg() { camMsg.hidden = true; }

// ── 카메라 ────────────────────────────────────
async function startCam() {
  hideCamMsg();
  try {
    const r = await startCamera(camVideo, settings.deviceId);
    settings.deviceId = r.deviceId;
    saveSettings(settings);

    // 권한을 받은 뒤에야 장치 이름이 채워진다
    const cams = await listCameras();
    fillCameraSelect(cams, r.deviceId);

    camTried = true;
    camOk = true;
    maybeStart();
  } catch (err) {
    camTried = true;
    camOk = false;
    hasFace = false;
    detector.stop();
    overlay.setTarget(null);
    smoother.reset();
    showCamMsg(cameraErrorText(err.code));
  }
  refreshState();
}

async function restartCamera() {
  detector.stop();
  await startCam();
}

// ── 모델 ─────────────────────────────────────
async function loadModel() {
  try {
    await detector.load();
    modelOk = true;
    panel.setMeters({ backend: detector.backend });
    maybeStart();
  } catch (err) {
    modelOk = false;
    fatal = true;
    showCamMsg({
      head: 'model load failed',
      body: `모델 파일을 불러오지 못했습니다.\nmodels 폴더가 함께 올라갔는지 확인하세요.\n${err?.message || ''}`,
    });
  }
  refreshState();
}

function maybeStart() {
  if (!modelOk || !camOk) return;
  hideCamMsg();
  lastPush = 0;
  detector.start(camVideo);
  overlay.start();
}

// ── 부팅 ─────────────────────────────────────
document.body.dataset.src = 'none';
applySettings(app);
initUI(app);
refreshState();

if (location.protocol === 'file:') {
  // file:// 에서는 카메라·모델·유튜브가 전부 막힌다
  fatal = true;
  refreshState();
  showCamMsg({
    head: 'file:// not supported',
    body: '파일을 더블클릭해서 연 상태입니다.\n로컬 서버(예: http://127.0.0.1:5690)로 열어야 카메라와 모델이 동작합니다.',
  });
} else {
  loadModel();
  startCam();
}

// 상태줄 수치는 0.5초마다만 갱신 (추론 주기대로 바꾸면 눈이 피곤하다)
setInterval(() => {
  if (!modelOk) return;
  panel.setMeters({
    hz: detector.effectiveHz || 0,
    ms: detector.emaMs || 0,
    backend: detector.backend,
  });
}, 500);

// 개발용 진단 핸들. 주소 뒤에 ?debug=1 을 붙였을 때만 열린다.
// 카메라 없이 임의의 영상 스트림으로 파이프라인 전체를 돌려볼 때 사용.
if (new URLSearchParams(location.search).has('debug')) {
  window.__f9 = {
    app, detector, panel, overlay, source, smoother,
    useStream(stream) {
      camVideo.srcObject = stream;
      camTried = true; camOk = true;
      hideCamMsg(); maybeStart(); refreshState();
    },
  };
}
