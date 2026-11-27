-- AlterEnum
ALTER TYPE "TipoEvento" ADD VALUE 'COPERTI_MODIFICATI';

-- AlterTable
ALTER TABLE "Seduta" ADD COLUMN     "unitaInId" UUID;

-- AlterTable
ALTER TABLE "DispositivoCliente" ADD COLUMN     "utenteStaffId" UUID;

