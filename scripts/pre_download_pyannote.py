#!/usr/bin/env python3
"""
Pre-download pyannote speaker-diarization and faster-whisper models from Hugging Face.
Run this once to avoid Hub download errors during diarization/transcription.

Usage:
  python pre_download_pyannote.py [hf_token]
  Or set HF_TOKEN or HUGGINGFACE_API_KEY in environment / .env.local
"""

import os
import sys
from pathlib import Path


def get_token() -> str | None:
    """Get HF token from arg, env, or .env.local."""
    if len(sys.argv) >= 2 and sys.argv[1].strip():
        return sys.argv[1].strip()
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_API_KEY")
    if token:
        return token
    env_path = Path(__file__).resolve().parent.parent / ".env.local"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("HUGGINGFACE_API_KEY=") or line.startswith("HF_TOKEN="):
                val = line.split("=", 1)[1].strip().strip('"').strip("'")
                if val:
                    return val
    return None


def main() -> None:
    token = get_token()
    if not token:
        print("Error: No Hugging Face token. Provide as arg or set HF_TOKEN/HUGGINGFACE_API_KEY.")
        sys.exit(1)

    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        print("Installing huggingface_hub...")
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "huggingface_hub"])
        from huggingface_hub import snapshot_download

    def download_with_retry(repo_id: str, token: str | None = None, **kwargs) -> str:
        last_err = None
        for attempt in range(1, 5):
            try:
                path = snapshot_download(repo_id, token=token, **kwargs)
                return path
            except Exception as e:
                last_err = e
                if attempt < 4:
                    wait = 2**attempt
                    print(f"Attempt {attempt} failed: {e}. Retrying in {wait}s...")
                    import time
                    time.sleep(wait)
        raise last_err  # type: ignore[misc]

    print("Downloading Systran/faster-whisper-base (WhisperX transcription)...")
    try:
        path = download_with_retry("Systran/faster-whisper-base")
        print(f"  Done. Cached at: {path}")
    except Exception as e:
        print(f"Failed to download faster-whisper-base: {e}")
        sys.exit(1)

    print("Downloading pyannote/speaker-diarization-3.1...")
    try:
        path = download_with_retry("pyannote/speaker-diarization-3.1", token=token)
        print(f"Done. Model cached at: {path}")
    except Exception as e:
        print(f"Failed after 4 attempts: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
