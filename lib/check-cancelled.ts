import { prisma } from "@/lib/prisma";

/** Check if a job has been cancelled (server should stop processing). */
export async function isJobCancelled(jobId: string): Promise<boolean> {
  const job = await prisma.summaryJob.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  return job?.status === "cancelled";
}
