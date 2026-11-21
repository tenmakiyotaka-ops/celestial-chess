# Online matchmaking

The app requires one running Node server with HTTPS terminated by its hosting provider and persistent storage. The app never creates a local game. Configure CC_DATA to point at a persistent mounted directory, e.g. `/var/data`, and set the hosting service's disk mount to the same directory. Keep the data directory across deploys and restarts, including `.secret` and `championship.json`. A persistent disk may require a paid hosting plan. Do not run multiple server instances against this file database.

## Entry

Both players open the same hosted URL and sign in with their names. They see the online directory. Either player can challenge the other; the recipient receives an in-app notification while signed in, or on their next visit. Accept joins the single current match; decline leaves it waiting. Alternatively, create a game and use its six-digit code to join. A challenge can also be sent for an already-created waiting match. A reconnecting player restores the existing match automatically. Colours and move history are determined by the same server. The code is unique across matches saved in this archive.

The directory shows live connections with a short grace period. In-app notifications require the app to be open, or appear the next time the recipient opens it; these are not push notifications.

## Security

Name-only sign-in is not authentication: anyone with the URL can impersonate either player or take their session. Codes are not passwords. Use real authentication before treating the game as private.

## Run and verify

`node server.js` and open the hosted URL. For automated checks run `node test-matchmaking.js` and `node test-acceptance.js`. Test on two real phones after deploying; automated tests do not replace that check.
