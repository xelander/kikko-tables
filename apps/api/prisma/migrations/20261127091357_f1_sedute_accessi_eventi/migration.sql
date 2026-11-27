-- CreateEnum
CREATE TYPE "StatoSeduta" AS ENUM ('APERTA', 'CHIUSA');

-- CreateEnum
CREATE TYPE "RuoloAttore" AS ENUM ('CLIENTE', 'CAMERIERE', 'CAPO', 'ADMIN', 'MONITOR', 'SISTEMA');

-- CreateEnum
CREATE TYPE "TipoEvento" AS ENUM ('TAVOLO_APERTO', 'PIN_RIGENERATO', 'PIN_ERRATO', 'DISPOSITIVO_UNITO', 'CARRELLO_MODIFICATO', 'GIRO_INVIATO', 'GIRO_APPROVATO', 'GIRO_RIFIUTATO', 'PIATTO_ESAURITO', 'PIATTO_RIPRISTINATO', 'TEMPO_SCADUTO', 'TEMPO_ESTESO', 'TAVOLI_UNITI', 'TAVOLO_SPOSTATO', 'PRECONTO_GENERATO', 'TAVOLO_CHIUSO', 'CONFIG_MODIFICATA', 'CLIENT_RICONNESSO');

-- AlterTable
ALTER TABLE "Tavolo" ADD COLUMN     "sedutaCorrenteId" UUID;

-- AlterTable
ALTER TABLE "UtenteStaff" ADD COLUMN     "pinHash" TEXT;

-- CreateTable
CREATE TABLE "DispositivoStaff" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "registratoDa" UUID NOT NULL,
    "creatoIl" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoAccesso" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revocatoIl" TIMESTAMP(3),

    CONSTRAINT "DispositivoStaff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "famiglia" UUID NOT NULL,
    "utenteId" UUID NOT NULL,
    "dispositivoStaffId" UUID,
    "creatoIl" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scadeIl" TIMESTAMP(3) NOT NULL,
    "usatoIl" TIMESTAMP(3),
    "revocatoIl" TIMESTAMP(3),

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Seduta" (
    "id" UUID NOT NULL,
    "stato" "StatoSeduta" NOT NULL DEFAULT 'APERTA',
    "formulaId" UUID NOT NULL,
    "formulaSnapshot" JSONB NOT NULL,
    "copertiAdulti" INTEGER NOT NULL,
    "copertiBambini" INTEGER NOT NULL,
    "pinHash" TEXT NOT NULL,
    "pinGeneratoIl" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "apertaIl" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "apertaDaId" UUID NOT NULL,
    "chiusaIl" TIMESTAMP(3),
    "chiusaDaId" UUID,
    "minutiExtra" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Seduta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SedutaTavolo" (
    "sedutaId" UUID NOT NULL,
    "tavoloId" UUID NOT NULL,
    "dalIl" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alIl" TIMESTAMP(3),

    CONSTRAINT "SedutaTavolo_pkey" PRIMARY KEY ("sedutaId","tavoloId")
);

-- CreateTable
CREATE TABLE "DispositivoCliente" (
    "id" UUID NOT NULL,
    "sedutaId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "soprannome" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "creatoIl" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoAccesso" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revocatoIl" TIMESTAMP(3),

    CONSTRAINT "DispositivoCliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TentativoPin" (
    "chiave" TEXT NOT NULL,
    "falliti" INTEGER NOT NULL DEFAULT 0,
    "blocchi" INTEGER NOT NULL DEFAULT 0,
    "bloccatoFino" TIMESTAMP(3),
    "aggiornatoIl" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TentativoPin_pkey" PRIMARY KEY ("chiave")
);

-- CreateTable
CREATE TABLE "Evento" (
    "seq" BIGSERIAL NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tipo" "TipoEvento" NOT NULL,
    "attoreRuolo" "RuoloAttore" NOT NULL,
    "attoreId" UUID,
    "dispositivoStaffId" UUID,
    "sedutaId" UUID,
    "tavoloId" UUID,
    "payload" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "Evento_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE UNIQUE INDEX "DispositivoStaff_tokenHash_key" ON "DispositivoStaff"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_famiglia_idx" ON "RefreshToken"("famiglia");

-- CreateIndex
CREATE INDEX "Seduta_stato_idx" ON "Seduta"("stato");

-- CreateIndex
CREATE INDEX "SedutaTavolo_tavoloId_idx" ON "SedutaTavolo"("tavoloId");

-- CreateIndex
CREATE UNIQUE INDEX "DispositivoCliente_tokenHash_key" ON "DispositivoCliente"("tokenHash");

-- CreateIndex
CREATE INDEX "DispositivoCliente_sedutaId_idx" ON "DispositivoCliente"("sedutaId");

-- CreateIndex
CREATE INDEX "Evento_sedutaId_seq_idx" ON "Evento"("sedutaId", "seq");

-- CreateIndex
CREATE INDEX "Evento_tipo_seq_idx" ON "Evento"("tipo", "seq");

-- AddForeignKey
ALTER TABLE "Tavolo" ADD CONSTRAINT "Tavolo_sedutaCorrenteId_fkey" FOREIGN KEY ("sedutaCorrenteId") REFERENCES "Seduta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_utenteId_fkey" FOREIGN KEY ("utenteId") REFERENCES "UtenteStaff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_dispositivoStaffId_fkey" FOREIGN KEY ("dispositivoStaffId") REFERENCES "DispositivoStaff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seduta" ADD CONSTRAINT "Seduta_apertaDaId_fkey" FOREIGN KEY ("apertaDaId") REFERENCES "UtenteStaff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seduta" ADD CONSTRAINT "Seduta_chiusaDaId_fkey" FOREIGN KEY ("chiusaDaId") REFERENCES "UtenteStaff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SedutaTavolo" ADD CONSTRAINT "SedutaTavolo_sedutaId_fkey" FOREIGN KEY ("sedutaId") REFERENCES "Seduta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SedutaTavolo" ADD CONSTRAINT "SedutaTavolo_tavoloId_fkey" FOREIGN KEY ("tavoloId") REFERENCES "Tavolo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispositivoCliente" ADD CONSTRAINT "DispositivoCliente_sedutaId_fkey" FOREIGN KEY ("sedutaId") REFERENCES "Seduta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
