import { Prisma } from '../generated/prisma/client.js';

/** True for PostgreSQL serialization failures and deadlocks, which are safe to retry. */
export function erroreDaRiprovare(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2034') return true;
    const meta = JSON.stringify(error.meta ?? {});
    return /40001|40P01|could not serialize|deadlock/i.test(meta + error.message);
  }
  return error instanceof Error && /40001|40P01|could not serialize|deadlock/i.test(error.message);
}

/** Runs a Serializable transaction again (with a short random pause) when PostgreSQL asks for it. */
export async function conRiprova<T>(fn: () => Promise<T>, tentativi = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i >= tentativi || !erroreDaRiprovare(error)) throw error;
      await new Promise((r) => setTimeout(r, 10 + Math.random() * 40 * i));
    }
  }
}
