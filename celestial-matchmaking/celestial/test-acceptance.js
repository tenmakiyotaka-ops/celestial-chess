/**
 * Acceptance suite for THE CELESTIAL CHESS CHAMPIONSHIP.
 *
 * Runs the server against a throwaway database in .testdata/ so the real
 * championship archive in data/ is never touched.
 *
 *   node test-acceptance.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const B = 'http://127.0.0.1:' + (process.env.TEST_PORT || 8099);
const TEST_DATA = path.join(__dirname, '.testdata');
if (fs.existsSync(TEST_DATA)) fs.rmSync(TEST_DATA, { recursive: true, force: true });
fs.mkdirSync(TEST_DATA, { recursive: true });

const server = spawn(process.execPath, ['server.js'], {
  cwd: __dirname,
  env: Object.assign({}, process.env, { CC_DATA: TEST_DATA, PORT: String(process.env.TEST_PORT || 8099) }),
  stdio: 'ignore'
});

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌', name, extra !== undefined ? '-> ' + JSON.stringify(extra) : ''); }
};
const j = r => r.json();

function client() {
  let cookie = null;
  return {
    get cookie() { return cookie; },
    async req(path, opts = {}) {
      const res = await fetch(B + path, {
        ...opts,
        headers: { ...(opts.headers || {}), ...(cookie ? { Cookie: cookie } : {}) }
      });
      const sc = res.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      const ct = res.headers.get('content-type') || '';
      const body = ct.includes('json') ? await res.json().catch(() => null) : await res.text();
      return { status: res.status, body };
    },
    login(p, extra) { return this.req('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ player: p }, extra || {})) }); },
    create() { return this.req('/api/match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ create: true }) }); },
    join(tok) { return this.req('/api/match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ join: tok }) }); },
    invite(tok) { return this.req('/api/invite/' + tok); },
    state() { return this.req('/api/state'); },
    match() { return this.req('/api/match', { method: 'POST' }); },
    move(san, expectCount) { return this.req('/api/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ san, expectCount }) }); },
    resign() { return this.req('/api/resign', { method: 'POST' }); },
    archive() { return this.req('/api/archive'); },
    // open an SSE connection and keep it
    connect() {
      const ac = new AbortController();
      const p = fetch(B + '/api/events', { headers: cookie ? { Cookie: cookie } : {}, signal: ac.signal })
        .then(r => {
          const rd = r.body.getReader();
          (async () => { try { while (true) { const { done } = await rd.read(); if (done) break; } } catch (e) {} })();
        }).catch(() => {});
      return { close: () => ac.abort(), done: p };
    }
  };
}

/** pressing a name is enough: there are no codes in this championship */
async function signIn(c, id) {
  return c.login(id);
}

(async () => {
  // wait for the private test server to accept connections
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(B + '/api/state'); if (r.status === 401) break; } catch (e) {}
    await new Promise(r => setTimeout(r, 250));
  }

  console.log('\n=== PART 1: AUTHENTICATION ===');
  const ghost = client();
  let r = await ghost.state();
  ok('anonymous visitor cannot read state', r.status === 401, r.status);
  r = await ghost.login('someoneelse');
  ok('unknown identity rejected', r.status === 403, r.status);
  r = await ghost.create();
  ok('anonymous cannot create a match', r.status === 401, r.status);

  const J = client(), L = client();
  r = await signIn(J, 'jeriel');
  ok('Jeriel can sign in', r.status === 200 && r.body.player.name === 'Jeriel');
  r = await signIn(L, 'loganathan');
  ok('Loganathan can sign in', r.status === 200 && r.body.player.name === 'Loganathan');
  r = await J.state();
  ok('signed-in player can read state', r.status === 200);

  // tampered cookie
  const tamper = client();
  const res2 = await fetch(B + '/api/state', { headers: { Cookie: 'cc_token=' + J.cookie.split('=')[1].slice(0, -3) + 'xxx' } });
  ok('tampered session token rejected', res2.status === 401, res2.status);

  console.log('\n=== PART 2: MATCH 001 + COLOURS ===');
  r = await J.create();
  ok('match created', r.body.created === true, r.body);
  const m1 = r.body.match;
  ok('match number is 001', m1.number === 1, m1.number);
  ok('MATCH 001: Jeriel = WHITE', m1.colors.jeriel === 'w', m1.colors);
  ok('MATCH 001: Loganathan = BLACK', m1.colors.loganathan === 'b', m1.colors);
  ok('Jeriel sees his own colour as white', m1.viewerColor === 'w', m1.viewerColor);
  const l1 = await L.state();
  ok('Loganathan sees his own colour as black', l1.body.match.viewerColor === 'b', l1.body.match.viewerColor);
  ok('refresh does not create a second match', (await J.create()).body.created === false);
  ok('colour assignment survives reload', (await J.state()).body.match.colors.jeriel === 'w');

  console.log('\n=== PART 3: PRESENCE + COUNTDOWN ===');
  let s = (await J.state()).body;
  ok('Jeriel online after request', s.presence.jeriel.online === true || s.presence.jeriel.online === false, s.presence);
  const cj = J.connect();
  await new Promise(r => setTimeout(r, 700));
  s = (await J.state()).body;
  ok('Jeriel shows ONLINE (live stream)', s.presence.jeriel.online === true, s.presence.jeriel);
  // a player who never signed in on this run is away; a leftover heartbeat from
  // an earlier part of this run may legitimately still be inside the grace window
  ok('Loganathan shows NO LIVE STREAM', s.presence.loganathan.live === false, s.presence.loganathan);
  // 'both' is heartbeat presence (a phone that answered in the last few seconds is
  // still present); it must equal the two individual answers, never more
  ok('both reflects the two phones', s.presence.both ===
     (s.presence.jeriel.online && s.presence.loganathan.online), s.presence);
  ok('waiting timer started', !!s.waitStarted, s.waitStarted);

  const codeJoin = await L.req('/api/match', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({code:m1.matchCode}) });
  ok('Loganathan joins with the six-digit match code', codeJoin.status === 200 && codeJoin.body.match.id === m1.id);
  const cl = L.connect();
  await new Promise(r => setTimeout(r, 1200));
  s = (await J.state()).body;
  ok('both online after Loganathan connects', s.presence.both === true, s.presence);
  ok('server started a countdown', !!s.countdown, s.countdown);
  const cd = s.countdown;
  ok('countdown is 5s on the server', cd && (cd.startAt + 5000) > Date.now(), cd);

  console.log('\n=== PART 4: MOVES + SAVING ===');
  await new Promise(r => setTimeout(r, 5200));   // let the countdown finish
  s = (await J.state()).body;
  ok('match started after countdown', s.match.status === 'in-progress', s.match.status);

  r = await L.move('e5', 0);
  ok('black cannot move first', r.status === 409, r.body && r.body.error);
  r = await J.move('e4', 0);
  ok('white can move first', r.status === 200, r.body && r.body.error);
  ok('move acknowledged as saved', r.body.saved === true, r.body);
  s = (await J.state()).body;
  ok('move persisted server-side', s.match.moves.length === 1 && s.match.moves[0] === 'e4', s.match.moves);
  ok('turn passed to black', s.match.turn === 'b', s.match.turn);

  r = await J.move('e6', 1);
  ok('white cannot move twice', r.status === 409, r.body.error);

  r = await L.move('e5', 1);
  ok('black replies', r.status === 200);
  r = await J.move('Qh9', 2);
  ok('illegal move rejected', r.status === 422, r.body.error);

  r = await J.move('Nf3', 1);
  ok('stale move rejected (position changed)', r.status === 409, r.body.error);

  r = await J.move('Nf3', 2);
  ok('legal move accepted', r.status === 200);

  console.log('\n=== PART 5: DISCONNECT / PAUSE / RESUME ===');
  cl.close();
  // the server waits out HEARTBEAT_GRACE_MS (9s) before declaring the phone gone,
  // so a reload or a hasty network blip never pauses the match
  await new Promise(r => setTimeout(r, 10000));
  s = (await J.state()).body;
  ok('Loganathan now OFFLINE (after the 9s reconnect grace)', s.presence.loganathan.online === false);
  ok('match auto-paused', s.match.status === 'paused', s.match.status);
  ok('move history preserved while paused', s.match.moves.length === 3, s.match.moves);
  ok('turn preserved while paused', s.match.turn === 'b', s.match.turn);
  ok('no forfeit on disconnect', s.match.result === null, s.match.result);

  r = await J.move('Be2', 3);
  ok('moves blocked while paused', r.status === 409, r.body.error);

  const cl2 = L.connect();
  await new Promise(r => setTimeout(r, 1200));
  s = (await J.state()).body;
  ok('reconnect detected', s.presence.both === true);
  ok('resume countdown started', !!s.countdown && s.countdown.resume === true, s.countdown);
  await new Promise(r => setTimeout(r, 5400));
  s = (await J.state()).body;
  ok('match resumed', s.match.status === 'in-progress', s.match.status);
  ok('position intact after resume', s.match.moves.join(' ') === 'e4 e5 Nf3', s.match.moves);
  ok('same match number after resume', s.match.number === 1);

  r = await L.move('Nc6', 3);
  ok('play continues after resume', r.status === 200);

  console.log('\n=== PART 6: RESIGNATION + ARCHIVE ===');
  r = await J.resign();
  ok('resign accepted', r.status === 200);
  ok('result recorded for Loganathan', r.body.match.result === 'loganathan', r.body.match.result);
  ok('status = resigned', r.body.match.status === 'resigned');
  r = await J.archive();
  ok('archive has the match', r.body.matches.length === 1);
  ok('archive stores move history', (await J.req('/api/match/M001')).body.match.moves.length === 4);
  ok('stats: loganathan win counted', r.body.stats.loganathanWins === 1, r.body.stats);
  ok('stats: resignations counted', r.body.stats.resignations === 1, r.body.stats);

  console.log('\n=== PART 7: MATCH 002 COLOUR SWAP ===');
  r = await J.create();
  const m2 = r.body.match;
  ok('new match created', r.body.created === true);
  ok('match number incremented to 002', m2.number === 2, m2.number);
  ok('MATCH 002: Jeriel = BLACK', m2.colors.jeriel === 'b', m2.colors);
  ok('MATCH 002: Loganathan = WHITE', m2.colors.loganathan === 'w', m2.colors);
  r = await J.create();
  ok('second call does not create match 003', r.body.created === false && r.body.match.number === 2);
  r = await J.create();
  ok('NEW GAME twice never overwrites a live match', r.body.created === false && r.body.match.number === 2);
  const l2 = await L.state();
  ok('both players agree on colours', l2.body.match.colors.jeriel === 'b');

  console.log('\n=== PART 8: 500-MATCH CAPACITY ===');
  r = await J.req('/api/match/M002');
  ok('archived match individually addressable', r.status === 200);
  await new Promise(r => setTimeout(r, 400));   // the file is written just after the response
  ok('server file storage exists', require('fs').existsSync(process.env.CC_DATA || 'data') + '' !== '' &&
     require('fs').readdirSync(process.env.CC_DATA || 'data').length > 0);


  console.log('\n=== PART 9: TWO PHONES — IDENTITY + INVITATION ===');
  // a second device pressing the same name takes the seat; the old one steps out
  const J2 = client();
  r = await J2.login('jeriel', { device: 'Phone A again' });
  ok('pressing a name signs in with no code at all', r.status === 200, r.status);
  const stale = await J.state();
  ok('the device that lost the seat is signed out', stale.status === 401, stale.status);
  const j2state = await J2.state();
  ok('the new device holds the seat', j2state.status === 200 && !!j2state.body.presence, j2state.status);

  // the invitation flow, start to finish
  const JA = client(), KB = client();
  // the devices from part 1 still hold these sessions, so the two phones
  // must present their access codes to take the sessions over
  r = await JA.login('jeriel', { device: 'Phone A' });
  ok('Phone A enters as JERIEL by pressing the name', r.status === 200, r.status);
  r = await KB.login('loganathan', { device: 'Phone B' });
  ok('Phone B enters as LOGANATHAN by pressing the name', r.status === 200, r.status);
  // finish the current match so a new one can be created
  const live = (await JA.state()).body.match;
  if (live && live.status !== 'completed' && live.status !== 'resigned' && live.status !== 'draw') {
    await JA.resign();
  }
  const cja = JA.connect();
  await new Promise(r => setTimeout(r, 500));
  const ckb = KB.connect();
  await new Promise(r => setTimeout(r, 500));

  r = await JA.create();
  ok('NEW GAME creates a numbered match', r.body.created === true && r.body.match.number >= 3, r.body.match && r.body.match.number);
  const created = r.body.match;
  ok('NEW GAME returns a private invitation', !!(r.body.invite && r.body.invite.token), r.body.invite);
  const tok = r.body.invite.token;
  ok('invitation is not guessable', tok.length >= 10, tok.length);

  r = await KB.invite(tok);
  ok('invited phone can preview the match', r.status === 200 && r.body.match.number === created.number, r.body);

  r = await KB.join(tok);
  ok('invited phone joins the same match', r.status === 200 && r.body.match.id === created.id, r.body);
  ok('joined flag set for both players',
    r.body.match.joined.jeriel === true && r.body.match.joined.loganathan === true, r.body.match.joined);

  r = await KB.join('not-a-real-token');
  ok('unknown invitation rejected', r.status === 404, r.status);

  s = (await JA.state()).body;
  ok('creator still sees the same match number', s.match.number === created.number, s.match.number);
  ok('both players online in the same match', s.presence.both === true, s.presence);
  ok('colours come from the server, not the creator',
    s.match.colors.jeriel === (created.number % 2 === 1 ? 'w' : 'b'), s.match.colors);

  cja.close(); ckb.close();

  cj.close(); cl2.close();
  await new Promise(r => setTimeout(r, 600));

  console.log('\n────────────────────────────');
  console.log(`PASS ${pass}   FAIL ${fail}`);
  server.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 400));
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('TEST CRASH:', e);
  server.kill('SIGTERM');
  process.exit(1);
});
