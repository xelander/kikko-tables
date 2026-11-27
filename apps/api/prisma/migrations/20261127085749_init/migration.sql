-- CreateEnum
CREATE TYPE "Allergene" AS ENUM ('GLUTEN', 'CRUSTACEANS', 'EGGS', 'FISH', 'PEANUTS', 'SOY', 'MILK', 'NUTS', 'CELERY', 'MUSTARD', 'SESAME', 'SULPHITES', 'LUPIN', 'MOLLUSCS');

-- CreateEnum
CREATE TYPE "RuoloStaff" AS ENUM ('CAMERIERE', 'CAPO', 'ADMIN', 'MONITOR');

-- CreateTable
CREATE TABLE "Impostazioni" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "nomeLocale" TEXT NOT NULL,
    "fusoOrario" TEXT NOT NULL,
    "valuta" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Impostazioni_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Formula" (
    "id" UUID NOT NULL,
    "codice" TEXT NOT NULL,
    "nomeIt" TEXT NOT NULL,
    "nomeEn" TEXT NOT NULL,
    "prezzoAdultoCent" INTEGER NOT NULL,
    "prezzoBambinoCent" INTEGER NOT NULL,
    "fasce" JSONB NOT NULL,
    "piattiPerPersonaPerGiro" INTEGER NOT NULL,
    "minutiTraGiri" INTEGER NOT NULL,
    "durataMaxMinuti" INTEGER NOT NULL,
    "maxGiri" INTEGER,
    "attiva" BOOLEAN NOT NULL DEFAULT true,
    "ordine" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Formula_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Categoria" (
    "id" UUID NOT NULL,
    "codice" TEXT NOT NULL,
    "nomeIt" TEXT NOT NULL,
    "nomeEn" TEXT NOT NULL,
    "ordine" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Categoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Piatto" (
    "id" UUID NOT NULL,
    "codice" TEXT NOT NULL,
    "nomeIt" TEXT NOT NULL,
    "nomeEn" TEXT NOT NULL,
    "descrizioneIt" TEXT NOT NULL DEFAULT '',
    "descrizioneEn" TEXT NOT NULL DEFAULT '',
    "categoriaId" UUID NOT NULL,
    "immagine" TEXT,
    "allergeni" "Allergene"[],
    "inFormula" BOOLEAN NOT NULL DEFAULT true,
    "prezzoExtraCent" INTEGER,
    "maxPerSeduta" INTEGER,
    "maxPerGiro" INTEGER,
    "disponibile" BOOLEAN NOT NULL DEFAULT true,
    "ordine" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Piatto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tavolo" (
    "id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "slugQr" TEXT NOT NULL,
    "posti" INTEGER NOT NULL,
    "posX" INTEGER NOT NULL DEFAULT 0,
    "posY" INTEGER NOT NULL DEFAULT 0,
    "attivo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tavolo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UtenteStaff" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ruolo" "RuoloStaff" NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "attivo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UtenteStaff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Formula_codice_key" ON "Formula"("codice");

-- CreateIndex
CREATE UNIQUE INDEX "Categoria_codice_key" ON "Categoria"("codice");

-- CreateIndex
CREATE UNIQUE INDEX "Piatto_codice_key" ON "Piatto"("codice");

-- CreateIndex
CREATE INDEX "Piatto_categoriaId_ordine_idx" ON "Piatto"("categoriaId", "ordine");

-- CreateIndex
CREATE UNIQUE INDEX "Tavolo_numero_key" ON "Tavolo"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "Tavolo_slugQr_key" ON "Tavolo"("slugQr");

-- CreateIndex
CREATE UNIQUE INDEX "UtenteStaff_username_key" ON "UtenteStaff"("username");

-- AddForeignKey
ALTER TABLE "Piatto" ADD CONSTRAINT "Piatto_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
