# Decisioni

Registro delle decisioni di progetto e dei loro motivi. Le più recenti in fondo a ogni sezione.

## Decisioni prese con il committente (CLAUDE.md §14)

| #    | Tema                      | Decisione                                                                                                                                                                                                                                                                               | Data       |
| ---- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 14.1 | Angular                   | **Componenti standalone**, niente NgModules. È il default delle versioni recenti, riduce il codice di contorno e rende naturale il caricamento differito per area.                                                                                                                      | 2026-11-27 |
| 14.5 | Dispositivi dei camerieri | **Entrambe le modalità**: login personale (username e password) dal proprio telefono, oppure dispositivo condiviso del locale autenticato a lungo su cui il cameriere si identifica con un PIN personale. Gli eventi registrano sia il dispositivo sia la persona. Si implementa in F1. | 2026-11-27 |

Ancora aperte, da chiedere quando servono: 14.2 provider VPS e dominio (F9), 14.3 CSV Deliveroo di esempio (F7),
14.4 penale per il cibo avanzato (F4), 14.6 asset di brand e menù reale (F8).

## F0 – Base

### Versioni (verificate su npm il 2026-11-27)

- **Angular 22.3** con **TypeScript 6.0.x**: Angular 22 richiede `>=6.0 <6.1`, quindi non si usa TypeScript 7.
- **NestJS 12**, che è pubblicato come ESM: tutta l'API è ESM (`"type": "module"`, import relativi con `.js`).
- **Prisma 7.10.x** stabile. Il dist-tag `latest` di `prisma` punta a una 8.0 rc: non la usiamo finché non è stabile.
- Node 22, Vitest 5, Playwright 1.65, ESLint 10 (flat config), Zod 4.

### Monorepo con npm workspaces

Niente pnpm, Nx o Turborepo: tre pacchetti (`packages/shared`, `apps/api`, `apps/web`) non ne giustificano la complessità.
L'ordine dei workspace nel `package.json` radice fa sì che `npm run build --workspaces` compili prima `shared`.

### `packages/shared` compilato in `dist/`

Web e API importano `@kikko/shared` dal JavaScript compilato con le dichiarazioni `.d.ts`, non dai sorgenti TypeScript.
Così funziona allo stesso modo con il compilatore di Angular, con `tsc` di Nest e con Vitest, senza alias di percorso.
In sviluppo `npm run dev` lo ricompila in watch; `npm test` e `npm run typecheck` lo compilano prima di partire.

### ORM: Prisma

Scelto rispetto a TypeORM perché:

- schema dichiarativo in un solo file, facile da leggere e rivedere;
- client generato e completamente tipizzato, anche sui risultati delle query con `include`;
- migrazioni SQL versionate e seed integrati nella CLI;
- transazioni interattive con livello di isolamento `Serializable`, che serviranno in F2 per validare i giri in modo atomico.

Con Prisma 7 il client viene generato in `apps/api/src/generated/prisma` (ignorato da git, rigenerato a ogni `npm install`
e a ogni build) e si collega a Postgres tramite il driver adapter `@prisma/adapter-pg`.

### Nomi del dominio in italiano

Il §15 chiede nomi di codice in inglese, ma il brief definisce il modello dati con nomi italiani (`Seduta`, `Giro`,
`piattiPerPersonaPerGiro`…). Per non dover tradurre ogni volta tra brief, interfaccia e database, **le entità e i campi
del dominio usano il vocabolario del brief**; tutto il resto (servizi tecnici, funzioni di supporto, commenti, commit)
è in inglese. I codici degli allergeni sono identificatori in inglese (`GLUTEN`, `MILK`…) con le etichette it/en in
`packages/shared/src/allergens.ts`.

### Importi in centesimi

Prezzi salvati come interi in centesimi (`prezzoAdultoCent: 2590` = 25,90 €) per evitare errori di arrotondamento.

### Seed idempotente e ripristinabile

`npm run db:seed` fa upsert per chiave naturale (`codice` di formule, categorie e piatti; `numero` dei tavoli; `username`
dello staff). Rilanciarlo non crea doppioni e riporta ai valori di default formule, menù e tavoli: è la base dell'azione
"ripristina configurazione di default" prevista in F5. La password dell'admin viene impostata solo alla creazione.
I file JSON sono validati con gli stessi schemi Zod che useranno le API di amministrazione.

### Variabili d'ambiente con default solo in sviluppo

Fuori da produzione l'API e la CLI di Prisma usano il Postgres di `docker-compose.yml` se `DATABASE_URL` manca,
così i quattro comandi di avvio funzionano senza creare un `.env`. In produzione `DATABASE_URL` e
`SEED_ADMIN_PASSWORD` sono obbligatorie. Le variabili sono validate con Zod all'avvio.

### L'API parte anche senza database

Se Postgres non risponde all'avvio l'API parte lo stesso e `GET /api/health` risponde **503** con `database: "down"`;
la connessione viene ritentata alla prima query utile. In caso di blackout API e database possono ripartire in qualsiasi
ordine (§6), e il monitoraggio esterno vede comunque lo stato.

### Test di integrazione su un database separato

I test dell'API usano `TEST_DATABASE_URL` (default `kikko_test`). Un setup globale crea il database se manca e applica
le migrazioni. Per sicurezza i test si rifiutano di partire se il nome del database non finisce con `_test`.

### Vitest anche per l'API

Vitest 5 legge `emitDecoratorMetadata` dal `tsconfig`, quindi la dependency injection di Nest funziona nei test senza
plugin SWC. Un solo test runner per tutto il monorepo.

### Area web: rotte caricate quando servono

Ogni area (`/t/:slug`, `/staff/cameriere`, `/staff/cassa`, `/admin`, `/monitor`) è un chunk separato: chi scansiona il QR
scarica solo il codice del cliente. Componenti `OnPush` e app senza zone.js (default di Angular 22).

### Design token

Tutti i colori, font, spaziature, raggi, ombre e durate delle animazioni sono variabili CSS in
`apps/web/src/styles/tokens.css`. Con `prefers-reduced-motion` le durate vanno a zero.
Gli asset di brand stanno in `apps/web/public/assets/brand/` (serviti su `/assets/brand/`), con un README che spiega
come sostituirli.

### Test e2e

Playwright gira su due profili, telefono (Pixel 7) e desktop. Avvia l'API compilata e il dev server Angular con il proxy,
oppure riusa quelli già aperti in locale.

### Avvisi di `npm audit`

`npm audit` segnala 3 vulnerabilità "high" in `effect`, una dipendenza della CLI di Prisma (`@prisma/config`).
Riguardano solo gli strumenti di sviluppo e una regex che non riceve input esterni: nessun impatto a runtime.
La "correzione" proposta riporterebbe Prisma alla 6. Da ricontrollare quando esce un aggiornamento di Prisma 7.

### Ambiente di sviluppo in cloud

Nel container cloud usato per sviluppare F0 il demone Docker non è disponibile: migrazioni, seed e test sono stati
eseguiti su un PostgreSQL 16 locale con le stesse credenziali di `docker-compose.yml`. La CI usa PostgreSQL 17,
la stessa versione di `docker-compose.yml`.
