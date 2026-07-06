import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { audioExists } from "@/lib/audio-storage";
import { decryptApiKey, encryptApiKey } from "@/lib/crypto";
import { resolveGroqApiKey } from "@/lib/resolve-groq-api-key";
import { checkRateLimit } from "@/lib/rate-limit";
import { jobVisibilityWhere } from "@/lib/job-visibility";
import { writeAuditLog } from "@/lib/audit-log";

/** Job with fields needed for resume (Prisma client may be out of sync with schema). */
type ResumableJob = {
  id: string;
  status: string;
  filename: string;
  fileType: string;
  summaryText?: string | null;
  extractedTextForRetry: string | null;
  jobRetryContext: string | null;
  partialSummary?: string | null;
  partialTranscript?: string | null;
  processedChunks?: number;
  processedTranscribeChunks?: number;
  audioPath?: string | null;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth-token")?.value;
    const payload = token ? await verifyToken(token) : null;
    if (!payload) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimitResult = await checkRateLimit(`resume:${payload.userId}`);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: "Terlalu banyak permintaan. Silakan tunggu sebelum mencoba lagi." },
        { status: 429 }
      );
    }

    const { id: jobId } = await params;
    const visibility = await jobVisibilityWhere(payload.userId);

    const job = await prisma.summaryJob.findFirst({
      where: { id: jobId, ...visibility },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const resumableJob = job as ResumableJob;

    if (resumableJob.status === "completed") {
      return NextResponse.json({ message: "Rangkuman selesai." }, { status: 200 });
    }

    if (resumableJob.summaryText?.trim()) {
      return NextResponse.json({ message: "Rangkuman selesai." }, { status: 200 });
    }

    if (resumableJob.status === "processing") {
      return NextResponse.json(
        {
          error:
            "Pekerjaan ini sedang diproses. Tunggu hingga selesai atau batalkan jika macet.",
        },
        { status: 409 }
      );
    }

    let text: string | null = resumableJob.extractedTextForRetry;
    const hasTranscriptionResume =
      resumableJob.audioPath && audioExists(resumableJob.audioPath);

    if (!text?.trim() && !hasTranscriptionResume) {
      return NextResponse.json(
        { error: "Job cannot be resumed: no extracted text or audio saved." },
        { status: 400 }
      );
    }

    let satuanKerjaGroqKey: string | null = null;
    const whitelistEntry = await prisma.whitelist.findUnique({
      where: { nip: payload.userId },
      include: { satuanKerja: { select: { groqApiKey: true } } },
    });
    const encryptedKey = whitelistEntry?.satuanKerja?.groqApiKey;
    if (encryptedKey) {
      satuanKerjaGroqKey = decryptApiKey(encryptedKey);
    }

    const body = await request.json().catch(() => ({}));
    const apiKey = resolveGroqApiKey(
      body.groqApiKey as string | null | undefined,
      satuanKerjaGroqKey
    );
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "Groq API key is required. Set GROQ_API_KEY in .env.local on the server, or send groqApiKey in the request (kunci groq sendiri opsional).",
        },
        { status: 400 }
      );
    }

    const resumableStatuses = [
      "pending",
      "failed",
      "waiting_rate_limit",
      "cancelled",
    ] as const;

    const rawPersonalGroqKey = (body.groqApiKey as string | null | undefined)?.trim();

    const targetStatus =
      !text?.trim() && hasTranscriptionResume ? "queued_transcription" : "waiting_rate_limit";

    const claimResult = await prisma.summaryJob.updateMany({
      where: {
        id: jobId,
        ...visibility,
        status: { in: [...resumableStatuses] },
      },
      data: {
        status: targetStatus,
        ...(targetStatus === "waiting_rate_limit" ? { retryAfter: new Date() } : {}),
        ...(rawPersonalGroqKey ? { personalGroqApiKey: encryptApiKey(rawPersonalGroqKey) } : {}),
      },
    });

    if (claimResult.count === 0) {
      const latest = await prisma.summaryJob.findFirst({
        where: { id: jobId, ...visibility },
      });
      if (!latest) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }
      if (latest.status === "completed" || latest.summaryText?.trim()) {
        return NextResponse.json({ message: "Rangkuman selesai." }, { status: 200 });
      }
      if (latest.status === "processing") {
        return NextResponse.json(
          {
            error:
              "Pekerjaan ini sedang diproses. Tunggu hingga selesai atau batalkan jika macet.",
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "Tidak dapat melanjutkan pekerjaan dalam status ini." },
        { status: 400 }
      );
    }

    await writeAuditLog({
      type: "JOB",
      action: "job.resumed",
      userId: payload.userId,
      metadata: { jobId },
    });

    return NextResponse.json(
      { message: "Job resumed, processing in background.", jobId, queued: true },
      { status: 200 }
    );
  } catch (err) {
    console.error("Resume route error:", err);
    return NextResponse.json(
      { error: "Terjadi kesalahan. Silakan coba lagi." },
      { status: 500 }
    );
  }
}
