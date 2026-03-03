#!/usr/bin/env node
/**
 * Install PyTorch with CUDA for GPU-accelerated diarization.
 * Run: npm run install:gpu
 * Requires: summarizer_venv exists (create with: python -m venv summarizer_venv)
 * Note: PyTorch CUDA wheels for Windows support Python 3.8–3.12 only. Python 3.13 uses CPU.
 */
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const venvDir = path.join(process.cwd(), "summarizer_venv");
const pipPath =
  process.platform === "win32"
    ? path.join(venvDir, "Scripts", "pip.exe")
    : path.join(venvDir, "bin", "pip");
const reqPath = path.join(process.cwd(), "scripts", "requirements-cuda.txt");

if (!fs.existsSync(venvDir)) {
  console.error("Error: summarizer_venv not found. Create it first:");
  console.error("  python -m venv summarizer_venv");
  console.error("  pip install -r scripts/requirements.txt");
  process.exit(1);
}

// Check Python version - PyTorch CUDA for Windows supports 3.8–3.12 only
try {
  const pyExe = process.platform === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");
  const pyVersion = execSync(`"${pyExe}" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"`, {
    encoding: "utf8",
  }).trim();
  const [major, minor] = pyVersion.split(".").map(Number);
  if (major === 3 && minor >= 13) {
    console.warn("Warning: Python 3.13+ detected. PyTorch does not provide CUDA wheels for Python 3.13 on Windows.");
    console.warn("GPU support requires Python 3.8–3.12. Create a new venv with Python 3.12:");
    console.warn("  py -3.12 -m venv summarizer_venv");
    console.warn("Proceeding will install CPU-only PyTorch. Continue? (Ctrl+C to cancel)");
  }
} catch {
  // Ignore version check errors
}
if (!fs.existsSync(reqPath)) {
  console.error("Error: scripts/requirements-cuda.txt not found.");
  process.exit(1);
}

console.log("Installing PyTorch with CUDA for GPU support...");
execSync(`"${pipPath}" install -r scripts/requirements-cuda.txt`, {
  stdio: "inherit",
  cwd: process.cwd(),
});
console.log("Done. Verify with: python -c \"import torch; print('CUDA:', torch.cuda.is_available())\"");
