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

## F2 – App cliente

### Decisioni del committente (2026-11-27)

- **"Massimo N volte" è per persona**: con 4 coperti e "Bao bun massimo 1 volta" il tavolo può ordinare 4 bao in tutta
  la seduta. Il campo del brief `maxPerSeduta` è diventato `maxPerPersona` (migrazione con `RENAME COLUMN`, nessun dato
  perso). `maxPerGiro` resta un limite assoluto per tavolo e per giro.
- **Limiti di gruppo**: "massimo 4 volte in totale" (sashimi, carpacci in salsa ponzu) è un nuovo tipo di regola,
  `GruppoLimite.maxPerPersona`, anch'esso moltiplicato per i coperti.
- **Prezzi alla carta**: salvati (`prezzoCartaCent`) per la futura dashboard admin, mai inviati ai clienti (l'API del
  menù non li espone e un test lo verifica).
- **Foto**: quelle ritagliate dal PDF del menù, in WebP 240/480 px con anteprima sfocata incorporata nel menù.
- **Font**: Lexend (licenza OFL), simile al Marva del menù stampato. È ospitato dall'app (pacchetto `@fontsource`) e non
  caricato da Google Fonts: niente richieste a server terzi (GDPR) e funziona offline.
- **Stesso menù per tutte le formule**. **Bevande** in una pagina a parte, tutte extra a pagamento, inventate per la POC.

### Regole AYCE in `packages/shared/src/regole.ts`

Funzioni pure usate sia dal server (che decide sempre) sia dal client (che le usa solo per guidare il cliente):
limite del giro, limiti per giro, per persona e di gruppo, attesa tra i giri, numero massimo di giri, scadenza, piatti
non disponibili. Sono coperte da test unitari esaustivi in `regole.spec.ts`.

- **Giri rifiutati**: non contano né per i limiti né per il timer.
- **Giri di soli extra** (es. solo bevande): si possono inviare in qualsiasi momento, non fanno partire il timer e non
  contano nei giri. Non sono previsti dal brief, ma senza questa regola un tavolo dovrebbe aspettare 10 minuti per
  un'acqua.
- **Dopo la scadenza** non si può inviare nulla, neanche le bevande, come chiede il brief ("non può più inviare giri").
- I limiti per persona usano tutti i coperti, bambini compresi.

### Carrello condiviso

Una riga per piatto **per dispositivo**: ogni telefono modifica solo le proprie quantità, tutti vedono tutto con l'emoji
di chi ha aggiunto. Così non ci sono conflitti tra telefoni che toccano lo stesso piatto nello stesso istante.

- Il client applica subito le proprie modifiche (aggiornamento ottimistico), raggruppa i tocchi ravvicinati (250 ms) e,
  se il server non salva, torna al valore del server.
- Ogni modifica genera `CARRELLO_MODIFICATO`; gli altri telefoni aggiornano il carrello dal payload dell'evento.

### Invio del giro

- Qualsiasi telefono del tavolo invia **tutto il carrello del tavolo**. Il server rivalida tutte le regole in una
  transazione `Serializable` (ripetuta in caso di conflitto) e svuota il carrello.
- **Idempotenza**: il telefono genera una `chiaveIdempotenza` (UUID) e la salva in `localStorage` finché il server non
  risponde. Ripetere la richiesta (doppio tocco, rete caduta, ricarica della pagina) restituisce lo stesso giro; un
  vincolo unico `(sedutaId, chiaveIdempotenza)` lo garantisce anche con richieste simultanee.
- **Offline**: se la rete manca il giro resta "in coda" e riparte da solo quando torna la connessione (evento `online`,
  riconnessione del WebSocket o ogni 5 secondi).
- Due telefoni che inviano insieme: uno solo riesce, l'altro riceve l'errore delle regole (carrello vuoto o attesa).
- Il giro resta `INVIATO` ("in attesa di conferma") fino a F4. Ogni voce copia `inFormula` e il prezzo extra, per il
  pre-conto.
- Gli orari (prossimo giro, scadenza) vengono dal server; il client corregge la differenza tra il suo orologio e quello
  del server.

### Limite di richieste per dispositivo

In sala tutti i clienti escono dallo stesso IP del Wi-Fi: un limite per IP rallenterebbe l'intero locale durante il
servizio. I clienti vengono contati per cookie di dispositivo, tutti gli altri per IP.

### Menù per il cliente

`GET /api/menu` è pubblico e cambia raramente: risponde con un `ETag` e `Cache-Control: no-cache`, così il browser lo
rivalida e riceve `304` se non è cambiato. Le foto stanno in `MEDIA_DIR` (servite su `/media` con cache di un giorno)
e il seed ci copia quelle del menù.

### Interfaccia del cliente

Mobile first, colori e forme del menù stampato (acqua, rosso, crema, verde scuro), schede dei piatti con foto, numero
del menù, pezzi e indicatori, "massimo N a persona", chi l'ha già nel carrello. Il pulsante "+" si disattiva quando una
regola lo impedisce. Filtri "escludi allergeni", vegetariani e senza glutine, ricordati sul telefono. Animazioni leggere
(contatori, aggiunta, invio) che rispettano `prefers-reduced-motion`.

### Da fare nelle fasi successive

Approvazione e rifiuto dei giri alla cassa e piatti esauriti in tempo reale (F4), ordini per conto del cliente dal
cameriere (F3), modifica del menù e delle foto dall'admin (F5), PWA e cache offline del menù (F8).

## F3 – App cameriere

### Decisioni del committente (2026-11-27)

- **Lista invece della mappa della sala**: i camerieri usano il telefono, dove una mappa sarebbe scomoda. La lista si
  filtra per aperti, liberi e "giro in attesa" e si cerca per numero. Le posizioni dei tavoli restano nel database per il
  monitor (F6).
- **Tavolo e PIN** li gestiscono cameriere e capo: il PIN si genera da solo all'apertura (già così da F1) e si può
  rigenerare dalla pagina del tavolo. Non si può rivedere, perché il server ne salva solo l'impronta.
- **Unione di due tavoli già aperti**: sì, solo con la stessa formula. **Separazione**: no, si chiude e si riapre.
- **Coperti** modificabili da cameriere e capo.

### Ordini per conto del tavolo

Il cameriere usa lo stesso schermo del cliente (stessi componenti), collegato agli endpoint staff della seduta. Per non
duplicare carrello, giri e regole, ordina tramite un "dispositivo" della seduta creato al primo uso
(`DispositivoCliente.utenteStaffId`, emoji 🧑‍🍳, senza un token utilizzabile). Le sue righe compaiono nel carrello
condiviso e i clienti le vedono; le regole sono le stesse e gli eventi registrano il cameriere come autore. Questo
dispositivo non conta tra i telefoni collegati e non prende emoji né numero "Ospite".

### Spostare un tavolo

La seduta passa da un suo tavolo a uno libero, con un aggiornamento condizionale che resta sicuro con richieste
simultanee. I telefoni restano dentro e vedono il nuovo numero in tempo reale. Il QR del vecchio tavolo continua a
funzionare per i telefoni già entrati: una regola riconosce i tavoli che la loro seduta ha occupato. Lo stesso PIN vale
al nuovo tavolo.

### Unire tavoli

- **Tavolo libero**: si aggiunge alla seduta e il suo QR porta alla stessa seduta, con lo stesso PIN.
- **Due tavoli aperti** (stessa formula): tavoli, telefoni, carrello e giri passano alla seduta principale. I giri vengono
  rinumerati dopo quelli della principale e continuano a contare per i limiti "a persona". I coperti si sommano; per il
  tempo valgono l'apertura più vecchia e il maggiore dei minuti extra. La seduta assorbita viene chiusa con `unitaInId`.
  Il PIN valido resta quello della principale.
- I telefoni del tavolo assorbito ricevono `sessione_terminata` con motivo `TAVOLI_UNITI`: ricaricano lo stato e si
  ricollegano, entrando così nella stanza della seduta principale. Le sedute coinvolte vengono bloccate in ordine di id
  (`SELECT … FOR UPDATE`) per evitare conflitti e deadlock.

### Coperti

Modificarli aggiorna subito il limite del giro e i limiti "a persona"; le regole della formula restano quelle copiate
all'apertura. Nuovo tipo di evento `COPERTI_MODIFICATI`, visibile ai clienti (solo i numeri dei coperti).

### Nota di processo

Alcune modifiche alla documentazione di F1 e F2 fatte con script non erano state applicate, perché la formattazione
automatica aveva cambiato le tabelle: le variabili d'ambiente e le API mancanti sono state aggiunte al README in F3.
Da qui in poi le modifiche ai file esistenti si fanno solo con sostituzioni verificate.
