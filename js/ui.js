// 화면 조작 담당: 상단 바, 영상 열기 팝업, 설정 서랍, 단축키, 녹화 모드, 파일 끌어놓기

import { saveSettings } from './config.js';

export function applySettings(app) {
  const s = app.settings;
  const b = document.body;
  b.dataset.lang   = s.lang;
  b.dataset.panel  = s.panel;
  b.dataset.fit    = s.fit;
  b.dataset.camw   = s.camw;
  b.dataset.status = String(s.showStatus);

  app.panel.setLang(s.lang);
  app.panel.setCal(s.cal);
  app.detector.setHz(s.hz);
  app.detector.setInputSize(s.inputSize);
  app.applyTuning();          // 평활 시간상수 + 화면 갱신 주기 다시 걸기

  // 설정 서랍의 선택 상태 갱신
  document.querySelectorAll('.seg[data-key]').forEach(seg => {
    const key = seg.dataset.key;
    seg.querySelectorAll('button').forEach(btn => {
      btn.classList.toggle('on', String(s[key]) === btn.dataset.v);
    });
  });

  saveSettings(s);
}

export function initUI(app) {
  const $ = (id) => document.getElementById(id);
  const s = app.settings;

  const dlg = $('srcDialog');
  const ytInput = $('ytInput');
  const srcLabel = $('srcLabel');

  // ── 영상 열기 팝업 ─────────────────────────
  const openDlg = () => {
    if (dlg.open) return;
    dlg.showModal();
    ytInput.focus();
    ytInput.select();
  };
  const closeDlg = () => { if (dlg.open) dlg.close(); };

  $('btnOpen').addEventListener('click', openDlg);
  $('videoMsg').addEventListener('click', openDlg);
  $('btnCloseDlg').addEventListener('click', closeDlg);
  // 팝업 바깥(어두운 배경)을 누르면 닫기
  dlg.addEventListener('click', (e) => { if (e.target === dlg) closeDlg(); });

  const loadYT = async () => {
    const v = ytInput.value.trim();
    if (!v) return;
    const id = await app.source.loadYouTube(v);
    if (id) { srcLabel.textContent = 'youtube · ' + id; closeDlg(); }
  };
  $('btnLoad').addEventListener('click', loadYT);
  ytInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); loadYT(); }
  });

  $('btnFile').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) {
      const name = app.source.loadFile(f);
      if (name) { srcLabel.textContent = '파일 · ' + name; closeDlg(); }
    }
    e.target.value = '';    // 같은 파일을 다시 골라도 change가 뜨도록
  });

  // 영상 칸에 파일 끌어놓기
  const va = document.querySelector('.video-area');
  ['dragenter', 'dragover'].forEach(t => va.addEventListener(t, (e) => {
    e.preventDefault(); va.classList.add('drop');
  }));
  ['dragleave', 'drop'].forEach(t => va.addEventListener(t, (e) => {
    e.preventDefault(); va.classList.remove('drop');
  }));
  va.addEventListener('drop', (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    const name = app.source.loadFile(f);
    if (name) { srcLabel.textContent = '파일 · ' + name; closeDlg(); }
  });
  // 창 밖으로 벗어난 드롭이 새 탭을 여는 것 방지
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => e.preventDefault());

  // ── 카메라 선택 ────────────────────────────
  $('camSelect').addEventListener('change', (e) => {
    s.deviceId = e.target.value;
    saveSettings(s);
    app.restartCamera();
  });

  // ── 설정 서랍 ──────────────────────────────
  const setbox = $('settings');
  const toggleSettings = (on) => {
    setbox.hidden = on === undefined ? !setbox.hidden : !on;
    $('btnSet').classList.toggle('on', !setbox.hidden);
  };
  $('btnSet').addEventListener('click', () => toggleSettings());

  document.querySelectorAll('.seg[data-key]').forEach(seg => {
    seg.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-v]');
      if (!btn) return;
      const key = seg.dataset.key;
      const raw = btn.dataset.v;
      s[key] = /^\d+$/.test(raw) ? Number(raw) : raw;
      applySettings(app);
    });
  });

  $('btnLow').addEventListener('click', () => {
    s.hz = 5; s.inputSize = 160;
    applySettings(app);
  });

  // ── 패널 위치 / 녹화 모드 ──────────────────
  const togglePanelPos = () => {
    s.panel = s.panel === 'overlay' ? 'side' : 'overlay';
    applySettings(app);
  };
  const toggleLang = () => {
    s.lang = s.lang === 'ko' ? 'en' : 'ko';
    applySettings(app);
  };
  const setRecord = (on) => {
    document.body.classList.toggle('record', on);
    if (on) toggleSettings(false);
  };

  $('btnRec').addEventListener('click', () => setRecord(true));

  // ── 단축키 ─────────────────────────────────
  // 주의: 유튜브 iframe을 클릭한 뒤에는 키 입력을 유튜브가 가져가서 여기까지 오지 않는다.
  //       화면 아무 곳이나 한 번 클릭하면 다시 동작한다.
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) {
      if (e.key === 'Escape') t.blur();
      return;
    }
    if (dlg.open) return;   // 팝업이 떠 있을 땐 팝업이 알아서 처리(Esc로 닫힘)

    switch (e.key.toLowerCase()) {
      case 'o': openDlg(); break;
      case 'r': setRecord(!document.body.classList.contains('record')); break;
      case 'p': togglePanelPos(); break;
      case 'l': toggleLang(); break;
      case ' ': e.preventDefault(); app.source.togglePlay(); break;
      case 'arrowup': e.preventDefault(); app.source.nudgeVolume(+5); break;
      case 'arrowdown': e.preventDefault(); app.source.nudgeVolume(-5); break;
      case 'escape':
        if (!setbox.hidden) toggleSettings(false);
        else setRecord(false);
        break;
    }
  });
}

/** 카메라 목록을 select에 채운다 */
export function fillCameraSelect(cams, selectedId) {
  const sel = document.getElementById('camSelect');
  sel.innerHTML = '';
  cams.forEach((c, i) => {
    const o = document.createElement('option');
    o.value = c.deviceId;
    o.textContent = c.label || `카메라 ${i + 1}`;
    sel.appendChild(o);
  });
  if (selectedId) sel.value = selectedId;
  // 카메라가 하나뿐이면 굳이 보여줄 이유가 없다
  sel.style.display = cams.length > 1 ? '' : 'none';
}
