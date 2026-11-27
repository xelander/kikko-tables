import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp, { type Sharp } from 'sharp';
import type { Env } from '../config/env.js';
import { tokenCasuale } from '../common/crypto.js';

export interface FotoSalvata {
  /** Base name of `{file}-480.webp` and `{file}-240.webp` in MEDIA_DIR/piatti. */
  file: string;
  larghezza: number;
  altezza: number;
  anteprima: string;
}

/** Photos uploaded by the administrator get this prefix: only those are ever deleted from disk. */
const PREFISSO_CARICATE = 'p-';

/**
 * Dish photos (CLAUDE.md §11): any common image format in, two WebP sizes plus a tiny blurred preview out,
 * like the seed photos. Files live in MEDIA_DIR/piatti (a Docker volume included in the backups).
 */
@Injectable()
export class FotoService {
  private readonly logger = new Logger(FotoService.name);
  private readonly cartella: string;

  constructor(config: ConfigService<Env, true>) {
    this.cartella = join(config.get('MEDIA_DIR', { infer: true }), 'piatti');
  }

  async salva(dati: Buffer, codice: string): Promise<FotoSalvata> {
    let originale: Sharp;
    try {
      originale = sharp(dati, { failOn: 'error' }).rotate();
      const meta = await originale.metadata();
      if (!meta.width || !meta.height) throw new Error('no size');
    } catch {
      throw new BadRequestException({ codice: 'IMMAGINE_NON_VALIDA' });
    }
    // A new name for every upload, so browsers and the service worker never show a stale photo.
    const file = `${PREFISSO_CARICATE}${codice.slice(0, 40)}-${tokenCasuale(4)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')}`;
    mkdirSync(this.cartella, { recursive: true });
    const grande = await originale
      .clone()
      .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer({ resolveWithObject: true });
    const piccola = await originale
      .clone()
      .resize({ width: 240, height: 240, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer();
    const anteprima = await originale.clone().resize({ width: 16 }).blur(1).webp({ quality: 40 }).toBuffer();
    writeFileSync(join(this.cartella, `${file}-480.webp`), grande.data);
    writeFileSync(join(this.cartella, `${file}-240.webp`), piccola);
    return {
      file,
      larghezza: grande.info.width,
      altezza: grande.info.height,
      anteprima: `data:image/webp;base64,${anteprima.toString('base64')}`,
    };
  }

  /** Removes an uploaded photo. Seed photos are left alone (they can be restored with the example menu). */
  rimuovi(file: string): void {
    if (!file.startsWith(PREFISSO_CARICATE)) return;
    for (const misura of ['480', '240']) {
      try {
        rmSync(join(this.cartella, `${file}-${misura}.webp`), { force: true });
      } catch (error) {
        this.logger.warn(`Could not remove photo ${file}: ${(error as Error).message}`);
      }
    }
  }
}
