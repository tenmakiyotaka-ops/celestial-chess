# Celestial Chess World

An online two-player 3D chess championship. One Node.js process is the source of truth for identity, moves, clocks, chat, gestures and character positions. Both players need an internet connection. Do not use the removed standalone HTML version for multiplayer.

## Deploy safely

1. Host the app as a single Node web service behind HTTPS. The start command is `node server.js` and no build step is needed. Set `PORT` using the hosting platform (Render provides it).
2. Attach persistent storage and set `CC_DATA` to the mounted directory, for example `/var/data`. The disk contains the championship archive, session signing key and private player-link keys. Back it up and do not commit it to Git. A persistent disk may require a paid hosting plan. A single-instance file database does not support multiple replicas.
3. Set `CC_SETUP_SECRET` to a unique, cryptographically random secret of at least 32 characters using the hosting dashboard. Never commit it or send it in a chat or screenshot.
4. Once HTTPS is live, visit `/setup.html` as the owner, enter the setup secret, and privately send each player only their own link. The links contain bearer secrets: anyone who obtains a link can use that identity. Revoking or rotating links currently requires an operator to replace the stored player keys or configure replacement environment secrets; existing installations will need the new links.
5. Each player opens their own link, then uses Add to Home Screen. Test this on the actual two phones: browser and installed-app storage behaviour varies by device. The app may require a screen tap before sound can play due to mobile autoplay rules.

`CC_INSECURE_TEST_AUTH=1` is for local automated tests only. Never enable it in production. Do not publish or share the persistent data directory, the setup secret or either player link. Chat is protected by the same player links and HTTPS; it is not end-to-end encrypted.

## Current features and limits

Server-authoritative chess with saved move history, colour alternation, draw offers and a selectable server clock; private links and auto-entry; in-app chat (latest 200 messages); live character step controls and gestures; changing sky, birds and animated magical companions; match gallery and replay. The characters are stylised prototypes. Some Lichess features and rare chess/timeout edge cases are not yet fully verified. Real two-phone testing is required before relying on the game.

## Local tests

With Node.js installed, run `node test-private-links.js`, `node test-link-setup.js`, `node test-clock.js`, `node test-chess-bridge.js`, `node test-repetition.js`, `node test-match-rules.js`, `node test-draw-offer.js`, `node test-timeout-material.js`, `node test-move-sounds.js`, and `node test-acceptance.js` from this directory. Each server test uses disposable local data.
