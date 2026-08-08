// 설정값과 상수 모음

// face-api가 반환하는 순서 그대로. 절대 정렬하거나 바꾸지 않는다.
// (계측기처럼 채널 위치가 항상 같아야 하므로 값 크기순 정렬도 하지 않음)
export const EXPR_KEYS = ['neutral', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised'];

// 화면에서 뺀 감정. 모델은 계속 7종을 계산하지만 혐오·두려움은 다른 감정과 잘 구분되지 않아
// (학습 표본도 가장 적다) 오히려 화면을 어지럽혀서 표시에서 제외했다.
// 뺀 몫은 버리지 않고, 남은 5종을 다시 정규화해서 합계가 100%가 되게 한다.
export const HIDDEN_KEYS = ['fearful', 'disgusted'];
export const SHOWN_KEYS = EXPR_KEYS.filter(k => !HIDDEN_KEYS.includes(k));

// 표시용 이름. 순서와 판정은 모델 그대로이고, 이름만 옮긴 것.
export const LABELS = {
  ko: { neutral:'무표정', happy:'행복', sad:'슬픔', angry:'분노', fearful:'두려움', disgusted:'혐오', surprised:'놀람' },
  en: { neutral:'neutral', happy:'happy', sad:'sad', angry:'angry', fearful:'fearful', disgusted:'disgusted', surprised:'surprised' },
};

export const STATE_TEXT = {
  ko: { boot:'시작하는 중', loading:'모델 로딩 중', warmup:'준비 중', live:'분석 중',
        noface:'얼굴 없음', nocam:'카메라 없음', error:'오류' },
  en: { boot:'booting', loading:'loading model', warmup:'warming up', live:'live',
        noface:'no face detected', nocam:'no camera', error:'error' },
};

export const DEFAULTS = {
  hz: 10,            // 추론 주기. 표정은 200~500ms 단위로 변해서 10Hz면 충분하다
  inputSize: 224,    // TinyFaceDetector 내부 입력 크기 (작을수록 빠르고 덜 정확)
  smooth: 'slow',    // 표시 수치가 얼마나 진득하게 움직일지 (tune.js SMOOTH_LEVELS)
  cal: 'mid',        // 감정 쏠림 보정 세기 (tune.js CAL_LEVELS)
  lang: 'ko',
  panel: 'overlay',  // overlay | side
  pscale: 'lg',      // 수치 크기 sm | md | lg | xl
  fit: 'cover',      // 웹캠 채우기 | 전체 보기
  camw: 'mid',       // 웹캠 칸 가로세로비
  showStatus: 1,
  deviceId: '',
};

// 추론용으로 축소할 캔버스 가로 크기.
// 감정 모델은 "원본 캔버스에서 얼굴을 잘라내" 판정하므로 너무 작으면 표정이 뭉개진다.
// 웹캠 셀피는 얼굴이 크게 잡히므로 480px이면 얼굴이 150px 이상 확보된다.
export const DET_WIDTH = 480;

export const SCORE_THRESHOLD = 0.5;  // 오탐 억제
export const MODEL_URI = 'models';

const KEY = 'f9emo.settings';

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const merged = { ...DEFAULTS, ...JSON.parse(raw) };
    // 예전 버전에서 쓰다 없어진 설정 키는 버린다
    for (const k of Object.keys(merged)) if (!(k in DEFAULTS)) delete merged[k];
    return merged;
  } catch { return { ...DEFAULTS }; }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 저장 실패는 무시 */ }
}
