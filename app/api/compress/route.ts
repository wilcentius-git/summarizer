import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { writeFile, readFile, unlink, access } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { readdirSync, statSync } from "fs";

const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB

const GS_DIR = join(process.cwd(), "bin", "ghostscript");
const BUNDLED_GS_LINUX = join(GS_DIR, "bin", "gs");
const BUNDLED_GS_WIN = join(GS_DIR, "gswin64c.exe");

function findGswin64c(dir: string): string | null {
  try {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) {
        const found = findGswin64c(p);
        if (found) return found;
      } else if (e === "gswin64c.exe") return p;
    }
  } catch {}
  return null;
}

async function getGhostscriptCommand(): Promise<string> {
  if (process.platform === "win32") {
    try {
      await access(BUNDLED_GS_WIN);
      return BUNDLED_GS_WIN;
    } catch {
      const found = findGswin64c(GS_DIR);
      if (found) return found;
    }
  } else {
    try {
      await access(BUNDLED_GS_LINUX);
      return BUNDLED_GS_LINUX;
    } catch {}
  }
  throw new Error(
    "Ghostscript not found. Run 'npm run build' or 'npm run setup:ghostscript' to download the bundled binary."
  );
}

/**
 * Compress PDF using Ghostscript.
 */
async function compressWithGhostscript(buffer: Buffer): Promise<Buffer> {
  const tmpDir = tmpdir();
  const inputPath = join(tmpDir, `pdf-in-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  const outputPath = join(tmpDir, `pdf-out-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);

  try {
    await writeFile(inputPath, buffer);

    const gs = await getGhostscriptCommand();
    // Ghostscript interprets backslashes as escapes; use forward slashes on Windows
    const gsOutputPath = outputPath.replace(/\\/g, "/");
    const gsInputPath = inputPath.replace(/\\/g, "/");
    const args = [
      "-sDEVICE=pdfwrite",
      "-dCompatibilityLevel=1.4",
      "-dPDFSETTINGS=/ebook", // 150 dpi, good balance of quality/size
      "-dNOPAUSE",
      "-dQUIET",
      "-dBATCH",
      "-sOutputFile=" + gsOutputPath,
      gsInputPath,
    ];

    const result = await new Promise<{ success: boolean; stderr: string }>((resolve) => {
      const proc = spawn(gs, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      proc.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      proc.on("close", (code) => {
        resolve({ success: code === 0, stderr });
      });
      proc.on("error", () => {
        resolve({ success: false, stderr: "Ghostscript not found" });
      });
    });

    if (!result.success) {
      throw new Error(result.stderr || "Ghostscript compression failed");
    }

    const compressed = await readFile(outputPath);
    return compressed;
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: "No PDF file provided." },
        { status: 400 }
      );
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "File must be a PDF." },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: `File exceeds ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB.` },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const body = await compressWithGhostscript(buffer);

    return new NextResponse(new Uint8Array(body), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=compressed.pdf",
      },
    });
  } catch (err) {
    console.error("Compress error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Compression failed." },
      { status: 500 }
    );
  }
}
