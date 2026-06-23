import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
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

    const { id: jobId } = await params;
    const visibility = await jobVisibilityWhere(payload.userId);

    const job = await prisma.summaryJob.findFirst({
      where: { id: jobId, ...visibility },
      select: { id: true },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const history = await prisma.summaryEditHistory.findMany({
      where: { jobId: job.id },
      include: {
        editedBy: {
          select: { id: true, name: true },
        },
      },
      orderBy: { editedAt: "desc" },
    });

    return NextResponse.json(
      history.map((entry) => ({
        id: entry.id,
        editedAt: entry.editedAt,
        textBefore: entry.textBefore,
        textAfter: entry.textAfter,
        editorName: entry.editedBy.name ?? entry.editedBy.id,
      }))
    );
  } catch (err) {
    console.error("Summary job history error:", err);
    return NextResponse.json(
      { error: "Failed to fetch edit history" },
      { status: 500 }
    );
  }
}
