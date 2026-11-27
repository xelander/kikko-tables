import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

export function createTestPrisma(): PrismaClient {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString?.includes('_test')) throw new Error('DATABASE_URL must point to the test database');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/** Empties every application table (keeps the migrations table). */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Piatto", "Categoria", "Formula", "Tavolo", "UtenteStaff", "Impostazioni" RESTART IDENTITY CASCADE',
  );
}
