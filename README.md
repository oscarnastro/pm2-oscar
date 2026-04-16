# PM2 Oscar Dashboard

Dashboard web PM2 moderna, mobile-first e sicura per Node.js **v22.19.0+**.

## Features

- Lista processi PM2: stato, CPU, memoria, uptime, PID, restart
- Azioni: Start / Stop / Restart / Delete
- Log viewer: ultime N righe + streaming live via WebSocket
- Login con username/password e sessione cookie firmato
- Protezione brute-force sul login (max 5 tentativi / 10 minuti)
- Porta configurabile (`PORT`, default `3003`)
- Pensata per reverse proxy (`trust proxy` abilitato)

## Requisiti

- Node.js `v22.19.0` o superiore
- PM2 installato e processi gestiti da PM2

## Installazione

```bash
npm install
cp .env.example .env
```

Configura `.env`:

```env
PORT=3003
SESSION_SECRET=changeme_super_secret
ADMIN_USERNAME=admin
ADMIN_PASSWORD=changeme123
JWT_SECRET=changeme_jwt_secret
```

`JWT_SECRET` viene usato come entropia aggiuntiva per la generazione dei token CSRF di sessione.

## Avvio

### Locale

```bash
npm start
```

Apri: `http://localhost:3003`

### Con PM2

```bash
pm2 start ecosystem.config.js
pm2 save
```

## Uso dietro reverse proxy

- Mantieni HTTPS sul proxy
- Passa correttamente gli header `X-Forwarded-*`
- Lascia `trust proxy` abilitato (già configurato)

## Struttura

```
pm2-oscar/
├── server.js
├── auth.js
├── routes/
│   ├── api.js
│   └── logs.js
├── public/
│   ├── index.html
│   ├── login.html
│   ├── style.css
│   └── app.js
├── .env.example
├── ecosystem.config.js
└── package.json
```
