-- AlterEnum
ALTER TYPE "DomainStatus" ADD VALUE 'ATTESTED';

-- AlterEnum
ALTER TYPE "VerificationMethod" ADD VALUE 'SELF_ATTESTED';

-- AlterTable
ALTER TABLE "VerifiedDomain" ADD COLUMN     "attestedAt" TIMESTAMP(3),
ADD COLUMN     "attestedById" TEXT;
