import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth-token")?.value;
    const payload = token ? await verifyToken(token) : null;
    if (!payload) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rows = await prisma.summaryJob.findMany({
      where: { userId: payload.userId },
      orderBy: { uploadTime: "desc" },
      select: {
        id: true,
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
      },
    });

    const jobs = rows.map(
      ({ extractedTextForRetry, audioPath, partialTranscript, sourceText, ...rest }) => ({
        ...rest,
        sourceText:
          sourceText?.trim() || extractedTextForRetry?.trim() || null,
        isResumable:
          rest.status !== "completed" &&
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
