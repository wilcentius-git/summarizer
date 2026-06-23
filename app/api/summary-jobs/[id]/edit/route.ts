import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { jobVisibilityWhere } from "@/lib/job-visibility";
import { writeAuditLog } from "@/lib/audit-log";

const editSummarySchema = z.object({
  summaryText: z.string().trim().min(1, "summaryText is required"),
});

export async function PATCH(
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

    const body = await request.json();
    const parsed = editSummarySchema.safeParse(body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? "Invalid input";
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const { id: jobId } = await params;
    const visibility = await jobVisibilityWhere(payload.userId);

    const job = await prisma.summaryJob.findFirst({
      where: { id: jobId, ...visibility },
      select: { id: true, summaryText: true },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const { summaryText } = parsed.data;

    await prisma.summaryJob.update({
      where: { id: job.id },
      data: { summaryText },
    });

    await prisma.summaryEditHistory.create({
      data: {
        jobId: job.id,
        editedById: payload.userId,
        textBefore: job.summaryText ?? "",
        textAfter: summaryText,
      },
    });

    await writeAuditLog({
      type: "JOB",
      action: "job.summary.edited",
      userId: payload.userId,
      metadata: {
        jobId,
        editedAt: new Date().toISOString(),
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Summary job edit error:", err);
    return NextResponse.json(
      { error: "Failed to update summary" },
      { status: 500 }
    );
  }
}
