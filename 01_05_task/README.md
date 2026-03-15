# Zadanie Railway

**Cel:** Aktywować trasę kolejową **X-01** przez API Hub (`https://hub.ag3nts.org/verify`, task: `railway`).

---

## Co jest potrzebne

W pliku **`.env`** w głównym katalogu repozytorium (4th-devs) musi być wpis:

```env
HUB_APIKEY=twój-klucz
```

---

## Jak uruchomić

Z **głównego katalogu** repozytorium:

```bash
npm run lesson5:task
```

Albo z katalogu `01_05_task`:

```bash
node app.js
```

Skrypt sam:
1. Wywoła `help` w API i odczyta dokumentację,
2. Wykona kolejno: **reconfigure** (X-01) → **setstatus** (X-01, RTOPEN) → **save** (X-01),
3. Przy 503 i 429 poczeka i spróbuje ponownie,
4. Wypisze na koniec flagę w formacie `{FLG:...}`.

---

## Co jest w tym katalogu

| Plik | Opis |
|------|------|
| `app.js` | Skrypt do uruchomienia — wywołuje API i wypisuje flagę. |
| `railway-api.js` | Wspólna logika wywołań API (help, reconfigure, setstatus, save) z obsługą 503/429. |
| `railway-tool.js` | Definicja narzędzia „railway” — 01_05_agent ładuje je stąd przy starcie. |
| `agents/railway.agent.md` | Szablon agenta „railway” — 01_05_agent ładuje go stąd. |

---

## Użycie agenta (01_05_agent) — curl

Serwer agenta nasłuchuje domyślnie na `http://127.0.0.1:3000`. API wymaga nagłówka `Authorization: Bearer <token>`. Token tworzysz przez seed bazy w 01_05_agent (domyślny z seed to `0f47acce-3aa7-4b58-9389-21b2940ecc70`).

**1. Uruchom serwer agenta** (z głównego katalogu repozytorium):

```bash
npm run lesson5:agent
```

**2. Wywołanie agenta „railway” (jedna wiadomość, odpowiedź w JSON):**

```bash
curl -s http://127.0.0.1:3000/api/chat/completions \
  -H "Authorization: Bearer 0f47acce-3aa7-4b58-9389-21b2940ecc70" \
  -H "Content-Type: application/json" \
  -d '{"agent":"railway","input":"Aktywuj trasę X-01 i podaj mi flagę."}' | jq
```

**3. To samo ze streamowaniem (SSE):**

```bash
curl -N http://127.0.0.1:3000/api/chat/completions \
  -H "Authorization: Bearer 0f47acce-3aa7-4b58-9389-21b2940ecc70" \
  -H "Content-Type: application/json" \
  -d '{"agent":"railway","input":"Aktywuj trasę X-01 i podaj flagę.","stream":true}'
```

**4. Kolejna wiadomość w tej samej sesji** (skopiuj `sessionId` z odpowiedzi pierwszego wywołania):

```bash
curl -s http://127.0.0.1:3000/api/chat/completions \
  -H "Authorization: Bearer 0f47acce-3aa7-4b58-9389-21b2940ecc70" \
  -H "Content-Type: application/json" \
  -d '{"agent":"railway","sessionId":"<sessionId-z-odpowiedzi>","input":"Jaka była flaga?"}' | jq
```

**5. Health check (bez auth):**

```bash
curl -s http://127.0.0.1:3000/health | jq
```

Jeśli uruchamiasz agenta na innym porcie lub hoście, zamień `http://127.0.0.1:3000` na właściwy URL. Token musisz mieć z bazy 01_05_agent (po `npm run lesson5:agent:db:seed` w katalogu głównym lub w 01_05_agent).

---

## Wynik

Po poprawnym wykonaniu w logu pojawi się flaga, np. **`{FLG:COUNTRYROADS}`**.
