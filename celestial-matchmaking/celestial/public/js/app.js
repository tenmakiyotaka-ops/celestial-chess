/**
 * app.js — championship application shell.
 * Wires: auth → intro → waiting → countdown → game, plus presence, saving,
 * pause/resume, camera, audio settings, archive.
 */
import * as THREE from './three.min.js';
import { buildWorld, updateWorld, WORLD, setVoyage } from './celestial-world.js';
import {
  initPieces, setPosition, animateMove, updatePieces, applySquareHighlight,
  setSelected, pickSquare, getPieceCount, squareToWorld, BOARD
} from './chess-3d.js';
import {
  runIntro, introAlreadySeen, markIntroSeen, preloadAnnouncer,
  startMusic, stopMusic, setMusicMode, startAmbience,
  playAnnouncer, sfx, SOUND, applyVolumes
} from './intro.js';

/* ------------------------------------------------------------------ state */
const S = {
  player: null,            // {id, name}
  match: null,             // server match view
  presence: null,
  countdown: null,
  waitStarted: null,
  archive: null,
  board: new Array(64).fill(null),
  selected: -1,
  targets: [],
  myColor: null,
  inGame: false,
  quality: localStorage.getItem('cc_quality') || 'balanced',
  camMode: 'iso',
  pendingPromo: null,
  lastMoveCount: 0,
  reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  es: null
};

const $ = id => document.getElementById(id);
const toastEl = () => $('toast');
let toastTimer = null;
function toast(msg, ms = 2400) {
  const t = toastEl();
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/* ------------------------------------------------------------------ renderer */
let renderer, scene, camera, raycaster, pointer, clock;
const camRig = {
  target: new THREE.Vector3(0, 1.6, 0),
  desiredPos: new THREE.Vector3(0, 9, 16),
  currentPos: new THREE.Vector3(0, 9, 16),
  orbit: 0.0,
  autoOrbit: false,
  // free-look: yaw wraps all the way round (360°), pitch is clamped so the
  // camera can look up into the sky and down at the cloud sea without flipping
  yaw: 0.785,
  pitch: 0.52,
  radius: 17.5,
  freeLook: false,
  // outward views (watch the clouds / voyage) stand high above the platform and
  // look out at the horizon, so the frame is filled with sky instead of marble
  outward: false,
  anchorY: 8.5
};

function initThree() {
  const canvas = $('view');
  renderer = new THREE.WebGLRenderer({
    canvas, antialias: S.quality !== 'performance', alpha: false,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, S.quality === 'high' ? 2 : 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xf7dcb2, 0.00010);

  camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(0, 9, 16);
  camera.lookAt(camRig.target);

  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();
  clock = new THREE.Clock();

  buildWorld(scene, renderer, S.quality);
  initPieces(scene);

  window.addEventListener('resize', onResize);
  animate();
}

function onResize() {
  if (!renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

let introActive = false;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  updateWorld(dt, t);
  updatePieces(dt, t);

  if (!introActive) {
    // smooth camera easing toward the desired rig
    if (camRig.autoOrbit) { camRig.yaw += dt * 0.06; applyRig(); }
    camRig.currentPos.lerp(camRig.desiredPos, 1 - Math.pow(0.001, dt));
    camera.position.copy(camRig.currentPos);
    camera.lookAt(camRig.target);
  }

  renderer.render(scene, camera);
}

/* ------------------------------------------------------------------ camera views */
function applyRig() {
  const cy = Math.cos(camRig.pitch);
  const dir = new THREE.Vector3(
    Math.sin(camRig.yaw) * cy,
    Math.sin(camRig.pitch),
    Math.cos(camRig.yaw) * cy
  );
  if (camRig.outward) {
    // stand above the platform and look out over the endless clouds
    camRig.desiredPos.set(0, camRig.anchorY, 0);
    camRig.target.copy(camRig.desiredPos).addScaledVector(dir, 80);
    camRig.currentPos.copy(camRig.desiredPos);
  } else {
    camRig.desiredPos.set(
      camRig.target.x + dir.x * camRig.radius,
      camRig.target.y + dir.y * camRig.radius,
      camRig.target.z + dir.z * camRig.radius
    );
  }
}

function setCamera(mode) {
  S.camMode = mode;
  camRig.autoOrbit = false;
  camRig.freeLook = false;
  camRig.outward = false;
  camRig.anchorY = 8.5;
  const dist = window.innerWidth < 720 ? 16.5 : 18.5;
  if (mode === 'top') {
    camRig.yaw = S.myColor === 'b' ? Math.PI : 0;
    camRig.pitch = 1.45;
    camRig.radius = 15.5;
    camRig.target.set(0, 1.5, 0);
  } else if (mode === 'iso') {
    // white is always seen from the near side: black views the board rotated 180°
    camRig.yaw = S.myColor === 'b' ? -Math.PI * 0.75 : Math.PI * 0.25;
    camRig.pitch = 0.50;
    camRig.radius = dist;
    camRig.target.set(0, 1.9, 0);
  } else if (mode === 'close') {
    camRig.yaw = Math.PI * 0.25;
    camRig.pitch = 0.42;
    camRig.radius = 7.5;
    camRig.target.set(0, 1.7, 0);
  } else if (mode === 'sky') {
    // stand and watch the clouds: look out level over the cloud sea
    camRig.outward = true;
    camRig.anchorY = 11.0;
    camRig.yaw = S.myColor === 'b' ? -Math.PI * 0.75 : Math.PI * 0.25;
    camRig.pitch = -0.06;
    camRig.radius = 15.0;
  } else if (mode === 'cine') {
    camRig.autoOrbit = true;
    camRig.yaw = Math.PI * 0.25;
    camRig.pitch = 0.45;
    camRig.radius = dist;
    camRig.target.set(0, 1.7, 0);
  } else if (mode === 'voyage') {
    // travelling through the never-ending clouds
    camRig.outward = true;
    camRig.anchorY = 12.0;
    camRig.yaw = Math.PI;
    camRig.pitch = -0.14;
    camRig.radius = 16.0;
  }
  setVoyage(mode === 'voyage');
  applyRig();
  syncCamButtons();
}

function syncCamButtons() {
  const map = { btnCamReset: 'iso', btnCamTop: 'top', btnCamIso: 'cine', btnCamSky: 'sky', btnCamVoyage: 'voyage' };
  Object.keys(map).forEach(id => {
    const el = $(id);
    if (el) el.classList.toggle('active', S.camMode === map[id]);
  });
}

/**
 * Free-look. Yaw is unbounded, so the world turns a full 360° in either
 * direction; pitch runs from looking straight down to looking up into the sky,
 * letting the player simply stand and watch the clouds.
 */
function orbitBy(deltaYaw, deltaPitch) {
  camRig.yaw += deltaYaw;
  camRig.pitch = Math.max(-0.42, Math.min(1.48, camRig.pitch + deltaPitch));
  if (Math.abs(deltaYaw) > 0.0001 || Math.abs(deltaPitch) > 0.0001) {
    camRig.autoOrbit = false;
    camRig.freeLook = true;
  }
  applyRig();
}
function zoomBy(f) {
  camRig.radius = Math.max(7, Math.min(40, camRig.radius * f));
  applyRig();
}

/* ------------------------------------------------------------------ API */
async function api(path, opts) {
  const res = await fetch(path, Object.assign({ credentials: 'same-origin' }, opts));
  if (res.status === 401) { showLogin(null); throw new Error('unauthorized'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || ('http ' + res.status));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
const apiPost = (p, body) => api(p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body || {})
});

/* ------------------------------------------------------------------ auth */
const INVITE_RE = /^\/join\/([A-Za-z0-9_-]+)\/?$/;
function inviteTokenFromUrl() {
  const mm = location.pathname.match(INVITE_RE);
  if (mm) return mm[1];
  return new URLSearchParams(location.search).get('invite') || null;
}

let deviceLabel = (function () {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Web';
})();

/* Any button-like element works even if the 3D canvas is dead or a script
   inside this module throws later: one plain DOM listener per screen. */
function wireTap(id, fn) {
  const el = $(id);
  if (!el) return;
  el.onclick = null;
  el.addEventListener('click', ev => {
    ev.preventDefault();
    ev.stopPropagation();
    try { fn(ev); } catch (e) { console.error('[tap]', e); }
  });
  el.addEventListener('touchend', ev => {
    ev.preventDefault();
    ev.stopPropagation();
    try { fn(ev); } catch (e) { console.error('[tap]', e); }
  }, { passive: false });
}

async function boot() {
  initThree();
  wireControls();
  setCamera('cine');
  preloadAnnouncer().catch(() => {});
  try {
    const saved = localStorage.getItem('cc_identity');
    if (saved) {
      try {
        const r = await apiPost('/api/restore', { identity: saved, device: deviceLabel });
        S.player = r.player;
        enterChampionship();
        return;
      } catch (e) { localStorage.removeItem('cc_identity'); }
    }
    const who = await api('/api/whoami');
    S.player = who.player;
    enterChampionship();
  } catch (e) {
    if (e && e.status && e.status !== 401) {
      console.error('[boot] session check failed', e.status);
      toast('SERVER NOT REACHABLE — TAP YOUR NAME TO RETRY', 6000);
    }
    // no session yet: the invitation (if any) decides who this phone must be
    showLogin(inviteTokenFromUrl());
  }
}

function showLogin(inviteToken) {
  $('login').classList.remove('hidden');
  $('hud').classList.add('hidden');
  $('lobby').classList.add('hidden');

  const invited = !!inviteToken;
  $('loginInvite').classList.toggle('hidden', !invited);
  $('loginAsk').textContent = invited ? 'Take your seat' : 'Choose your identity';

  // ask the server which match the invitation belongs to, so the phone can
  // tell the player what they are walking into before signing in
  if (invited) {
    fetch('/api/invite/' + inviteToken, { credentials: 'same-origin' })
      .then(r => r.json())
      .then(d => {
        if (d && d.match) {
          $('inviteMatch').textContent = 'MATCH ' + String(d.match.number).padStart(3, '0');
        }
      })
      .catch(() => {});
  }

  document.querySelectorAll('.player-btn').forEach(btn => {
    btn.disabled = false;
    btn.onclick = null;
    const id = btn.dataset.player;
    const tap = ev => {
      if (ev) { ev.preventDefault(); ev.stopPropagation(); }
      if (invited) $('inviteWho').textContent = PLAYER_NAMES[id];
      signIn(id, inviteToken);
    };
    btn.addEventListener('click', tap);
    btn.addEventListener('touchend', tap, { passive: false });
  });
}

const PLAYER_NAMES = { jeriel: 'JERIEL', loganathan: 'LOGANATHAN' };

/** pressing a name is all it takes: the server hands this device the seat */
async function signIn(id, inviteToken) {
  const btn = document.querySelector('.player-btn[data-player="' + id + '"]');
  if (btn) btn.disabled = true;
  try {
    const r = await apiPost('/api/login', { player: id, device: deviceLabel });
    S.player = r.player;
    sessionStorage.setItem('cc_player', id);
    if (r.identity) localStorage.setItem('cc_identity', r.identity);
    $('login').classList.add('hidden');
    $('loginNote').textContent = 'Tap your name to enter. Each phone stays signed in as that player.';
    enterChampionship(inviteToken);
  } catch (e) {
    console.error('[signIn]', e);
    $('loginNote').textContent = 'Could not sign in — tap your name again.';
    toast('SIGN-IN FAILED — TRY AGAIN', 4000);
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ------------------------------------------------------------------ championship entry */
async function enterChampionship(inviteToken) {
  // a match is only ever created by pressing NEW GAME, or joined via invitation
  let res;
  if (inviteToken) {
    res = await apiPost('/api/match', { join: inviteToken });
    history.replaceState({}, '', '/');
  } else {
    res = await apiPost('/api/match', {});
  }
  S.match = res.match || null;
  S.myColor = S.match ? S.match.viewerColor : null;
  refreshFromState(await api('/api/state'));
  openStream();
  startSyncFallback();

  const waitingForJoin = S.match && S.match.moves.length === 0 &&
    !(S.match.joined && S.match.joined.jeriel && S.match.joined.loganathan);
  if (!S.match || waitingForJoin) {
    // either nothing exists yet, or a match is waiting for the invited phone:
    // stay in the lobby so the invitation can be shared again
    markIntroSeen();
    setCamera('iso');
    showLobby();
    return;
  }
  if (!introAlreadySeen() && !S.reducedMotion) {
    playCinematic();
  } else {
    markIntroSeen();
    afterIntro();
  }
}

function showLobby() {
  $('hud').classList.add('hidden');
  $('lobby').classList.remove('hidden');
  $('lobbyMe').textContent = S.player ? PLAYER_NAMES[S.player.id] : '';
  const live = S.match && S.match.status !== 'completed';
  const awaiting = live && !(S.match.joined && S.match.joined.jeriel && S.match.joined.loganathan);

  $('btnResume').classList.toggle('hidden', !live || awaiting);
  if (live) $('btnResume').textContent = 'RESUME MATCH ' + String(S.match.number).padStart(3, '0');

  $('lobbyActions').classList.remove('hidden');
  $('lobbyInvite').classList.toggle('hidden', !awaiting);
  renderMatchmaking();
}

async function newGame() {
  const btn = $('btnNewGame');
  btn.disabled = true;
  btn.textContent = 'CREATING MATCH…';
  try {
    const r = await apiPost('/api/match', { create: true });
    S.match = r.match;
    S.myColor = S.match.viewerColor;
    refreshFromState(await api('/api/state'));
    openStream();
    if (S.match && S.match.joined && S.match.joined.jeriel && S.match.joined.loganathan) afterIntro();
    else showLobby();
  } catch (e) {
    toast('COULD NOT CREATE THE MATCH');
  } finally {
    btn.disabled = false;
    btn.textContent = 'NEW GAME';
  }
}

function renderMatchmaking() {
  if (!S.player) return;
  const other = S.player.id === 'jeriel' ? 'loganathan' : 'jeriel';
  const p = S.presence || {};
  for (const id of ['jeriel','loganathan']) {
    $(id + 'Status').textContent = p[id] && p[id].online ? 'ONLINE' : 'OFFLINE';
  }
  $('btnChallenge').textContent = 'CHALLENGE ' + PLAYER_NAMES[other].toUpperCase();
  const m = S.match;
  const pending = m && m.challenge && m.challenge.to === S.player.id && m.challenge.status === 'pending';
  $('challengeNotice').classList.toggle('hidden', !pending);
  if (pending) $('challengeText').textContent = PLAYER_NAMES[m.challenge.from] + ' challenged you to MATCH ' + String(m.number).padStart(3,'0');
  $('lobbyInvite').classList.toggle('hidden', !(m && m.status !== 'completed' && m.joined && !(m.joined.jeriel && m.joined.loganathan)));
  if (m) {
    $('lobbyInviteTitle').textContent = 'MATCH ' + String(m.number).padStart(3, '0');
    $('matchCode').textContent = m.matchCode || '------';
    $('challengeState').textContent = m.challenge && m.challenge.status === 'declined' ? 'Challenge declined.' : 'Waiting for the other player.';
  }
}
async function matchmaking(body) {
  try {
    const r = await apiPost('/api/match', body);
    S.match = r.match; S.myColor = S.match.colors[S.player.id];
    refreshFromState(await api('/api/state')); renderMatchmaking();
  } catch (e) { toast(e.message.toUpperCase(), 4000); }
}

function playCinematic() {
  introActive = true;
  $('login').classList.add('hidden');
  const els = {
    intro: $('intro'),
    sceneDark: $('sceneDark'), sceneAnnouncer: $('sceneAnnouncer'),
    sceneEntrance: $('sceneEntrance'), sceneConfrontation: $('sceneConfrontation'),
    sceneFinal: $('sceneFinal'),
    darkVignette: $('darkVignette'), darkText: $('darkText'),
    entranceCard: $('entranceCard'), entranceLabel: $('entranceLabel'),
    entranceName: $('entranceName'),
    confMatch: $('confMatch'), confColors: $('confColors'),
    btnSkip: $('btnSkip'), btnEnter: $('btnEnter')
  };
  runIntro({
    camera, scene, els,
    matchNumber: S.match ? S.match.number : 1,
    colors: S.match ? S.match.colors : { jeriel: 'w', loganathan: 'b' },
    reducedMotion: S.reducedMotion,
    onFinish: () => { introActive = false; $('intro').classList.add('hidden'); afterIntro(); }
  });
}

window.__setCam = m => setCamera(m);
window.__orbit = (y, p) => orbitBy(y, p);
window.__camState = () => ({ yaw: +camRig.yaw.toFixed(2), pitch: +camRig.pitch.toFixed(2), r: +camRig.radius.toFixed(1), mode: S.camMode });
window.__board = () => S.board.map((p, i) => p ? (String.fromCharCode(97 + (i % 8)) + (8 - Math.floor(i / 8)) + p) : null).filter(Boolean);
window.__turn = () => (S.match ? S.match.turn : null);
window.__handleSquare = i => handleSquare(i);
window.__sqIndex = sq => (8 - parseInt(sq[1], 10)) * 8 + (sq.charCodeAt(0) - 97);
window.__cam = (px,py,pz,tx,ty,tz) => { camRig.autoOrbit=false; camRig.desiredPos.set(px,py,pz); camRig.target.set(tx,ty,tz); };
window.__W = null; window.__scene = null; window.__hz = ()=>{window.__W=WORLD;window.__scene=scene;};
window.__getCam = () => ({mode: S.camMode, color: S.myColor});
window.__diag = function(){
  return {
    pieces: getPieceCount(),
    boardFilled: S.board.filter(Boolean).length,
    matchNumber: S.match && S.match.number,
    myColor: S.myColor,
    moveCount: S.match ? S.match.moves.length : 0,
    status: S.match ? S.match.status : null,
    inGame: S.inGame,
    camera: camera ? camera.position.toArray().map(n=>+n.toFixed(1)) : null
  };
};

function afterIntro() {
  introActive = false;
  $('intro').classList.add('hidden');
  $('hud').classList.remove('hidden');
  S.inGame = true;
  setCamera('iso');
  setMusicMode('gameplay');
  startAmbience();
  updateHUD();
  renderBoardFromMatch();
}

/* ------------------------------------------------------------------ live stream */
let streamRetry = null;
let syncTimer = null;
let streamHealthy = false;

function startSyncFallback() {
  if (syncTimer) return;
  syncTimer = setInterval(async () => {
    if (!S.player) return;
    if (streamHealthy) {
      // stream is fine but a cheap heartbeat keeps this phone marked present
      try { await api('/api/ping'); } catch (e) {}
      return;
    }
    try {
      refreshFromState(await api('/api/state'));
      if (S.match) { S.match = S.match; }
    } catch (e) {}
  }, 2500);
}
function stopSyncFallback() {
  if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
}

function openStream() {
  if (streamRetry) { clearTimeout(streamRetry); streamRetry = null; }
  if (S.es) { try { S.es.close(); } catch (e) {} }
  const es = new EventSource('/api/events');
  S.es = es;

  // if the stream drops (mobile network change, proxy idle-close), reconnect
  // immediately instead of waiting on the browser's default backoff
  es.onopen = () => {
    streamHealthy = true;
    stopSyncFallback();
    // a dropped connection pauses the match; coming back should resume it
    if (S.player) {
      apiPost('/api/resume', {}).then(r => {
        if (r && r.match) refreshFromState(r);
      }).catch(() => {});
    }
  };
  es.onerror = () => {
    if (S.es !== es) return;
    streamHealthy = false;
    startSyncFallback();          // the board keeps updating while the stream is down
    try { es.close(); } catch (e) {}
    if (streamRetry) clearTimeout(streamRetry);
    streamRetry = setTimeout(() => {
      if (S.player) openStream();
    }, 1500);
  };

  es.addEventListener('state', ev => {
    const d = JSON.parse(ev.data);
    refreshFromState(d);
  });
  es.addEventListener('session-ended', ev => {
    S.player = null; S.match = null; S.inGame = false;
    try { es.close(); } catch (e) {}
    S.es = null;
    $('lobby').classList.add('hidden');
    $('hud').classList.add('hidden');
    $('waiting').classList.add('hidden');
    showLogin(null);
    $('loginNote').textContent = 'This player was signed in on another phone. Sign in again to continue.';
  });
  es.addEventListener('tick', ev => {
    const d = JSON.parse(ev.data);
    S.presence = d.presence;
    renderMatchmaking();
    S.waitStarted = d.waitStarted;
    S.countdown = d.countdown;
    updateHUD();
    updateWaiting(d);
    updateCountdown(d);
  });
  es.addEventListener('move', ev => {
    const d = JSON.parse(ev.data);
    onRemoteMove(d);
  });
  es.addEventListener('match-start', () => {
    sfx('start');
    toast('MATCH STARTED');
    setMusicMode('gameplay');
  });
  es.addEventListener('match-paused', ev => {
    const d = JSON.parse(ev.data);
    showPause(d);
  });
  es.addEventListener('match-resumed', () => {
    $('pause').classList.add('hidden');
    toast('BOTH PLAYERS RECONNECTED');
  });
  es.addEventListener('resigned', ev => {
    const d = JSON.parse(ev.data);
    S.match = d.match;
    renderBoardFromMatch();
    showResult('RESIGNATION', (d.match.result === 'draw' ? 'DRAW' :
      (d.match.result === (S.player.id) ? 'YOU WIN' : 'YOU LOSE')) + ' — ' +
      (d.by === S.player.id ? 'YOU RESIGNED' : 'OPPONENT RESIGNED'));
    sfx('end');
  });
  es.addEventListener('draw-agreed', ev => {
    const d = JSON.parse(ev.data);
    S.match = d.match;
    showResult('DRAW', 'BY AGREEMENT');
  });
  es.addEventListener('countdown-cancelled', () => {
    $('countdown').classList.add('hidden');
    toast('PLAYER DISCONNECTED — COUNTDOWN CANCELLED');
  });
  es.onerror = () => {
    setTimeout(() => { if (!S.es || S.es.readyState === 2) openStream(); }, 2000);
  };
}

function refreshFromState(d) {
  if (!d) return;
  if (d.presence) S.presence = d.presence;
  if (S.player) renderMatchmaking();
  if (d.match) {
    S.match = d.match;
    S.myColor = d.match.viewerColor || (S.player && d.match.colors[S.player.id]);
  }
  if (S.player) renderMatchmaking();
  if (d.archive) S.archive = d.archive;
  if (d.countdown !== undefined) S.countdown = d.countdown;
  if (d.waitStarted !== undefined) S.waitStarted = d.waitStarted;
  updateHUD();
  renderBoardFromMatch();

  // both phones are in the same match now: leave the invitation screen and play
  const joinedBoth = S.match && S.match.joined && S.match.joined.jeriel && S.match.joined.loganathan;
  if (joinedBoth && !S.inGame && !introActive) {
    const inLobby = !$('lobby').classList.contains('hidden');
    if (inLobby) {
      S.match = S.match;
      S.myColor = S.match.colors[S.player.id];
      $('lobby').classList.add('hidden');
      $('login').classList.add('hidden');
      markIntroSeen();
      afterIntro();
      toast('BOTH PLAYERS CONNECTED');
      return;
    }
  }
  if (S.inGame) {
    updateWaiting(d);
    updateCountdown(d);
    checkPauseState();
  }
}

/* ------------------------------------------------------------------ board */
function renderBoardFromMatch(animateMoveInfo) {
  if (!S.match) return;
  // reconstruct the position by requesting it from the server view + local engine
  // the server sends SAN list; we apply it with a tiny embedded parser via /api/move history
  // => we keep a local copy of the board by replaying SANs
  const board = window.__replay(S.match.moves);
  S.board = board;
  setPosition(board, false);

  const last = S.match.moves.length ? lastMoveSquares(S.match.moves, board) : null;
  S.lastMove = last;
  const checkSq = S.match.inCheck ? findKingSq(board, S.match.turn) : -1;
  applySquareHighlight(S.selected, S.targets, last, checkSq);
  setSelected(S.selected);
  updateCaptured(board);
}

/* local chess helpers (SAN replay uses the server as authority; this mirrors it) */
function findKingSq(board, turn) {
  const target = turn === 'w' ? 'K' : 'k';
  for (let i = 0; i < 64; i++) if (board[i] === target) return i;
  return -1;
}
function lastMoveSquares(moves, board) {
  // derive the highlight by locating the most recent SAN on the previous position
  if (!moves || !moves.length) return null;
  const lastSan = moves[moves.length - 1];
  const prevBoard = window.__replay(moves.slice(0, -1));
  const mv = window.__moveSquares(prevBoard, lastSan);
  return mv ? { from: mv.from, to: mv.to } : null;
}

function updateCaptured(board) {
  const counts = { w: { p: 8, n: 2, b: 2, r: 2, q: 1 }, b: { p: 8, n: 2, b: 2, r: 2, q: 1 } };
  const live = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  board.forEach(p => {
    if (!p) return;
    const side = (p === p.toUpperCase()) ? 'w' : 'b';
    const t = p.toLowerCase();
    if (live[side][t] !== undefined) live[side][t]++;
  });
  const glyph = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛' };
  function capturedBy(us) {
    const them = us === 'w' ? 'b' : 'w';
    let out = '';
    for (const t of ['q', 'r', 'b', 'n', 'p']) {
      const missing = counts[them][t] - live[them][t];
      for (let i = 0; i < missing; i++) out += glyph[t];
    }
    return out;
  }
  const mySide = S.myColor || 'w';
  $('meCaptured').textContent = capturedBy(mySide);
  $('oppCaptured').textContent = capturedBy(mySide === 'w' ? 'b' : 'w');
}

/* ------------------------------------------------------------------ HUD */
function updateHUD() {
  const p = S.presence || { jeriel: {}, loganathan: {} };
  const me = S.player ? S.player.id : null;
  const oppId = me === 'jeriel' ? 'loganathan' : 'jeriel';
  const meP = p[me] || { name: '', online: false };
  const oppP = p[oppId] || { name: '', online: false };

  $('meName').textContent = (meP.name || '').toUpperCase();
  $('oppName').textContent = (oppP.name || '').toUpperCase();
  $('meDot').className = 'pp-dot' + (meP.online ? ' on' : '');
  $('oppDot').className = 'pp-dot' + (oppP.online ? ' on' : '');
  $('meStatus').textContent = meP.online ? 'ONLINE' : 'OFFLINE';
  $('oppStatus').textContent = oppP.online ? 'ONLINE' : 'OFFLINE';

  if (S.match) {
    $('matchChip').textContent = 'MATCH ' + String(S.match.number).padStart(3, '0') + ' / 500';
    const myColor = S.match.colors[me];
    const oppColor = S.match.colors[oppId];
    $('meColor').textContent = myColor === 'w' ? 'WHITE' : 'BLACK';
    $('oppColor').textContent = oppColor === 'w' ? 'WHITE' : 'BLACK';
    S.myColor = myColor;

    const banner = $('turnBanner');
    banner.className = 'turn-banner';
    if (S.match.status === 'paused') {
      banner.textContent = 'MATCH PAUSED';
    } else if (S.match.status !== 'in-progress') {
      banner.textContent = 'MATCH ' + S.match.status.toUpperCase();
    } else if (!p.both) {
      banner.textContent = 'WAITING FOR OPPONENT';
    } else {
      const myTurn = S.match.turn === myColor;
      banner.textContent = myTurn
        ? (S.match.inCheck ? 'CHECK — YOUR TURN' : 'YOUR TURN')
        : (S.match.inCheck ? 'CHECK — OPPONENT\'S TURN' : 'OPPONENT\'S TURN');
      if (myTurn) banner.classList.add('mine');
      if (S.match.inCheck) banner.classList.add('check');
    }
  }
}

/* ------------------------------------------------------------------ waiting + countdown */
function updateWaiting(d) {
  const both = d && d.presence ? d.presence.both : (S.presence && S.presence.both);
  const waiting = $('waiting');
  if (S.countdown) { waiting.classList.add('hidden'); return; }
  if (!both) {
    waiting.classList.remove('hidden');
    const me = S.player ? S.player.id : 'jeriel';
    const oppId = me === 'jeriel' ? 'loganathan' : 'jeriel';
    const oppName = oppId.toUpperCase();
    const myName = me.toUpperCase();
    $('waitTitle').textContent = myName + ' HAS ENTERED THE CHAMPIONSHIP';
    $('waitOwnStatus').innerHTML = 'YOUR STATUS: <span class="on">ONLINE</span>';
    $('waitSub').textContent = 'WAITING FOR ' + oppName + '…';
    $('waitCountdown').classList.add('hidden');
    $('waitTimer').classList.remove('hidden');
    const start = S.waitStarted || Date.now();
    const el = $('waitTimer');
    clearInterval(el._t);
    const tick = () => {
      const secs = Math.max(0, Math.floor((Date.now() - start) / 1000));
      const hh = String(Math.floor(secs / 3600)).padStart(2, '0');
      const mm = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
      const ss = String(secs % 60).padStart(2, '0');
      el.textContent = hh + ':' + mm + ':' + ss;
    };
    tick();
    el._t = setInterval(tick, 1000);
    $('waitNote').textContent = 'YOUR GAME IS SAVED. IT RESUMES THE MOMENT BOTH PLAYERS ARE ONLINE.';
  } else {
    waiting.classList.add('hidden');
  }
}

function updateCountdown(d) {
  const cd = $('countdown');
  if (!S.countdown) {
    cd.classList.add('hidden');
    if (S._cdTimer) { clearInterval(S._cdTimer); S._cdTimer = null; }
    return;
  }
  cd.classList.remove('hidden');
  const startAt = S.countdown.startAt;
  const resume = S.countdown.resume;
  $('cdSub').textContent = resume ? 'MATCH RESUMING' : 'LET THE MATCH BEGIN';
  if (S._cdTimer) return;
  const paint = () => {
    const left = Math.max(0, Math.ceil((startAt + 5000 - Date.now()) / 1000));
    $('cdNumber').textContent = left > 0 ? left : '1';
    if (left <= 0) {
      clearInterval(S._cdTimer); S._cdTimer = null;
      cd.classList.add('hidden');
    }
  };
  paint();
  S._cdTimer = setInterval(paint, 250);
}

/* ------------------------------------------------------------------ pause */
function showPause(d) {
  const m = S.match;
  $('pauseTitle').textContent = 'MATCH ' + String(m ? m.number : 1).padStart(3, '0') + ' — PAUSED';
  $('pauseReason').textContent = 'OPPONENT DISCONNECTED';
  $('pause').classList.remove('hidden');
}
function checkPauseState() {
  const both = S.presence && S.presence.both;
  if (both) {
    $('pause').classList.add('hidden');
  } else if (S.match && S.match.moves && S.match.moves.length > 0 && S.inGame) {
    showPause();
  }
}

/* ------------------------------------------------------------------ interaction */
function onPointerDown(ev) {
  if (!S.inGame || ev.button === 2) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  const sq = pickSquare(raycaster, camera, pointer);
  if (sq < 0) { S.selected = -1; S.targets = []; setSelected(-1); renderBoardFromMatch(); return; }
  handleSquare(sq);
}

async function handleSquare(sq) {
  if (!S.match) return;
  if (S.match.status !== 'in-progress') { toast('MATCH IS ' + S.match.status.toUpperCase()); return; }
  if (!S.presence || !S.presence.both) { toast('WAITING FOR OPPONENT'); return; }
  if (S.match.turn !== S.myColor) { toast('NOT YOUR TURN'); return; }

  const me = S.myColor;
  const p = S.board[sq];
  const mine = p && ((me === 'w') === (p === p.toUpperCase()));

  if (S.selected >= 0) {
    const legal = S.targets.filter(t => t.to === sq);
    if (legal.length === 1) { await sendMove(legal[0].san); return; }
    if (legal.length > 1) { askPromotion(legal); return; }
  }
  if (mine) {
    S.selected = (S.selected === sq) ? -1 : sq;
    if (S.selected >= 0) {
      S.targets = window.__movesFrom(S.board, sq, me);
      sfx('select');
    } else S.targets = [];
    setSelected(S.selected);
    const checkSq = S.match.inCheck ? findKingSq(S.board, S.match.turn) : -1;
    applySquareHighlight(S.selected, S.targets.map(t => t.to), null, checkSq);
  } else {
    S.selected = -1; S.targets = [];
    setSelected(-1);
    renderBoardFromMatch();
  }
}

function askPromotion(options) {
  $('modalPromo').classList.remove('hidden');
  document.querySelectorAll('.promo-btn').forEach(btn => {
    btn.onclick = async () => {
      $('modalPromo').classList.add('hidden');
      const pick = options.find(o => o.san.includes('=' + btn.dataset.promo.toUpperCase()));
      if (pick) await sendMove(pick.san);
    };
  });
}

async function sendMove(san) {
  const prevBoard = S.board.slice();
  const prevSelected = S.selected;
  const expectCount = S.match.moves.length;
  // optimistic animation
  const anim = window.__moveSquares(S.board, san);
  S.selected = -1; S.targets = []; setSelected(-1);
  if (anim) {
    sfx(anim.captured ? 'capture' : 'move');
    await animateMove(anim.from, anim.to, 0.42, anim.captured);
  }
  try {
    const r = await apiPost('/api/move', { san, expectCount });
    if (r.match) {
      S.match = r.match;
      S.myColor = r.match.viewerColor;
      renderBoardFromMatch();
      updateHUD();
      flashSaved();
      if (r.match.status !== 'in-progress') showResultFromMatch();
      if (r.match.inCheck) sfx('check');
    }
  } catch (e) {
    // reconcile: revert to authoritative server position
    S.board = prevBoard; S.selected = prevSelected;
    renderBoardFromMatch();
    toast('MOVE REJECTED — SYNCHRONISING');
    const st = await api('/api/state');
    refreshFromState(st);
  }
}

let remoteBusy = false;
async function onRemoteMove(d) {
  if (remoteBusy) return;
  remoteBusy = true;
  try {
    if (d.match) {
      S.match = d.match;
      S.myColor = d.match.viewerColor || (S.player && d.match.colors[S.player.id]);
      const san = d.san;
      const anim = window.__moveSquares(S.board, san);
      if (anim) {
        sfx(anim.captured ? 'capture' : 'move');
        await animateMove(anim.from, anim.to, 0.42, anim.captured);
      }
      renderBoardFromMatch();
      updateHUD();
      if (S.match.status !== 'in-progress') showResultFromMatch();
      if (S.match.inCheck) sfx('check');
    }
  } finally {
    remoteBusy = false;
  }
}

function flashSaved() {
  const c = $('saveChip');
  c.classList.add('show');
  clearTimeout(c._t);
  c._t = setTimeout(() => c.classList.remove('show'), 1600);
}

/* ------------------------------------------------------------------ result */
function showResultFromMatch() {
  const m = S.match;
  if (!m) return;
  let title = 'MATCH COMPLETE', text = '';
  const winner = m.result === 'draw' ? null : m.result;
  if (m.reason === 'checkmate') title = 'CHECKMATE';
  else if (m.reason === 'resignation') title = 'PLAYER RESIGNED';
  else if (m.reason === 'stalemate') title = 'STALEMATE';
  else if (m.reason === 'agreement') title = 'DRAW AGREED';
  else if (m.reason) title = m.reason.toUpperCase();
  if (winner === null) text = 'DRAW';
  else if (winner === S.player.id) text = 'YOU WIN';
  else text = 'YOU LOSE — ' + (m.players ? m.players[winner].toUpperCase() : '') + ' WINS';
  showResult(title, text);
}
function showResult(title, text) {
  $('resultTitle').textContent = title;
  $('resultText').textContent = text;
  $('modalResult').classList.remove('hidden');
  sfx('end');
}

/* ------------------------------------------------------------------ controls */
function wireControls() {
  $('btnNewGame').onclick = newGame;
  $('btnChallenge').onclick = () => matchmaking({challenge:S.player.id === 'jeriel' ? 'loganathan' : 'jeriel'});
  $('btnAccept').onclick = () => matchmaking({respond:'accept'});
  $('btnDecline').onclick = () => matchmaking({respond:'decline'});
  $('btnJoinCode').onclick = () => matchmaking({code:$('codeInput').value.trim()});
  $('btnSignOutHud').onclick = doSignOut;
  $('btnSignOut').onclick = doSignOut;
  $('btnResume').onclick = () => { $('lobby').classList.add('hidden'); afterIntro(); };
  $('btnCamReset').onclick = () => setCamera('iso');
  $('btnCamTop').onclick = () => setCamera('top');
  $('btnCamIso').onclick = () => setCamera('cine');
  $('btnCamSky').onclick = () => setCamera('sky');
  $('btnCamVoyage').onclick = () => setCamera('voyage');
  $('btnSound').onclick = () => { syncSoundUI(); $('modalSound').classList.remove('hidden'); };
  $('btnSoundClose').onclick = () => $('modalSound').classList.add('hidden');
  $('btnArchive').onclick = openArchive;
  $('btnArchiveClose').onclick = () => $('modalArchive').classList.add('hidden');
  $('btnDismissWait').onclick = () => $('waiting').classList.add('hidden');

  $('btnResign').onclick = () => {
    $('resignTitle').textContent = (S.player ? S.player.name.toUpperCase() : '') + ' WANTS TO RESIGN';
    $('modalResign').classList.remove('hidden');
  };
  $('btnResignCancel').onclick = () => $('modalResign').classList.add('hidden');
  $('btnResignConfirm').onclick = async () => {
    $('modalResign').classList.add('hidden');
    try {
      const r = await apiPost('/api/resign', {});
      if (r.match) { S.match = r.match; renderBoardFromMatch(); showResultFromMatch(); }
    } catch (e) { toast('COULD NOT RESIGN'); }
  };
  $('btnResultClose').onclick = () => $('modalResult').classList.add('hidden');
  $('btnRematch').onclick = async () => {
    $('modalResult').classList.add('hidden');
    const r = await apiPost('/api/match', {});
    S.match = r.match; S.myColor = r.match.viewerColor;
    S.selected = -1; S.targets = [];
    renderBoardFromMatch(); updateHUD();
    toast(r.created ? 'MATCH ' + String(r.match.number).padStart(3, '0') + ' CREATED' : 'RESUMING MATCH');
  };

  // sound sliders
  const bind = (id, key, scale) => {
    const el = $(id);
    el.oninput = () => {
      SOUND[key] = el.value / 100;
      applyVolumes();
      localStorage.setItem('cc_' + key, el.value);
    };
  };
  bind('volMaster', 'master');
  bind('volMusic', 'musicVol');
  bind('volAnn', 'annVol');
  bind('volAmb', 'ambVol');
  bind('volChess', 'chessVol');
  $('volMaster').oninput = () => {
    SOUND.master = (+$('volMaster').value) > 0;
    applyVolumes();
  };
  $('qualitySelect').onchange = () => {
    S.quality = $('qualitySelect').value;
    localStorage.setItem('cc_quality', S.quality);
    toast('RELOAD TO APPLY QUALITY: ' + S.quality.toUpperCase());
  };

  // pointer + gestures: drag anywhere on the board to look around (360°),
  // a quick tap still selects a square
  const el = renderer.domElement;
  el.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    el._down = { x: e.clientX, y: e.clientY, t: Date.now(), moved: false };
  });
  el.addEventListener('pointermove', e => {
    if (!el._down) return;
    const dx = e.clientX - el._down.x, dy = e.clientY - el._down.y;
    if (Math.hypot(dx, dy) > 8) el._down.moved = true;
    if (e.buttons === 2 || (e.pointerType === 'mouse' && e.buttons === 1 && e.shiftKey)) {
      // right-drag: a fine look-around that never disturbs a tap
      orbitBy(dx * 0.005, -dy * 0.004);
      el._down.x = e.clientX; el._down.y = e.clientY;
    }
  });
  el.addEventListener('pointerup', e => {
    const d = el._down; el._down = null;
    if (!d) return;
    if (!d.moved && Date.now() - d.t < 600) onPointerDown(e);
  });
  el.addEventListener('wheel', e => { e.preventDefault(); zoomBy(e.deltaY > 0 ? 1.08 : 0.92); }, { passive: false });
  el.addEventListener('contextmenu', e => e.preventDefault());

  // touch: one finger looks around the whole world, two fingers zoom
  let pinchStart = null, touchLast = null, touchMoved = false;
  el.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      pinchStart = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchLast = null;
    } else if (e.touches.length === 1) {
      touchLast = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      touchMoved = false;
    }
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (e.touches.length === 2 && pinchStart) {
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      zoomBy(pinchStart / d);
      pinchStart = d;
      touchMoved = true;
    } else if (e.touches.length === 1 && touchLast) {
      const dx = e.touches[0].clientX - touchLast.x;
      const dy = e.touches[0].clientY - touchLast.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) {
        touchMoved = true;
        orbitBy(-dx * 0.006, -dy * 0.005);
        touchLast = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
      e.preventDefault();
    }
  }, { passive: false });
  el.addEventListener('touchend', () => { pinchStart = null; touchLast = null; });

  // keyboard
  window.addEventListener('keydown', e => {
    if (e.key === '1') setCamera('iso');
    if (e.key === '2') setCamera('top');
    if (e.key === '3') setCamera('close');
    if (e.key === '4') setCamera('cine');
    if (e.key === '5') setCamera('sky');
    if (e.key === '6') setCamera('voyage');
    if (e.key === 'r' || e.key === 'R') setCamera('iso');
    if (e.key === '+' || e.key === '=') zoomBy(0.9);
    if (e.key === '-' || e.key === '_') zoomBy(1.1);
    if (e.key === 'ArrowLeft') orbitBy(-0.12, 0);
    if (e.key === 'ArrowRight') orbitBy(0.12, 0);
    if (e.key === 'ArrowUp') orbitBy(0, 0.08);
    if (e.key === 'ArrowDown') orbitBy(0, -0.08);
  });
}

async function doSignOut() {
  try { await apiPost('/api/logout', {}); } catch (e) {}
  S.player = null; S.match = null; S.inGame = false;
  if (S.es) { try { S.es.close(); } catch (e) {} S.es = null; }
  ['lobby', 'hud', 'waiting', 'pause', 'countdown'].forEach(id => $(id) && $(id).classList.add('hidden'));
  stopSyncFallback();
  showLogin(null);
  toast('SIGNED OUT — CHOOSE A PLAYER');
}

function syncSoundUI() {
  $('volMaster').value = SOUND.master ? 100 : 0;
  $('volMusic').value = Math.round(SOUND.musicVol * 100);
  $('volAnn').value = Math.round(SOUND.annVol * 100);
  $('volAmb').value = Math.round(SOUND.ambVol * 100);
  $('volChess').value = Math.round(SOUND.chessVol * 100);
  $('qualitySelect').value = S.quality;
}

async function openArchive() {
  showArchiveListLoading();
  $('modalArchive').classList.remove('hidden');
  try {
    const d = await api('/api/archive');
    const s = d.stats;
    $('stTotal').textContent = s.total;
    $('stJeriel').textContent = s.jerielWins;
    $('stLogan').textContent = s.loganathanWins;
    $('stDraws').textContent = s.draws;
    $('stUnfinished').textContent = s.unfinished;
    $('stResign').textContent = s.resignations;
    const list = $('archiveList');
    if (!d.matches.length) {
      list.innerHTML = '<div class="archive-empty">NO MATCHES PLAYED YET</div>';
      return;
    }
    list.innerHTML = d.matches.map(m => {
      const res = m.result === 'draw' ? 'DRAW'
        : (m.result ? (m.winner || '').toUpperCase() + ' WON' : m.status.toUpperCase());
      return '<div class="archive-row" data-id="' + m.id + '">' +
        '<span>MATCH ' + String(m.number).padStart(3, '0') + '</span>' +
        '<span class="ar-mid">' + m.moveCount + ' moves · ' + m.status.toUpperCase() + '</span>' +
        '<span class="ar-res">' + res + '</span></div>';
    }).join('');
    list.querySelectorAll('.archive-row').forEach(row => {
      row.onclick = () => openArchivedMatch(row.dataset.id);
    });
  } catch (e) {
    $('archiveList').innerHTML = '<div class="archive-empty">COULD NOT LOAD ARCHIVE</div>';
  }
}
async function openArchivedMatch(id) {
  try {
    const d = await api('/api/match/' + id);
    const m = d.match;
    const board = window.__replay(m.moves.map(x => x.san));
    setPosition(board, false);
    S.board = board;
    S.selected = -1; S.targets = [];
    applySquareHighlight(null, [], null, -1);
    $('modalArchive').classList.add('hidden');
    toast('MATCH ' + String(m.number).padStart(3, '0') + ' · ' + m.moves.length + ' MOVES · ' + (m.status || '').toUpperCase(), 4000);
    // a small replay stepper
    if (m.moves.length) {
      let i = m.moves.length;
      const step = () => {
        i = Math.max(0, Math.min(m.moves.length, i));
        const bd = window.__replay(m.moves.slice(0, i).map(x => x.san));
        setPosition(bd, false);
        const lastMv = i > 0 ? window.__moveSquares(window.__replay(m.moves.slice(0, i - 1).map(x => x.san)), m.moves[i - 1].san) : null;
        applySquareHighlight(null, [], lastMv, -1);
        toast('MOVE ' + i + ' / ' + m.moves.length + '   (← → to step)', 1500);
      };
      step();
      window._replayStep = d2 => { i += d2; step(); };
    }
  } catch (e) { toast('COULD NOT OPEN MATCH'); }
}

function showArchiveListLoading() {
  $('archiveList').innerHTML = '<div class="archive-empty">LOADING…</div>';
}

/* ------------------------------------------------------------------ boot */
window.addEventListener('DOMContentLoaded', () => {
  // Three.js must be initialised first: wireControls touches renderer.domElement
  boot();
});
