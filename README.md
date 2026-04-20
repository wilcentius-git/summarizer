# Document Summarizer

A simple web app to upload documents and get AI-generated summaries.

## Features

- **Upload documents** – Add files via file picker or drag and drop (max 500 MB per file). Supports: **PDF**, **DOCX**, **DOC**, **TXT**, **RTF**, **ODT**, **SRT**, **MP3**, **WAV**, **M4A**, **WebM**, **FLAC**, **OGG**.
- **Summarize** – Extract text and get a concise summary via Groq (Llama). Supports scanned PDFs via OCR (Groq Vision) and **audio transcription** via Groq Whisper (MP3, WAV, etc., max 200 MB upload; long audio is chunked for the API).
- **Optional technical terms** – After you add a file to the queue, you can fill **Istilah teknis (opsional)** with abbreviations or jargon (e.g. `PSSI, KPI, XSS, CI/CD`). They are sent to Whisper as a transcription **prompt** (helps spelling of rare terms) and to the summarizer so it keeps those spellings and interprets the domain better.
- **Segmented Summarize** – Works on text with **label and opinion format** (e.g., speaker-labeled transcripts, structured opinions). The model checks the format first; if not found, returns "no segmented opinion format". For **audio (MP3, etc.)**: optionally use **pyannote.audio** (via WhisperX) for speaker diarization when a Hugging Face token is provided.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Run the dev server:

   ```bash
   npm run dev
   ```

3. Open [http://localhost:3000](http://localhost:3000) and enter your Groq API key in the form (get a free key at [console.groq.com](https://console.groq.com)). The key is cached for 1 hour in your browser.

4. (Optional) After uploading a file, use **Istilah teknis** on that row before clicking **Summarize** if the content uses domain-specific vocabulary.

### Segmented Summarize with speaker diarization (optional)

For **audio files** with speaker labels via pyannote:

1. Install Python 3.8+ and create a virtual environment:
   ```bash
   python -m venv summarizer_venv
   .\summarizer_venv\Scripts\pip.exe install -r scripts/requirements.txt   # Windows
   # or: summarizer_venv/bin/pip install -r scripts/requirements.txt       # macOS/Linux
   ```
   The app uses `summarizer_venv` automatically when it exists.

2. To run the diarize script from the CLI, activate the venv first:
   ```powershell
   .\summarizer_venv\Scripts\Activate.ps1   # Windows PowerShell
   # or: summarizer_venv\Scripts\activate.bat   # Windows cmd
   # or: source summarizer_venv/bin/activate    # macOS/Linux
   ```
   Then run: `python scripts/diarize_transcribe.py <audio_path> <hf_token>`

3. Accept the pyannote model license at [huggingface.co/pyannote/speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1).

4. Create a Hugging Face token at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) and enter it in the app when using Segmented Summarize on audio. For CLI usage, pass it as the second argument.

Without the HF token, Segmented Summarize on audio falls back to Groq Whisper (no speaker labels).

**If you get Hugging Face Hub download errors** (e.g. "cannot find the appropriate snapshot folder"), pre-download the model when your connection is stable:

```bash
python scripts/pre_download_pyannote.py <your_hf_token>
# Or set HF_TOKEN or HUGGINGFACE_API_KEY in .env.local
```

### GPU (CUDA) support for faster diarization

By default, `pip install -r scripts/requirements.txt` installs PyTorch CPU-only. For **GPU acceleration** (much faster on long audio):

**Note:** PyTorch CUDA wheels for Windows support **Python 3.8–3.12** only. If you use Python 3.13+, create a venv with Python 3.12: `py -3.12 -m venv summarizer_venv`

1. Check your CUDA version: `nvidia-smi` (e.g. 12.1 or 11.8).
2. Install PyTorch with CUDA (use venv first: `.\summarizer_venv\Scripts\Activate.ps1` on Windows):
   ```bash
   npm run install:gpu
   ```
   Or manually: `pip install -r scripts/requirements-cuda.txt`
   For CUDA 11.8, edit `scripts/requirements-cuda.txt` and change `cu121` to `cu118`.
3. Verify: `python -c "import torch; print('CUDA:', torch.cuda.is_available())"` → should print `CUDA: True`.

The app will use GPU automatically when available and show `[GPU (CUDA)]` or `[CPU]` in the summary caption.

### TorchCodec / FFmpeg issues on Windows

If diarization fails with "Could not load libtorchcodec" or FFmpeg DLL errors when using Segmented Summarize from the web app (but works from CLI), the script now uses **torchaudio** for audio loading to bypass torchcodec. If you still see issues:

1. **Uninstall torchcodec** (pyannote will fall back to torchaudio):
   ```bash
   .\summarizer_venv\Scripts\Activate.ps1
   pip uninstall torchcodec -y
   ```
2. Or install FFmpeg "full-shared" with DLLs: [ffmpeg.org](https://ffmpeg.org/download.html) → Windows builds → "full-shared".

### API timeout

The Segmented Summarize API allows up to **2 hours** (`maxDuration: 7200`) for long audio diarization. Local dev has no timeout; Vercel caps by plan (Hobby: 10s, Pro: 60s, Enterprise: 900s).

## Build

```bash
npm run build
npm start
```

## Docker

**Build:**

```bash
docker build -t summarizer .
```

**Run (foreground – use Ctrl+C to stop):**

```bash
   docker run -p 3000:3000 summarizer
```

```bash
docker run --rm -p 3000:3000 -v summarizer-db:/app/data -e DATABASE_URL="file:/app/data/prod.db" -e JWT_SECRET="change-this-to-a-secure-random-string-in-production" -e NODE_ENV=development summarizer
```

**Run (background):**

```bash
docker run -d -p 3000:3000 --name summarizer summarizer
```

**Stop (when running in background):**

```bash
docker stop summarizer
```

**Or with Docker Compose:**

```bash
docker compose up --build    # Ctrl+C to stop
# or
docker compose up -d --build # background; use: docker compose down
```

Open [http://localhost:3000](http://localhost:3000). Users enter their Groq API key in the app. To pass `GROQ_API_KEY` via env, create `.env.local` and uncomment the `env_file` section in `docker-compose.yml`.

## Deploy to Vercel

No environment variables needed—users enter their own Groq API key in the app:

```bash
vercel
```

Or connect your repo to [Vercel](https://vercel.com) for automatic deployments.

## Tech

- Next.js 16 (App Router), React 18, TypeScript
- **pdf-parse** for PDF text extraction; **pdf-to-img** for PDF-to-image when text is missing (scanned PDFs)
- **mammoth** for DOCX/DOC text extraction; **rtf-parser** for RTF; **adm-zip** for ODT
- **Groq API** for summaries (text), OCR/image understanding (Llama 4 Scout Vision), and **speech-to-text** (Whisper Large V3 Turbo)

## Architecture

### Document Summarization Flow

1. **Text extraction** – Text is extracted by format:
   - **TXT**: Direct UTF-8 decode
   - **DOCX/DOC**: mammoth
   - **RTF**: rtf-parser
   - **ODT**: adm-zip + XML parsing
   - **SRT**: Custom parser (timestamps + speaker turns)
   - **PDF**: pdf-parse first; if text is empty or very short (< 50 chars), falls back to OCR
   - **Audio (MP3, WAV, M4A, etc.)**: Groq Whisper (`whisper-large-v3-turbo`) transcribes to text. If the user provided optional **Istilah teknis**, that string is passed as the Whisper API `prompt` on each audio chunk, then summarization proceeds as usual.

2. **Glossary for summarization** – When **Istilah teknis** is set, the same string is appended to the summarizer system prompt so technical spellings are preserved and the model has domain context (applies to documents and audio alike).

3. **PDF OCR fallback** – For scanned PDFs:
   - `pdf-to-img` converts pages to PNG images (scale 3, max 20 pages)
   - Each page is sent to Groq Vision API (`meta-llama/llama-4-scout-17b-16e-instruct`)
   - Extracted text is concatenated with `[Halaman N]` markers

4. **Chunking** – If text exceeds ~8,000 chars (~2,000 tokens):
   - Split at natural boundaries (paragraph, line, sentence)
   - Each chunk summarized separately with `llama-3.1-8b-instant`
   - 2.5 s delay between chunk requests to avoid rate limits

5. **Merge** – Chunk summaries are merged recursively until a single summary remains. Retries on 429 (rate limit) up to 3 times.

6. **Response** – Streamed as NDJSON: `progress` events, then `summary` or `error`.

### Segmented Summarize Flow

1. **Text extraction** – Documents: same as Summarize. Audio: if Hugging Face token provided, run `scripts/diarize_transcribe.py` (WhisperX + pyannote) for speaker-labeled transcript; otherwise Groq Whisper (single speaker).

2. **Format check** – LLM checks if text has "label and opinion" format (e.g., `Speaker: opinion`, `Topic: opinion`). If not, returns `no segmented opinion format`.

3. **Segmented summarization** – If format valid, LLM groups by topic and summarizes each speaker's opinion per topic in Indonesian, with stance labels: **pro** (mendukung), **con** (menentang), or **performative** (netral/formal).

4. **Response** – JSON with `summary` (topic-based, per-speaker opinions + stance) or `error` (e.g., `no segmented opinion format`).

### Models

| Purpose            | Model                                      |
|--------------------|--------------------------------------------|
| Text summarization | `llama-3.1-8b-instant`                     |
| PDF OCR (Vision)   | `meta-llama/llama-4-scout-17b-16e-instruct`|
| Audio transcription| `whisper-large-v3-turbo`                   |
| Segmented summarize| `llama-3.1-8b-instant`                     |
| Speaker diarization| WhisperX + pyannote (optional, Python)     |

### Limits

- Max file size: 500 MB (documents), 200 MB (audio)
- Max transcript length (meeting): 30,000 chars
- Max PDF pages for OCR: 20
