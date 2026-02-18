#!/usr/bin/env node
/**
 * Downloads Ghostscript binary for local dev and Vercel.
 * - Linux: shelfio/ghostscript-lambda-layer (for Vercel + WSL)
 * - Windows: Ghostscript 9.54 installer (silent install to project bin/)
 */
import { mkdirSync, existsSync, chmodSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "bin", "ghostscript");

const isWin = process.platform === "win32";
const GS_WIN_EXE = join(OUT_DIR, "gswin64c.exe");
const GS_LINUX = join(OUT_DIR, "bin", "gs");

function alreadyInstalled() {
  if (isWin) return existsSync(GS_WIN_EXE) || (existsSync(OUT_DIR) && findGswin64c(OUT_DIR));
  return existsSync(GS_LINUX);
}

if (alreadyInstalled()) {
  console.log("Ghostscript already present at", OUT_DIR);
  process.exit(0);
}

/** Find gswin64c.exe in a directory tree */
function findGswin64c(dir) {
  try {
    const entries = readdirSync(dir);
    for (const e of entries) {
      const p = join(dir, e);
      const st = statSync(p);
      if (st.isDirectory()) {
        const found = findGswin64c(p);
        if (found) return found;
      } else if (e === "gswin64c.exe") {
        return p;
      }
    }
  } catch {}
  return null;
}

async function downloadWindows() {
  const GS_WIN_URL =
    "https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/download/gs9540/gs9540w64.exe";
  const installerPath = join(tmpdir(), `gs9540w64-${Date.now()}.exe`);

  console.log("Downloading Ghostscript (Windows 64-bit)...");
  const res = await fetch(GS_WIN_URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const { writeFile, unlink } = await import("fs/promises");
  await writeFile(installerPath, buf);

  mkdirSync(OUT_DIR, { recursive: true });

  return new Promise((resolve, reject) => {
    const proc = spawn(installerPath, ["/S", "/D=" + OUT_DIR], {
      stdio: "inherit",
      shell: true,
    });
    proc.on("close", (code) => {
      unlink(installerPath).catch(() => {});
      if (code !== 0) {
        reject(new Error(`Installer exited with code ${code}`));
        return;
      }
      const exePath = findGswin64c(OUT_DIR);
      if (exePath) {
        resolve();
      } else {
        reject(new Error("gswin64c.exe not found after install"));
      }
    });
    proc.on("error", (err) => reject(err));
  });
}

async function downloadLinux() {
  // shelfio repo now has arch-specific zips (ghostscript.zip was removed)
  const zipName = process.arch === "arm64" ? "ghostscript-arm64.zip" : "ghostscript-x86_64.zip";
  const GS_URLS = [
    `https://github.com/shelfio/ghostscript-lambda-layer/raw/master/${zipName}`,
    `https://cdn.jsdelivr.net/gh/shelfio/ghostscript-lambda-layer@master/${zipName}`,
  ];

  let buf;
  for (const url of GS_URLS) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 1000) break;
      }
    } catch (e) {}
  }
  if (!buf || buf.length < 1000) throw new Error("Download failed");

  console.log("Downloading Ghostscript (Linux binary for Vercel/WSL)...");
  const { default: AdmZip } = await import("adm-zip");
  const zip = new AdmZip(buf);
  mkdirSync(OUT_DIR, { recursive: true });
  zip.extractAllTo(OUT_DIR, true);
  if (existsSync(GS_LINUX)) chmodSync(GS_LINUX, 0o755);
}

async function main() {
  try {
    if (isWin) {
      await downloadWindows();
    } else {
      await downloadLinux();
    }
    console.log("Ghostscript installed to", OUT_DIR);
  } catch (err) {
    console.error("Ghostscript download failed:", err.message);
    if (isWin) {
      console.error("Install manually: https://ghostscript.com/releases/gsdnld.html");
      console.error("Then copy gswin64c.exe to:", OUT_DIR);
    } else {
      console.error("Install manually: https://ghostscript.com/releases/gsdnld.html");
    }
    process.exit(1);
  }
}

main();
