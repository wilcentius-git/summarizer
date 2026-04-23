-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "summary_jobs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "upload_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "summary_text" TEXT,
    "source_text" TEXT,
    "progress_percentage" INTEGER NOT NULL DEFAULT 0,
    "total_chunks" INTEGER,
    "processed_chunks" INTEGER NOT NULL DEFAULT 0,
    "partial_summary" TEXT,
    "groq_attempts" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "retry_after" TIMESTAMP(3),
    "extracted_text_for_retry" TEXT,
    "job_retry_context" TEXT,
    "processed_transcribe_chunks" INTEGER NOT NULL DEFAULT 0,
    "partial_transcript" TEXT,
    "audio_path" TEXT,
    "total_duration_ms" INTEGER,
    "transcribe_duration_ms" INTEGER,
    "summarize_duration_ms" INTEGER,
    "merge_duration_ms" INTEGER,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "summary_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AddForeignKey
ALTER TABLE "summary_jobs" ADD CONSTRAINT "summary_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
