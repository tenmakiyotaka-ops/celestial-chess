# Render — deployment guide (persistent disk requires an eligible paid service)

You need: the zip file, a browser, and 10 minutes. No coding. At the end you have
`https://something.onrender.com` that works on both phones forever.

---

## Step 0 — what you are doing

You are putting the game on a hosted computer on the internet. That computer runs `node server.js`
all day. Both phones open its link. It never changes, never expires, and keeps all 500 matches.

---

## Step 1 — make the files ready (2 min)

1. Download the zip from Drive to your computer.
2. Unzip it. You get a folder called `celestial`.
3. Open it. You must see `server.js`, `engine.js`, `README.md`, and folders `public`, `data`.
   Delete the `data` folder's contents if there is anything inside (it starts empty).

---

## Step 2 — put it on GitHub (3 min)

1. Go to **github.com** → sign up / sign in.
2. Top right **+** → **New repository**.
3. Name: `celestial-chess` · visibility **Private** · do **not** tick "Add a README".
4. **Create repository**.
5. On the empty repo page click **uploading an existing file**.
6. Drag **everything inside** the `celestial` folder into the box — `server.js`, `engine.js`,
   `chess.js`, `README.md`, and the folders `public`, `test-acceptance.js`, `HOSTING-OPTIONS.md`.
   (Drag the contents, not the folder itself. The browser uploads subfolders automatically.)
7. Click **Commit changes**.

Check: the repo's main page shows `server.js` at the top level. If instead you see a folder named
`celestial`, you dragged the folder — open it, select all, and re-upload so `server.js` is top level.

---

## Step 3 — Render (4 min)

1. Go to **render.com** → **Get Started** → sign in with GitHub (easiest).
2. Dashboard → **New +** → **Web Service**.
3. **Connect** your `celestial-chess` repository (grant access if asked).
4. Fill exactly:
   - **Name:** `celestial-chess`
   - **Region:** Singapore (closest to India)
   - **Branch:** `main`
   - **Runtime:** `Node`
   - **Build Command:** *(empty — delete anything in it)*
   - **Start Command:** `node server.js`
   - **Instance Type:** a paid type that supports persistent disks
5. **Create Web Service**. Wait ~2 minutes for the log to say
   `CELESTIAL CHESS CHAMPIONSHIP on http://0.0.0.0:8080`.
6. Copy the URL at the top: `https://celestial-chess.onrender.com`. **That is your permanent link.**

---

## Step 4 — keep the archive forever (1 min)

Without this, the 500-match archive is lost when Render restarts the service.

1. Your service page → **Disks** (left menu) → **Add Disk**.
2. **Name:** `data` · **Mount Path:** `/opt/render/project/src/data` · **Size:** 1 GB.
3. **Save**. Render restarts once. Done.

---

## Step 5 — the two phones (1 min)

1. Both phones open `https://celestial-chess.onrender.com`.
2. **JERIEL's phone:** tap **JERIEL** → **NEW GAME** → **COPY** the invitation link.
3. Send that invitation to Loganathan (WhatsApp).
4. **His phone:** tap the invitation → tap **LOGANATHAN** → he is in your match.
5. Add it to the home screen so it opens like an app:
   - iPhone Safari: Share → **Add to Home Screen**
   - Android Chrome: ⋮ → **Install app**

You will see `JERIEL — 🟢 ONLINE`, `LOGANATHAN — 🟢 ONLINE`, `MATCH 001 / 500`, and the same board on
both phones. Every night, both phones open the same link and continue the championship at the next
match number.

---

## Things that surprise people

- **First open in the morning takes ~30 s.** A free instance without persistent disk sleeps after inactivity. It wakes on
  the first request. Free instances do not provide the persistent disk needed for this archive.
- **"Free instance hours"** — 750 hours a month is enough for one always-on service.
- **The link never changes** after deploys. Re-uploading files to GitHub auto-deploys in ~2 min.
- **Do not commit `data/`** — that folder is the live archive, it belongs on the disk, not GitHub.
- **If the URL shows a Render error page**, open the service → **Logs** and look for the last line;
  it is almost always a missing `server.js` at the repo root (redo Step 2.7).

---

## Optional: your own domain later

Render → your service → **Settings** → **Custom Domain** → add `chess.yourdomain.com`, then create
the CNAME record Render shows at your domain registrar. Ten minutes, and it is yours forever.
