# Asset di brand

Questa cartella contiene **tutti** gli asset grafici del locale. Oggi ci sono solo segnaposto:
quando il committente manda gli asset reali basta sostituire i file qui e i token in
`apps/web/src/styles/tokens.css`. Nessun componente punta a file di brand fuori da questa cartella.

Viene pubblicata così com'è su `/assets/brand/` (questo README è escluso dalla build).

| File                              | Uso                                                     | Formato consigliato                    |
| --------------------------------- | ------------------------------------------------------- | -------------------------------------- |
| `logo.svg`                        | Logo in testata e nella home (token `--brand-logo-url`) | SVG, quadrato, leggibile anche a 32 px |
| `logo-wide.svg` _(da aggiungere)_ | Logo orizzontale per desktop e pre-conto                | SVG                                    |
| `fonts/` _(da aggiungere)_        | Font del brand                                          | WOFF2, con licenza per il web          |
| `icons/` _(F8)_                   | Icone PWA 192/512 px e maskable                         | PNG                                    |
| `og-image.jpg` _(opzionale)_      | Anteprima quando si condivide il link                   | 1200×630 JPG                           |

## Come applicare il brand reale

1. Copia i file in questa cartella (stessi nomi per sostituire i segnaposto).
2. Font: aggiungi una regola `@font-face` in `src/styles/tokens.css` che punti a
   `/assets/brand/fonts/...` e aggiorna `--font-family-base` / `--font-family-display`.
3. Colori, raggi e ombre: modifica solo le variabili in `src/styles/tokens.css`.
   Verifica il contrasto (almeno 4.5:1 per il testo) tra `--color-text` e `--color-bg`
   e tra `--color-on-primary` e `--color-primary`.
4. Le foto dei piatti **non** vanno qui: si caricano dall'area amministratore (F5).
