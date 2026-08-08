// 영상 소스 컨트롤러: 유튜브 ↔ 로컬 파일 전환과 공통 조작을 한 곳에서 관리
// 영상 A → 영상 B 교체 시 플레이어를 새로 만들지 않는다(새로 만들면 1~2초 검은 화면이 생김)

import { YouTubeSource, parseYouTubeId, ytErrorText } from './youtube.js';
import { FileSource } from './localfile.js';

export class SourceController {
  constructor({ frameEl, ytMountEl, videoEl, msgEl }) {
    this.frameEl = frameEl;
    this.msgEl = msgEl;
    this.mode = 'none';
    this.errBox = null;

    this.yt = new YouTubeSource(ytMountEl, {
      onError: (code) => this.showError(ytErrorText(code)),
      onState: () => {},
    });
    this.file = new FileSource(videoEl);
  }

  _setMode(mode) {
    this.mode = mode;
    document.body.dataset.src = mode;
  }

  /** 입력창 문자열(URL 또는 ID)로 유튜브 재생. 성공하면 영상 ID를 돌려준다 */
  async loadYouTube(input) {
    const id = parseYouTubeId(input);
    if (!id) {
      this.showError({ head: 'invalid url', body: '유튜브 주소나 11자리 영상 ID를 넣어주세요.' });
      return false;
    }
    this.clearError();
    this.file.pause();
    this._setMode('yt');
    try {
      await this.yt.load(id);
    } catch (err) {
      const blocked = String(err?.message || '').includes('blocked') || String(err?.message || '').includes('timeout');
      this.showError(blocked
        ? { head: 'api blocked', body: '유튜브 스크립트를 불러오지 못했습니다.\n광고차단 확장을 끄거나 [파일]로 영상을 올려 주세요.' }
        : { head: 'youtube error', body: '유튜브 플레이어를 만들지 못했습니다.' });
      return false;
    }
    return id;
  }

  /** 로컬 파일 재생. 성공하면 파일 이름을 돌려준다 */
  loadFile(f) {
    if (!f) return false;
    if (!f.type.startsWith('video/')) {
      this.showError({ head: 'not a video', body: '영상 파일만 열 수 있습니다. (mp4, webm, mov 등)' });
      return false;
    }
    this.clearError();
    this.yt.pause();
    this._setMode('file');
    return this.file.load(f);
  }

  togglePlay() {
    if (this.mode === 'yt') this.yt.toggle();
    else if (this.mode === 'file') this.file.toggle();
  }

  nudgeVolume(delta) {
    if (this.mode === 'yt') this.yt.setVolume(this.yt.getVolume() + delta);
    else if (this.mode === 'file') this.file.setVolume(this.file.getVolume() + delta);
  }

  showError({ head, body }) {
    this.clearError();
    const box = document.createElement('div');
    box.className = 'video-err';
    const b = document.createElement('b'); b.textContent = head;
    const s = document.createElement('span'); s.textContent = body;
    box.append(b, s);
    this.frameEl.appendChild(box);
    this.errBox = box;
  }

  clearError() {
    if (this.errBox) { this.errBox.remove(); this.errBox = null; }
  }
}
