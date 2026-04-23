import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

export async function POST(
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

    const { id: jobId } = await params;

    const updated = await prisma.summaryJob.updateMany({
      where: {
        id: jobId,
        userId: payload.userId,
        status: { not: "completed" },
      },
      data: { status: "cancelled" },
    });

    if (updated.count > 0) {
      return NextResponse.json({ success: true });
    }

    // No row updated: not found, wrong owner, or already completed — disambiguate for HTTP semantics.
    const job = await prisma.summaryJob.findFirst({
      where: { id: jobId, userId: payload.userId },
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    if (job.status === "completed") {
      return NextResponse.json({ error: "Job already completed" }, { status: 400 });
    }
    return NextResponse.json({ error: "Cannot cancel this job" }, { status: 500 });
  } catch (err) {
    console.error("Cancel job error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Cancel failed" },
      { status: 500 }
    );
  }
}
