# Kikko – tavoli e ordinazioni

Sistema di ordinazione al tavolo per un ristorante all you can eat: un'unica web app Angular con aree per ruolo
(cliente, cameriere, cassa, amministratore, monitor) e un'API NestJS con PostgreSQL.
Il brief completo è in [`CLAUDE.md`](CLAUDE.md), le decisioni prese in [`docs/decisioni.md`](docs/decisioni.md).

**Stato:** F0 – Base (monorepo, database, seed, health check, CI).

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

- Web: <http://localhost:4200> (la home mostra lo stato dell'API)
- API: <http://localhost:3000/api/health>
- Admin di sviluppo creato dal seed: utente `admin`, password `admin` (il login arriva in F1)

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

## CI

GitHub Actions (`.github/workflows/ci.yml`), su ogni PR e su `main`: install, lint, formato, controllo dei tipi,
test (con PostgreSQL 17 come servizio), build, migrazioni, seed lanciato due volte e test e2e.
