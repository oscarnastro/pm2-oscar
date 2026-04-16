# PM2 Oscar Dashboard

Dashboard web **PM2** moderna, sicura e installabile come **PWA** (Progressive Web App), con supporto a **notifiche push** sul telefono quando un processo crasha o si ferma in modo imprevisto.

> Progettata per girare su **Node.js v22+**, gestita da PM2 stesso, accessibile da browser desktop e cellulare. Ideale dietro un reverse proxy come nginx o Caddy.

---

## Sommario

- [Funzionalità](#funzionalità)
- [Screenshot](#screenshot)
- [Stack tecnico](#stack-tecnico)
- [Requisiti](#requisiti)
- [Installazione](#installazione)
- [Configurazione .env](#configurazione-env)
- [Generare le chiavi VAPID (push notifications)](#generare-le-chiavi-vapid)
- [Avvio](#avvio)
- [PWA: installare la dashboard sul telefono](#pwa-installare-la-dashboard-sul-telefono)
- [Notifiche push: come funzionano](#notifiche-push-come-funzionano)
- [Uso dietro reverse proxy](#uso-dietro-reverse-proxy)
- [Struttura del progetto](#struttura-del-progetto)
- [Variabili d'ambiente – riferimento completo](#variabili-dambiente--riferimento-completo)
- [API REST – riferimento](#api-rest--riferimento)
- [Sicurezza](#sicurezza)
- [FAQ](#faq)

---

## Funzionalità

| Feature | Dettaglio |
|---|---|
| 📋 **Lista processi** | Stato (online / stopped / errored), CPU%, RAM, uptime, PID, numero restart |
| ▶️ **Controllo processi** | Avvia, Ferma, Riavvia, Elimina ogni processo PM2 |
| 📜 **Log viewer** | Ultimi N righe + streaming live via WebSocket; scelta 50/100/200 righe |
| 🔐 **Login sicuro** | Username + password, sessione con cookie firmato (HttpOnly, SameSite=Strict) |
| 🛡️ **Protezione brute-force** | Max 5 tentativi login / 10 minuti, poi blocco temporaneo |
| 🔏 **CSRF protection** | Token anti-CSRF su tutte le richieste state-changing |
| 📱 **PWA installabile** | `manifest.json` + Service Worker → si installa come app nativa su Android/iOS |
| 🔔 **Notifiche push** | Avvisi istantanei sul telefono quando un processo crasha (exit code ≠ 0) |
| 🌙 **UI dark glassmorphism** | Design moderno, mobile-first, sfondo scuro, badge animati, font Inter |
| 🔌 **Porta configurabile** | Default `3003`, modificabile via `PORT` in `.env` |
| 🔀 **Reverse proxy ready** | `trust proxy` abilitato, compatibile con nginx/Caddy e HTTPS |

---

## Screenshot

![Dashboard PM2 Oscar](https://github.com/user-attachments/assets/58967e0c-3f4b-4a00-beef-f5f933a7a75b)

---

## Stack tecnico

**Backend**
- `Node.js v22+` – runtime
- `express` – server HTTP
- `express-session` – sessioni cookie firmate
- `express-rate-limit` – protezione brute-force
- `pm2` – API programmatica PM2 (lista, azioni, bus log/eventi)
- `ws` – WebSocket per streaming log in real-time
- `web-push` – invio notifiche push VAPID (PWA)
- `dotenv` – gestione variabili d'ambiente

**Frontend** (vanilla, nessun build step)
- HTML/CSS/JS puro in `public/`
- Service Worker (`sw.js`) per cache offline e ricezione push
- Web Push API del browser per sottoscrizione notifiche
- Lucide icons via CDN, Inter font via Google Fonts

---

## Requisiti

- **Node.js `v22.19.0`** o superiore
- **PM2** installato globalmente: `npm install -g pm2`
- Un dominio con **HTTPS** per le notifiche push in produzione (requisito del browser per le Web Push API)

---

## Installazione

```bash
# 1. Clona il repository
git clone https://github.com/oscarnastro/pm2-oscar.git
cd pm2-oscar

# 2. Installa le dipendenze
npm install

# 3. Crea il file .env dalla base di esempio
cp .env.example .env
```

Poi modifica `.env` con le tue credenziali (vedi sezione successiva).

---

## Configurazione .env

```env
# Porta su cui ascolta la dashboard (default: 3003)
PORT=3003

# Segreto per firmare i cookie di sessione
# Cambia con una stringa random lunga (es. openssl rand -hex 32)
SESSION_SECRET=changeme_super_secret

# Credenziali di accesso alla dashboard
ADMIN_USERNAME=admin
ADMIN_PASSWORD=changeme123

# Usato come entropia per i token CSRF
# Cambia con una stringa random (es. openssl rand -hex 32)
JWT_SECRET=changeme_jwt_secret

# ── Push notifications (PWA) ─────────────────────────────────
# Genera le chiavi con: npx web-push generate-vapid-keys
VAPID_EMAIL=admin@example.com
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
```

> **Sicurezza:** Non committare mai il file `.env` nel repository. È già incluso in `.gitignore`.

---

## Generare le chiavi VAPID

Le chiavi VAPID sono necessarie per inviare notifiche push al browser. Genera le chiavi una sola volta:

```bash
npx web-push generate-vapid-keys
```

Output di esempio:
```
=======================================
Public Key:
BH1c9aQ...lunga stringa...
Private Key:
mA3k...lunga stringa...
=======================================
```

Copia i valori nel tuo `.env`:
```env
VAPID_PUBLIC_KEY=BH1c9aQ...
VAPID_PRIVATE_KEY=mA3k...
```

> Le chiavi devono rimanere **stabili**: se le rigeneri, tutti i dispositivi già sottoscritti perderanno le notifiche e dovranno ri-sottoscriversi.

---

## Avvio

### Locale (sviluppo)

```bash
npm start
# oppure
node server.js
```

Apri il browser su: `http://localhost:3003`

### Con PM2 (produzione)

```bash
# Avvia tramite la configurazione inclusa
pm2 start ecosystem.config.js

# Salva la lista dei processi per il riavvio automatico
pm2 save

# Abilita l'avvio automatico al boot del sistema
pm2 startup
```

Verifica che stia girando:
```bash
pm2 list
pm2 logs pm2-oscar-dashboard
```

Per aggiornare dopo una modifica al codice:
```bash
pm2 restart pm2-oscar-dashboard
```

---

## PWA: installare la dashboard sul telefono

La dashboard è una **Progressive Web App** installabile. Funziona su Android (Chrome) e iOS (Safari).

### Android (Chrome)

1. Apri la dashboard in Chrome (HTTPS obbligatorio in produzione)
2. Tocca il menu `⋮` → **Aggiungi a schermata Home** (o segui il banner automatico)
3. La dashboard si apre come app nativa, senza barra del browser

### iOS (Safari)

1. Apri la dashboard in Safari
2. Tocca l'icona **Condividi** → **Aggiungi a schermata Home**
3. Conferma il nome e tocca **Aggiungi**

> **Nota:** Le notifiche push su iOS richiedono iOS 16.4+ con Safari e sono supportate solo se la PWA è installata.

---

## Notifiche push: come funzionano

```
[PM2 process crasha]
       │
       ▼
[PM2 Bus emette process:event con exit_code ≠ 0]
       │
       ▼
[server.js rileva il crash]
       │
       ▼
[push-service.js invia notifica via web-push a tutti i device sottoscritti]
       │
       ▼
[Service Worker del browser riceve il push e mostra la notifica]
       │
       ▼
[Tocco sulla notifica → apre la dashboard]
```

### Attivare le notifiche dal browser

1. Accedi alla dashboard
2. Clicca il bottone **campanella** 🔔 in alto a destra nella navbar
3. Il browser chiederà il permesso per le notifiche → clicca **Consenti**
4. La campanella diventa viola (attiva)

### Quando arriva una notifica

Riceverai una notifica push quando:
- Un processo si ferma con **exit code ≠ 0** (crash inatteso)
- Un processo va in stato **error**

**Non** riceverai notifiche per:
- Stop manuali dalla dashboard (exit code 0)
- Restart pianificati

### Disattivare le notifiche

Clicca di nuovo la campanella per disiscriverti. Oppure revoca il permesso nelle impostazioni del browser.

---

## Uso dietro reverse proxy

### Nginx

```nginx
server {
    listen 443 ssl;
    server_name dashboard.tuodominio.it;

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
    server_name dashboard.tuodominio.it;
    return 301 https://$host$request_uri;
}
```

### Caddy

```caddyfile
dashboard.tuodominio.it {
    reverse_proxy 127.0.0.1:3003
}
```

Caddy gestisce automaticamente TLS (Let's Encrypt) e gli header `X-Forwarded-*`.

> La dashboard ha già `app.set('trust proxy', 1)` abilitato, quindi legge correttamente IP e schema dal proxy.

---

## Struttura del progetto

```
pm2-oscar/
├── server.js              # Entry point Express + WebSocket + PM2 bus
├── auth.js                # Middleware sessione, requireAuth, validazione credenziali
├── pm2-client.js          # Wrapper PM2 (connect, list, action, describe, bus)
├── push-service.js        # VAPID setup, gestione subscription, invio push
├── routes/
│   ├── api.js             # REST API processi PM2 (list, start, stop, restart, delete)
│   ├── logs.js            # Tail log (ultimi N righe)
│   └── push.js            # API sottoscrizione push, chiave pubblica VAPID
├── public/
│   ├── index.html         # Dashboard principale (protetta da login)
│   ├── login.html         # Pagina di login
│   ├── style.css          # CSS dark/glassmorphism
│   ├── app.js             # Logica frontend (processi, log, SW, push)
│   ├── sw.js              # Service Worker (cache + push handler)
│   ├── manifest.json      # Web App Manifest (PWA)
│   └── icons/
│       ├── icon-192.svg   # Icona PWA 192x192
│       ├── icon-512.svg   # Icona PWA 512x512
│       └── badge-72.svg   # Badge notifiche 72x72
├── data/
│   └── subscriptions.json # Sottoscrizioni push (auto-generato, gitignored)
├── .env.example           # Template variabili d'ambiente
├── .gitignore
├── ecosystem.config.js    # Configurazione PM2 per avviare la dashboard
└── package.json
```

---

## Variabili d'ambiente – riferimento completo

| Variabile | Default | Obbligatoria | Descrizione |
|---|---|---|---|
| `PORT` | `3003` | No | Porta su cui ascolta il server |
| `SESSION_SECRET` | `changeme_super_secret` | **Sì** | Segreto per firmare i cookie di sessione |
| `ADMIN_USERNAME` | `admin` | **Sì** | Username per l'accesso alla dashboard |
| `ADMIN_PASSWORD` | `changeme123` | **Sì** | Password per l'accesso alla dashboard |
| `JWT_SECRET` | `changeme_jwt_secret` | **Sì** | Entropia per i token CSRF |
| `VAPID_EMAIL` | `admin@example.com` | No | Email per le notifiche push (formato `mailto:`) |
| `VAPID_PUBLIC_KEY` | _(vuoto)_ | Per push | Chiave pubblica VAPID |
| `VAPID_PRIVATE_KEY` | _(vuoto)_ | Per push | Chiave privata VAPID |
| `NODE_ENV` | _(non impostato)_ | No | Imposta `production` per abilitare il flag `secure` sui cookie |

> Se `VAPID_PUBLIC_KEY` o `VAPID_PRIVATE_KEY` sono vuoti, le notifiche push vengono disabilitate gracefully. La dashboard funziona normalmente.

---

## API REST – riferimento

Tutte le API richiedono autenticazione (sessione attiva). Le richieste non-GET richiedono l'header `x-csrf-token`.

### Autenticazione

| Metodo | Endpoint | Descrizione |
|---|---|---|
| `GET` | `/auth/csrf` | Restituisce il token CSRF per la sessione corrente |
| `POST` | `/auth/login` | Login. Body: `{ username, password }`. Rate-limited: 5 req/10min |
| `POST` | `/auth/logout` | Logout, distrugge la sessione |

### Processi PM2

| Metodo | Endpoint | Descrizione |
|---|---|---|
| `GET` | `/api/processes` | Lista tutti i processi PM2 |
| `POST` | `/api/processes/:id/start` | Avvia il processo |
| `POST` | `/api/processes/:id/stop` | Ferma il processo |
| `POST` | `/api/processes/:id/restart` | Riavvia il processo |
| `DELETE` | `/api/processes/:id` | Elimina il processo da PM2 |

### Log

| Metodo | Endpoint | Descrizione |
|---|---|---|
| `GET` | `/logs/processes/:id/tail?lines=N` | Ultime N righe di log (max 500) |
| `WebSocket` | `ws://host/ws/logs?processId=N` | Streaming log in real-time |

### Push Notifications

| Metodo | Endpoint | Descrizione |
|---|---|---|
| `GET` | `/api/push/status` | Controlla se le push sono configurate |
| `GET` | `/api/push/vapid-public-key` | Restituisce la chiave pubblica VAPID |
| `POST` | `/api/push/subscribe` | Salva una sottoscrizione push |
| `DELETE` | `/api/push/subscribe` | Rimuove una sottoscrizione push |

---

## Sicurezza

- **Sessioni**: cookie `HttpOnly`, `SameSite=Strict`, `secure` in produzione
- **Brute-force**: rate limiting sul login (5 tentativi / 10 minuti)
- **CSRF**: token anti-CSRF generato per sessione, richiesto su tutte le richieste non-GET
- **Errori API**: messaggi generici al client, dettagli loggati solo server-side
- **Reverse proxy**: `trust proxy` abilitato, supporta header `X-Forwarded-*`
- **VAPID**: solo la chiave pubblica è esposta al client
- **Abbonamenti push**: le sottoscrizioni scadute/invalide vengono rimosse automaticamente

> **Raccomandazione**: in produzione usa sempre HTTPS. Genera segreti forti con `openssl rand -hex 32`.

---

## FAQ

**Le notifiche arrivano anche quando chiudo il browser?**
Sì, il Service Worker rimane attivo in background (su Android/Chrome). Su iOS richiedono iOS 16.4+ con la PWA installata.

**Il server devo tenerlo sempre acceso?**
Sì, le notifiche vengono inviate dal server (non dal browser). Se il server è spento, le notifiche non vengono inviate.

**Posso avere più utenti?**
Al momento supporta un solo utente admin. Per multi-utente bisognerebbe estendere `auth.js` con un sistema di account.

**Le sottoscrizioni push sopravvivono al riavvio del server?**
Sì, vengono salvate in `data/subscriptions.json` (escluso da git).

**Come aggiorno la dashboard senza perdere i processi PM2?**
```bash
pm2 reload pm2-oscar-dashboard
```
`reload` esegue un graceful restart senza downtime.

**Cosa succede se le chiavi VAPID cambiano?**
I device precedentemente sottoscritti perderanno le notifiche. Elimina `data/subscriptions.json` e chiedi agli utenti di ri-attivare la campanella.
