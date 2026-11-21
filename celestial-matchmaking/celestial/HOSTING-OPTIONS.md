# How to get a link that never dies

The game itself is finished and tested (77/77 acceptance checks). The only thing that has ever
failed is **temporary tunnels** — free services that pipe a URL to a machine that is running the
server. They are fine for a five-minute look and useless for a 500-match championship, because the
link belongs to a session, not to you.

Below are the real options, easiest first. Every one of them ends with the same place: two phones
open one https:// link and play.

---

## What "the server" actually is

```
server.js        the rules, the two identities, the match archive  <-- must run somewhere
public/          the 3D board, the sky, the clouds                    <-- served by server.js
data/            championship.json — all 500 matches live here
```

There is no build step and no dependencies. `node server.js` is the entire deployment. The only
question is *which machine runs it*, and the only thing that machine needs is a disk that survives
restarts (for `data/`).

---

## Option 1 — Render (recommended: free, permanent URL, nothing to keep running)

1. Create a GitHub account if you do not have one, then a new **private** repository.
2. Upload the contents of this folder (GitHub's web uploader is fine — do not upload `data/`).
3. Go to [render.com](https://render.com) → **New → Web Service** → connect the repository.
4. Settings:
   - **Runtime:** Node
   - **Build command:** *(leave empty)*
   - **Start command:** `node server.js`
5. **Create Web Service.** You get `https://your-name.onrender.com` — permanent, https, no tunnel.
6. Add a **Disk** (Render dashboard → your service → Disks): name `data`, mount path
   `/opt/render/project/src/data`, size 1 GB. This keeps the 500-match archive across deploys.
7. Open the URL on both phones and add it to the home screen.

Free tier sleeps after 15 minutes idle; the first tap in the morning takes ~30 seconds to wake.
That is the only cost. Paid `$7/mo` removes the sleep.

**Railway** and **Fly.io** are the same idea: connect the repo, start command `node server.js`,
attach a volume at `/app/data`. Fly is the fastest of the three to wake.

---

## Option 2 — Your own Cloudflare tunnel (permanent URL, runs on a machine you own)

Best if you have a laptop or mini-PC that stays on, and want your own subdomain.

```bash
cloudflared tunnel login
cloudflared tunnel create celestial
cloudflared tunnel route dns celestial chess.yourdomain.com
cloudflared tunnel run --url http://localhost:8080 celestial
```

Run `node server.js` alongside it. `chess.yourdomain.com` never changes, no sleeping, no limits.
The `data/` folder sits on your machine, so the archive is literally yours.

---

## Option 3 — Play on the same Wi-Fi (no internet, no third party)

Both phones on the same Wi-Fi, one of them (or any computer on that network) running the server:

```bash
node server.js
```

then open `http://<that-machine-ip>:8080` on both phones. Instant, private, zero dependencies.
Not suitable for playing from different places — that needs option 1 or 2.

---

## Option 4 — Tailscale (play from anywhere, no public link at all)

Install [Tailscale](https://tailscale.com) on the machine running the server and on both phones,
then open `http://<tailscale-ip>:8080` from either phone. Private network, works across cities,
nothing exposed to the internet. Good if you both have the app installed and do not want a public
URL.

---

## Option 5 — A cheap VPS (cheapest long-term, most control)

Any $4–5/month box (Hetzner, DigitalOcean, Vultr, Oracle free tier):

```bash
# on the server
apt install -y nodejs caddy
# copy this folder to /srv/celestial
cd /srv/celestial && node server.js      # or run it under systemd / pm2
```

Caddy gives you automatic https for a domain in three lines of config. `data/` lives on the VPS,
so the archive is permanent.

---

## Option 6 — Keep using a quick tunnel (what is running right now)

Zero setup, dies whenever the session ends. Only useful for a same-evening test.

- Cloudflare quick tunnel: `cloudflared tunnel --url http://localhost:8080 --protocol http2`
- localhost.run: `ssh -R 80:localhost:8080 nokey@localhost.run`
- ngrok: `ngrok http 8080`

If a tunnel reports **Error 1033**, the tunnel process is alive but Cloudflare's edge cannot reach
it — restart it and use the new URL. Switching `--protocol http2` avoids the UDP path that fails
most often.

---

## Which one should you pick?

| You want | Use |
| --- | --- |
| A link that just works forever, free, nothing to maintain | **Option 1 — Render** |
| Your own address, machine always on | **Option 2 — Cloudflare named tunnel** |
| Play tonight, same room, no accounts | **Option 3 — same Wi-Fi** |
| Play from anywhere, private, no public URL | **Option 4 — Tailscale** |
| Full control, small monthly cost | **Option 5 — VPS** |

Whichever you choose, the two-phone test itself does not change: JERIEL taps his name → NEW GAME →
sends the invitation → LOGANATHAN taps the invitation → both boards show the same match.
