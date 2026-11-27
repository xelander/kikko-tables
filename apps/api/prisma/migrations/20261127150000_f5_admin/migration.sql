-- AlterTable
ALTER TABLE "Impostazioni" ADD COLUMN     "sogliaGiroAttesaMin" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "urlBaseQr" TEXT;

-- AlterTable
ALTER TABLE "Piatto" ADD COLUMN     "archiviato" BOOLEAN NOT NULL DEFAULT false;

