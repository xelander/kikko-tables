# Seed versionati

File JSON con la configurazione di default e il menù demo, validati dagli schemi Zod di `src/schemas/`.

| File                  | Contenuto                                                                             |
| --------------------- | ------------------------------------------------------------------------------------- |
| `default-config.json` | Impostazioni del locale (nome, fuso, valuta) e le tre formule di default              |
| `menu-demo.json`      | Categorie e piatti finti (it/en) con allergeni, extra a pagamento e limiti per piatto |

I tavoli demo (24) sono generati da `generaTavoliDemo()` in `src/schemas/tables.ts`.

- Importi in **centesimi** (`1590` = 15,90 €).
- Giorni ISO: `1` = lunedì … `7` = domenica. Orari `HH:mm`, `24:00` = fine giornata.
- I prezzi e i limiti sono segnaposto: vanno confermati con il committente.
- Lo script di seed (`npm run db:seed`) fa upsert per `codice`: si può rilanciare senza creare doppioni.
