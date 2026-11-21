# THE CELESTIAL CHESS CHAMPIONSHIP

A private, permanent two-player chess universe for **Jeriel** and **Loganathan** — 500 numbered
matches, a cinematic opening, and a 3D celestial cloud world with a golden sunrise.

- **Jeriel's phone** signs in as `JERIEL` · **Loganathan's phone** signs in as `LOGANATHAN`
- One shared match. One board. Real-time over Server-Sent Events.
- The server is the only authority: colours, turn order, legal moves, results, saving.

---

## 1. Run it

```bash
cd celestial
node server.js          # no npm dependencies at all
```

Open `http://<host>:8080` on both phones.

### Signing in

**No passwords, no codes.** There are exactly two permanent identities: tap **JERIEL** or tap
**LOGANATHAN** and you are in. The phone stays signed in until you press **⏻** (sign out).

If the same name is pressed on a second device, the seat simply moves to the new device and the old
one is returned to the sign-in screen — no duplicate player, no lock-out.

---

## 2. The phone-to-phone flow

1. **Jeriel's phone** opens the app and signs in as JERIEL.
2. He presses **NEW GAME** — the server numbers the match (`001`, `002`, …) and returns a
   private invitation link: `/join/<token>`.
3. He shares that link (COPY, or SHARE VIA WHATSAPP).
4. **Loganathan's phone** opens the link, sees *"You have been personally invited to MATCH 001"*,
   signs in as LOGANATHAN and takes his seat.
5. Both phones immediately show the same board:

```
JERIEL — 🟢 ONLINE          MATCH 001 / 500
LOGANATHAN — 🟢 ONLINE      BOTH PLAYERS CONNECTED
```

Moves appear on the other phone automatically. No refresh, ever.

### Colours

Decided by the server from the match number, never by the device that created it:

| Match | Jeriel | Loganathan |
|-------|--------|------------|
| 001   | White  | Black      |
| 002   | Black  | White      |
| 003   | White  | Black      |

---

## 3. Identity security

- A session cookie (`cc_token`) is **HttpOnly**, HMAC-signed, and tied to a server-side session id.
  It never appears in the frontend source and cannot be forged.
- **One player, one phone at a time.** Pressing a name on a second device moves the seat there; the
  displaced phone is told immediately (`session-ended`) and returns to the sign-in screen, so two
  devices can never play as the same player at once.
- An abandoned session frees itself after 90 seconds of inactivity, so a closed tab never locks a
  player out.
- Colours and turns are always decided by the server, never by the device.

---

## 4. Connection recovery

- The match is written to disk on every move (`data/championship.json`, atomic write).
- If a phone drops, the server waits out a **9-second grace window** (so a reload or a lift ride
  never interrupts play), then sets the match to `paused`.
- The remaining phone shows **MATCH PAUSED — opponent offline**, keeps the exact position, and
  cannot move.
- When the phone returns, a 5-second countdown resumes the same match, same number, same position.
- **Never**: a forfeit, an auto-move, a reset board, or an overwritten unfinished match.

---

## 5. Controls (mobile)

| Gesture | Action |
|---------|--------|
| Tap a piece, then a highlighted square | Move |
| Drag with one finger (or right-drag with a mouse) | **Look around — full 360°**, look up into the sky, down at the cloud sea |
| Pinch / wheel | Zoom |
| Arrow keys | Turn the world / tilt the view |
| `1` `2` `3` `4` | Board view · Top view · Close view · Cinematic orbit |
| `5` `6` | **Watch the clouds** · **Voyage** |

Camera buttons (bottom right): reset · top · cinematic · **❄ watch the clouds** ·
**➤ voyage** · archive · sound · resign. The active mode is highlighted.

**Watch the clouds** lifts you above the colonnade and looks out level over the cloud sea — you can
rotate the whole way round and simply stand there.

**Voyage** sends an endless stream of golden cloud banks flying past while the cloud sea drifts
beneath you: you are travelling through the never-ending clouds. Look in any direction while you
fly.

Sound settings are independent: Master, Music, Announcer, Ambience, Chess sounds, and a
Cinematic/Balanced/Performance quality switch.

---

## 6. Verification

```bash
node test-acceptance.js      # isolated test DB in .testdata/ — never touches the real archive
```

Covers authentication, identity cloning, invitation join, legal/illegal moves, idempotency,
disconnect → pause → resume, resignation, archive stats, colour alternation, and the 500-match cap.

**Result: PASS 78 / FAIL 0.**

---

## 7. Real-phone checklist

Run this once on the two actual phones:

1. Phone A opens the app, signs in as **JERIEL**.
2. Phone A presses **NEW GAME** → copy the invitation link.
3. Send the link to Phone B (WhatsApp / any messenger).
4. Phone B opens the link → signs in as **LOGANATHAN**.
5. Both phones show **MATCH 001 / 500** and both names **🟢 ONLINE**.
6. Both boards are identical.
7. Jeriel moves a pawn → it appears on Loganathan's phone.
8. Loganathan replies → it appears on Jeriel's phone.
9. Close Phone A completely, reopen the app → the same match returns.
10. Put Phone B in airplane mode → Phone A shows **MATCH PAUSED**.
11. Turn airplane mode off on Phone B → both resume the same match after a 5-second countdown.

---

## 8. Layout

```
server.js                 authoritative server (zero dependencies)
engine.js                 perft-verified chess rules engine (shared with the client)
test-acceptance.js        78-check acceptance suite (runs its own isolated server)
public/index.html         shell: login, lobby, HUD, archive, modals
public/js/app.js          app shell: auth, lobby, presence, moves, camera, audio, archive
public/js/celestial-world.js  3D world: sky, cloud sea, sunrise, colonnade, board table
public/js/chess-3d.js     piece meshes, animation, picking
public/js/intro.js        cinematic timeline, synthesised score, announcer playback
public/js/engine-bridge.js  SAN replay for the client (mirrors the server engine)
public/audio/*.mp3        original announcer clips
data/championship.json    the permanent archive (create it by playing)
data/codes.txt            private access codes (0600)
```

### API

| Endpoint | Purpose |
|----------|---------|
| `POST /api/login` | `{player, code?, takeover?, device?}` → session cookie |
| `POST /api/logout` | ends the server-side session |
| `POST /api/match` | `{create:true}` · `{join:<token>}` · `{}` (resume) |
| `GET /api/invite/:token` | preview an invitation |
| `GET /api/state` | presence, current match, countdown, archive summary |
| `GET /api/events` | SSE: `state`, `tick`, `move`, `match-start`, `match-paused`, `match-resumed`, `session-ended` |
| `POST /api/move` | `{san, expectCount}` — validated, persisted, then acknowledged |
| `POST /api/resign` · `POST /api/draw` | end conditions |
| `GET /api/archive` · `GET /api/match/:id` | the 500-match archive and replays |

---

## 9. Making it permanent

A quick tunnel (`*.trycloudflare.com`) is fine for a test but it dies when the machine stops. For a
link that always works — so a phone can open the game any day of the 500 matches — use either of
these.

### A. A free host (nothing to keep running)

1. Put this folder in a GitHub repository.
2. On [render.com](https://render.com) → **New → Web Service** → pick the repo.
3. Settings: **Runtime** Node · **Build command** (leave empty) · **Start command** `node server.js`.
4. Deploy. Render gives you `https://<name>.onrender.com` — open it on both phones.
5. Add a persistent disk (Render → your service → **Disks**, mount path `/opt/render/project/src/data`)
   so the 500-match archive survives restarts.

Railway and Fly.io work the same way; any host that runs `node server.js` and keeps a disk will do.

### B. Your own Cloudflare tunnel (permanent link on your own domain)

```bash
cloudflared tunnel login
cloudflared tunnel create celestial
cloudflared tunnel route dns celestial chess.yourdomain.com
cloudflared tunnel run --url http://localhost:8080 celestial
```

The same `data/` folder keeps the archive, so matches continue exactly where they stopped.
