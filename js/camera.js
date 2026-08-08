// 웹캠 담당: 권한 요청, 장치 목록, 스트림 교체

let currentStream = null;

function stopStream() {
  if (currentStream) {
    currentStream.getTracks().forEach(t => t.stop());
    currentStream = null;
  }
}

/**
 * 카메라를 켠다. deviceId를 주면 그 장치로.
 * 실패하면 code가 붙은 Error를 던진다.
 */
export async function startCamera(videoEl, deviceId) {
  if (!navigator.mediaDevices?.getUserMedia) {
    const e = new Error('unsupported'); e.code = 'unsupported'; throw e;
  }
  stopStream();

  const constraints = {
    audio: false,
    video: deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
      : { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
  };

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    // 지정한 장치가 사라졌으면 기본 카메라로 한 번만 다시 시도
    if (deviceId && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
      return startCamera(videoEl, '');
    }
    const e = new Error(err.name); e.code = err.name; throw e;
  }

  currentStream = stream;
  videoEl.srcObject = stream;
  await videoEl.play().catch(() => {});   // 자동재생이 막혀도 srcObject는 유지

  // 실제로 잡힌 장치 id (기본 카메라로 시작했을 때 확인용)
  const track = stream.getVideoTracks()[0];
  return { stream, deviceId: track?.getSettings?.().deviceId || '', label: track?.label || '' };
}

/** 카메라 목록. 권한을 받은 뒤에야 label이 채워진다. */
export async function listCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter(d => d.kind === 'videoinput');
}

export function stopCamera() { stopStream(); }

/** 권한 거부 등 오류를 사람이 읽을 문구로 */
export function cameraErrorText(code) {
  switch (code) {
    case 'NotAllowedError':
    case 'SecurityError':
      return { head: 'camera blocked', body: '카메라 권한이 거부되었습니다.\n주소창 왼쪽 자물쇠 아이콘 → 카메라 → 허용으로 바꾼 뒤 새로고침하세요.' };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return { head: 'no camera', body: '연결된 카메라를 찾지 못했습니다.' };
    case 'NotReadableError':
    case 'TrackStartError':
      return { head: 'camera busy', body: '다른 프로그램이 카메라를 쓰고 있습니다.\nZoom·OBS 등을 끄고 새로고침하세요.' };
    case 'unsupported':
      return { head: 'unsupported', body: '이 브라우저는 카메라를 지원하지 않습니다.\n크롬으로 열어주세요.' };
    default:
      return { head: 'camera error', body: `카메라를 켤 수 없습니다. (${code})\nhttps 또는 localhost에서 열었는지 확인하세요.` };
  }
}
