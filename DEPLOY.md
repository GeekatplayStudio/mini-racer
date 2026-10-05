# Deploying the MiniRacer game server

The game server is one Node.js process. On a single port it:

- serves the built game (the `dist/` folder) to browsers,
- keeps player accounts and their saved teams (`/api/...`),
- runs the online lobby and the online races over a WebSocket (`/ws`).

Single-player MiniRacer needs none of this; any static host can serve `dist/` on its own.
The server is only needed for online play.

## 1. Build

On your own computer, in the project folder:

```bash
npm install
npm run build          # the game -> dist/
npm run build:server   # the server -> server-dist/server.js
```

`server-dist/server.js` is one self-contained file. It needs nothing from `node_modules`.

Requirements on the server: **Node.js 20 or newer** (22 LTS recommended).

## 2. What to upload

Upload these two folders, keeping them side by side:

```
miniracer/
  dist/            the game
  server-dist/     server.js and package.json
```

Do **not** upload `node_modules`, `src`, or `server-data`.

Start the server from the `miniracer/` folder, so that it finds `./dist`. You can also set
`STATIC_DIR` (see below) and start it from anywhere.

## 3. Settings (environment variables)

| Variable      | Default          | Meaning |
|---------------|------------------|---------|
| `PORT`        | `8787`           | Port to listen on. Managed hosting usually sets this for you. |
| `HOST`        | all interfaces   | Address to bind, e.g. `127.0.0.1` behind a reverse proxy. |
| `DATA_DIR`    | `./server-data`  | Where accounts and saved teams are kept. |
| `STATIC_DIR`  | `./dist`         | The built game. |
| `TRUST_PROXY` | off              | `1` to read the client address from `X-Forwarded-For`. Set it **only** behind your own reverse proxy (nginx, Apache, Hostinger's proxy). It is used for the sign-in rate limit and the per-address connection limit. |
| `MAX_GAMES`   | `20`             | Most online games open or running at once. |
| `MAX_PER_ADDRESS` | `6`          | Most lobby connections at once from one address. Raise it if many players share one router. |
| `CORS_DEV`    | off              | `1` lets web pages from other origins call the API. **Development only; never in production.** |

No secrets are needed. Nothing secret is in the repository.

## 4. Running on a Hostinger VPS

### Start it and keep it running with pm2

```bash
sudo npm install -g pm2
cd /var/www/miniracer
PORT=8787 HOST=127.0.0.1 TRUST_PROXY=1 DATA_DIR=/var/lib/miniracer pm2 start server-dist/server.js --name miniracer
pm2 save
pm2 startup           # prints a command; run it so pm2 starts after a reboot
```

Logs: `pm2 logs miniracer`. Restart after an update: `pm2 restart miniracer`.

### Or with systemd

`/etc/systemd/system/miniracer.service`:

```ini
[Unit]
Description=MiniRacer game server
After=network.target

[Service]
WorkingDirectory=/var/www/miniracer
ExecStart=/usr/bin/node server-dist/server.js
Environment=PORT=8787
Environment=HOST=127.0.0.1
Environment=TRUST_PROXY=1
Environment=DATA_DIR=/var/lib/miniracer
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo mkdir -p /var/lib/miniracer && sudo chown www-data /var/lib/miniracer
sudo systemctl daemon-reload
sudo systemctl enable --now miniracer
journalctl -u miniracer -f
```

### Reverse proxy (nginx) with HTTPS

The WebSocket needs the `Upgrade` headers passed through. If they are missing, the
game loads and sign-in works, but the Online tab never connects.

```nginx
server {
    server_name race.example.com;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 120s;   # the server pings every 30 s
    }

    listen 80;
}
```

Then get a certificate with `sudo certbot --nginx -d race.example.com`.

## 5. Running on Hostinger managed "Node.js app" hosting

Some Hostinger plans (Business / Cloud web hosting) have a **Node.js** section in hPanel.

1. Create a Node.js application. Choose Node 20 or newer.
2. Upload `dist/` and `server-dist/` into the application folder.
3. Set the **startup file** to `server-dist/server.js`.
4. Add environment variables: `TRUST_PROXY=1`, and `DATA_DIR` set to a folder inside your
   account that is **not** web-accessible and is kept between deployments.
   Leave `PORT` alone: the platform provides it.
5. Start the app.

**Important: online play needs WebSockets.** The plan and its proxy must pass WebSocket
connections through to the app. Not every shared or managed plan does. If yours does not,
the game and the account pages still work, but online races cannot run. In that case use
a VPS.

### How to check that WebSockets work

1. Open `https://your-domain/api/health` in a browser. You should see
   `{"ok":true,"game":"miniracer"}`. If you do, the app is running.
2. Open the game, go to the **Online** tab, register and sign in. The status line should
   read **Online as <name>** within a few seconds. If it stays on **Connecting...**,
   WebSocket connections are being blocked.
3. Or, from a computer with Node 22 or newer:

   ```bash
   node -e "const w=new WebSocket('wss://your-domain/ws');w.onopen=()=>{console.log('WebSocket OK');w.close()};w.onerror=()=>console.log('WebSocket blocked')"
   ```

## 6. HTTPS and wss

Run the site over HTTPS. Players send passwords to `/api/login`, and over plain HTTP they
cross the network readable. The game connects to `wss://` automatically when the page is
served over `https://`. TLS is handled by your reverse proxy or by Hostinger. The Node
server itself speaks plain HTTP and should not be exposed directly on the internet without
TLS in front.

## 7. Where the data lives, and backups

Everything is in `DATA_DIR`:

```
server-data/
  users/u-<name>.json      account: name, salt, scrypt password hash
  profiles/p-<name>.json   saved team (cars, drivers, money, history; no photos)
  sessions.json            sign-in sessions (only SHA-256 digests of the tokens)
```

There is no database. Files are written atomically (write, then rename).

**Backup:** copy the whole folder while the server runs. For example, daily with cron:

```bash
tar czf /backups/miniracer-$(date +%F).tgz -C /var/lib/miniracer .
```

To restore, stop the server, put the folder back, and start the server again.
Keep `DATA_DIR` outside the folder you replace when you upload a new version.
Keep it out of git; the repository's `.gitignore` already excludes `server-data/`.

## 8. Updating

Build again on your computer and upload the new `dist/` and `server-dist/`. Then restart
(`pm2 restart miniracer`, `systemctl restart miniracer`, or Restart in hPanel). Races
running at that moment are lost (their entry fees are refunded); accounts and saved teams are not.

## 9. Local development

```bash
npm run build:server
CORS_DEV=1 npm start                          # API and lobby on http://localhost:8787
npm run dev                                   # the game on http://localhost:5173
# then open http://localhost:5173/?server=http://localhost:8787
```

Or build the game too (`npm run build`), run `npm start`, and open `http://localhost:8787`.

## 10. Limits to know about

- Teams are kept as the game sends them. A determined player can edit their money, cars or
  drivers before uploading. The server rebuilds and checks every car it races, and it
  checks drivers' skill points. Entry fees and prizes for online races are applied on the
  server. But a team's bank balance is not protected against tampering.
- All games run in this one process. A restart ends the races in progress. A race the server
  has to stop (an error, or still running after 3 hours) refunds its entry fees.
- Sign-in attempts are limited to 10 a minute per address. A lobby connection must sign in
  within 5 seconds, and a game nobody joins, enters or gets ready in for 15 minutes is closed.
