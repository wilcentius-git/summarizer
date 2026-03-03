#!/usr/bin/env python3
"""
Transcribe audio with speaker diarization using WhisperX (Whisper + pyannote).
Outputs JSON to stdout: {"transcript": "Speaker 0: ...\\nSpeaker 1: ..."} or {"error": "..."}

Usage:
  python diarize_transcribe.py <audio_path> <hf_token>

Requires: pip install -r requirements.txt
Hugging Face: Accept license at https://huggingface.co/pyannote/speaker-diarization-3.1
"""

import json
import sys
import warnings
from pathlib import Path

# Suppress torchcodec/FFmpeg warnings on Windows when pyannote loads.
warnings.filterwarnings("ignore", category=UserWarning, module="pyannote")
# Suppress Lightning checkpoint upgrade warning (can be raised when run from Node).
warnings.filterwarnings("ignore", message="Lightning automatically upgraded")
warnings.filterwarnings("ignore", category=UserWarning, module="lightning")


def main() -> None:
    if len(sys.argv) < 3:
        out = {"error": "Usage: diarize_transcribe.py <audio_path> <hf_token>"}
        print(json.dumps(out), flush=True)
        sys.exit(1)

    audio_path = sys.argv[1]
    hf_token = sys.argv[2].strip()

    if not hf_token:
        out = {"error": "Hugging Face token is required. Get one at huggingface.co/settings/tokens"}
        print(json.dumps(out), flush=True)
        sys.exit(1)

    if not Path(audio_path).exists():
        out = {"error": f"Audio file not found: {audio_path}"}
        print(json.dumps(out), flush=True)
        sys.exit(1)

    try:
        import torch
        import whisperx
        from whisperx.diarize import DiarizationPipeline
    except ImportError as e:
        out = {"error": f"Missing dependencies. Run: pip install -r scripts/requirements.txt. {e}"}
        print(json.dumps(out), flush=True)
        sys.exit(1)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    compute_type = "float16" if device == "cuda" else "int8"

    def load_audio_robust(path: str):
        """Load audio with torchaudio to avoid torchcodec/FFmpeg issues on Windows.
        Bypasses whisperx.load_audio which uses torchcodec (problematic on Windows)."""
        import torchaudio
        waveform, sr = torchaudio.load(path)
        if waveform.shape[0] > 1:
            waveform = waveform.mean(dim=0, keepdim=True)
        if sr != 16000:
            resampler = torchaudio.transforms.Resample(sr, 16000)
            waveform = resampler(waveform)
        return waveform.squeeze(0).numpy().astype("float32")

    try:
        # Load model
        model = whisperx.load_model("base", device, compute_type=compute_type)
        audio = load_audio_robust(audio_path)

        # Transcribe
        result = model.transcribe(audio, batch_size=16)
        if not result.get("segments"):
            out = {"transcript": "", "error": None, "device": device}
            print(json.dumps(out), flush=True)
            return

        # Align for word-level timestamps (needed for diarization)
        lang = result.get("language", "id")
        try:
            model_a, metadata = whisperx.load_align_model(language_code=lang, device=device)
            result = whisperx.align(result["segments"], model_a, metadata, audio, device)
        except Exception:
            try:
                model_a, metadata = whisperx.load_align_model(language_code="en", device=device)
                result = whisperx.align(result["segments"], model_a, metadata, audio, device)
            except Exception:
                pass  # Use raw segments without alignment

        # Diarize (WhisperX 3.3.4+ moved DiarizationPipeline to whisperx.diarize)
        diarize_model = DiarizationPipeline(
            model_name="pyannote/speaker-diarization-3.1",
            token=hf_token,
            device=device,
        )
        diarize_df = diarize_model(audio)
        result = whisperx.assign_word_speakers(diarize_df, result)

        # Build speaker-labeled transcript
        segments = result.get("segments", [])
        lines: list[str] = []
        current_speaker: str | None = None
        current_text: list[str] = []

        for seg in segments:
            speaker = seg.get("speaker", "SPEAKER_00")
            text = (seg.get("text") or "").strip()
            if not text:
                continue

            if speaker == current_speaker:
                current_text.append(text)
            else:
                if current_text:
                    label = current_speaker or "Speaker"
                    lines.append(f"{label}: {' '.join(current_text)}")
                current_speaker = speaker
                current_text = [text]

        if current_text:
            label = current_speaker or "Speaker"
            lines.append(f"{label}: {' '.join(current_text)}")

        transcript = "\n\n".join(lines) if lines else ""
        out = {"transcript": transcript, "error": None, "device": device}
        print(json.dumps(out), flush=True)

    except Exception as e:
        out = {"transcript": "", "error": str(e), "device": device}
        print(json.dumps(out), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
