// 로컬 영상 파일 재생 (유튜브 임베드가 막힌 영상용 폴백)
// 파일은 브라우저 메모리에서만 열린다. 어디로도 올라가지 않는다.

export class FileSource {
  constructor(videoEl) {
    this.video = videoEl;
    this.url = null;
  }

  load(file) {
    this.clear();
    this.url = URL.createObjectURL(file);
    this.video.src = this.url;
    this.video.play().catch(() => { /* 자동재생이 막히면 사용자가 누르면 됨 */ });
    return file.name;
  }

  clear() {
    if (this.url) { URL.revokeObjectURL(this.url); this.url = null; }
    this.video.removeAttribute('src');
    this.video.load();
  }

  isPlaying() { return !this.video.paused && !this.video.ended; }
  toggle() { this.isPlaying() ? this.video.pause() : this.video.play().catch(() => {}); }
  pause() { this.video.pause(); }
  setVolume(v) { this.video.volume = Math.max(0, Math.min(1, v / 100)); }
  getVolume() { return Math.round(this.video.volume * 100); }
}
