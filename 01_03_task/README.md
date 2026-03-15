# 01_03_Task — proxy-asystent (pamięć sesji + API paczek)

Publiczny endpoint HTTP: operator wysyła `{ "sessionID", "msg" }`, dostaje `{ "msg" }`.  
Serwer trzyma historię per `sessionID` (RAM + pliki w `sessions/`), woła LLM z narzędziami `check_package` / `redirect_package` (API `https://hub.ag3nts.org/api/packages`).

## Wymagania

- **Node.js 24+** (tak samo jak root `config.js` w repo)
- Skopiuj **`env.example` → `.env`**. Są **dwa niezależne API**:
  1. **OpenRouter** — `OPENROUTER_API_KEY` → tokeny LLM (jak w innych lekcjach).
  2. **Hub (ag3nts)** — `HUB_APIKEY` → weryfikacja zadań + API paczek (`hub.ag3nts.org/api/packages`); to **nie** jest klucz OpenRouter.
- Opcjonalnie: `PORT`, `PROXY_MODEL`.

## Klucze w `.env`

| Zmienna | Gdzie służy |
|--------|-------------|
| `OPENROUTER_API_KEY` | Wyłącznie **OpenRouter** (model, function calling) |
| `HUB_APIKEY` | **Hub**: verify (`apikey` w JSON) + pole `apikey` w POST do `/api/packages` |

## Uruchomienie lokalnie

Z **roota repo** (wczytuje `.env` z roota):

```bash
npm run lesson3:task
```

W `.env` — wg root **`env.example`**.  
Skrypt wczytuje całe `.env` — potrzebne m.in. **`OPENROUTER_API_KEY`**, **`HUB_APIKEY`**, `AI_PROVIDER`, opcjonalnie `PORT` / `PROXY_MODEL`.

Alternatywnie:

```bash
cd 01_03_Task
npm start
```

(tak samo potrzebny `.env` w rootcie repo przez import `config.js`). Domyślnie port **3000**.

Opcjonalnie model LLM:

```bash
PROXY_MODEL=anthropic/claude-3.5-haiku npm start
```

## Wystawienie na świat

### Plan: najpierw ngrok → potem VPS

1. **Ngrok** — szybki test z Maca (bez wgrywania kodu).  
2. **VPS / Azyl** — stały adres; wtedy `deploy-azyl.sh` / Frog + `PORT` publiczny.

---

### ngrok (krok po kroku)

**Terminal 1 — aplikacja (z roota repo):**

```bash
cd /ścieżka/do/4th-devs
npm run lesson3:task
```

Domyślnie słucha na **3000**. Inny port: `PORT=8080 npm run lesson3:task` — wtedy ngrok na ten sam port.

**Terminal 2 — tunel:**

```bash
ngrok http 3000
```

Zaloguj się wcześniej: [ngrok.com](https://ngrok.com) → `ngrok config add-authtoken …`

Skopiuj **HTTPS** URL (np. `https://abc123.ngrok-free.app`).

**Test z internetu (opcjonalnie):**

```bash
curl -sS -X POST https://TWÓJ_NGROK.ngrok-free.app/ \
  -H 'Content-Type: application/json' \
  -H 'ngrok-skip-browser-warning: 1' \
  -d '{"sessionID":"ngrok1","msg":"Cześć"}'
```

(Nagłówek `ngrok-skip-browser-warning` bywa potrzebny przy ręcznym curl; Hub zwykle i tak łączy się jako klient API.)

**Verify (w `apikey` daj swoje `HUB_APIKEY` z `.env`):**

```bash
curl -sS -X POST https://hub.ag3nts.org/verify \
  -H 'Content-Type: application/json' \
  -d '{
    "apikey": "<HUB_APIKEY z .env>",
    "task": "proxy",
    "answer": {
      "url": "https://abc123.ngrok-free.app/",
      "sessionID": "hub01"
    }
  }'
```

- URL w `answer.url` = **dokładnie** adres z ngrok + zwykle **końcowy `/`**.  
- Po restarcie ngrok **zmienia się domena** — wtedy ponów verify z nowym URL.  
- Zostaw **Terminal 1 i 2 włączone**, dopóki Hub testuje.

---

### Później: VPS (Azyl / Frog)

- **Azyl:** port z bannera (np. 57086) + `bash 01_03_Task/deploy-azyl.sh` albo `mac-upload-azyl.sh` + `PORT=<banner> node …` — patrz sekcja Azyl niżej.  
- **Frog:** ten sam kod, `PORT` zgodny z tym, co wystawiasz na świat (nginx / firewall).

### pinggy (SSH)

```bash
ssh -p 443 -R0:localhost:3000 a.pinggy.io
```

### Azyl (szybkie wdrożenie z Maca)

Po zalogowaniu banner pokazuje **Twój port HTTP** (np. `57086`) i URL `https://azyl-57086.ag3nts.org`.

Z **Maca**, w katalogu repo (masz lokalny `.env`):

```bash
bash 01_03_Task/deploy-azyl.sh
```

Domyślnie: SSH `agent17086@azyl.ag3nts.org -p 5022`, port HTTP **57086**. Inny port z bannera:

```bash
AZYL_HTTP_PORT=57086 AZYL_USER=agent17086 bash 01_03_Task/deploy-azyl.sh
```

Skrypt: `rsync` → `~/proxy-task/` (`config.js` + `01_03_Task/`), wgrywa **`.env`**, na serwerze instaluje **Node 24 (nvm)** jeśli brak, odpala `PORT=<twój_port> node --env-file=.env …` w tle, robi lokalny `curl` test.

Logi na Azylu: `tail -f ~/proxy-task/proxy.log`

### VPS Frog (mikr.us)

1. **SSH** na Frog (login/hasło z panelu mikr.us).
2. Zainstaluj Node 24 (jeśli nie ma), np. [nvm](https://github.com/nvm-sh/nvm):
   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
   source ~/.nvm/nvm.sh
   nvm install 24
   ```
3. W rootcie repo `.env`: **`OPENROUTER_API_KEY`**, **`AI_PROVIDER=openrouter`**, **`HUB_APIKEY`** (klucz z kursu do Huba).
4. Uruchom serwer **w tle** (z roota repo, żeby wczytać `.env`):
   ```bash
   cd /ścieżka/do/repo
   PORT=3000 nohup node --env-file=.env ./01_03_Task/app.js > 01_03_Task/proxy.log 2>&1 &
   ```
5. Jeśli Frog wystawia tylko port 80, ustaw `PORT=80` (może wymagać `sudo`) albo użyj reverse proxy (nginx) z `proxy_pass http://127.0.0.1:3000`.
6. Publiczny URL Froga (np. `http://twoj-host.mikr.us:PORT/`) wpisz w verify jako `url` — **pełny adres do endpointu**, pod który Hub zrobi POST (ten sam host co działa z zewnątrz).

### systemd (opcjonalnie na VPS)

Plik `/etc/systemd/system/proxy-task.service`:

```ini
[Unit]
Description=AI Devs proxy task
After=network.target

[Service]
Type=simple
User=twoj-user
WorkingDirectory=/ścieżka/do/repo/01_03_Task
Environment=NODE_ENV=production
Environment=PORT=3000
EnvironmentFile=/ścieżka/do/repo/.env
ExecStart=/home/twoj-user/.nvm/versions/node/v24.x.x/bin/node app.js
Restart=always

[Install]
WantedBy=multi-user.target
```

`systemctl daemon-reload && systemctl enable --now proxy-task`

## Zgłoszenie do Huba

Gdy URL jest publiczny:

```bash
curl -s -X POST https://hub.ag3nts.org/verify \
  -H "Content-Type: application/json" \
  -d '{
    "apikey": "<HUB_APIKEY z .env — ten sam co do verify, nie OpenRouter>",
    "task": "proxy",
    "answer": {
      "url": "https://twoj-publiczny-adres/",
      "sessionID": "test01"
    }
  }'
```

`sessionID` może być dowolny — Hub użyje go przy testach.

## Test ręczny

```bash
curl -s -X POST http://127.0.0.1:3000/ \
  -H "Content-Type: application/json" \
  -d '{"sessionID":"abc","msg":"Cześć"}'
```

Odpowiedź: `{"msg":"..."}`.

## Uwagi techniczne

- Przekierowanie paczki w kodzie **zawsze** idzie na `PWR6132PL` (Żarnowiec), zgodnie z misją — operator dostaje naturalną odpowiedź od modelu + `confirmation` z API.
- Historia sesji jest w `sessions/<sessionID>.json` (bezpieczna nazwa pliku).
