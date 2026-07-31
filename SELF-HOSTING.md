# Self-Hosting Reqcore

Reqcore is open-source and self-hostable. This is a DIY path, provided best-effort and without support or an SLA — the Reqcore team's own support and uptime commitments apply only to the hosted cloud product at [reqcore.com](https://reqcore.com). The reference path below uses Docker Compose to run the app, PostgreSQL, and S3-compatible object storage together.

Code under [`ee/`](ee) is licensed separately (see [`ee/LICENSE`](ee/LICENSE)) and gates itself behind the same plan checks as the hosted product; without your own billing configured, those features stay locked.

> **Windows users:** Open [Git Bash](https://gitforwindows.org) and run all commands there instead of Command Prompt or PowerShell.

## Option A — Use the pre-built image (fastest)

No cloning, no building. Pull the official image and run:

```bash
mkdir reqcore && cd reqcore
curl -fsSLO https://raw.githubusercontent.com/reqcore-inc/reqcore/main/docker-compose.production.yml
curl -fsSLO https://raw.githubusercontent.com/reqcore-inc/reqcore/main/setup.sh
chmod +x setup.sh
./setup.sh
docker compose -f docker-compose.production.yml up -d
```

Open **[http://localhost:3000](http://localhost:3000)** and sign up. That's it.

To update: `docker compose -f docker-compose.production.yml pull app && docker compose -f docker-compose.production.yml up -d`

## Option B — Build from source

### Step 1 — Install Docker

Docker packages the app, database, and file storage into containers so you don't have to install anything else manually.

| Your OS | How to install |
|---------|---------------|
| **Mac** | [Download Docker Desktop for Mac](https://www.docker.com/products/docker-desktop/) → install → open it |
| **Windows** | [Download Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/) → install → open it |
| **Linux** | Follow the [Docker Engine install guide](https://docs.docker.com/engine/install/) for your distro |

Once installed, verify Docker is running:

```bash
docker --version
```

You should see something like `Docker version 27.x.x`. If you get `command not found`, Docker isn't running yet — open Docker Desktop and try again.

### Step 2 — Download Reqcore

Clone the repository (this downloads the source code):

```bash
git clone https://github.com/reqcore-inc/reqcore.git
cd reqcore
```

> Don't have `git`? [Download it here](https://git-scm.com/downloads), or [download a ZIP](https://github.com/reqcore-inc/reqcore/archive/refs/heads/main.zip) and unzip it manually.

### Step 3 — Generate your secret keys

This creates a `.env` file containing random passwords and secrets. You only run this once.

```bash
./setup.sh
```

You'll see: `✅ .env generated with random secrets.`

> **Windows CMD / PowerShell?** Run `cp .env.example .env` instead, then open `.env` and replace every placeholder value with a random string of your choice.

### Step 4 — Start the app

```bash
docker compose up
```

**The very first run takes 3–5 minutes** while Docker builds the app image and downloads dependencies. This is normal — you only wait this long once. Subsequent starts take seconds.

When you see a line like:

```
app  | Listening on http://[::]:3000
```

...the app is ready.

### Step 5 — Open Reqcore

Go to **[http://localhost:3000](http://localhost:3000)** in your browser.

Click **Sign up** to create your account and first organization. That's it — you're running your own ATS.

### Optional: Load demo data

Want to explore with pre-filled jobs, candidates, and a pipeline? Open a **new terminal window** while the app is running and run:

```bash
docker compose exec app npm run db:seed
```

Then sign in with:
- **Email:** `demo@reqcore.com`
- **Password:** `demo1234`

## Updating to a new release

When a new version of Reqcore is released, follow these steps **in order** to update your instance. Your data is safe — updates never delete the database or your uploaded files.

#### Pre-built image users

```bash
docker compose -f docker-compose.production.yml pull app
docker compose -f docker-compose.production.yml up -d
```

#### Build from source users

**Step 1 — Pull the latest code**

```bash
git pull origin main
```

**Step 2 — Rebuild and restart the app**

```bash
docker compose up --build -d
```

This rebuilds the app image with the new code, applies any new database migrations automatically on startup, and restarts in the background. The whole process typically takes under a minute.

**Step 3 — Verify it's running**

```bash
docker compose logs app --tail 20
```

Look for `Listening on http://[::]:3000`. Then open [http://localhost:3000](http://localhost:3000) — you're on the latest version.

> **Something wrong after an update?** Roll back by running `git checkout <previous-commit>` and then `docker compose up --build -d`.

> **To find the latest release notes**, check the [CHANGELOG](CHANGELOG.md) or [GitHub Releases](https://github.com/reqcore-inc/reqcore/releases).

Updates keep your database volume and uploaded files intact. Always back up the Postgres and MinIO volumes before major upgrades.

## Managing your instance

```bash
# Stop the app (your data is kept)
docker compose down

# Start it again
docker compose up

# Rebuild after pulling new code
docker compose up --build

# Stop and delete ALL data (irreversible)
docker compose down -v
```

### What's running

| Service | URL | Description |
|---------|-----|-------------|
| **App** | [localhost:3000](http://localhost:3000) | The Reqcore web UI |
| **MinIO Console** | [localhost:9001](http://localhost:9001) | File storage browser (S3-compatible) |
| **Adminer** | [localhost:8080](http://localhost:8080) | Database browser — only with `--profile tools` |

To enable Adminer (a visual database browser):

```bash
docker compose --profile tools up
# Open http://localhost:8080
# System: PostgreSQL  |  Server: db  |  Username & Password: from your .env
```

### Running behind a reverse proxy

Rate limiting is keyed on the client IP, so the app has to know which forwarding
headers it may believe. Set `TRUSTED_PROXY` in `.env`:

| Your setup | Value |
|------------|-------|
| Behind Cloudflare | `TRUSTED_PROXY=cloudflare` |
| Behind one proxy you run (nginx, Caddy, Traefik) | `TRUSTED_PROXY=1` (the number of proxies that append to `X-Forwarded-For`) |
| Reachable directly from the internet | `TRUSTED_PROXY=none` |

The default is `cloudflare`, which matches the hosted deployment. Leaving it on
`cloudflare` while the app is directly reachable lets a client pick its own
rate-limit bucket by sending a `CF-Connecting-IP` header; setting it to `none`
while behind a proxy puts every visitor in a single shared bucket.

## Troubleshooting

| Problem | What to do |
|---------|-----------|
| Applicants get "Too many applications submitted" unexpectedly | `TRUSTED_PROXY` doesn't match your setup — see [Running behind a reverse proxy](#running-behind-a-reverse-proxy) |
| `docker: command not found` | Docker isn't installed, or Docker Desktop isn't open yet |
| `permission denied: ./setup.sh` | Run `chmod +x setup.sh` first, then try again |
| App shows a connection error | The first build is still running — wait 30 seconds, then refresh |
| Port 3000 or 5432 already in use | Another app is using that port — stop it, or edit the port in `docker-compose.yml` |
| Upload / file errors | Run `docker compose logs minio` — MinIO may still be starting up |
| Need to rotate a secret | Edit `.env`, then run `docker compose up --build` |

For architecture and deployment details, see [ARCHITECTURE.md](ARCHITECTURE.md).
