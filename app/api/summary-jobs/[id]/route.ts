import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { deleteAudio } from "@/lib/audio-storage";
import { jobVisibilityWhere } from "@/lib/job-visibility";

export async function GET(
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
    const job = await prisma.summaryJob.findFirst({
      where: { id, userId: payload.userId },
      select: {
        id: true,
        status: true,
        progressPercentage: true,
        processedTranscribeChunks: true,
        totalChunks: true,
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
