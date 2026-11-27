# Seed versionati

File JSON validati dagli schemi Zod di `src/schemas/`.

| File                  | Contenuto                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `default-config.json` | Impostazioni del locale (nome, fuso, valuta) e le tre formule di default                                                       |
| `menu-kikko.json`     | Menù reale del ristorante: 155 piatti it/en, categorie, gruppi di limite, allergeni, foto, più 12 bevande inventate per la POC |
| `media/piatti/*.webp` | Foto dei piatti (240 e 480 px), copiate in `MEDIA_DIR` dal seed                                                                |

I tavoli demo (24) sono generati da `generaTavoliDemo()` in `src/schemas/tables.ts`.

## Menù reale (POC)

- **Fonte**: PDF "Menu AYCE cena" del ristorante, trascritto il 2026-11-27. Nomi, descrizioni, numeri e prezzi vengono dal
  testo del PDF; allergeni e indicatori (vegetariano, piccante, senza glutine) dalle icone, letti a vista.
- **Allergeni da verificare**: il menù stampato non dichiara il glutine (indica solo i piatti "senza glutine") e la
  legenda copre 9 allergeni su 14. Il ristorante deve confermare la scheda allergeni completa. L'app mostra sempre
  l'avviso "per allergie chiedi al personale".
- **Traduzioni inglesi**: bozze da far rivedere.
- **Foto**: ritagliate dal PDF (risoluzione bassa). Alcuni piatti condividono la foto del gruppo (es. maki, nigiri).
- **Prezzi alla carta** (`prezzoCartaCent`): salvati per la futura dashboard admin, mai inviati ai clienti.
- **Limiti**: "massimo N volte" → `maxPerPersona` (× coperti); "massimo 4 volte in totale" su sashimi e carpacci in
  salsa ponzu → gruppi di limite.
- **Bevande**: inventate, nella sezione `BEVANDE`, extra a pagamento con `prezzoExtraCent`.
- Quando il ristorante popolerà il menù dall'area amministratore (F5), questo file resterà la configurazione di default.

## Convenzioni

- Importi in **centesimi** (`1590` = 15,90 €).
- Giorni ISO: `1` = lunedì … `7` = domenica. Orari `HH:mm`, `24:00` = fine giornata.
- Lo script di seed (`npm run db:seed`) fa upsert per `codice`: si può rilanciare senza creare doppioni e riporta il menù ai
  valori di default. Toglie i piatti che non sono più nel file, se nessuno li ha mai ordinati (altrimenti li rende non
  disponibili).
