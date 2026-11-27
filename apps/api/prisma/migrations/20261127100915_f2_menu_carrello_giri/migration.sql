-- CreateEnum
CREATE TYPE "SezioneMenu" AS ENUM ('MENU', 'BEVANDE');

-- CreateEnum
CREATE TYPE "StatoGiro" AS ENUM ('INVIATO', 'APPROVATO', 'RIFIUTATO');

-- AlterTable
ALTER TABLE "Categoria" ADD COLUMN     "sezione" "SezioneMenu" NOT NULL DEFAULT 'MENU';

-- RenameColumn: "massimo N volte" is per person (decision of 2026-11-27)
ALTER TABLE "Piatto" RENAME COLUMN "maxPerSeduta" TO "maxPerPersona";

-- AlterTable
ALTER TABLE "Piatto" ADD COLUMN     "gruppoLimiteId" UUID,
ADD COLUMN     "immagineAltezza" INTEGER,
ADD COLUMN     "immagineAnteprima" TEXT,
ADD COLUMN     "immagineLarghezza" INTEGER,
ADD COLUMN     "numero" TEXT,
ADD COLUMN     "pezzi" INTEGER,
ADD COLUMN     "piccante" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "prezzoCartaCent" INTEGER,
ADD COLUMN     "senzaGlutine" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "vegetariano" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "GruppoLimite" (
    "id" UUID NOT NULL,
    "codice" TEXT NOT NULL,
    "nomeIt" TEXT NOT NULL,
    "nomeEn" TEXT NOT NULL,
    "maxPerPersona" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GruppoLimite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoceCarrello" (
    "id" UUID NOT NULL,
    "sedutaId" UUID NOT NULL,
    "piattoId" UUID NOT NULL,
    "dispositivoId" UUID NOT NULL,
    "quantita" INTEGER NOT NULL,
    "aggiornatoIl" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoceCarrello_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Giro" (
    "id" UUID NOT NULL,
    "sedutaId" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "stato" "StatoGiro" NOT NULL DEFAULT 'INVIATO',
    "chiaveIdempotenza" TEXT NOT NULL,
    "soloExtra" BOOLEAN NOT NULL DEFAULT false,
    "inviatoIl" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inviatoDaId" UUID,
    "gestitoDaId" UUID,
    "gestitoIl" TIMESTAMP(3),
    "motivoRifiuto" TEXT,

    CONSTRAINT "Giro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoceGiro" (
    "id" UUID NOT NULL,
    "giroId" UUID NOT NULL,
    "piattoId" UUID NOT NULL,
    "quantita" INTEGER NOT NULL,
    "inFormula" BOOLEAN NOT NULL,
    "prezzoExtraCent" INTEGER,

    CONSTRAINT "VoceGiro_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GruppoLimite_codice_key" ON "GruppoLimite"("codice");

-- CreateIndex
CREATE UNIQUE INDEX "VoceCarrello_sedutaId_piattoId_dispositivoId_key" ON "VoceCarrello"("sedutaId", "piattoId", "dispositivoId");

-- CreateIndex
CREATE INDEX "Giro_stato_inviatoIl_idx" ON "Giro"("stato", "inviatoIl");

-- CreateIndex
CREATE UNIQUE INDEX "Giro_sedutaId_chiaveIdempotenza_key" ON "Giro"("sedutaId", "chiaveIdempotenza");

-- CreateIndex
CREATE UNIQUE INDEX "Giro_sedutaId_numero_key" ON "Giro"("sedutaId", "numero");

-- CreateIndex
CREATE INDEX "VoceGiro_giroId_idx" ON "VoceGiro"("giroId");

-- CreateIndex
CREATE UNIQUE INDEX "Piatto_numero_key" ON "Piatto"("numero");

-- AddForeignKey
ALTER TABLE "Piatto" ADD CONSTRAINT "Piatto_gruppoLimiteId_fkey" FOREIGN KEY ("gruppoLimiteId") REFERENCES "GruppoLimite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoceCarrello" ADD CONSTRAINT "VoceCarrello_sedutaId_fkey" FOREIGN KEY ("sedutaId") REFERENCES "Seduta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoceCarrello" ADD CONSTRAINT "VoceCarrello_piattoId_fkey" FOREIGN KEY ("piattoId") REFERENCES "Piatto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoceCarrello" ADD CONSTRAINT "VoceCarrello_dispositivoId_fkey" FOREIGN KEY ("dispositivoId") REFERENCES "DispositivoCliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Giro" ADD CONSTRAINT "Giro_sedutaId_fkey" FOREIGN KEY ("sedutaId") REFERENCES "Seduta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Giro" ADD CONSTRAINT "Giro_inviatoDaId_fkey" FOREIGN KEY ("inviatoDaId") REFERENCES "DispositivoCliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoceGiro" ADD CONSTRAINT "VoceGiro_giroId_fkey" FOREIGN KEY ("giroId") REFERENCES "Giro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoceGiro" ADD CONSTRAINT "VoceGiro_piattoId_fkey" FOREIGN KEY ("piattoId") REFERENCES "Piatto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

