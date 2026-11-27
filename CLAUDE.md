# Progetto: Sistema tavoli e ordinazioni – Ristorante All You Can Eat

> Documento di contesto per lo sviluppo. Leggilo per intero prima di scrivere codice.
> Quando una scelta non è coperta qui, scegli l'opzione più semplice e annotala in `docs/decisioni.md`.

---

## 1. Contesto

Ristorante cinese **all you can eat** (AYCE) di un amico del committente. Il cliente si siede, scansiona un QR code sul tavolo e ordina dal proprio smartphone. Gli ordini **non** vanno direttamente in cucina: arrivano su un tablet dove una persona (il "capo" alla cassa) li controlla e li gira in cucina a mano.

Obiettivo commerciale: battere la concorrenza (altri sistemi di ordinazione via QR). L'app deve essere **bella, curata, animata, ma velocissima e reattiva**. Il locale ha brand, font, logo, immagini e menù propri che verranno forniti più avanti (vedi §11).

---

## 2. Ruoli e app

È **un'unica web app Angular** con aree per ruolo (stesso progetto, stesso deploy), più un backend Node.

| Ruolo | Dispositivo | Cosa fa |
|---|---|---|
| **Cliente** | Smartphone personale (via QR) | Inserisce il PIN, consulta il menù, aggiunge piatti al carrello condiviso del tavolo e invia i giri |
| **Cameriere** | Smartphone/tablet di servizio | Mappa tavoli, apre il tavolo (coperti e formula), vede e comunica il PIN, ordina per conto dei clienti senza smartphone, sposta o unisce tavoli |
| **Capo / Cassa** | Tablet alla cassa | Coda ordini in arrivo (approva o rifiuta), segna i piatti esauriti, stampa il pre-conto, chiude il tavolo al conto |
| **Amministratore** | Desktop/tablet | Configura le formule e i limiti, gestisce menù, tavoli e utenti staff, importa il CSV Deliveroo, consulta i report |
| **Monitor** | Schermo/desktop | Vista in tempo reale di tutto il sistema: eventi, tavoli aperti, giri, allarmi |

---

## 3. Flusso principale

1. **Apertura tavolo (cameriere).** Seleziona il tavolo, inserisce i coperti (adulti e bambini) e la formula (pranzo, cena o weekend; viene proposta in automatico in base all'orario). Il server crea una **Seduta** e genera un **PIN a 4 cifre**, mostrato al cameriere che lo comunica al tavolo.
2. **Accesso cliente.** Scansiona il QR (URL fisso tipo `/t/{slugTavolo}`). Se il tavolo non ha una seduta aperta, appare la schermata "Tavolo non attivo, chiedi al personale". Altrimenti il cliente inserisce il PIN, il server rilascia un token di dispositivo legato alla seduta (cookie httpOnly) e il PIN non viene più richiesto.
3. **Carrello condiviso.** Tutti i dispositivi del tavolo vedono lo stesso carrello in tempo reale (WebSocket). Ogni voce mostra chi l'ha aggiunta (soprannome o emoji assegnati al dispositivo). Contatori e limiti sono sempre visibili ("Questo giro: 14/20 piatti").
4. **Invio giro.** Un solo "Invia giro" per tavolo. Il server rivalida tutte le regole (§4) in una transazione. Dopo l'invio parte il timer fino al giro successivo, ben visibile.
5. **Approvazione (capo).** Il giro arriva nella coda del tablet cassa con un avviso visivo e sonoro. Il capo lo approva (e lo gira in cucina) oppure lo rifiuta indicando un motivo, che il tavolo vede. Un giro rifiutato **non** consuma limiti né timer.
6. **Chiusura (capo, al conto).** Il capo genera il pre-conto (formula × coperti + extra come bevande e dolci fuori formula), poi chiude la seduta. Tutti i token del tavolo vengono invalidati.

Stati del giro: `INVIATO → APPROVATO | RIFIUTATO`. Non servono altri stati per ora.

---

## 4. Regole AYCE: configurabili dall'amministratore

Tutto è configurabile da interfaccia. È disponibile una **configurazione di default** caricabile o ripristinabile con un click (file seed JSON versionato nel repo).

**A livello di formula** (es. Pranzo feriale, Cena, Weekend):
- prezzo per adulto e per bambino
- fasce orarie e giorni di validità (per proporre la formula all'apertura)
- `piattiPerPersonaPerGiro`: il limite del giro è questo valore × coperti
- `minutiTraGiri`: attesa minima tra un invio e il successivo
- `durataMaxMinuti`: durata massima della seduta
- `maxGiri` (opzionale)

**A livello di piatto:**
- `inFormula`: true/false. Gli extra (bevande, alcuni dolci) hanno un prezzo e **non** contano nel limite del giro.
- `maxPerSeduta`: il piatto si può ordinare al massimo N volte in tutta la seduta (es. piatto X max 3)
- `maxPerGiro`: massimo N pezzi per singolo giro (es. piatto Y max 1)
- `disponibile`: il capo lo può disattivare in tempo reale e sparisce subito da tutti i menù aperti

**Regole importanti:**
- All'apertura la seduta **salva una copia (snapshot) della configurazione** della formula. Le modifiche fatte dall'amministratore a servizio in corso valgono solo per le sedute aperte dopo.
- I limiti `maxPerSeduta` contano i giri `INVIATO` e `APPROVATO` (non quelli `RIFIUTATO`).
- La validazione è **sempre lato server**. Quella sul client serve solo all'esperienza utente.
- Il server non chiude le sedute da solo. Allo scadere di `durataMaxMinuti` il tavolo va in stato "tempo scaduto": non può più inviare giri e scatta un allarme su monitor e cassa. Il capo può concedere minuti extra.

---

## 5. Sicurezza dell'accesso al tavolo

- Il QR è fisso: contiene solo l'identificativo del tavolo e non dà alcun diritto da solo.
- Il PIN è generato a ogni apertura e il cameriere può rigenerarlo. Il server salva solo l'hash.
- Anti-forza bruta: massimo 5 tentativi errati per dispositivo/IP e per tavolo, poi blocco di 60 secondi crescente. I tentativi vengono registrati come eventi.
- Il token cliente è legato alla seduta e scade alla chiusura.
- Lo staff accede con un login a ruoli. I dispositivi di servizio restano autenticati a lungo (refresh token) per ripartire da soli dopo un riavvio (§6).
- Rate limiting sulle API pubbliche.
- Nessun dato personale dei clienti. Solo cookie tecnici (niente banner per i cookie se non ne aggiungiamo altri).

---

## 6. Resilienza: mancanza di corrente o di rete (requisito critico)

Scenario: nel locale salta la corrente. Router e Wi-Fi si spengono, i tablet restano accesi a batteria e i clienti spesso continuano a navigare in 4G/5G. Quando torna la corrente **tutto deve ripartire da solo, senza interventi**.

Requisiti tecnici:
- **La fonte di verità è il server in cloud.** I dispositivi non tengono uno stato di cui il server non sia informato.
- **Registro eventi con numerazione progressiva** (§7). Ogni client ricorda l'ultimo numero ricevuto. Alla riconnessione chiede gli eventi mancanti, oppure una fotografia completa dello stato se il salto è troppo grande.
- Riconnessione WebSocket automatica con backoff e un banner chiaro ("Connessione persa, riprovo…" → "Ripristinato").
- **PWA** con service worker: app shell, menù e immagini in cache, così l'app si ricarica subito anche con la rete lenta.
- **Coda di invio sul client con chiavi di idempotenza**: un "Invia giro" fatto offline parte alla riconnessione, e un doppio tocco o un nuovo tentativo non crea doppioni.
- I dispositivi staff restano autenticati e tornano alla schermata in cui erano dopo un riavvio o la riapertura del browser.
- Timer e durate sono calcolati sul server dagli orari salvati, mai da contatori sul client.
- Azione amministratore "**Estendi tempo a tutti i tavoli aperti**" di N minuti, per recuperare il tempo perso durante il blackout.
- Test automatici dei casi di disconnessione: client offline durante l'invio, server riavviato, WebSocket che cade mentre il carrello cambia.

Consigli hardware da girare al committente (fuori dal codice): piccolo UPS per router e modem, e tablet cassa con SIM o hotspot 4G di riserva.

---

## 7. Monitor in tempo reale e registro eventi

Ogni azione significativa diventa un **Evento** salvato nel database:
`{ seq, timestamp, tipo, attore (ruolo + id), sedutaId?, tavoloId?, payload }`

Tipi principali: `TAVOLO_APERTO`, `PIN_RIGENERATO`, `PIN_ERRATO`, `DISPOSITIVO_UNITO`, `CARRELLO_MODIFICATO`, `GIRO_INVIATO`, `GIRO_APPROVATO`, `GIRO_RIFIUTATO`, `PIATTO_ESAURITO`, `PIATTO_RIPRISTINATO`, `TEMPO_SCADUTO`, `TEMPO_ESTESO`, `TAVOLI_UNITI`, `TAVOLO_SPOSTATO`, `PRECONTO_GENERATO`, `TAVOLO_CHIUSO`, `CONFIG_MODIFICATA`, `CLIENT_RICONNESSO`.

Il **Monitor** mostra:
- un flusso eventi live con filtri (tavolo, tipo, ruolo)
- la mappa dei tavoli con il loro stato (libero, aperto, in attesa del giro, tempo quasi scaduto, scaduto)
- allarmi: giri in coda da più di N minuti, tavoli aperti oltre la durata massima, molti PIN errati, dispositivi staff disconnessi
- lo stato delle connessioni dei dispositivi staff

Lo stesso registro alimenta i report (§8).

---

## 8. Report

Gli incassi di sala **non** si tracciano: possono esserci sconti informali. Il pre-conto è solo informativo.

- **Coperti** per giorno, fascia (pranzo/cena) e formula, con confronto tra periodi.
- **Piatti più ordinati** (sala, dai giri approvati), filtrabili per periodo.
- **Deliveroo**: incasso, numero di ordini e, se presenti nell'export, i piatti più venduti.
- Esportazione dei report in CSV.

### Integrazione Deliveroo
- **Fase 1 (da fare):** importazione del CSV scaricato dal Partner Hub di Deliveroo (export fatture dettagliato o vendite). Upload dalla pagina amministratore, parser tollerante (colonne che cambiano), anteprima prima della conferma, protezione dai duplicati (stesso ordine importato due volte). Costruisci il parser su un file reale: **chiedi un CSV di esempio al committente prima di implementarlo**.
- **Fase 2 (futura, solo se Deliveroo concede l'accesso):** Order API di Deliveroo tramite webhook (`order.new` / `order.status_update`, firma HMAC). Prevedi solo un'interfaccia `DeliveryOrderSource` così da poterla aggiungere senza toccare i report.

Non entra nello scopo la gestione operativa degli ordini Deliveroo: restano sul sistema che il locale usa già.

---

## 9. Vincoli legali (Italia / UE)

- **L'app NON emette scontrini fiscali.** Li emette il registratore telematico della cassa. Noi generiamo solo il pre-conto, con l'etichetta "documento non fiscale".
- **Allergeni obbligatori** (Reg. UE 1169/2011): ogni piatto ha l'elenco dei 14 allergeni, visibile nel dettaglio piatto, con filtro "escludi allergeni" nel menù.
- GDPR: nessun dato personale dei clienti. Dati staff minimi.

---

## 10. Lingue

- Menù e interfaccia cliente: **italiano e inglese**, con selettore e rilevamento della lingua del browser.
- Interfacce staff, amministratore e monitor: italiano.
- Testi del menù (nome, descrizione) inseriti nelle due lingue dall'amministratore.

---

## 11. UX, design e prestazioni

L'esperienza del cliente è il prodotto. Requisiti:
- **Mobile first**, usabile con una mano, pulsanti grandi, poco testo.
- Animazioni curate ma leggere: aggiunta al carrello, contatori, invio giro, arrivo di un giro approvato. Usa Angular animations o transizioni CSS. Rispetta `prefers-reduced-motion`.
- Prestazioni:
  - LCP sotto 2 secondi su un telefono medio in 4G
  - caricamento differito (lazy loading) per area/ruolo
  - immagini responsive in WebP o AVIF con segnaposto sfocati o skeleton
  - nessun blocco della UI durante le operazioni di rete (aggiornamenti ottimistici con rollback)
- **Tema di brand facile da sostituire**: colori, font, logo, raggi e ombre in design token (variabili CSS) in un solo file. Gli asset reali (font, logo, immagini, menù) arriveranno dopo: usa segnaposto e una cartella `assets/brand/` ben documentata.
- Per le aree staff e amministratore va bene una libreria di componenti (es. PrimeNG). L'area cliente invece deve avere un aspetto personalizzato e di brand, non "da gestionale".
- Accessibilità di base: contrasti, focus, etichette, dimensioni dei tocchi.

---

## 12. Stack e architettura

- **Frontend:** Angular (ultima versione stabile), PWA con service worker, client Socket.IO.
- **Backend:** Node.js + **NestJS** in TypeScript, API REST e gateway WebSocket (Socket.IO).
- **Database:** PostgreSQL (ORM: Prisma o TypeORM, scegline uno e motiva la scelta).
- **Monorepo:** `apps/web` (Angular), `apps/api` (NestJS), `packages/shared` (tipi, DTO, regole di validazione condivise tra client e server).
- **Infrastruttura (budget minimo):** un solo VPS europeo piccolo (2 vCPU / 4 GB, ~5-10 €/mese) con docker-compose: API NestJS + PostgreSQL + Caddy (HTTPS automatico, serve anche il frontend statico). Niente servizi gestiti a pagamento. Il carico è minimo (24 tavoli, poche migliaia di eventi al giorno).
- **Backup:** `pg_dump` notturno compresso e cifrato, caricato su **Google Drive** con rclone (conservazione 30 giorni) più una copia locale sul VPS. Script di ripristino testato e documentato. Health check esterno gratuito (es. UptimeRobot) con avviso se il server non risponde.
- Le immagini del menù stanno sul VPS (volume Docker) e vengono incluse nel backup.
- **Qualità:** ESLint + Prettier, test unitari sulle regole AYCE (sono la logica più critica), test end-to-end dei flussi principali (Playwright), CI con lint, test e build.
- Il gateway WebSocket usa stanze (room) per seduta, per ruolo staff e per il monitor.

### Modello dati (bozza da raffinare)
- `Impostazioni` (nome locale, fuso orario, valuta, impostazioni globali)
- `Formula` (nome, prezzi adulto/bambino, fasce orarie, piattiPerPersonaPerGiro, minutiTraGiri, durataMaxMinuti, maxGiri?)
- `Categoria` (nome it/en, ordine)
- `Piatto` (codice, nome it/en, descrizione it/en, categoria, immagine, allergeni[], inFormula, prezzoExtra?, maxPerSeduta?, maxPerGiro?, disponibile, ordine)
- `Tavolo` (numero, slugQr, posti, posizione nella mappa)
- `Seduta` (tavoli[], formulaSnapshot, copertiAdulti, copertiBambini, pinHash, apertaIl, apertaDa, chiusaIl?, chiusaDa?, minutiExtra, stato)
- `DispositivoCliente` (tokenHash, sedutaId, soprannome/emoji, creatoIl, ultimoAccesso)
- `Carrello` / `VoceCarrello` (sedutaId, piattoId, quantità, aggiuntoDa)
- `Giro` (sedutaId, numero, stato, chiaveIdempotenza, inviatoIl, gestitoDa, gestitoIl, motivoRifiuto?) e `VoceGiro`
- `Evento` (seq, ts, tipo, attore, sedutaId?, tavoloId?, payload JSON)
- `UtenteStaff` (nome, ruolo, credenziali)
- `ImportDeliveroo` (file, periodo, righe importate) e `OrdineDeliveroo` (idEsterno univoco, data, totale, voci?)

---

## 13. Fasi di sviluppo

Procedi per fasi. Alla fine di ogni fase il prodotto deve funzionare end-to-end ed essere testato.

- **F0 – Base:** monorepo, docker-compose (Postgres), NestJS e Angular collegati, CI, seed con la configurazione di default e un menù finto.
- **F1 – Dominio e tempo reale:** tavoli, sedute, PIN, token, registro eventi, gateway WebSocket, riconnessione con recupero degli eventi mancanti.
- **F2 – App cliente:** accesso tramite QR e PIN, menù it/en con allergeni, carrello condiviso live, regole AYCE, invio giro con idempotenza, timer.
- **F3 – App cameriere:** mappa tavoli, apertura (coperti e formula), PIN, ordini per conto del cliente, spostamento e unione di tavoli.
- **F4 – App capo:** coda giri con approva/rifiuta, piatti esauriti, pre-conto, chiusura tavolo, estensione del tempo.
- **F5 – Amministratore:** CRUD formule, piatti, categorie, tavoli e utenti; caricamento immagini; ripristino della configurazione di default; stampa dei QR in PDF.
- **F6 – Monitor:** flusso eventi live, mappa stati, allarmi.
- **F7 – Report e Deliveroo:** coperti, piatti più ordinati, import CSV Deliveroo, export.
- **F8 – Rifinitura:** PWA e offline, test di resilienza, prestazioni (Lighthouse), animazioni, applicazione del brand reale.
- **F9 – Deploy:** ambiente cloud UE, dominio, HTTPS, backup, monitoraggio errori.

---

## 14. Decisioni aperte (chiedi prima di procedere su questi punti)

1. Angular: componenti standalone (default delle versioni recenti) o NgModules?
2. Provider del VPS (Hetzner, OVH, Netcup, Aruba…: valutare disponibilità e prezzo al momento) e dominio.
3. Formato reale del CSV Deliveroo (serve un file di esempio).
4. Penale per il cibo avanzato: va gestita nel pre-conto?
5. Il cameriere apre i tavoli dal telefono personale o da dispositivi del locale?
6. Asset di brand (font, colori, logo) e menù reale con foto: in arrivo.

---

## 15. Come lavorare

- Rispondi e documenta in **italiano**. Codice, nomi di variabili e commit in inglese.
- Prima di ogni fase presenta un piano breve. Poi implementa, testa ed esegui davvero i test.
- Le regole AYCE vivono in `packages/shared` e sono coperte da test unitari esaustivi (limiti per giro, per seduta, per piatto, extra fuori formula, giri rifiutati, snapshot della configurazione).
- Non introdurre funzionalità fuori scope senza chiedere.
- Tieni aggiornati `docs/decisioni.md` (decisioni prese e motivi) e il `README.md` (come avviare il progetto in locale).