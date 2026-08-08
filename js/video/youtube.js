// 유튜브 IFrame Player API 래퍼
// 임베드 오류 153 대책 3종: (1) index.html의 referrer 메타 (2) youtube-nocookie 호스트 (3) origin 파라미터

let apiPromise = null;

export function loadYTApi() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) { resolve(window.YT); return; }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (typeof prev === 'function') prev(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => reject(new Error('api-blocked'));
    document.head.appendChild(s);
    // 광고차단 확장 등으로 스크립트가 조용히 막히는 경우 대비
    setTimeout(() => { if (!(window.YT && window.YT.Player)) reject(new Error('api-timeout')); }, 12000);
  });
  return apiPromise;
}

const ID_RE = /^[\w-]{11}$/;

/** URL이든 ID든 11자리 영상 ID로 바꾼다. 못 알아보면 null */
export function parseYouTubeId(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (ID_RE.test(s)) return s;

  let u;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '');
  const head = (x) => { const m = String(x || '').match(/[\w-]{11}/); return m ? m[0] : null; };

  if (host === 'youtu.be') return head(u.pathname.slice(1));
  if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
    const v = u.searchParams.get('v');
    if (v) return head(v);
    const m = u.pathname.match(/\/(?:shorts|embed|live|v)\/([\w-]{11})/);
    if (m) return m[1];
  }
  return null;
}

export function ytErrorText(code) {
  switch (Number(code)) {
    case 2:   return { head: 'invalid id', body: '영상 ID를 알아볼 수 없습니다. 주소를 다시 확인해 주세요.' };
    case 5:   return { head: 'player error', body: '유튜브 플레이어 오류입니다. 새로고침 후 다시 시도해 주세요.' };
    case 100: return { head: 'not found', body: '삭제되었거나 비공개인 영상입니다.' };
    // 유튜브는 "임베드 차단"과 "없는 영상"을 같은 코드로 돌려주므로 둘 다 안내한다
    case 101:
    case 150: return { head: 'embed blocked', body: '이 영상은 외부 사이트에서 재생할 수 없습니다.\n소유자가 임베드를 막았거나, 삭제·비공개된 영상입니다.\n[파일] 버튼으로 직접 받은 영상을 올려서 쓰세요.' };
    case 153: return { head: 'referrer blocked', body: '유튜브가 출처를 확인하지 못했습니다.\nfile:// 로 연 경우이거나 광고차단 확장 때문입니다. localhost 주소로 열어 주세요.' };
    default:  return { head: 'youtube error', body: `영상을 재생할 수 없습니다. (코드 ${code})` };
  }
}

export class YouTubeSource {
  constructor(mountEl, { onError, onState } = {}) {
    this.mountEl = mountEl;       // 플레이어가 들어갈 빈 div
    this.onError = onError || (() => {});
    this.onState = onState || (() => {});
    this.player = null;
    this.ready = false;
    this.pending = null;          // 준비 전에 요청된 영상 ID
  }

  async ensure() {
    if (this.player) return this.player;
    const YT = await loadYTApi();

    // 이미 만들어진 요소가 있으면 비우고 새 div를 넣는다(플레이어 생성 시 요소가 교체되므로)
    this.mountEl.innerHTML = '<div></div>';
    const holder = this.mountEl.firstElementChild;

    await new Promise((resolve) => {
      this.player = new YT.Player(holder, {
        host: 'https://www.youtube-nocookie.com',
        playerVars: {
          enablejsapi: 1,
          origin: window.location.origin,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
        },
        events: {
          onReady: () => { this.ready = true; resolve(); },
          onError: (e) => this.onError(e.data),
          onStateChange: (e) => this.onState(e.data),
        },
      });
    });
    return this.player;
  }

  async load(id) {
    await this.ensure();
    this.player.loadVideoById(id);
    // 사용자의 클릭에서 이어진 호출이라 소리 있는 자동재생이 허용된다
    try { this.player.playVideo(); } catch { /* 무시 */ }
  }

  isPlaying() {
    try { return this.player && this.player.getPlayerState() === 1; } catch { return false; }
  }
  toggle() {
    if (!this.player) return;
    try { this.isPlaying() ? this.player.pauseVideo() : this.player.playVideo(); } catch { /* 무시 */ }
  }
  pause() { try { this.player?.pauseVideo(); } catch { /* 무시 */ } }
  setVolume(v) { try { this.player?.setVolume(Math.max(0, Math.min(100, v))); } catch { /* 무시 */ } }
  getVolume() { try { return this.player?.getVolume() ?? 100; } catch { return 100; } }
}
