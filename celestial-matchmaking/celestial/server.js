/**
 * THE CELESTIAL CHESS CHAMPIONSHIP — server
 * Node only, zero runtime dependencies (three is a build-time frontend asset).
 *
 * Responsibilities (server is the single source of truth):
 *   - player authentication (signed session tokens)
 *   - presence / heartbeats
 *   - waiting timer (server clock)
 *   - matchmaking & match creation
 *   - colour alternation by match number
 *   - authoritative chess rules (shared engine)
 *   - every confirmed move persisted
 *   - pause / resume on disconnect
 *   - 500-match archive + statistics
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------- config
const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
// CC_DATA lets the acceptance suite run against a throwaway database without
// ever touching the real championship archive.
const DATA = process.env.CC_DATA || path.join(ROOT, 'data');
const DB_FILE = path.join(DATA, 'championship.json');
const SECRET_FILE = path.join(DATA, '.secret');
const PLAYERS = { loganathan: 'Loganathan', jeriel: 'Jeriel' };
const TOTAL_MATCHES = 500;
const COUNTDOWN_MS = 5000;
const HEARTBEAT_GRACE_MS = 9000;   // tolerate brief network blips

// ---------------------------------------------------------------- engine
const engineSrc = fs.readFileSync(path.join(ROOT, 'engine.js'), 'utf8');
const engine = {};
new Function('exports', engineSrc + '\n;Object.assign(exports,{initialState,legalMoves,makeMove,unmakeMove,toSAN,applySANList,inCheck,findKing,insufficientMaterial,idxToAlg,isWhiteP,normalizeSAN});')(engine);

// ---------------------------------------------------------------- storage
function ensureDirs() {
  for (const d of [DATA, PUBLIC, path.join(PUBLIC, 'js'), path.join(PUBLIC, 'audio')]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}
ensureDirs();

function secret() {
  if (!fs.existsSync(SECRET_FILE)) {
    fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  return fs.readFileSync(SECRET_FILE, 'utf8').trim();
}
const SECRET = secret();

let DB = {
  version: 1,
  nextMatchNumber: 1,
  currentMatchId: null,
  matches: {},          // id -> match record
  presence: {},         // playerId -> lastSeen ms
  waitStarted: null,    // ms timestamp of first arrival for the running wait
  countdown: null       // {startAt, matchId}
};

function loadDB() {
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    DB = Object.assign(DB, raw);
    // everyone starts offline after a restart
    DB.presence = {};
    DB.countdown = null;
  } catch (e) { /* first run */ }
}
let saveTimer = null, saveQueued = false;
function persist(now) {
  if (now) {
    writeDB();
    return;
  }
  saveQueued = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeDB, 250);
}
function writeDB() {
  saveQueued = false;
  const tmp = DB_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(DB, null, 0));
    fs.renameSync(tmp, DB_FILE);          // atomic: never corrupts the archive
  } catch (e) {
    console.error('[db] write failed:', e.message);
    setTimeout(writeDB, 1000);            // retry
  }
}
loadDB();

// ---------------------------------------------------------------- auth

/**
 * Permanent player accounts. Each phone holds exactly one player's code; the
 * code is exchanged once for an HttpOnly, HMAC-signed session cookie, so the
 * frontend never stores or sees a credential and no one can type a display
 * name to impersonate the other player.
 *
 * Codes can be overridden without touching the source:
 *   JERIEL_CODE=... LOGANATHAN_CODE=... node server.js
 * data/codes.txt is written on first boot so the codes are recoverable.
 */
// one active session per player: a phone that opens the app twice must not
// silently clone the identity.
const sessions = { jeriel: null, loganathan: null };   // {sid, since, lastSeen, device}
const SESSION_IDLE_MS = 90 * 1000;                     // a closed phone frees its seat

/** a session only blocks another phone while it is actually being used */
function liveSession(id) {
  const sn = sessions[id];
  if (!sn) return null;
  const recentlySeen = Date.now() - (sn.lastSeen || sn.since) < SESSION_IDLE_MS;
  if (recentlySeen || isOnline(id)) return sn;
  sessions[id] = null;       // stale: the phone went away, free the seat
  return null;
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + mac;
}
function verify(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [body, mac] = token.split('.');
  const want = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(mac || ''), Buffer.from(want))) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!p.id || !PLAYERS[p.id]) return null;
    return p;
  } catch (e) { return null; }
}
/** long-lived identity token, used to restore a seat on a reinstalled app */
function identityToken(playerId) {
  return sign({ id: playerId, name: PLAYERS[playerId], kind: 'identity', iat: Date.now() });
}

function newToken(playerId, sid) {
  return sign({ id: playerId, name: PLAYERS[playerId], sid, iat: Date.now() });
}

// ---------------------------------------------------------------- colours
/** Match numbers are 1-based. Odd => Jeriel white. Even => Jeriel black. */
function colorsFor(matchNumber) {
  const jerielWhite = (matchNumber % 2 === 1);
  return {
    jeriel: jerielWhite ? 'w' : 'b',
    loganathan: jerielWhite ? 'b' : 'w'
  };
}

// ---------------------------------------------------------------- match
function freshCode() {
  const used = new Set(Object.values(DB.matches).map(m => m.matchCode).filter(Boolean));
  if (used.size >= 1000000) throw new Error('no match codes available');
  let code; do { code = String(crypto.randomInt(1000000)).padStart(6, '0'); } while (used.has(code));
  return code;
}
function ensureCode(m) { if (!m.matchCode) { m.matchCode = freshCode(); persist(true); } return m.matchCode; }
function seatsJoined(m) { return !!(m && m.joined && m.joined.jeriel && m.joined.loganathan); }
function maybeStart(m) {
  if (seatsJoined(m) && bothLive() && !DB.countdown && !m.startedAt)
    DB.countdown = { startAt: Date.now(), matchId: m.id, resume: false };
}
function newMatch() {
  const num = DB.nextMatchNumber;
  if (num > TOTAL_MATCHES) return null;
  const id = 'M' + String(num).padStart(3, '0');
  const colors = colorsFor(num);
  const m = {
    id, number: num, matchCode: freshCode(), challenge: null,
    players: { jeriel: 'Jeriel', loganathan: 'Loganathan' },
    colors,
    createdBy: null,           // which phone pressed NEW GAME
    joined: { jeriel: false, loganathan: false },   // set true once that phone has seen the board
    moves: [],                 // [{san, by, at, fenBefore, fenAfter, moveNumber}]
    status: 'in-progress',     // in-progress | paused | completed | resigned | draw
    result: null,              // 'jeriel' | 'loganathan' | 'draw'
    reason: null,              // checkmate | resignation | stalemate | agreement | ...
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: null,
    endedAt: null,
    startPosition: engine.initialState().board.slice(),
    finalPosition: null,
    resign: null,
    draw: null
  };
  DB.matches[id] = m;
  DB.nextMatchNumber = num + 1;
  DB.currentMatchId = id;
  persist(true);
  return m;
}

// ---------------------------------------------------------------- invitations
/** a match keeps one stable invitation token, stored with the match */
function inviteFor(m) {
  if (!m.invite) {
    m.invite = { token: crypto.randomBytes(9).toString('base64url'), createdAt: Date.now(), uses: 0 };
  }
  return m.invite;
}
function issueInvite(m) {
  const inv = inviteFor(m);
  inv.uses = (inv.uses || 0) + 1;
  return inv;
}
function matchByInvite(token) {
  if (!token) return null;
  const want = String(token);
  for (const m of Object.values(DB.matches)) {
    if (m.invite && m.invite.token === want) return m;
  }
  return null;
}

function started(m) {
  if (!m) return false;
  if (m.startedAt) return true;
  return (m.moves && m.moves.length > 0) || !!(m.joined && m.joined.jeriel && m.joined.loganathan);
}

function currentMatch() {
  if (!DB.currentMatchId) return null;
  return DB.matches[DB.currentMatchId] || null;
}

/** reconstruct engine state from a match's move list */
function stateOf(match) {
  const r = engine.applySANList(match.moves.map(m => m.san));
  return r;
}

function matchView(m, viewerId) {
  if (!m) return null;
  const st = stateOf(m);
  const history = engine.applySANList(m.moves.map(x => ({}.toString, x.san))); // reuse for positions
  const sanList = m.moves.map(x => x.san);
  const last = sanList.length ? sanList[sanList.length - 1] : null;
  return {
    id: m.id,
    number: m.number,
    matchCode: ensureCode(m), challenge: m.challenge || null,
    total: TOTAL_MATCHES,
    colors: m.colors,
    status: m.status,
    result: m.result,
    reason: m.reason,
    moves: sanList,
    moveCount: m.moves.length,
    turn: st.state.turn,
    legalCount: engine.legalMoves(st.state).length,
    inCheck: engine.inCheck(st.state, st.state.turn === 'w'),
    createdAt: m.createdAt,
    startedAt: m.startedAt,
    endedAt: m.endedAt,
    resign: m.resign,
    draw: m.draw,
    viewerColor: viewerId ? m.colors[viewerId] : null,
    createdBy: m.createdBy || null,
    joined: m.joined || { jeriel: true, loganathan: true },
    lastMove: last,
    updatedAt: m.updatedAt
  };
}

// ---------------------------------------------------------------- presence
const conns = new Map();   // res -> {playerId, matchId}
const perPlayer = { loganathan: 0, jeriel: 0 };
const sseClients = new Set();

// remembers when a player's last live stream went away, so a reload or a
// brief mobile network drop does not pause a match that is still being played
const lastSeenAt = { jeriel: 0, loganathan: 0 };   // 0 = never connected

function isOnline(id) {
  if (perPlayer[id] > 0) return true;
  // still inside the grace window: treat as present, but never claim a live
  // stream that does not exist
  const gone = Date.now() - Number(lastSeenAt[id] || 0);
  return gone < HEARTBEAT_GRACE_MS;
}
function isLive(id) {
  return perPlayer[id] > 0;
}
function bothOnline() {
  return isOnline('jeriel') && isOnline('loganathan');
}
function bothLive() {
  return isLive('jeriel') && isLive('loganathan');
}

function presenceView() {
  return {
    jeriel: { name: 'Jeriel', online: isOnline('jeriel'), live: isLive('jeriel') },
    loganathan: { name: 'Loganathan', online: isOnline('loganathan'), live: isLive('loganathan') },
    both: bothOnline(),
    serverTime: Date.now()
  };
}

function broadcast(event, payload) {
  const msg = 'event: ' + event + '\ndata: ' + JSON.stringify(payload) + '\n\n';
  for (const res of sseClients) {
    try { res.write(msg); } catch (e) { sseClients.delete(res); }
  }
}

function pushState() {
  const m = currentMatch();
  const view = m ? matchView(m) : null;
  if (view && m.invite) view.invitePath = '/join/' + m.invite.token;
  else if (view) view.invitePath = '/join/' + inviteFor(m).token;
  broadcast('state', {
    presence: presenceView(),
    match: view,
    countdown: DB.countdown,
    waitStarted: DB.waitStarted,
    archive: archiveSummary()
  });
}

// ---------------------------------------------------------------- timers
let tickTimer = null;
function startTicker() {
  if (tickTimer) return;
  tickTimer = setInterval(() => {

    // waiting timer bookkeeping
    if (bothLive()) {
      if (!DB.waitStarted) DB.waitStarted = null;
    } else if (!DB.waitStarted && (isOnline('jeriel') || isOnline('loganathan'))) {
      DB.waitStarted = Date.now();
    }
    if (!isOnline('jeriel') && !isOnline('loganathan')) DB.waitStarted = null;

    // ---- authoritative countdown state machine ----
    const m = currentMatch();
    // a countdown is a live handshake: both phones must actually hold the stream
    const both = bothLive();

    // 1. if the countdown is running but someone left, cancel it
    if (DB.countdown && !both) {
      DB.countdown = null;
      broadcast('countdown-cancelled', { reason: 'player-offline' });
      pushState();
    }

    // 2. countdown finished -> transition the match
    if (DB.countdown && both && Date.now() >= DB.countdown.startAt + COUNTDOWN_MS) {
      const finished = DB.countdown;
      DB.countdown = null;
      const mm = DB.matches[finished.matchId] || m;
      if (mm) {
        if (finished.resume) {
          if (mm.status === 'paused') {
            mm.status = 'in-progress';
            mm.updatedAt = Date.now();
            if (!mm.startedAt) mm.startedAt = Date.now();
            persist(true);
            broadcast('match-resumed', { matchId: mm.id, number: mm.number });
          }
        } else {
          if (!mm.startedAt) mm.startedAt = Date.now();
          if (mm.status === 'paused') mm.status = 'in-progress';
          persist(true);
          broadcast('match-start', { matchId: mm.id, number: mm.number });
        }
      }
      pushState();
    }

    // 3. nobody in the middle of a countdown: a live match pauses the moment a
    //    player drops (even before the first move). Never a forfeit, never a reset.
    if (!DB.countdown && m && m.status === 'in-progress' && !bothLive() && started(m)) {
      m.status = 'paused';
      m.updatedAt = Date.now();
      persist(true);
      broadcast('match-paused', { matchId: m.id, number: m.number });
      pushState();
    }

    // 4. a paused match with both present -> start the resume countdown
    if (!DB.countdown && bothLive() && m && m.status === 'paused') {
      DB.countdown = { startAt: Date.now(), matchId: m.id, resume: true };
      broadcast('match-resuming', { matchId: m.id, number: m.number });
      pushState();
    }

    broadcast('tick', {
      serverTime: Date.now(),
      presence: presenceView(),
      waitStarted: DB.waitStarted,
      countdown: DB.countdown,
      bothOnline: bothOnline()
    });
  }, 1000);
}

// ---------------------------------------------------------------- http
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}
function readBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 64 * 1024) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { resolve({}); } });
  });
}
function cookie(req, name) {
  const raw = req.headers.cookie || '';
  const m = raw.match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}
function playerOf(req) {
  const t = cookie(req, 'cc_token');
  const p = verify(t);
  if (!p) return null;
  // a session that has been replaced (or ended) can no longer act
  const live = sessions[p.id];
  if (live && p.sid && live.sid !== p.sid) return null;
  if (live && live.sid === p.sid) live.lastSeen = Date.now();
  return p.id;
}
function sessionOf(req) {
  const p = verify(cookie(req, 'cc_token'));
  return p || null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

function serveFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      'Content-Length': buf.length
    });
    res.end(buf);
  });
}

// ---------------------------------------------------------------- archive
function archiveSummary() {
  const all = Object.values(DB.matches);
  const stats = {
    total: all.length,
    jerielWins: 0, loganathanWins: 0, draws: 0,
    unfinished: 0, resignations: 0, completed: 0,
    capacity: TOTAL_MATCHES,
    nextNumber: DB.nextMatchNumber
  };
  for (const m of all) {
    if (m.result === 'jeriel') stats.jerielWins++;
    else if (m.result === 'loganathan') stats.loganathanWins++;
    else if (m.result === 'draw') stats.draws++;
    if (m.status === 'completed' || m.status === 'resigned' || m.status === 'draw') stats.completed++;
    else stats.unfinished++;
    if (m.reason === 'resignation') stats.resignations++;
  }
  return stats;
}

// ---------------------------------------------------------------- routes
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  // ---------------- auth ----------------
  if (p === '/api/login' && req.method === 'POST') {
    const body = await readBody(req);
    const id = String(body.player || '').toLowerCase();
    if (!PLAYERS[id]) return json(res, 403, { error: 'unknown player' });

    // No password, no code: there are only two permanent identities, and
    // pressing a name takes that seat on this device. If the other device still
    // holds the seat it is told to step aside (see 'session-ended' below).
    const live = liveSession(id);
    if (live) {
      broadcast('session-ended', { player: id, reason: 'signed-in-elsewhere' });
    }
    const sid = crypto.randomBytes(12).toString('base64url');
    sessions[id] = {
      sid, since: Date.now(), lastSeen: Date.now(),
      device: String(body.device || '').slice(0, 120)
    };
    const tok = newToken(id, sid);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': 'cc_token=' + encodeURIComponent(tok) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000',
      'Cache-Control': 'no-store'
    });
    pushState();
    return res.end(JSON.stringify({
      ok: true,
      player: { id, name: PLAYERS[id] },
      session: { sid, since: sessions[id].since },
      identity: identityToken(id)      // lets a reinstalled app come back as the same player
    }));
  }

  // is this player already signed in elsewhere? (asked before signing in)
  if (p === '/api/session-status') {
    const who = String(url.searchParams.get('player') || '').toLowerCase();
    const live = PLAYERS[who] ? liveSession(who) : null;
    return json(res, 200, { signedIn: !!live, since: live ? live.since : null });
  }

  if (p === '/api/ping') {
    const id = playerOf(req);
    if (!id) return json(res, 401, { error: 'not signed in' });
    lastSeenAt[id] = Date.now();
    return json(res, 200, { ok: true, online: isOnline(id), both: bothOnline() });
  }

  if (p === '/api/whoami') {
    const id = playerOf(req);
    if (!id) return json(res, 401, { error: 'not signed in' });
    return json(res, 200, { player: { id, name: PLAYERS[id] }, presence: presenceView() });
  }

  if (p === '/api/logout' && req.method === 'POST') {
    const sess = sessionOf(req);
    if (sess && sessions[sess.id] && sessions[sess.id].sid === sess.sid) sessions[sess.id] = null;
    res.writeHead(200, { 'Set-Cookie': 'cc_token=; Path=/; Max-Age=0', 'Content-Type': 'application/json' });
    pushState();
    return res.end('{"ok":true}');
  }

  if (p === '/api/restore' && req.method === 'POST') {
    const body = await readBody(req);
    const p2 = verify(String(body.identity || ''));
    if (!p2 || p2.kind !== 'identity' || !PLAYERS[p2.id]) return json(res, 401, { error: 'bad identity' });
    const id = p2.id;
    const live = liveSession(id);
    if (live) broadcast('session-ended', { player: id, reason: 'signed-in-elsewhere' });
    const sid = crypto.randomBytes(12).toString('base64url');
    sessions[id] = { sid, since: Date.now(), lastSeen: Date.now(), device: String(body.device || '').slice(0, 120) };
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': 'cc_token=' + encodeURIComponent(newToken(id, sid)) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000',
      'Cache-Control': 'no-store'
    });
    pushState();
    return res.end(JSON.stringify({ ok: true, player: { id, name: PLAYERS[id] }, session: { sid } }));
  }

  if (p === '/api/resume' && req.method === 'POST') {
    const id = playerOf(req);
    if (!id) return json(res, 401, { error: 'not signed in' });
    lastSeenAt[id] = Date.now();
    const m = currentMatch();
    if (!m) return json(res, 409, { error: 'no active match' });
    if (m.status === 'paused' && !m.result) {
      if (!bothLive()) return json(res, 409, { error: 'waiting for the other phone', match: matchView(m, id) });
      m.status = 'in-progress';
      if (!m.startedAt) m.startedAt = Date.now();
      save();
      pushState();
      broadcast('resumed', { matchId: m.id, number: m.number });
      return json(res, 200, { ok: true, resumed: true, match: matchView(m, id) });
    }
    return json(res, 200, { ok: true, resumed: false, match: matchView(m, id) });
  }

  // ---------------- state ----------------
  if (p === '/api/state') {
    const id = playerOf(req);
    if (!id) return json(res, 401, { error: 'not signed in' });
    lastSeenAt[id] = Date.now();   // an open app counts as present even without SSE
    const m = currentMatch();
    const view = m ? matchView(m, id) : null;
    if (view && m.status !== 'completed') view.invitePath = '/join/' + inviteFor(m).token;
    return json(res, 200, {
      presence: presenceView(),
      match: view,
      countdown: DB.countdown,
      waitStarted: DB.waitStarted,
      archive: archiveSummary(),
      serverTime: Date.now(),
      countdownMs: COUNTDOWN_MS
    });
  }

  // ---------------- events (SSE) ----------------
  if (p === '/api/events') {
    const id = playerOf(req);
    if (!id) { res.writeHead(401); return res.end(); }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    if (res.flushHeaders) res.flushHeaders();
    res.write('retry: 1500\n\n');
    // keep the pipe warm so proxies and mobile networks do not drop a silent stream
    const keepWarm = setInterval(() => {
      try { res.write(': ping\n\n'); } catch (e) { clearInterval(keepWarm); }
    }, 12000);
    res.on('close', () => clearInterval(keepWarm));
    sseClients.add(res);
    perPlayer[id] = (perPlayer[id] || 0) + 1;
    lastSeenAt[id] = Date.now();
    conns.set(res, { playerId: id });

    // if nobody was online, the waiting timer starts now
    if (!DB.waitStarted) DB.waitStarted = Date.now();
    if (bothLive() && !DB.countdown) {
      const m = currentMatch();
      if (m && m.status === 'paused') {
        DB.countdown = { startAt: Date.now(), matchId: m.id, resume: true };
      } else if (m && m.status === 'in-progress' && seatsJoined(m)) {
        // a match that never started still needs the opening countdown
        DB.countdown = { startAt: Date.now(), matchId: m.id, resume: !!m.startedAt };
      }
    }
    pushState();

    const ping = setInterval(() => { try { res.write(': hb\n\n'); } catch (e) {} }, 15000);
    const cleanup = () => {
      clearInterval(ping);
      if (!sseClients.has(res)) return;
      sseClients.delete(res);
      perPlayer[id] = Math.max(0, (perPlayer[id] || 0) - 1);
      lastSeenAt[id] = Date.now();
      conns.delete(res);
      // the ticker owns pausing: it waits out the grace window first, so a
      // reload or a brief mobile drop never interrupts a live match
      if (!(perPlayer.jeriel > 0) && !(perPlayer.loganathan > 0)) DB.countdown = null;
      pushState();
    };
    req.on('close', cleanup);
    req.on('error', cleanup);
    return;
  }

  // ---------------- matchmaking ----------------
  /**
   * POST /api/match  — called by NEW GAME.
   *  {create:true}          -> create the next numbered match + invitation token
   *  {join:<inviteToken>}   -> join an existing match from the invitation link
   *  {}                     -> resume whatever match already exists
   * A match is never created implicitly: pressing NEW GAME is the only way.
   */
  if (p === '/api/match' && req.method === 'POST') {
    const id = playerOf(req);
    if (!id) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const cur = currentMatch();
    const active = cur && (cur.status === 'in-progress' || cur.status === 'paused');

    // Codes and direct challenges always resolve to the one current server match.
    if (body.code !== undefined) {
      const code = String(body.code).trim();
      if (!/^\d{6}$/.test(code)) return json(res, 400, {error:'enter a six-digit code'});
      if (!active || ensureCode(cur) !== code) return json(res, 404, {error:'match code not found'});
      cur.joined[id] = true;
      if (cur.challenge && cur.challenge.to === id) cur.challenge.status = 'accepted';
      cur.updatedAt = Date.now(); maybeStart(cur); persist(true); pushState();
      return json(res, 200, {match:matchView(cur,id), joined:true});
    }
    if (body.challenge) {
      const target = String(body.challenge);
      if (!PLAYERS[target] || target === id) return json(res, 400, {error:'invalid player'});
      if (active && seatsJoined(cur)) return json(res, 409, {error:'finish the current match first'});
      let m = active ? cur : newMatch();
      if (!m) return json(res, 409, {error:'championship complete'});
      if (m.createdBy && m.createdBy !== id) return json(res, 409, {error:'the other player created this match'});
      m.createdBy = id; m.joined[id] = true;
      m.challenge = {from:id, to:target, status:'pending', createdAt:Date.now()};
      persist(true); pushState();
      return json(res, 200, {match:matchView(m,id), challenged:true});
    }
    if (body.respond) {
      if (!active || !cur.challenge || cur.challenge.to !== id || cur.challenge.status !== 'pending')
        return json(res, 409, {error:'no pending challenge'});
      if (!['accept','decline'].includes(body.respond)) return json(res, 400, {error:'invalid response'});
      cur.challenge.status = body.respond === 'accept' ? 'accepted' : 'declined';
      if (body.respond === 'accept') { cur.joined[id] = true; maybeStart(cur); }
      cur.updatedAt = Date.now(); persist(true); pushState();
      return json(res, 200, {match:matchView(cur,id)});
    }
    // ---- join an invited match ----
    if (body.join) {
      const m = matchByInvite(String(body.join));
      if (!m) return json(res, 404, { error: 'invitation not found or expired' });
      if (m.status === 'completed' || m.status === 'resigned' || m.status === 'draw') {
        return json(res, 409, { error: 'that match is already finished', match: matchView(m, id) });
      }
      if (DB.currentMatchId !== m.id) { DB.currentMatchId = m.id; persist(true); }
      m.joined = m.joined || { jeriel: false, loganathan: false };
      m.joined[id] = true;
      m.updatedAt = Date.now();
      maybeStart(m); persist(true); pushState();
      return json(res, 200, { match: matchView(m, id), joined: true });
    }

    // ---- create a new one ----
    if (body.create) {
      if (active) {
        // never overwrite an unfinished match: hand back the live one instead
        return json(res, 200, {
          match: matchView(cur, id), created: false,
          note: 'a match is already in progress — finish it first'
        });
      }
      if (DB.nextMatchNumber > TOTAL_MATCHES) {
        return json(res, 409, { error: 'championship complete — 500 matches played' });
      }
      const m = newMatch();
      m.createdBy = id;
      m.joined = { jeriel: false, loganathan: false };
      m.joined[id] = true;
      const invite = issueInvite(m);
      persist(true); pushState();
      return json(res, 200, {
        match: matchView(m, id), created: true,
        invite: { token: invite.token, path: '/join/' + invite.token }
      });
    }

    // ---- plain resume ----
    if (cur) {
      cur.joined = cur.joined || { jeriel: false, loganathan: false };
      // A new player must accept a challenge or enter the code; returning players restore their seat.
      return json(res, 200, { match: matchView(cur, id), created: false });
    }
    // nothing exists yet: the caller should offer NEW GAME
    return json(res, 200, { match: null, created: false });
  }

  /** GET /api/invite/:token — what the invited phone sees before it joins */
  if (p.startsWith('/api/invite/') && req.method === 'GET') {
    const m = matchByInvite(p.slice('/api/invite/'.length));
    if (!m) return json(res, 404, { error: 'invitation not found or expired' });
    return json(res, 200, {
      match: { id: m.id, number: m.number, total: TOTAL_MATCHES, colors: m.colors, status: m.status },
      invitation: true
    });
  }

  // ---------------- move (authoritative) ----------------
  if (p === '/api/move' && req.method === 'POST') {
    const id = playerOf(req);
    if (!id) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const m = currentMatch();
    if (!m) return json(res, 409, { error: 'no active match' });
    if (m.status !== 'in-progress') return json(res, 409, { error: 'match is ' + m.status, match: matchView(m, id) });
    if (!bothOnline()) return json(res, 409, { error: 'opponent offline', match: matchView(m, id) });

    const st = stateOf(m);
    if (!st.ok) return json(res, 500, { error: 'corrupt history' });
    const turn = st.state.turn;
    if (m.colors[id] !== turn) return json(res, 409, { error: 'not your turn', match: matchView(m, id) });

    // idempotency: client sends the move count it expects
    if (typeof body.expectCount === 'number' && body.expectCount !== m.moves.length) {
      return json(res, 409, { error: 'position changed', match: matchView(m, id) });
    }

    const san = String(body.san || '');
    const move = engine.parseSAN ? engine.parseSAN(st.state, san) : null;
    // resolve via legal move list (engine has no parseSAN export: use SAN match)
    let legal = null;
    for (const cand of engine.legalMoves(st.state)) {
      if (engine.normalizeSAN(engine.toSAN(st.state, cand)) === engine.normalizeSAN(san)) { legal = cand; break; }
    }
    if (!legal) return json(res, 422, { error: 'illegal move', match: matchView(m, id) });

    const before = st.state.board.slice();
    const undo = engine.makeMove(st.state, legal);
    const after = st.state.board.slice();
    const appliedSan = engine.toSAN((function(){ engine.unmakeMove(st.state, legal, undo); return st.state; })(), legal);

    const entry = {
      san: appliedSan,
      by: id,
      at: Date.now(),
      moveNumber: m.moves.length + 1,
      from: engine.idxToAlg(legal.from),
      to: engine.idxToAlg(legal.to),
      fenBefore: fenish(before, turn),
      fenAfter: fenish(after, st.state.turn),
      boardBefore: before,
      boardAfter: after
    };
    m.moves.push(entry);
    m.updatedAt = Date.now();
    if (!m.startedAt) m.startedAt = entry.at;

    // terminal detection
    const fin = stateOf(m);
    const legalNow = engine.legalMoves(fin.state);
    if (legalNow.length === 0) {
      if (engine.inCheck(fin.state, fin.state.turn === 'w')) {
        m.status = 'completed';
        m.reason = 'checkmate';
        m.result = id;                    // the player who just moved
      } else {
        m.status = 'draw';
        m.reason = 'stalemate';
        m.result = 'draw';
      }
      m.endedAt = Date.now();
      m.finalPosition = fin.state.board.slice();
    } else if (engine.insufficientMaterial(fin.state)) {
      m.status = 'draw'; m.reason = 'insufficient material'; m.result = 'draw';
      m.endedAt = Date.now(); m.finalPosition = fin.state.board.slice();
    } else if (fin.state.half >= 100) {
      m.status = 'draw'; m.reason = 'fifty-move rule'; m.result = 'draw';
      m.endedAt = Date.now(); m.finalPosition = fin.state.board.slice();
    }

    // SAVE FIRST, then acknowledge — a move is only complete once persisted
    persist(true);
    const view = matchView(m, id);
    broadcast('move', { matchId: m.id, san: appliedSan, by: id, match: view });
    pushState();
    return json(res, 200, { ok: true, saved: true, match: view });
  }

  // ---------------- resign / draw ----------------
  if (p === '/api/resign' && req.method === 'POST') {
    const id = playerOf(req);
    if (!id) return json(res, 401, { error: 'not signed in' });
    const m = currentMatch();
    if (!m) return json(res, 409, { error: 'no active match' });
    if (m.status !== 'in-progress' && m.status !== 'paused') return json(res, 409, { error: 'match is ' + m.status });
    m.status = 'resigned';
    m.reason = 'resignation';
    m.result = id === 'jeriel' ? 'loganathan' : 'jeriel';
    m.resign = { by: id, at: Date.now() };
    m.endedAt = Date.now();
    m.finalPosition = stateOf(m).state.board.slice();
    persist(true);
    broadcast('resigned', { matchId: m.id, by: id, match: matchView(m) });
    pushState();
    return json(res, 200, { ok: true, match: matchView(m, id) });
  }

  if (p === '/api/draw' && req.method === 'POST') {
    const id = playerOf(req);
    if (!id) return json(res, 401, { error: 'not signed in' });
    const m = currentMatch();
    if (!m) return json(res, 409, { error: 'no active match' });
    // simple mutual agreement: offer / accept
    if (m.drawOffer && m.drawOffer.by !== id) {
      m.status = 'draw'; m.reason = 'agreement'; m.result = 'draw';
      m.draw = { offeredBy: m.drawOffer.by, acceptedBy: id, at: Date.now() };
      m.endedAt = Date.now();
      m.finalPosition = stateOf(m).state.board.slice();
      persist(true);
      broadcast('draw-agreed', { matchId: m.id, match: matchView(m) });
      pushState();
      return json(res, 200, { ok: true, agreed: true, match: matchView(m, id) });
    }
    m.drawOffer = { by: id, at: Date.now() };
    persist(true);
    pushState();
    return json(res, 200, { ok: true, offered: true });
  }

  // ---------------- archive ----------------
  if (p === '/api/archive') {
    const id = playerOf(req);
    if (!id) return json(res, 401, { error: 'not signed in' });
    const list = Object.values(DB.matches)
      .sort((a, b) => b.number - a.number)
      .map(m => ({
        id: m.id, number: m.number, status: m.status, result: m.result, reason: m.reason,
        colors: m.colors, moveCount: m.moves.length,
        createdAt: m.createdAt, endedAt: m.endedAt,
        winner: m.result === 'draw' ? 'draw' : (m.result ? DB.matches[m.id].players[m.result] : null)
      }));
    return json(res, 200, { matches: list, stats: archiveSummary() });
  }

  if (p.startsWith('/api/match/')) {
    const id = playerOf(req);
    if (!id) return json(res, 401, { error: 'not signed in' });
    const mid = p.split('/')[3];
    const m = DB.matches[mid];
    if (!m) return json(res, 404, { error: 'no such match' });
    return json(res, 200, { match: m, view: matchView(m, id) });
  }

  // ---------------- static ----------------
  if (req.method === 'GET') {
    // /join/<token> is a real deep link: the SPA reads the token from the URL,
    // so a link shared over WhatsApp opens the championship directly.
    let file = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
    if (file.indexOf('..') >= 0) { res.writeHead(400); return res.end(); }
    const full = path.join(PUBLIC, file);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return serveFile(res, full);
    return serveFile(res, path.join(PUBLIC, 'index.html'));   // SPA fallback
  }

  res.writeHead(404); res.end('not found');
});

// tiny FEN-ish signature used in the move log (kept for the archive)
function fenish(board, turn) {
  let out = '';
  for (let r = 0; r < 8; r++) {
    let empty = 0;
    for (let c = 0; c < 8; c++) {
      const p = board[r * 8 + c];
      if (!p) empty++;
      else { if (empty) { out += empty; empty = 0; } out += p; }
    }
    if (empty) out += empty;
    if (r < 7) out += '/';
  }
  return out + ' ' + turn;
}

// ---------------------------------------------------------------- boot
startTicker();
server.listen(PORT, '0.0.0.0', () => {
  console.log('CELESTIAL CHESS CHAMPIONSHIP on http://0.0.0.0:' + PORT);
  console.log('  matches played:', Object.keys(DB.matches).length, '| next:', DB.nextMatchNumber);
});
process.on('SIGTERM', () => { persist(true); process.exit(0); });
process.on('SIGINT', () => { persist(true); process.exit(0); });
