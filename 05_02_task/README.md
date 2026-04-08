# S05E02 — zadanie `phonecall` (`05_02_task`)

Automatyczna rozmowa z operatorem Centrali: `start` na `https://hub.ag3nts.org/verify`, kolejne tury to nagrania MP3 w Base64. Agent używa wyłącznie **OpenAI** (Whisper + Chat + TTS) oraz **`HUB_APIKEY`** z pliku **`.env` w katalogu głównym repozytorium**.

## Wymagania

- Node.js 24+ (jak w reszcie repo)
- W **katalogu głównym** projektu (`4th-devs/`) plik `.env` z:
  - `OPENAI_API_KEY=...`
  - `HUB_APIKEY=...` (klucz API Centrali / ag3nts)

## Instalacja i uruchomienie (z katalogu głównego repo)

```bash
npm install --prefix ./05_02_task
npm run lesson22:task
```

Albo jednym z `lesson22:install` (instaluje też UI, voice i ten task):

```bash
npm run lesson22:install
npm run lesson22:task
```

Serwer ładuje zmienne przez `node --env-file=.env` uruchamiane **z roota** — nie trzeba `cd` do `05_02_task`.

W przeglądarce otwórz **http://localhost:3312** (port zmienisz zmienną `PHONECALL_PORT`).

1. Kliknij **Start sesji (auto)** — serwer wyśle `action: start`, potem w pętli: synteza mowy → Base64 → hub → transkrypcja odpowiedzi operatora → kolejna wypowiedź modelu.
2. **Stop sesji** przerywa pętlę (Abort).

### Opcjonalnie z podkatalogu `05_02_task`

```bash
cd 05_02_task && npm run dev
```

(`dev` używa `node --env-file=../.env` — nadal root `.env`.)

## Pamięć między sesjami

Każda próba jest dopisywana do `05_02_task/.data/phonecall_memory.json` (katalog w `.gitignore`).

Przed **każdą** wygenerowaną wypowiedzią (oprócz pierwszej, skryptowanej linii powitalnej) model ma narzędzie **`read_phonecall_memory`**: wymuszane wywołanie funkcji, potem w treść wiadomości `tool` trafia świeży wynik `loadLessonsForPrompt()` z dysku — agent najpierw „czyta” pamięć, potem zwraca jedną linijkę mowy po polsku.

- Podgląd: `GET http://localhost:3312/api/memory` (liczba sesji + skrót lekcji).
- Limity: `PHONECALL_MEMORY_MAX_CHARS` (domyślnie 3800), `PHONECALL_MEMORY_SESSIONS` (ile ostatnich sesji brać pod uwagę, domyślnie 8).
- Wyłączenie narzędzia (stary tryb: jeden request bez tooli): `PHONECALL_USE_MEMORY_TOOL=0` w `.env`.

## Opcjonalne zmienne środowiskowe

| Zmienna | Domyślnie | Opis |
|--------|-----------|------|
| `PHONECALL_PORT` | `3312` | Port serwera WWW |
| `PHONECALL_CHAT_MODEL` | `gpt-4o` | Model czatu sterującego scenariuszem |
| `PHONECALL_TTS_MODEL` | `tts-1-hd` | Model syntezy (wyraźniejsza mowa niż `tts-1`) |
| `PHONECALL_TTS_VOICE` | `nova` | Głos OpenAI TTS (`alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`) |
| `PHONECALL_TTS_SPEED` | `0.92` | Tempo mowy (0.25–1.25); wolniej = wyraźniej dla polskich imion |
| `PHONECALL_MAX_TURNS` | `40` | Limit tur zabezpieczający przed nieskończoną pętlą |
| `PHONECALL_MEMORY_MAX_CHARS` | `3800` | Max. długość bloku „lekcji” w prompcie |
| `PHONECALL_MEMORY_SESSIONS` | `8` | Ile ostatnich sesji z pliku brać do podsumowania |
| `PHONECALL_USE_MEMORY_TOOL` | `1` (domyślnie włączone) | Ustaw `0`, żeby wyłączyć narzędzie `read_phonecall_memory` i jeden prosty request czatu |

## Uwagi

- Scenariusz (Tymon Gajewski, drogi RD224 / RD472 / RD820, hasło **BARBAKAN**, itd.) jest wpisany w `src/openai_pipeline.js` w `SYSTEM_INSTRUCTIONS`.
- Jeśli hub zwraca nietypowy JSON, sprawdź log w UI — pełny kształt odpowiedzi (bez surowego Base64) jest logowany przez `summarizeHubData`.
