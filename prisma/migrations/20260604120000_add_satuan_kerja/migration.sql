-- CreateTable
CREATE TABLE "satuan_kerja" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "satuan_kerja_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "satuan_kerja_name_key" ON "satuan_kerja"("name");

-- AlterTable
ALTER TABLE "whitelist" ADD COLUMN "satuan_kerja_id" TEXT;

-- AddForeignKey
ALTER TABLE "whitelist" ADD CONSTRAINT "whitelist_satuan_kerja_id_fkey" FOREIGN KEY ("satuan_kerja_id") REFERENCES "satuan_kerja"("id") ON DELETE SET NULL ON UPDATE CASCADE;
