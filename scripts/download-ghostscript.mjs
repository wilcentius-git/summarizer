#!/usr/bin/env node
/**
 * Downloads Ghostscript Linux binary for local dev and Vercel.
 * Uses shelfio/ghostscript-lambda-layer (same binary for both).
 */
import { mkdirSync, existsSync, chmodSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "bin", "ghostscript");

if (existsSync(join(OUT_DIR, "bin", "gs"))) {
  console.log("Ghostscript already present at", OUT_DIR);
  process.exit(0);
}

const GS_URLS = [
  "https://media.githubusercontent.com/media/shelfio/ghostscript-lambda-layer/master/ghostscript.zip",
  "https://cdn.jsdelivr.net/gh/shelfio/ghostscript-lambda-layer@master/ghostscript.zip",
  "https://raw.githubusercontent.com/shelfio/ghostscript-lambda-layer/master/ghostscript.zip",
];

async function download() {
  for (const url of GS_URLS) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 1000) return buf;
      }
    } catch (e) {}
  }
  throw new Error("Download failed");
}

async function main() {
  try {
    console.log("Downloading Ghostscript (Linux binary for local + Vercel)...");
    const buf = await download();
    const { default: AdmZip } = await import("adm-zip");
    const zip = new AdmZip(buf);
    mkdirSync(OUT_DIR, { recursive: true });
    zip.extractAllTo(OUT_DIR, true);
    const gsPath = join(OUT_DIR, "bin", "gs");
    if (existsSync(gsPath)) chmodSync(gsPath, 0o755);
    console.log("Ghostscript installed to", OUT_DIR);
  } catch (err) {
    console.error("Ghostscript download failed:", err.message);
    console.error("Install manually: https://ghostscript.com/releases/gsdnld.html");
    process.exit(1);
  }
}

main();
