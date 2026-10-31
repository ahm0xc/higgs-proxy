# higgs-proxy

A self-hosted dashboard and team-management layer for the
[Higgsfield CLI](https://higgsfield.ai). Run it on a VPS or your own Mac/Linux
machine, give your team accounts, and let them generate images, video, and audio
from a web UI backed by your Higgsfield workspace.

- **First-run setup** — the first account becomes the admin; there is no public
  sign-up after that.
- **Team management** — admins create users, reset passwords, ban accounts, and
  grant per-feature capabilities (images, audio, video).
- **Generations** — image, audio, and (coming soon) video jobs are queued
  through the Higgsfield CLI. Galleries, favorites, downloads, and job status
  live in the dashboard.
- **Single SQLite database** — no external services to run.

The dashboard is two processes: `apps/api` (Bun + Hono + Better Auth + SQLite)
and `apps/web` (React + Vite). The installer starts both for you.

---

## Requirements

| Requirement                | Notes                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| macOS 12+ or Linux         | Windows is not supported yet.                                                                                  |
| `git`, `curl`, `openssl`   | The installer can install these via Homebrew/apt/dnf/pacman.                                                   |
| [Bun](https://bun.sh) 1.2+ | Installed automatically if missing.                                                                            |
| Node.js 20+ and npm        | Needed by the Higgsfield CLI. The installer offers to install them.                                            |
| Higgsfield CLI             | Installed with `npm install -g @higgsfield/cli --allow-scripts=@higgsfield/cli`, then `higgsfield auth login`. |
| A Higgsfield account       | A selected workspace with credits.                                                                             |

> You do **not** need Nginx, Caddy, Docker, Postgres, or Redis. If you want a
> domain and TLS, put your own reverse proxy in front of the two ports — that
> part is intentionally outside this project.

---

## Quick install

```bash
git clone https://github.com/ahm0xc/higgs-proxy.git
cd higgs-proxy
./install.sh
```

The installer prompts for the public URLs, then:

1. Checks/installs Node.js + npm, Bun, and the Higgsfield CLI.
2. Installs workspace dependencies with `bun install`.
3. Generates `apps/api/.env` with a random `BETTER_AUTH_SECRET`
   (`openssl rand -base64 32`).
4. Writes `apps/web/.env` with `VITE_API_URL`.
5. Creates the SQLite database and applies all migrations.
6. Builds the dashboard.
7. Starts the API and web processes as a systemd service (Linux),
   a launchd agent (macOS), or background processes as a fallback.

When it finishes, open the dashboard:

```
http://localhost:5560/setup
```

Create the first account there. It is automatically made the admin. Afterwards,
`/setup` is locked and all new users must be created from
**Admin → Users**.

### Installing on a VPS with a domain

Pass the public URLs up front so the build and Better Auth are configured
correctly:

```bash
./install.sh \
  --web-url https://app.example.com \
  --api-url https://api.example.com
```

Then point your proxy at:

| Service       | Default port |
| ------------- | ------------ |
| Web dashboard | `5560`       |
| API           | `5561`       |

### Non-interactive install

```bash
./install.sh --yes --web-url https://app.example.com --api-url https://api.example.com
```

### Other installer options

| Flag              | Description                                     |
| ----------------- | ----------------------------------------------- |
| `--yes`           | Accept defaults; never prompt.                  |
| `--web-url URL`   | Public URL of the dashboard.                    |
| `--api-url URL`   | Public URL of the API.                          |
| `--web-port PORT` | Port the dashboard listens on (default `5560`). |
| `--api-port PORT` | Port the API listens on (default `5561`).       |
| `--no-start`      | Configure and build, but do not start anything. |
| `--restart`       | Restart the already-installed services.         |
| `--stop`          | Stop the services (temporary; see below).       |

Environment overrides: `WEB_PORT`, `API_PORT`, `WEB_URL`, `API_URL`,
`ASSUME_YES=1`.

### Rerunning the installer

Running `./install.sh` again is safe and behaves like a re-apply, not a fresh
install. It keeps:

- `apps/api/db.sqlite` (users, sessions, generations, capabilities)
- `BETTER_AUTH_SECRET` (existing logins stay valid)
- existing `.env` values, only filling in keys that are missing or empty
- custom ports, remembered in `.install.conf`

It re-runs dependency installation, migrations (no-op if already applied), and
the web build, then restarts both services (a few seconds of downtime).

Two caveats:

1. If `apps/api/.env` already exists, the "Public URL" prompts are **ignored** —
   existing `CORS_ORIGINS` and `BETTER_AUTH_URL` are never overwritten. The same
   applies to `VITE_API_URL`.
2. Do **not** change ports with `--web-port` / `--api-port` on a rerun. The
   service definitions pick up the new port, but `apps/api/.env` keeps its old
   `PORT`, leaving the API and dashboard out of sync.

To change domains or ports after the first install, edit `.env` and
`.install.conf` directly, then rebuild and restart:

```bash
cd apps/web && bun run build
cd ../.. && ./install.sh --restart
```

---

## First run

1. Open `http://<your-host>:5560/setup` (or your dashboard URL).
2. Create the admin account.
3. Sign the Higgsfield CLI in as the user that runs the services:

   ```bash
   higgsfield auth login
   higgsfield workspace select   # if you have more than one workspace
   ```

4. Check the status pill in the dashboard. It should report a healthy CLI and
   your credit balance.

If you change the Higgsfield login **after** the service started, the API picks
it up automatically — credentials are read from disk per request.

### Capabilities

Each user can be granted `image`, `audio`, and/or `video` access from
**Admin → Users**. A user with no capability sees a locked page.

---

## Configuration

### `apps/api/.env`

| Variable                     | Default                 | Purpose                                                                                  |
| ---------------------------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| `PORT`                       | `5561`                  | API port.                                                                                |
| `CORS_ORIGINS`               | `http://localhost:5560` | Comma-separated browser origins allowed to call the API. Must include the dashboard URL. |
| `BETTER_AUTH_URL`            | `http://localhost:5561` | Public API origin used by Better Auth for cookies/callbacks.                             |
| `BETTER_AUTH_SECRET`         | generated               | Session signing secret. Changing it signs everyone out.                                  |
| `DB_FILE_NAME`               | `./db.sqlite`           | SQLite file, relative to `apps/api` unless absolute.                                     |
| `HIGGSFIELD_CLI_PATH`        | `higgsfield`            | Absolute path to the CLI binary.                                                         |
| `HIGGSFIELD_CLI_TIMEOUT_MS`  | `15000`                 | Per-command timeout.                                                                     |
| `HIGGSFIELD_STATUS_CACHE_MS` | `10000`                 | How long the CLI status is cached.                                                       |

### `apps/web/.env`

| Variable       | Default                 | Purpose                                                |
| -------------- | ----------------------- | ------------------------------------------------------ |
| `VITE_API_URL` | `http://localhost:5561` | API base URL. **Baked into the bundle at build time.** |

> `.env.local` files take precedence over `.env` in both apps. Remove leftover
> development `.env.local` files on a server, or their values will override
> what the installer wrote.

If you change `VITE_API_URL`, rebuild and restart:

```bash
cd apps/web && bun run build
cd ../.. && ./install.sh --restart
```

If you change `BETTER_AUTH_URL`, `CORS_ORIGINS`, or `PORT`, just restart.
Both URLs must use the same scheme (both `http://` or both `https://`) and the
web origin must exactly match `CORS_ORIGINS`.

### Cookies and domains

Better Auth stores the session in an httpOnly cookie on the **API** origin. For
the dashboard to authenticate:

- Use the same registrable domain for both, e.g. `app.example.com` and
  `api.example.com`, or one domain with different ports.
- Do not mix `http://` and `https://` between the two URLs.
- If the web app is at `https://app.example.com`, `CORS_ORIGINS` and
  `BETTER_AUTH_URL` must say exactly that (no trailing slash).

Cross-site setups such as `app.example.com` → `api.other-domain.com` will not
work with the default cookie policy.

---

## Services and logs

The installer picks the first available service manager:

| Platform                      | Manager                                                   | Logs                           |
| ----------------------------- | --------------------------------------------------------- | ------------------------------ |
| Linux with systemd (root)     | `higgs-proxy-api.service`, `higgs-proxy-web.service`      | `logs/api.log`, `logs/web.log` |
| Linux with systemd (non-root) | user units with the same names                            | `logs/api.log`, `logs/web.log` |
| macOS                         | launchd agents `com.higgsproxy.api`, `com.higgsproxy.web` | `logs/api.log`, `logs/web.log` |
| Fallback                      | background processes + `.run/*.pid`                       | `logs/api.log`, `logs/web.log` |

Common commands:

```bash
# Linux, system-wide
sudo systemctl status higgs-proxy-api higgs-proxy-web
sudo systemctl restart higgs-proxy-api higgs-proxy-web

# Linux, user units
systemctl --user status higgs-proxy-api higgs-proxy-web
loginctl enable-linger "$USER"   # keep running after logout

# macOS
launchctl kickstart -k gui/$(id -u)/com.higgsproxy.api
launchctl kickstart -k gui/$(id -u)/com.higgsproxy.web

# Any platform
tail -f logs/api.log logs/web.log
./install.sh --restart
./install.sh --stop
```

Custom ports chosen with `--web-port` / `--api-port` are stored in
`.install.conf` so restarts and upgrades keep using them.

### Stopping and disabling

```bash
./install.sh --stop
```

This stops both processes immediately and also kills any leftover background
processes from a nohup fallback. It is a **temporary stop**: the systemd units /
launchd plists remain installed, so the services start again on the next reboot
or login.

Verify nothing is still listening:

```bash
lsof -nP -iTCP:5560 -sTCP:LISTEN
lsof -nP -iTCP:5561 -sTCP:LISTEN
# Linux alternative
ss -ltnp | grep -E '5560|5561'
```

To keep it stopped across reboots/logins:

```bash
# Linux, system-wide
sudo systemctl disable --now higgs-proxy-api higgs-proxy-web

# Linux, user units
systemctl --user disable --now higgs-proxy-api higgs-proxy-web
loginctl disable-linger "$USER"

# macOS
launchctl bootout "gui/$(id -u)/com.higgsproxy.api" 2>/dev/null || true
launchctl bootout "gui/$(id -u)/com.higgsproxy.web" 2>/dev/null || true
rm -f ~/Library/LaunchAgents/com.higgsproxy.api.plist \
      ~/Library/LaunchAgents/com.higgsproxy.web.plist
```

Bring it back with:

```bash
./install.sh --restart
```

`--restart` re-creates the macOS plists if you removed them, and re-enables the
systemd units.

Stopping is non-destructive. It does **not** delete the database, `.env` files,
`logs/`, or `backups/`.

---

## Reverse proxy, DNS, and TLS

This project does not manage domains, certificates, or proxies. On a VPS,
install whatever you already use and forward traffic to the two local ports.

An Nginx example using two subdomains:

```nginx
server {
  listen 443 ssl http2;
  server_name app.example.com;

  ssl_certificate     /etc/letsencrypt/live/app.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:5560;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}

server {
  listen 443 ssl http2;
  server_name api.example.com;

  ssl_certificate     /etc/letsencrypt/live/api.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:5561;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Caddy equivalent:

```caddyfile
app.example.com {
  reverse_proxy 127.0.0.1:5560
}

api.example.com {
  reverse_proxy 127.0.0.1:5561
}
```

Cloudflare is fine in front of either setup. Keep the proxy in **Full (strict)**
SSL mode if you use Cloudflare, and do not enable a proxy mode that rewrites the
API response bodies.

> Do not expose `5560`/`5561` directly to the internet on a VPS. Bind them to
> localhost with a firewall, or let the reverse proxy be the only public entry
> point. The API handles auth, but TLS and rate limiting belong at the edge.

---

## Upgrading

```bash
cd higgs-proxy
./upgrade.sh
```

`upgrade.sh`:

1. Refuses to run on a dirty working tree (commit or stash first).
2. Stops the services.
3. Backs up the SQLite database to `backups/db-YYYYMMDD-HHMMSS.sqlite`
   (the ten newest backups are kept).
4. Runs `git fetch` + `git pull --ff-only` from `origin/main`.
5. Runs `bun install`, applies new Drizzle migrations, and rebuilds the web app.
6. Restarts the services.

Use a different branch with `./upgrade.sh --branch dev`.

The script only pulls code — it never pushes. Database migrations are additive;
if an upgrade fails, the previous database backup is in `backups/`. To roll back
code and data:

```bash
git checkout <previous-commit>
cp backups/db-<stamp>.sqlite apps/api/db.sqlite
./install.sh --restart
```

> Always keep off-site backups of `apps/api/db.sqlite`. It contains all users,
> sessions, and generation history.

---

## Manual setup

If you prefer to run the steps yourself:

```bash
bun install

# API environment
cp apps/api/.env.example apps/api/.env
# edit apps/api/.env: set BETTER_AUTH_SECRET, CORS_ORIGINS, BETTER_AUTH_URL
# generate a secret with: openssl rand -base64 32

# Web environment (baked in at build time)
cp apps/web/.env.example apps/web/.env
# edit apps/web/.env: set VITE_API_URL

# Database
cd apps/api && bun run db:migrate && cd ../..

# Build and run
cd apps/web && bun run build && cd ../..
(cd apps/api && bun run start)
(cd apps/web && PORT=5560 bun run start)
```

For development with hot reload:

```bash
bun run dev
# dashboard: http://localhost:5560
# api:       http://localhost:5561
```

Press `Ctrl+C` to stop the dev processes. Installed services are stopped with
`./install.sh --stop` instead.

> Do not generate or edit migrations by hand in a deployed install. Migrations
> are versioned in `apps/api/drizzle/` and applied by `bun run db:migrate`.

---

## Troubleshooting

| Symptom                                        | Fix                                                                                                                                                                                                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard says **CLI not installed**           | Install it with `npm install -g @higgsfield/cli --allow-scripts=@higgsfield/cli` (the flag lets its `postinstall` download the binary), then make sure `HIGGSFIELD_CLI_PATH` in `apps/api/.env` points at the binary (`which higgsfield`). Restart. |
| Dashboard says **unauthenticated**             | Run `higgsfield auth login` as the user that runs the API service, then refresh.                                                                                                                                                                    |
| Dashboard says **out of credits**              | Top up or switch workspaces with `higgsfield workspace select`.                                                                                                                                                                                     |
| Login succeeds but the session does not stick  | `BETTER_AUTH_URL`, `CORS_ORIGINS`, and the browser URL must match exactly and use the same scheme. Remove `.env.local` leftovers.                                                                                                                   |
| `install.sh: Permission denied`                | `chmod +x install.sh upgrade.sh`                                                                                                                                                                                                                    |
| Port already in use                            | Stop the process using it. On a fresh install choose other ports with `--web-port` / `--api-port`; on an existing install edit `.env` and `.install.conf`.                                                                                          |
| User systemd services stop after logout        | `loginctl enable-linger "$USER"`                                                                                                                                                                                                                    |
| macOS services do not start over SSH           | launchd needs a GUI session. The installer falls back to background processes; use `./install.sh --restart` from a desktop session or run with `nohup`.                                                                                             |
| `bun: command not found` after install         | `export PATH="$HOME/.bun/bin:$PATH"` and add it to your shell profile.                                                                                                                                                                              |
| Need to reset the admin                        | There is no public sign-up. Restore a database backup, or remove `apps/api/db.sqlite` **only** on a fresh install and rerun `./install.sh`.                                                                                                         |
| Mismatched Vite API URL after changing domains | Edit `apps/web/.env`, then `cd apps/web && bun run build && cd ../.. && ./install.sh --restart`.                                                                                                                                                    |
| Services return after reboot                   | `./install.sh --stop` is temporary. Use the `systemctl disable` / launchd commands under [Stopping and disabling](#stopping-and-disabling).                                                                                                         |
| Ports/URLs did not change after a rerun        | The installer never overwrites existing `.env` values. Edit `.env` (and `.install.conf` for ports), rebuild if needed, then `./install.sh --restart`.                                                                                               |

---

## Security notes

- Run the stack as a dedicated non-root user where possible.
- Keep `apps/api/.env` at mode `600`; the installer sets this.
- Put TLS in front of both services and firewall the app ports.
- Back up the SQLite database regularly and store backups off the machine.
- Rotating `BETTER_AUTH_SECRET` invalidates every existing session.
- The first `/setup` request creates an admin; do it immediately after install.

---

## License

No license file is included in this repository. Add one before distributing
the project.
