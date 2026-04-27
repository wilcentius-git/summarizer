# Kemenkum Summarizer

A web app for uploading documents and audio and getting AI-generated summaries, built for the IT Division of Kementerian Hukum.

## Features

- **Upload files** – File picker or drag and drop. **Documents** (PDF, DOCX, DOC, TXT, RTF, ODT, SRT) up to **500 MB**. **Audio** (MP3, WAV, M4A, WebM, FLAC, OGG) up to **200 MB**.
- **Summarize** – Extract text and summarize via Groq (**LLaMA**). Scanned PDFs use OCR (Groq Vision). Audio is transcribed with Groq Whisper (`whisper-large-v3-turbo`); long audio is chunked automatically (ffmpeg, with overlap).
- **Optional glossary** – **Istilah teknis (opsional)** holds domain terms (e.g. `PSSI, KPI, XSS, CI/CD`). Passed to Whisper as a transcription prompt and into the summarizer prompt for context and spelling.
- **Resume** – Jobs stopped by rate limits or cancellation can resume from partial transcription or partial chunk summaries.
- **History** – Past jobs show status, duration breakdown, and PDF export (signed via BSrE / Pusdatin TTE where configured).

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy env template and configure:

   ```bash
   cp .env.local.example .env.local
   ```

   | Variable | Description |
   |----------|-------------|
   | `DATABASE_URL` | **Required** for Prisma. Use PostgreSQL, e.g. `postgresql://USER:PASSWORD@localhost:5432/DBNAME` (see `docker-compose.yml` for a full stack example). |
   | `JWT_SECRET` | Secret for signing auth tokens (use a long random string). |
   | `GROQ_API_KEY` | Optional server-side Groq key; users can still enter **kunci groq sendiri (opsional)** in the UI. Also used by the rate-limit worker. |
   | `PUSDATIN_BEARER_TOKEN` | Bearer for Kemenkum **Simpeg login** (`login_simpeg`). The PDF signing route (`tte_sign`) uses the same e-arsip host; use the token your environment expects for those APIs. |
   | `SEED_ADMIN_PASSWORD` | For `npx prisma db seed` (admin user). Loaded from `.env.local` (see `prisma/seed.ts`). |

3. Start PostgreSQL (local dev, optional if you already have Postgres). From the project root:

   ```bash
   docker compose up db -d
   ```

   Point `DATABASE_URL` at the Compose `db` service, e.g. `postgresql://summarizer_user:changeme@localhost:5432/summarizer_db` (see `docker-compose.yml`). Skip this if you use another database.

4. Run migrations (Prisma is run via a helper that loads `.env.local`):

   ```bash
   npm run db:deploy
   ```

   For local schema iteration: `npm run db:migrate`. `npm run db:push` is available for prototyping without a migration.

5. **Run the app (development).** Starts Next.js and the rate-limit worker:

   ```bash
   npm run dev
   ```

6. Open [http://localhost:3000](http://localhost:3000), sign in with **NIP** via Simpeg. Optional Groq key in the form is cached ~1 hour in the browser (`sessionStorage`).

**Local HTTPS / Simpeg:** If Simpeg or TTE calls fail on certificate verification in dev, see comments in `.env.local.example` (never disable TLS verification in production).

## Build

```bash
npm run build
npm start
```

Worker only: `npm run worker` (or use `npm run start:all` to run Next + worker together).

## Docker

Preferred: **Docker Compose** (app + PostgreSQL + uploads volume):

```bash
docker compose up --build       # foreground; Ctrl+C to stop
docker compose up -d --build    # background; docker compose down to stop
```

Compose sets `DATABASE_URL`, `FFMPEG_PATH`, and `FFPROBE_PATH`. The `app` service loads optional `env_file` from `.env.local` (same as local dev) for `GROQ_API_KEY`, `JWT_SECRET`, `PUSDATIN_BEARER_TOKEN`, and other secrets.

**Image only:**

```bash
docker build -t summarizer .
```

The container runs `prisma migrate deploy` then `node server.js`. You must supply a valid **`DATABASE_URL`** (and other secrets) at run time—e.g. point at an external Postgres instance.

## Deploy (e.g. Vercel)

Provide **`DATABASE_URL`**, **`JWT_SECRET`**, and any **Pusdatin / Groq** secrets your deployment needs. Users can still paste their own Groq key in the app.

`/api/summarize` does not set a long `maxDuration` in code; platform limits apply. Long jobs are easier on Docker or a long-lived Node host. **`/api/summary-jobs/[id]/resume`** sets `maxDuration = 7200` (2 hours) for large resume work where the platform honors it.

## Architecture

### Summarization flow

1. **Text extraction**
   - **TXT**: UTF-8 decode  
   - **DOCX/DOC**: mammoth  
   - **RTF**: rtf-parser  
   - **ODT**: adm-zip + XML  
   - **SRT**: custom parser  
   - **PDF**: pdf-parse; OCR fallback if text is empty or very short (< 50 chars)  
   - **Audio**: Groq Whisper; files over **~5 min** or **~8 MB** are split with ffmpeg (~4 min segments, **2 s** overlap)—see `lib/audio-chunking.ts`

2. **PDF OCR** (when needed): `pdf-to-img` → Groq Vision (`meta-llama/llama-4-scout-17b-16e-instruct`), max **20** pages, `[Halaman N]` markers.

3. **Chunking** – Long text is split at natural boundaries. Default summarize chunk size is **~4,500** characters with **~6 s** between chunk requests and header-based pacing (`lib/summarize-pipeline.ts` → `SUMMARIZE_PIPELINE_STANDARD`).

4. **Merge** – Chunk summaries are merged in one or more Groq rounds. **429 / 524** responses are retried using API hints (e.g. `Retry-After`, message parsing) and configured delays between merge batches—not a single global “exponential backoff” policy everywhere.

5. **Streaming** – NDJSON lines: `progress`, `sourceText` (when applicable), `summary`, `error`.

### Job lifecycle

Statuses in Prisma (see `prisma/schema.prisma`):

| Status | Meaning |
|--------|---------|
| `pending` | Created, not started |
| `processing` | Running |
| `waiting_rate_limit` | Groq rate limited; worker or user can retry |
| `completed` | Done |
| `failed` | Error |
| `cancelled` | User cancelled |

Partial work can be resumed from history (**Lanjutkan**) when the backend still has transcript chunks or chunk summaries to continue from.

### Models

| Purpose | Model |
|---------|--------|
| Text summarization (incl. merge) | `llama-3.1-8b-instant` |
| PDF OCR (Vision) | `meta-llama/llama-4-scout-17b-16e-instruct` |
| Audio transcription | `whisper-large-v3-turbo` |

### Limits

| Item | Value |
|------|--------|
| Document upload | 500 MB |
| Audio upload | 200 MB |
| PDF pages (OCR) | 20 |
| Resume route (`/api/summary-jobs/[id]/resume`) | `maxDuration` 7200 s where supported |

## Tech

- **Frontend:** Next.js 16 (App Router), React 18, TypeScript, Tailwind CSS  
- **Backend / DB:** Prisma, **PostgreSQL** (`DATABASE_URL`)  
- **Auth:** JWT; **Simpeg** login (`lib/simpeg-login.ts`) with NIP  
- **AI:** Groq — Whisper for transcription, LLaMA for summarization (see Models)  
- **PDF:** pdf-parse; pdf-to-img + **@napi-rs/canvas** for OCR rasterization  
- **Documents:** mammoth, rtf-parser, adm-zip  
- **Audio:** ffmpeg (chunking), fluent-ffmpeg, @ffprobe-installer/ffprobe  
- **Export:** jsPDF; server route for **TTE** signing (`/api/sign-pdf`)
