-- CreateTable
CREATE TABLE "whitelist" (
    "nip" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whitelist_pkey" PRIMARY KEY ("nip")
);
