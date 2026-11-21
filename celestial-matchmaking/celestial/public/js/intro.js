/**
 * intro.js — THE GRAND OPENING.
 * Five cinematic scenes, driven by a timeline of camera moves, DOM reveals
 * and announcer audio. Everything is skippable and never blocks a resume.
 */
import * as THREE from './three.min.js';

const AUDIO_BASE = '/audio/';

export const SOUND = {
  music: true, announcer: true, ambience: true, chess: true, master: true,
  musicVol: 0.32, annVol: 1.0, ambVol: 0.5, chessVol: 0.8
};

const ONCE_KEY = 'cc_intro_seen_v1';

// ------------------------------------------------------------------ audio
const buffers = {};
let audioCtx = null;
let musicGain = null, annGain = null, ambGain = null, chessGain = null, masterGain = null;

export function initAudio() {
  if (audioCtx) return audioCtx;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = SOUND.master ? 1 : 0;
    masterGain.connect(audioCtx.destination);

    musicGain = audioCtx.createGain(); musicGain.gain.value = SOUND.musicVol;
    annGain = audioCtx.createGain(); annGain.gain.value = SOUND.annVol;
    ambGain = audioCtx.createGain(); ambGain.gain.value = SOUND.ambVol;
    chessGain = audioCtx.createGain(); chessGain.gain.value = SOUND.chessVol;
    [musicGain, annGain, ambGain, chessGain].forEach(g => g.connect(masterGain));
  } catch (e) { /* no audio */ }
  return audioCtx;
}

export function loadAudio(name) {
  const ctx = initAudio();
  if (!ctx) return Promise.resolve(null);
  if (buffers[name]) return Promise.resolve(buffers[name]);
  return fetch(AUDIO_BASE + name + '.mp3')
    .then(r => r.arrayBuffer())
    .then(buf => new Promise((res, rej) => {
      ctx.decodeAudioData(buf, d => { buffers[name] = d; res(d); }, rej);
    }))
    .catch(() => null);
}

export function preloadAnnouncer() {
  return Promise.all(['ann_ladies', 'ann_ready', 'ann_welcome', 'ann_loganathan',
    'ann_jeriel', 'ann_500', 'ann_firstmove'].map(loadAudio));
}

/** play a clip; resolves when it finishes (or immediately if muted/missing) */
export function playAnnouncer(name) {
  const ctx = initAudio();
  if (!ctx || !SOUND.announcer || !SOUND.master) return Promise.resolve(0);
  const b = buffers[name];
  if (!b) return Promise.resolve(0);
  const src = ctx.createBufferSource();
  src.buffer = b;
  src.connect(annGain);
  src.start();
  return new Promise(res => setTimeout(res, b.duration * 1000));
}

// ------------------------------------------------------------------ music engine
// Original cinematic score, synthesised live: warm pad progression + soft arpeggio.
let musicNodes = [], musicTimer = null, musicMode = 'cinematic';

export function startMusic(mode = 'cinematic') {
  const ctx = initAudio();
  if (!ctx) return;
  stopMusic();
  musicMode = mode;
  const t0 = ctx.currentTime;

  // chord progression (D minor-ish, warm and noble)
  const cinemaChords = [
    [146.83, 220.00, 293.66, 349.23],   // Dm add9
    [130.81, 196.00, 261.63, 329.63],   // C
    [174.61, 261.63, 349.23, 440.00],   // F
    [164.81, 246.94, 329.63, 415.30]    // E
  ];
  const calmChords = [
    [174.61, 261.63, 349.23, 440.00],   // F
    [196.00, 293.66, 392.00, 493.88],   // G
    [130.81, 196.00, 261.63, 329.63],   // C
    [146.83, 220.00, 293.66, 349.23]    // Dm
  ];
  const chords = mode === 'gameplay' ? calmChords : cinemaChords;
  const barLen = mode === 'gameplay' ? 8.0 : 4.4;

  function playChord(idx) {
    const now = ctx.currentTime + 0.05;
    const chord = chords[idx % chords.length];
    chord.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = mode === 'gameplay' ? 1400 : 2200;
      o.type = i === 0 ? 'sine' : 'triangle';
      o.frequency.value = f * (i === 3 ? 1.0 : 1.0);
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(mode === 'gameplay' ? 0.045 : 0.06, now + 1.4);
      g.gain.linearRampToValueAtTime(0.0001, now + barLen);
      o.connect(filt); filt.connect(g); g.connect(musicGain);
      o.start(now); o.stop(now + barLen + 0.1);
      musicNodes.push(o);
    });
    // gentle high shimmer
    const sh = ctx.createOscillator(), shg = ctx.createGain();
    sh.type = 'sine';
    sh.frequency.value = chord[2] * 4;
    shg.gain.setValueAtTime(0, now);
    shg.gain.linearRampToValueAtTime(0.012, now + 2.0);
    shg.gain.linearRampToValueAtTime(0.0001, now + barLen);
    sh.connect(shg); shg.connect(musicGain);
    sh.start(now); sh.stop(now + barLen + 0.1);
    musicNodes.push(sh);
  }

  let i = 0;
  playChord(i);
  musicTimer = setInterval(() => {
    i++;
    playChord(i);
    if (musicNodes.length > 60) musicNodes.splice(0, 20);
  }, barLen * 1000);
}

export function stopMusic() {
  clearInterval(musicTimer);
  musicTimer = null;
  const ctx = audioCtx;
  if (!ctx) { musicNodes = []; return; }
  musicNodes.forEach(n => { try { n.stop(ctx.currentTime + 0.1); } catch (e) {} });
  musicNodes = [];
}

export function setMusicMode(mode) {
  if (musicMode === mode) return;
  startMusic(mode);
}

// ------------------------------------------------------------------ ambience
let ambNodes = [];
export function startAmbience() {
  const ctx = initAudio();
  if (!ctx) return;
  // filtered noise = wind through clouds
  const len = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.35;
  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 420;
  const g = ctx.createGain(); g.gain.value = 0.16;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08;
  const lfoG = ctx.createGain(); lfoG.gain.value = 0.07;
  lfo.connect(lfoG); lfoG.connect(g.gain);
  src.connect(lp); lp.connect(g); g.connect(ambGain);
  src.start(); lfo.start();
  ambNodes = [src, lfo];
}

export function stopAmbience() {
  const ctx = audioCtx;
  if (!ctx) return;
  ambNodes.forEach(n => { try { n.stop(); } catch (e) {} });
  ambNodes = [];
}

// ------------------------------------------------------------------ chess SFX
export function sfx(kind) {
  const ctx = initAudio();
  if (!ctx || !SOUND.chess || !SOUND.master) return;
  const now = ctx.currentTime;
  const specs = {
    move:    { freq: 320, dur: 0.10, type: 'triangle', vol: 0.15 },
    capture: { freq: 160, dur: 0.20, type: 'sawtooth', vol: 0.13 },
    select:  { freq: 620, dur: 0.05, type: 'sine', vol: 0.07 },
    check:   { freq: 880, dur: 0.30, type: 'sine', vol: 0.14 },
    start:   { freq: 520, dur: 0.40, type: 'sine', vol: 0.16 },
    end:     { freq: 240, dur: 0.70, type: 'sine', vol: 0.18 }
  };
  const s = specs[kind] || specs.move;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = s.type;
  o.frequency.setValueAtTime(s.freq, now);
  o.frequency.exponentialRampToValueAtTime(s.freq * (kind === 'capture' ? 0.6 : 1.25), now + s.dur);
  g.gain.setValueAtTime(s.vol, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + s.dur);
  o.connect(g); g.connect(chessGain);
  o.start(now); o.stop(now + s.dur + 0.02);
}

export function applyVolumes() {
  if (!audioCtx) return;
  masterGain.gain.value = SOUND.master ? 1 : 0;
  musicGain.gain.value = SOUND.music ? SOUND.musicVol : 0;
  annGain.gain.value = SOUND.announcer ? SOUND.annVol : 0;
  ambGain.gain.value = SOUND.ambience ? SOUND.ambVol : 0;
  chessGain.gain.value = SOUND.chess ? SOUND.chessVol : 0;
}

// ------------------------------------------------------------------ intro timeline
export function introAlreadySeen() {
  try { return sessionStorage.getItem(ONCE_KEY) === '1'; } catch (e) { return false; }
}
export function markIntroSeen() {
  try { sessionStorage.setItem(ONCE_KEY, '1'); } catch (e) {}
}

/**
 * Runs the whole cinematic.
 * ctx = { camera, scene, els, matchNumber, colors, players, reducedMotion, onFinish }
 */
export function runIntro(ctx) {
  const { camera, els, reducedMotion } = ctx;
  const root = els.intro;
  root.classList.remove('hidden');

  const scenes = {
    dark: els.sceneDark,
    announcer: els.sceneAnnouncer,
    entrance: els.sceneEntrance,
    confrontation: els.sceneConfrontation,
    final: els.sceneFinal
  };
  Object.values(scenes).forEach(s => s && s.classList.add('hidden'));

  let cancelled = false;
  const timers = [];
  const wait = (ms) => new Promise(res => {
    const t = setTimeout(res, reducedMotion ? Math.min(ms, 220) : ms);
    timers.push(t);
  });

  function show(el) {
    if (!el) return;
    Object.values(scenes).forEach(s => s && s.classList.add('hidden'));
    el.classList.remove('hidden');
  }

  // camera keyframes (position, lookAt)
  function camStep(pos, target, ms, easeFn) {
    return new Promise(res => {
      if (reducedMotion) { camera.position.set(...pos); camera.lookAt(...target); return res(); }
      const p0 = camera.position.clone();
      const t0 = new THREE.Vector3().copy(camera.userData.lookAt || new THREE.Vector3(0, 1.5, 0));
      const p1 = new THREE.Vector3(...pos);
      const t1 = new THREE.Vector3(...target);
      const start = performance.now();
      (function step(now) {
        if (cancelled) return res();
        const k = Math.min(1, (now - start) / ms);
        const e = easeFn ? easeFn(k) : (k < 0.5 ? 2 * k * k : -1 + (4 - 2 * k) * k);
        camera.position.lerpVectors(p0, p1, e);
        const look = new THREE.Vector3().lerpVectors(t0, t1, e);
        camera.lookAt(look);
        camera.userData.lookAt = look;
        if (k < 1) requestAnimationFrame(step); else res();
      })(start);
    });
  }
  function fade(el, to, ms) {
    return new Promise(res => {
      if (!el) return res();
      el.style.transition = 'opacity ' + ms + 'ms ease';
      requestAnimationFrame(() => {
        el.style.opacity = String(to);
        setTimeout(res, ms);
      });
    });
  }

  async function play() {
    root.style.opacity = '1';

    // ---------- SCENE 1: the unknown world ----------
    show(scenes.dark);
    if (els.darkText) els.darkText.style.opacity = '0';
    camera.position.set(-2, 26, 46);
    const focus = new THREE.Vector3(0, 1.5, 0);
    camera.lookAt(focus);
    camera.userData.lookAt = focus.clone();

    startMusic('cinematic');
    startAmbience();

    await wait(600);
    // golden light grows in the distance while darkness dissolves
    if (els.darkVignette) {
      els.darkVignette.style.transition = 'opacity 3.2s ease';
      requestAnimationFrame(() => { els.darkVignette.style.opacity = '0'; });
    }
    if (els.darkText) {
      els.darkText.style.transition = 'opacity 2.4s ease';
      els.darkText.style.opacity = '1';
    }
    await camStep([-6, 20, 40], focus, 3400);
    await wait(300);

    // ---------- SCENE 2: the announcer ----------
    show(scenes.announcer);
    await wait(350);
    await playAnnouncer('ann_ladies');
    await wait(620);
    els.sceneAnnouncer.classList.add('pulse');
    await playAnnouncer('ann_ready');
    await wait(420);
    await playAnnouncer('ann_welcome');
    await wait(700);

    // ---------- SCENE 3: player entrances ----------
    show(scenes.entrance);
    // Loganathan first
    els.entranceLabel.textContent = 'PLAYER 01';
    els.entranceName.textContent = 'LOGANATHAN';
    els.entranceName.style.color = '#ffffff';
    els.entranceCard.classList.remove('reveal');
    void els.entranceCard.offsetWidth;
    els.entranceCard.classList.add('reveal');
    camStep([14, 14, 26], focus, 2400);
    await playAnnouncer('ann_loganathan');
    await wait(900);

    // Jeriel
    els.entranceLabel.textContent = 'PLAYER 02';
    els.entranceName.textContent = 'JERIEL';
    els.entranceName.style.color = '#ffd873';
    els.entranceCard.classList.remove('reveal');
    void els.entranceCard.offsetWidth;
    els.entranceCard.classList.add('reveal');
    camStep([-14, 14, 26], focus, 2400);
    await playAnnouncer('ann_jeriel');
    await wait(900);

    // ---------- SCENE 4: the royal confrontation ----------
    show(scenes.confrontation);
    els.confMatch.textContent = 'CHAMPIONSHIP MATCH ' +
      String(ctx.matchNumber).padStart(3, '0') + ' / 500';
    const c = ctx.colors || { jeriel: 'w', loganathan: 'b' };
    els.confColors.textContent =
      'JERIEL — ' + (c.jeriel === 'w' ? 'WHITE' : 'BLACK') + '    ·    ' +
      'LOGANATHAN — ' + (c.loganathan === 'w' ? 'WHITE' : 'BLACK');
    camStep([0, 9, 22], new THREE.Vector3(0, 1.6, 0), 3000);
    await playAnnouncer('ann_500');
    await wait(600);

    // ---------- SCENE 5: the entry concludes ----------
    show(scenes.final);
    camStep([0, 7.5, 17], new THREE.Vector3(0, 1.7, 0), 2600);
    await playAnnouncer('ann_firstmove');
    await wait(2400);
    markIntroSeen();
    // the game always takes over on its own; the button is an optional early exit
    if (!cancelled) finish({ skipped: false });
  }

  // single exit path: the world is handed over exactly once
  function finish(info) {
    if (finished) return;
    finished = true;
    cancelled = true;
    timers.forEach(clearTimeout);
    markIntroSeen();
    root.classList.add('hidden');
    Object.values(scenes).forEach(s => s && s.classList.add('hidden'));
    ctx.onFinish && ctx.onFinish(info);
  }
  let finished = false;

  // skip support
  const skip = () => finish({ skipped: true });
  els.btnSkip && (els.btnSkip.onclick = skip);
  els.btnEnter && (els.btnEnter.onclick = () => finish({ skipped: false }));
  els.intro.addEventListener('dblclick', skip);

  play().then(() => {
    if (!cancelled) {
      els.btnEnter && els.btnEnter.classList.add('glow');
    }
  });

  return { skip };
}
