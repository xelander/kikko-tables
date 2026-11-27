# Kikko – tavoli e ordinazioni

Sistema di ordinazione al tavolo per un ristorante all you can eat: un'unica web app Angular con aree per ruolo
(cliente, cameriere, cassa, amministratore, monitor) e un'API NestJS con PostgreSQL.
Il brief completo è in [`CLAUDE.md`](CLAUDE.md), le decisioni prese in [`docs/decisioni.md`](docs/decisioni.md).

**Stato:** F2 – App cliente (menù reale it/en con foto e allergeni, carrello condiviso in tempo reale, regole AYCE, invio dei giri anche offline).

## Struttura

```
apps/
  api/        NestJS 12 (ESM) + Prisma 7 – REST sotto /api
    prisma/   schema, migrazioni, script di seed
  web/        Angular 22 standalone + SCSS
    src/styles/tokens.css      design token del brand (unico file da cambiare)
    public/assets/brand/       logo e asset di brand (vedi il README lì dentro)
packages/
  shared/     tipi, DTO e schemi Zod condivisi tra web e API
    seed/     configurazione di default e menù demo (JSON versionati)
e2e/          test Playwright
docker-compose.yml   PostgreSQL 17 per lo sviluppo
```

## Requisiti

- Node.js 22.12 o successivo (npm 10)
- Docker con Docker Compose, oppure un PostgreSQL 16+ già installato

## Avvio in locale

```bash
npm install
```

```bash
docker compose up -d db
```

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

```bash
npm run dev
```

- Web: <http://localhost:4200> (la home mostra lo stato dell'API e i link alle aree)
- API: <http://localhost:3000/api/health>

### Utenti di sviluppo

Il seed (fuori da produzione) crea questi utenti. Le password sono uguali allo username.

| Utente    | Ruolo     | PIN personale | Note                                                       |
| --------- | --------- | ------------- | ---------------------------------------------------------- |
| `admin`   | ADMIN     | –             | Può fare tutto                                             |
| `capo`    | CAPO      | `0000`        | Può chiudere i tavoli e registrare i dispositivi condivisi |
| `mario`   | CAMERIERE | `1234`        | Apre i tavoli e vede il PIN                                |
| `monitor` | MONITOR   | –             | Solo lettura                                               |

### Provare il flusso F1

1. Apri <http://localhost:4200/staff/cameriere> ed entra con `mario` / `mario`.
2. Tocca un tavolo libero, scegli coperti e formula, poi "Apri tavolo": compare il PIN.
3. Da un altro browser (o in incognito) apri `http://localhost:4200/t/tavolo-01` (per il tavolo 1) e inserisci il PIN.
4. Il cameriere vede comparire il telefono sul tavolo in tempo reale. Con `capo` puoi chiudere il tavolo: il telefono del
   cliente mostra subito la schermata di chiusura.

### Provare il flusso F2 (ordinazione)

1. Apri un tavolo come sopra, poi entra con il PIN da due finestre diverse (o due telefoni) sullo stesso tavolo.
2. Aggiungi piatti dal menù: l'altro telefono vede subito le aggiunte con l'emoji di chi le ha fatte, e il contatore
   "Questo giro: N/limite".
3. Le bevande sono nella pagina "Bevande": extra a pagamento, non contano nel limite del giro.
4. "Vedi ordine" → "Invia giro": il giro va "in attesa di conferma" (l'approvazione alla cassa arriva in F4) e parte il
   conto alla rovescia per il giro successivo.

Il menù è quello reale del ristorante (155 piatti, trascritti dal PDF della cena) con foto, allergeni e limiti
"massimo N volte" (per persona). Vedi [`packages/shared/seed/README.md`](packages/shared/seed/README.md).

**Dispositivo condiviso del locale:** entra come `capo` sul tablet, tocca "Rendi condiviso" e dai un nome.
Da quel momento la pagina di accesso di quel tablet mostra i nomi dello staff e chiede solo il PIN personale.

`npm run dev` avvia insieme, in modalità watch, `packages/shared`, l'API e il web.
Il dev server Angular gira le chiamate `/api` e `/socket.io` all'API (`apps/web/proxy.conf.json`).

### Variabili d'ambiente

Fuori da produzione l'API funziona senza `.env`: i default puntano al Postgres di `docker-compose.yml`.
Per cambiarli copia `apps/api/.env.example` in `apps/api/.env`.

| Variabile                                     | Default (sviluppo)                                   | Note                                                            |
| --------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------- |
| `DATABASE_URL`                                | `postgresql://kikko:kikko@localhost:5432/kikko`      | Obbligatoria in produzione                                      |
| `TEST_DATABASE_URL`                           | `postgresql://kikko:kikko@localhost:5432/kikko_test` | Il nome deve finire in `_test`: viene creato e migrato dai test |
| `PORT` / `HOST`                               | `3000` / `0.0.0.0`                                   |                                                                 |
| `APP_VERSION`                                 | `0.0.0-dev`                                          | Mostrata da `/api/health`                                       |
| `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` | `admin` / `admin`                                    | La password è obbligatoria in produzione                        |

Le variabili vengono validate all'avvio: se una non è valida l'API si ferma subito con un messaggio chiaro.

### Senza Docker

Con un PostgreSQL locale crea utente e database e imposta `DATABASE_URL` se diversi dai default:

```bash
psql -U postgres -c "CREATE USER kikko WITH PASSWORD 'kikko' CREATEDB;" -c "CREATE DATABASE kikko OWNER kikko;"
```

L'utente deve poter creare database (`CREATEDB`) perché i test di integrazione creano `kikko_test` da soli.

## Comandi

| Comando                                   | Cosa fa                                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                             | Shared, API e web in watch                                                                                                            |
| `npm run build`                           | Build di shared, API (`apps/api/dist`) e web (`apps/web/dist/web`)                                                                    |
| `npm run lint` / `npm run lint:fix`       | ESLint su tutto il monorepo                                                                                                           |
| `npm run format` / `npm run format:check` | Prettier                                                                                                                              |
| `npm run typecheck`                       | Controllo dei tipi di tutti i pacchetti e dei test e2e                                                                                |
| `npm test`                                | Test unitari (Vitest) di shared e web; test unitari e di integrazione dell'API su `kikko_test`                                        |
| `npm run e2e`                             | Test Playwright (mobile e desktop). Esegui prima `npm run build`, oppure tieni aperto `npm run dev`                                   |
| `npm run check`                           | Lint, formato, tipi, test e build in sequenza                                                                                         |
| `npm run db:migrate`                      | Crea o applica le migrazioni in sviluppo (`prisma migrate dev`)                                                                       |
| `npm run db:deploy`                       | Applica le migrazioni esistenti (CI e produzione)                                                                                     |
| `npm run db:seed`                         | Carica configurazione di default, menù demo, 24 tavoli e admin. Si può rilanciare: non crea doppioni e ripristina i valori di default |
| `npm run db:reset`                        | Cancella il database, riapplica le migrazioni e il seed                                                                               |

Per i test e2e su una macchina dove Chromium è già installato si può indicare il binario con
`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/percorso/chrome`; altrimenti `npx playwright install chromium`.

## API

Tutte sotto `/api`. Lo staff manda `Authorization: Bearer <accessToken>`; i clienti sono riconosciuti dal cookie.

| Metodo e percorso                                           | Chi                   | Cosa fa                                                   |
| ----------------------------------------------------------- | --------------------- | --------------------------------------------------------- |
| `POST /auth/login`                                          | pubblico              | Login personale; imposta il cookie di refresh             |
| `POST /auth/pin`                                            | dispositivo condiviso | Login con PIN personale                                   |
| `POST /auth/refresh` · `POST /auth/logout` · `GET /auth/me` | staff                 | Rinnovo (token ruotato), uscita, utente corrente          |
| `GET /auth/dispositivo` · `POST /auth/dispositivo`          | pubblico · CAPO       | Stato del dispositivo condiviso · registrazione           |
| `GET /tavoli`                                               | CAMERIERE, MONITOR    | Tavoli con lo stato della seduta                          |
| `GET /formule`                                              | CAMERIERE             | Formule attive e quella proposta per l'orario attuale     |
| `POST /tavoli/:id/apri`                                     | CAMERIERE             | Apre il tavolo: seduta con copia della formula e PIN      |
| `POST /sedute/:id/pin`                                      | CAMERIERE             | Nuovo PIN                                                 |
| `POST /sedute/:id/chiudi`                                   | CAPO                  | Chiusura minima: libera il tavolo e disconnette i clienti |
| `GET /t/:slug` · `POST /t/:slug/join`                       | cliente               | Stato del tavolo dal QR · ingresso con il PIN             |

WebSocket (Socket.IO su `/socket.io`): alla connessione il client manda `sync` con l'ultimo `seq` ricevuto e riceve
gli eventi persi (o `snapshot_required`); poi riceve `evento` in tempo reale e `sessione_terminata` alla chiusura.
I ruoli seguono una gerarchia: ADMIN può tutto, CAPO può quello che fa il CAMERIERE.

## CI

GitHub Actions (`.github/workflows/ci.yml`), su ogni PR e su `main`: install, lint, formato, controllo dei tipi,
test (con PostgreSQL 17 come servizio), build, migrazioni, seed lanciato due volte e test e2e.
