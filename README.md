# PM2 Oscar Dashboard

A modern, secure **PM2** web dashboard installable as a **PWA** (Progressive Web App), with support for **push notifications** on your phone when a process crashes or stops unexpectedly.

> Designed to run on **Node.js v22+**, managed by PM2 itself, accessible from desktop and mobile browsers. Ideal behind a reverse proxy such as nginx or Caddy.

---

## Table of Contents

- [Features](#features)
- [Screenshot](#screenshot)
- [Tech Stack](#tech-stack)
- [Requirements](#requirements)
- [Installation](#installation)
- [.env Configuration](#env-configuration)
- [Generating VAPID Keys (push notifications)](#generating-vapid-keys)
- [Starting the Dashboard](#starting-the-dashboard)
- [PWA: Installing the Dashboard on Your Phone](#pwa-installing-the-dashboard-on-your-phone)
- [Push Notifications: How They Work](#push-notifications-how-they-work)
- [Behind a Reverse Proxy](#behind-a-reverse-proxy)
- [Project Structure](#project-structure)
- [Environment Variables – Full Reference](#environment-variables--full-reference)
- [REST API – Reference](#rest-api--reference)
- [Security](#security)
- [FAQ](#faq)

---

## Features

| Feature | Details |
|---|---|
| 📋 **Process list** | Status (online / stopped / errored), CPU%, RAM, uptime, PID, restart count |
| ▶️ **Process control** | Start, Stop, Restart, Delete any PM2 process |
| 📜 **Log viewer** | Last N lines + live streaming via WebSocket; choose 50/100/200 lines |
| 🔐 **Secure login** | Username + password, session with signed cookie (HttpOnly, SameSite=Strict) |
| 🛡️ **Brute-force protection** | Max 5 login attempts / 10 minutes, then temporary lock |
| 🔏 **CSRF protection** | Anti-CSRF token on all state-changing requests |
| 📱 **Installable PWA** | `manifest.json` + Service Worker → installs as a native app on Android/iOS |
| 🔔 **Push notifications** | Instant alerts on your phone when a process crashes (exit code ≠ 0) |
| 🌙 **Dark glassmorphism UI** | Modern, mobile-first design, dark background, animated badges, Inter font |
| 🔌 **Configurable port** | Default `3003`, changeable via `PORT` in `.env` |
| 🔀 **Reverse proxy ready** | `trust proxy` enabled, compatible with nginx/Caddy and HTTPS |

---

## Screenshot

![Dashboard PM2 Oscar](https://github.com/user-attachments/assets/58967e0c-3f4b-4a00-beef-f5f933a7a75b)

---

## Tech Stack

**Backend**
- `Node.js v22+` – runtime
- `express` – HTTP server
- `express-session` – signed cookie sessions
- `express-rate-limit` – brute-force protection
- `pm2` – PM2 programmatic API (list, actions, log/event bus)
- `ws` – WebSocket for real-time log streaming
- `web-push` – VAPID push notification delivery (PWA)
- `dotenv` – environment variable management

**Frontend** (vanilla, no build step)
- Plain HTML/CSS/JS in `public/`
- Service Worker (`sw.js`) for offline cache and push reception
- Browser Web Push API for notification subscription
- Lucide icons via CDN, Inter font via Google Fonts

---

## Requirements

- **Node.js `v22.19.0`** or higher
- **PM2** installed globally: `npm install -g pm2`
- A domain with **HTTPS** for push notifications in production (browser requirement for Web Push API)

---

## Installation

```bash
# 1. Clone the repository
git clone https://github.com/oscarnastro/pm2-oscar.git
cd pm2-oscar

# 2. Install dependencies
npm install

# 3. Create the .env file from the example template
cp .env.example .env
```

Then edit `.env` with your credentials (see the next section).

---

## .env Configuration

```env
# Port the dashboard listens on (default: 3003)
PORT=3003

# Secret used to sign session cookies
# Replace with a long random string (e.g. openssl rand -hex 32)
SESSION_SECRET=changeme_super_secret

# Dashboard login credentials
ADMIN_USERNAME=admin
ADMIN_PASSWORD=changeme123

# Used as entropy for CSRF tokens
# Replace with a random string (e.g. openssl rand -hex 32)
JWT_SECRET=changeme_jwt_secret

# ── Push notifications (PWA) ─────────────────────────────────
# Generate keys with: npx web-push generate-vapid-keys
VAPID_EMAIL=admin@example.com
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
```

> **Security:** Never commit the `.env` file to the repository. It is already listed in `.gitignore`.

---

## Generating VAPID Keys

VAPID keys are required to send push notifications to the browser. Generate them once:

```bash
npx web-push generate-vapid-keys
```

Example output:
```
=======================================
Public Key:
BH1c9aQ...long string...
Private Key:
mA3k...long string...
=======================================
```

Copy the values into your `.env`:
```env
VAPID_PUBLIC_KEY=BH1c9aQ...
VAPID_PRIVATE_KEY=mA3k...
```

> The keys must remain **stable**: if you regenerate them, all previously subscribed devices will lose notifications and will need to re-subscribe.

---

## Starting the Dashboard

### Local (development)

```bash
npm start
# or
node server.js
```

Open your browser at: `http://localhost:3003`

### With PM2 (production)

```bash
# Start using the included configuration
pm2 start ecosystem.config.js

# Save the process list for automatic restart
pm2 save

# Enable automatic startup on system boot
pm2 startup
```

Verify it is running:
```bash
pm2 list
pm2 logs pm2-oscar-dashboard
```

To update after a code change:
```bash
pm2 restart pm2-oscar-dashboard
```

---

## PWA: Installing the Dashboard on Your Phone

The dashboard is an installable **Progressive Web App**. It works on Android (Chrome) and iOS (Safari).

### Android (Chrome)

1. Open the dashboard in Chrome (HTTPS required in production)
2. Tap the `⋮` menu → **Add to Home Screen** (or follow the automatic banner)
3. The dashboard opens as a native app, without the browser bar

### iOS (Safari)

1. Open the dashboard in Safari
2. Tap the **Share** icon → **Add to Home Screen**
3. Confirm the name and tap **Add**

> **Note:** Push notifications on iOS require iOS 16.4+ with Safari and are only supported when the PWA is installed.

---

## Push Notifications: How They Work

```
[PM2 process crashes]
       │
       ▼
[PM2 Bus emits process:event with exit_code ≠ 0]
       │
       ▼
[server.js detects the crash]
       │
       ▼
[push-service.js sends notification via web-push to all subscribed devices]
       │
       ▼
[Browser Service Worker receives the push and shows the notification]
       │
       ▼
[Tap on notification → opens the dashboard]
```

### Enabling Notifications from the Browser

1. Log in to the dashboard
2. Click the **bell** button 🔔 in the top-right of the navbar
3. The browser will ask for notification permission → click **Allow**
4. The bell turns purple (active)

### When You Receive a Notification

You will receive a push notification when:
- A process stops with **exit code ≠ 0** (unexpected crash)
- A process enters the **error** state

You will **not** receive notifications for:
- Manual stops from the dashboard (exit code 0)
- Scheduled restarts

### Disabling Notifications

Click the bell again to unsubscribe. Alternatively, revoke the permission in your browser settings.

---

## Behind a Reverse Proxy

### Nginx

```nginx
server {
    listen 443 ssl;
    server_name dashboard.yourdomain.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass         http://127.0.0.1:3003;
        proxy_http_version 1.1;

        # WebSocket (log streaming)
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 3600s;
    }
}

# Redirect HTTP → HTTPS
server {
    listen 80;
    server_name dashboard.yourdomain.com;
    return 301 https://$host$request_uri;
}
```

### Caddy

```caddyfile
dashboard.yourdomain.com {
    reverse_proxy 127.0.0.1:3003
}
```

Caddy automatically handles TLS (Let's Encrypt) and `X-Forwarded-*` headers.

> The dashboard already has `app.set('trust proxy', 1)` enabled, so it correctly reads the IP and scheme from the proxy.

---

## Project Structure

```
pm2-oscar/
├── server.js              # Express + WebSocket + PM2 bus entry point
├── auth.js                # Session middleware, requireAuth, credential validation
├── pm2-client.js          # PM2 wrapper (connect, list, action, describe, bus)
├── push-service.js        # VAPID setup, subscription management, push delivery
├── routes/
│   ├── api.js             # PM2 process REST API (list, start, stop, restart, delete)
│   ├── logs.js            # Log tail (last N lines)
│   └── push.js            # Push subscription API, VAPID public key
├── public/
│   ├── index.html         # Main dashboard (protected by login)
│   ├── login.html         # Login page
│   ├── style.css          # Dark/glassmorphism CSS
│   ├── app.js             # Frontend logic (processes, logs, SW, push)
│   ├── sw.js              # Service Worker (cache + push handler)
│   ├── manifest.json      # Web App Manifest (PWA)
│   └── icons/
│       ├── icon-192.svg   # PWA icon 192x192
│       ├── icon-512.svg   # PWA icon 512x512
│       └── badge-72.svg   # Notification badge 72x72
├── data/
│   └── subscriptions.json # Push subscriptions (auto-generated, gitignored)
├── .env.example           # Environment variable template
├── .gitignore
├── ecosystem.config.js    # PM2 configuration to run the dashboard
└── package.json
```

---

## Environment Variables – Full Reference

| Variable | Default | Required | Description |
|---|---|---|---|
| `PORT` | `3003` | No | Port the server listens on |
| `SESSION_SECRET` | `changeme_super_secret` | **Yes** | Secret for signing session cookies |
| `ADMIN_USERNAME` | `admin` | **Yes** | Dashboard login username |
| `ADMIN_PASSWORD` | `changeme123` | **Yes** | Dashboard login password |
| `JWT_SECRET` | `changeme_jwt_secret` | **Yes** | Entropy for CSRF tokens |
| `VAPID_EMAIL` | `admin@example.com` | No | Email for push notifications (`mailto:` format) |
| `VAPID_PUBLIC_KEY` | _(empty)_ | For push | VAPID public key |
| `VAPID_PRIVATE_KEY` | _(empty)_ | For push | VAPID private key |
| `NODE_ENV` | _(unset)_ | No | Set to `production` to enable the `secure` flag on cookies |

> If `VAPID_PUBLIC_KEY` or `VAPID_PRIVATE_KEY` are empty, push notifications are gracefully disabled. The dashboard works normally.

---

## REST API – Reference

All APIs require authentication (active session). Non-GET requests require the `x-csrf-token` header.

### Authentication

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/auth/csrf` | Returns the CSRF token for the current session |
| `POST` | `/auth/login` | Login. Body: `{ username, password }`. Rate-limited: 5 req/10min |
| `POST` | `/auth/logout` | Logout, destroys the session |

### PM2 Processes

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/processes` | List all PM2 processes |
| `POST` | `/api/processes/:id/start` | Start the process |
| `POST` | `/api/processes/:id/stop` | Stop the process |
| `POST` | `/api/processes/:id/restart` | Restart the process |
| `DELETE` | `/api/processes/:id` | Delete the process from PM2 |

### Logs

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/logs/processes/:id/tail?lines=N` | Last N log lines (max 500) |
| `WebSocket` | `ws://host/ws/logs?processId=N` | Real-time log streaming |

### Push Notifications

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/push/status` | Check whether push notifications are configured |
| `GET` | `/api/push/vapid-public-key` | Returns the VAPID public key |
| `POST` | `/api/push/subscribe` | Save a push subscription |
| `DELETE` | `/api/push/subscribe` | Remove a push subscription |

---

## Security

- **Sessions**: `HttpOnly`, `SameSite=Strict` cookies, `secure` flag in production
- **Brute-force**: rate limiting on login (5 attempts / 10 minutes)
- **CSRF**: per-session anti-CSRF token, required on all non-GET requests
- **API errors**: generic messages to the client, details logged server-side only
- **Reverse proxy**: `trust proxy` enabled, supports `X-Forwarded-*` headers
- **VAPID**: only the public key is exposed to the client
- **Push subscriptions**: expired/invalid subscriptions are removed automatically

> **Recommendation**: always use HTTPS in production. Generate strong secrets with `openssl rand -hex 32`.

---

## FAQ

**Do notifications arrive even when I close the browser?**
Yes, the Service Worker stays active in the background (on Android/Chrome). On iOS they require iOS 16.4+ with the PWA installed.

**Does the server need to stay on all the time?**
Yes, notifications are sent from the server (not the browser). If the server is off, no notifications will be sent.

**Can I have multiple users?**
Currently only a single admin user is supported. For multi-user support, `auth.js` would need to be extended with an account system.

**Do push subscriptions survive a server restart?**
Yes, they are saved in `data/subscriptions.json` (excluded from git).

**How do I update the dashboard without losing PM2 processes?**
```bash
pm2 reload pm2-oscar-dashboard
```
`reload` performs a graceful restart with no downtime.

**What happens if the VAPID keys change?**
Previously subscribed devices will lose notifications. Delete `data/subscriptions.json` and ask users to re-enable the bell.
