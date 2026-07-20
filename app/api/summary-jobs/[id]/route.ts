import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { validateApiKey } from "@/lib/api-key";
import { deleteAudio } from "@/lib/audio-storage";
import { jobVisibilityWhere } from "@/lib/job-visibility";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    let payload: { userId: string; email: string } | null = null;
    let isApiKeyAuth = false;

    const authHeader = request.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const apiKeyRecord = await validateApiKey(authHeader.slice(7));
      if (apiKeyRecord) {
        payload = { userId: "admin", email: `api-key:${apiKeyRecord.name}` };
        isApiKeyAuth = true;
      }
    }

    if (!payload) {
      const cookieStore = await cookies();
      const token = cookieStore.get("auth-token")?.value;
      payload = token ? await verifyToken(token) : null;
    }

    if (!payload) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const job = await prisma.summaryJob.findFirst({
      where: isApiKeyAuth ? { id } : { id, userId: payload.userId },
      select: {
        id: true,
        status: true,
        progressPercentage: true,
        processedTranscribeChunks: true,
        totalChunks: true,
        processedChunks: true,
        errorMessage: true,
        summaryText: true,
        sourceText: true,
        filename: true,
      },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json(job);
  } catch (err) {
    console.error("Summary job fetch error:", err);
    return NextResponse.json(
      { error: "Failed to fetch job" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth-token")?.value;
    const payload = token ? await verifyToken(token) : null;
    if (!payload) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const visibility = await jobVisibilityWhere(payload.userId);

    const job = await prisma.summaryJob.findFirst({
      where: { id, ...visibility },
      select: { id: true, audioPath: true },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.audioPath) deleteAudio(job.audioPath);
    await prisma.summaryJob.delete({ where: { id: job.id } });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Summary job delete error:", err);
    return NextResponse.json(
      { error: "Failed to delete job" },
      { status: 500 }
    );
  }
}
