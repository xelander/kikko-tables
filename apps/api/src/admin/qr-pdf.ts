import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

export interface CartellinoQr {
  numero: number;
  url: string;
}

/** A4 in points, four cards per page (2 × 2), to be cut along the dashed lines. */
const PAGINA = { larghezza: 595.28, altezza: 841.89 };
const COLONNE = 2;
const RIGHE = 2;
const ROSSO = '#9e1b22';
const VERDE = '#1f4b4a';
const GRIGIO = '#6b6b6b';

/**
 * Printable table cards (CLAUDE.md §13 F5): restaurant name, table number, QR code to `/t/{slug}`
 * and "Scan to order" in Italian and English. Built-in Helvetica: the brand font and logo arrive later (§11).
 */
export async function pdfQr(nomeLocale: string, cartellini: readonly CartellinoQr[]): Promise<Buffer> {
  const qr = await Promise.all(
    cartellini.map((c) => QRCode.toBuffer(c.url, { errorCorrectionLevel: 'M', margin: 1, width: 600 })),
  );
  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    info: { Title: `QR dei tavoli – ${nomeLocale}`, Author: nomeLocale },
  });
  const blocchi: Buffer[] = [];
  doc.on('data', (b: Buffer) => blocchi.push(b));
  const fine = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(blocchi)));
    doc.on('error', reject);
  });

  const w = PAGINA.larghezza / COLONNE;
  const h = PAGINA.altezza / RIGHE;
  const perPagina = COLONNE * RIGHE;

  cartellini.forEach((c, i) => {
    const posizione = i % perPagina;
    if (i > 0 && posizione === 0) doc.addPage();
    if (posizione === 0) lineeDiTaglio(doc, w, h);
    const x = (posizione % COLONNE) * w;
    const y = Math.floor(posizione / COLONNE) * h;
    const lato = 190;

    doc
      .fillColor(ROSSO)
      .font('Helvetica-Bold')
      .fontSize(26)
      .text(nomeLocale.toUpperCase(), x, y + 38, { width: w, align: 'center', characterSpacing: 4 });
    doc
      .fillColor(VERDE)
      .font('Helvetica-Bold')
      .fontSize(30)
      .text(`Tavolo ${c.numero}`, x, y + 78, { width: w, align: 'center' });
    doc.image(qr[i]!, x + (w - lato) / 2, y + 125, { width: lato, height: lato });
    doc
      .fillColor(VERDE)
      .font('Helvetica-Bold')
      .fontSize(15)
      .text('Scansiona per ordinare', x, y + 330, { width: w, align: 'center' });
    doc
      .fillColor(GRIGIO)
      .font('Helvetica')
      .fontSize(11)
      .text('Scan to order', x, y + 350, { width: w, align: 'center' });
    doc.fontSize(7).text(c.url, x + 16, y + 385, { width: w - 32, align: 'center' });
  });
  if (cartellini.length === 0) {
    doc
      .font('Helvetica')
      .fontSize(14)
      .text('Nessun tavolo attivo.', 0, 100, { width: PAGINA.larghezza, align: 'center' });
  }
  doc.end();
  return fine;
}

function lineeDiTaglio(doc: PDFKit.PDFDocument, w: number, h: number): void {
  doc.save().lineWidth(0.5).strokeColor('#bbbbbb').dash(4, { space: 4 });
  doc.moveTo(w, 0).lineTo(w, PAGINA.altezza).stroke();
  doc.moveTo(0, h).lineTo(PAGINA.larghezza, h).stroke();
  doc.undash().restore();
}
