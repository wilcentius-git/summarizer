import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { jobVisibilityWhere } from "@/lib/job-visibility";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth-token")?.value;
    const payload = token ? await verifyToken(token) : null;
    if (!payload) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const visibility = await jobVisibilityWhere(payload.userId);

    const rows = await prisma.summaryJob.findMany({
      where: visibility,
      orderBy: { uploadTime: "desc" },
      select: {
        id: true,
        userId: true,
        filename: true,
        fileType: true,
        uploadTime: true,
        status: true,
        summaryText: true,
        progressPercentage: true,
        groqAttempts: true,
        errorMessage: true,
        retryAfter: true,
        totalChunks: true,
        processedChunks: true,
        extractedTextForRetry: true,
        sourceText: true,
        audioPath: true,
        partialTranscript: true,
        totalDurationMs: true,
        transcribeDurationMs: true,
        summarizeDurationMs: true,
        mergeDurationMs: true,
        completedAt: true,
        user: { select: { name: true } },
      },
    });

    const jobs = rows.map(
      ({
        extractedTextForRetry,
        audioPath,
        partialTranscript,
        sourceText,
        user,
        userId,
        ...rest
      }) => ({
        ...rest,
        userId,
        ownerName: user.name?.trim() || userId,
        sourceText:
          sourceText?.trim() || extractedTextForRetry?.trim() || null,
        isResumable:
          rest.status !== "completed" &&
          rest.status !== "processing" &&
          !rest.summaryText?.trim() &&
          (!!extractedTextForRetry || !!audioPath),
      })
    );

    return NextResponse.json({ jobs });
  } catch (err) {
    console.error("Summary jobs fetch error:", err);
    return NextResponse.json(
      { error: "Failed to fetch summary history" },
      { status: 500 }
    );
  }
}
