import { resolve } from 'node:path';

/**
 * Directory of uploaded media (dish photos), served under /media.
 * In production it is a Docker volume included in the backups (CLAUDE.md §12).
 */
export function resolveMediaDir(env: NodeJS.ProcessEnv | Record<string, string | undefined>): string {
  return resolve(env['MEDIA_DIR'] || 'media');
}
