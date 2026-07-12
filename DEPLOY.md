# Deploying the Riftbound Terminal

The app is one always-on Node process with a SQLite file — it wants a small
box that never sleeps, not serverless. Recommended: a ~$5/mo VPS (Hetzner
CX22 / DigitalOcean basic) with Docker, reached privately over Tailscale.

**Security model:** there is deliberately no login — this is a single-user
tool with demo/kill endpoints and your portfolio in it. The compose file
binds to `127.0.0.1` only; Tailscale is what makes it reachable by *you*
from anywhere. Never map the port to a public interface.

## VPS + Docker + Tailscale (recommended)

On a fresh Ubuntu/Debian VPS:

```bash
# 1. Docker + Tailscale
curl -fsSL https://get.docker.com | sh
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up                      # authenticate the box into your tailnet

# 2. The app
git clone <your-repo-url> rbt && cd rbt
cp .env.example .env
nano .env                         # eBay keys, twitterapi.io key, NTFY_TOPIC

# 3. Run
docker compose up -d --build
docker compose logs -f rbt        # watch for "mode=live" — see below

# 4. Reach it from anywhere on your tailnet (HTTPS, phone included)
tailscale serve --bg 8787
tailscale serve status            # prints your private https://<box>.<tailnet>.ts.net URL
```

Install the Tailscale app on your phone/laptop, and the terminal is at that
URL from anywhere — visible only to your devices.

### First-boot checks (live bring-up)

The first boot on open internet is the moment the real adapters run for the
first time — work through `HANDOVER.md` §6. The short version:

- Logs say `mode=live`? If they say `SAMPLE mode: <reason>`, the reason is
  the actual error (bad key, endpoint shape, blocked egress).
- `curl -s localhost:8787/api/status` on the box: `cards` should be the full
  Riftbound catalog (hundreds), not 22 (that's the sample count).
- Prices in the UI should wear `LIVE` provenance pills, not `SMPL`.

### Alerts on your phone

Set `NTFY_TOPIC` in `.env` to a long random string and subscribe to the same
topic in the [ntfy](https://ntfy.sh) app. Fired alerts push with the card
name and crossing price. Free, no account.

### Backups

All state is one SQLite file. Nightly copy, keeping 14 days:

```bash
crontab -e
0 5 * * * docker exec rbt node -e "require('better-sqlite3')('/app/data/rbt.sqlite').backup('/app/data/backup-'+new Date().toISOString().slice(0,10)+'.sqlite')" && find ~/rbt/data -name 'backup-*' -mtime +14 -delete
```

### Updating

```bash
cd ~/rbt && git pull && docker compose up -d --build
```

Price history in `./data` survives rebuilds (it's a bind mount).

## Alternatives

- **Your own machine:** `npm install && npm run build && npm start` →
  http://localhost:8787. Zero cost, but a sleeping laptop misses overnight
  moves and never fires alerts — fine for evaluation, wrong for the mission.
- **Fly.io / Railway:** works — single service, attach a volume at
  `/app/data`, set env vars from `.env`. Choose it if you don't want to own
  a VPS; you lose the Tailscale-private posture unless you add auth in
  front, so put it behind Fly's private networking or an access proxy.
