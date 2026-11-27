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

## F1 – Dominio e tempo reale

### Una seduta aperta per tavolo, anche con richieste simultanee

`Tavolo.sedutaCorrenteId` punta alla seduta aperta. L'apertura lo imposta con un aggiornamento condizionale
(`WHERE sedutaCorrenteId IS NULL`) nella stessa transazione: se due camerieri aprono lo stesso tavolo insieme, uno solo
riesce e l'altro riceve `409 TAVOLO_GIA_APERTO`. La tabella `SedutaTavolo` conserva la storia ed è pronta per l'unione
dei tavoli (F3).

### Copia della formula nella seduta

All'apertura la seduta salva `formulaSnapshot` (prezzi, piatti per persona per giro, minuti tra i giri, durata,
numero massimo di giri) con un numero di versione. La scadenza mostrata è sempre calcolata dal server da
`apertaIl + durataMaxMinuti + minutiExtra`.

### PIN del tavolo

- 4 cifre casuali (`crypto.randomInt`), salvate come HMAC-SHA256 con un segreto del server e l'id della seduta.
  Senza il segreto le 10 000 combinazioni non si possono provare offline.
- Il PIN in chiaro viene mostrato solo quando viene generato. Per ricomunicarlo il cameriere ne genera uno nuovo
  (il brief chiede di salvare solo l'hash). I telefoni già al tavolo restano dentro.
- Anti-forza bruta: dopo 5 errori la chiave si blocca per 60 s, poi 120 s, 240 s… fino a un'ora. Un successo azzera.
  Una chiave inattiva da più di un'ora riparte da zero. Ogni errore genera `PIN_ERRATO` (senza il PIN tentato).
- Le chiavi sono due: il **dispositivo** (un cookie anonimo `kk_did`, oppure l'IP alla prima richiesta) e il **tavolo**.
  Non si blocca per IP perché nel locale tutti i clienti escono sullo stesso IP del Wi-Fi: un cliente impaziente
  bloccherebbe l'intera sala. Chi cancella i cookie a ogni tentativo viene comunque fermato dal blocco del tavolo.
  Rigenerare il PIN sblocca il tavolo.
- I contatori sono in `TentativoPin` e vengono aggiornati con un advisory lock per chiave: tentativi in parallelo
  vengono contati tutti.

### Token del cliente

Cookie `kk_ct` httpOnly, `SameSite=Strict`, valido 12 ore. Nel database c'è solo lo SHA-256. Alla chiusura del tavolo
tutti i dispositivi vengono revocati e le connessioni WebSocket della seduta chiuse dal server.

### Accesso dello staff (decisione 14.5)

- **Login personale**: password argon2id, token di accesso JWT HS256 di 15 minuti tenuto solo in memoria, refresh token
  di 90 giorni in cookie httpOnly (`Path=/api/auth`, `SameSite=Strict`), rinnovato a ogni uso.
- **Dispositivo condiviso**: un CAPO o un ADMIN, dal dispositivo stesso, tocca "Rendi condiviso". Il browser riceve un
  cookie di dispositivo di lunga durata. Sulla pagina di accesso compaiono i nomi dello staff con PIN e ognuno entra con
  il proprio PIN personale (argon2id, stesse regole di blocco). La sessione dell'utente su quel dispositivo dura un
  turno (14 ore, rinnovata a ogni uso). Il token di accesso contiene l'id del dispositivo e gli eventi registrano sia la
  persona sia il dispositivo.
- **Furto del refresh token**: ogni refresh token appartiene a una "famiglia". Se un token già ruotato viene riusato
  dopo più di 15 secondi, l'intera famiglia viene revocata. Entro 15 secondi si tratta di due schede che rinnovano
  insieme: il server risponde `409` e il client riprova una volta (in più il browser serializza i rinnovi con la Web
  Locks API).
- **Ruoli**: ADMIN include tutti i ruoli, CAPO include CAMERIERE, MONITOR è solo lettura. Un guard globale protegge tutte
  le API tranne quelle marcate come pubbliche.
- Le pagine staff, dopo un riavvio o la riapertura del browser, rinnovano la sessione dal cookie e restano sulla stessa
  pagina (l'URL è la fonte dello stato di navigazione).

### Registro eventi: ordine garantito

- Ogni evento è scritto nella **stessa transazione** del cambiamento che descrive.
- Prima di scrivere eventi la transazione prende un advisory lock globale fino al commit: così l'ordine di `seq` coincide
  con l'ordine di commit. Senza, una transazione lenta potrebbe fare il commit di `seq` 10 dopo che i client hanno già
  visto 11, e quell'evento andrebbe perso. Con il carico del locale (poche migliaia di eventi al giorno) il costo è nullo.
  Il lock degli eventi è sempre l'ultimo preso, per evitare deadlock.
- Dopo il commit una sola "pompa" legge dal database gli eventi nuovi in ordine di `seq` e li pubblica; un controllo ogni
  5 secondi recupera eventuali eventi rimasti indietro.

### WebSocket: recupero degli eventi persi

- Stanze `seduta:{id}` (clienti), `staff:{ruolo}` e `monitor`. Lo staff riceve tutti gli eventi; i clienti solo quelli
  della propria seduta, con il payload filtrato campo per campo (lista di campi ammessi per ogni tipo) e senza id dello
  staff.
- Alla connessione il client manda `sync` con l'ultimo `seq` ricevuto (`null` se parte da zero: in quel caso carica lo
  stato via REST e riceve solo il cursore). Il server risponde con gli eventi mancanti oppure con `snapshot_required` se
  sono più di 500.
- Durante il `sync` il client tiene da parte gli eventi live e li applica dopo quelli recuperati, ignorando quelli già
  visti: un evento live più recente non può far saltare quelli ancora in arrivo. I test lo coprono, incluso il riavvio
  del server.
- `CLIENT_RICONNESSO` viene registrato al massimo una volta al minuto per utente o dispositivo, dopo aver risposto.
- Se il server rifiuta un token staff scaduto il client lo rinnova e si ricollega; se rifiuta un cliente (tavolo chiuso)
  mostra la schermata di chiusura.

### Limiti di richieste

`@nestjs/throttler`: 300 richieste al minuto per IP in generale, 20 su login e PIN (configurabili). Dietro Caddy va
impostato `TRUST_PROXY` per leggere l'IP reale.

### Bundle del browser

Il punto d'ingresso principale di `@kikko/shared` include Zod (schemi di validazione per l'API). Il web importa i valori
da `@kikko/shared/browser`, che non lo include; i tipi si importano da `@kikko/shared`. Una regola ESLint impedisce
l'errore. Senza questa separazione il bundle cresceva di circa 80 kB compressi.

### Interfacce staff senza libreria di componenti, per ora

Il brief permette PrimeNG per staff e admin. In F1 le schermate staff sono poche e semplici: le ho fatte con i design
token e `<dialog>` nativo, senza aggiungere dipendenze. PrimeNG si potrà introdurre in F5 per le tabelle di
amministrazione, se servirà.

### Lingua del cliente

Rilevata dal browser (italiano per i browser in italiano, inglese per tutti gli altri), modificabile con il selettore e
ricordata in `localStorage`. I testi del cliente sono in un dizionario tipizzato it/en; per il menù (F2) i testi
arrivano dal database nelle due lingue.

### Utenti demo

Fuori da produzione il seed crea `mario` (cameriere, PIN 1234), `capo` (capo, PIN 0000) e `monitor`, con password
uguale allo username. In produzione non vengono creati.

### Non ancora fatto (fasi successive)

Allarme e evento `TEMPO_SCADUTO` (F4/F6: per ora la scadenza è solo calcolata e mostrata), revoca dei dispositivi staff
da interfaccia (F5), gestione degli utenti e dei PIN da interfaccia (F5), stato delle connessioni staff sul monitor (F6).
