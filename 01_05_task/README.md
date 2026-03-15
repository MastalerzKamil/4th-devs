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
| `railway-tool.js` | Definicja narzędzia „railway” (dla ewentualnego podłączenia do agenta w 01_05_agent). |
| `agents/railway.agent.md` | Szablon agenta „railway” (do użycia razem z narzędziem, jeśli zintegrujesz to z 01_05_agent). |

Do rozwiązania zadania wystarczy **`npm run lesson5:task`** — reszta plików to kod do ewentualnej integracji z agentem/MCP.

---

## Wynik

Po poprawnym wykonaniu w logu pojawi się flaga, np. **`{FLG:COUNTRYROADS}`**.
