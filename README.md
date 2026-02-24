# Document Summarizer

A simple web app to upload documents and get AI-generated summaries.

## Features

- **Upload documents** – Add files via file picker or drag and drop (max 500 MB per file). Supports: **PDF**, **DOCX**, **DOC**, **TXT**, **RTF**, **ODT**, **SRT**.
- **Summarize** – Extract text and get a concise summary via Groq (Llama). Supports scanned PDFs via OCR and image understanding (Groq Vision).
- **Summarize Meeting** – Analyze meeting transcripts to extract participant stances, alignment risks, and agreement confidence (Indonesian business conversations).

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

## Build

```bash
npm run build
npm start
```

## Deploy to Vercel

No environment variables needed—users enter their own Groq API key in the app:

```bash
vercel
```

Or connect your repo to [Vercel](https://vercel.com) for automatic deployments.

## Tech

- Next.js 14 (App Router), React 18, TypeScript
- **pdf-parse** for PDF text extraction; **pdf-to-img** for PDF-to-image when text is missing (scanned PDFs)
- **mammoth** for DOCX/DOC text extraction; **rtf-parser** for RTF; **adm-zip** for ODT
- **Groq API** for summaries (text) and OCR/image understanding (Llama 4 Scout Vision)

## Architecture

### Document Summarization Flow

1. **Text extraction** – Text is extracted by format:
   - **TXT**: Direct UTF-8 decode
   - **DOCX/DOC**: mammoth
   - **RTF**: rtf-parser
   - **ODT**: adm-zip + XML parsing
   - **SRT**: Custom parser (timestamps + speaker turns)
   - **PDF**: pdf-parse first; if text is empty or very short (< 50 chars), falls back to OCR

2. **PDF OCR fallback** – For scanned PDFs:
   - `pdf-to-img` converts pages to PNG images (scale 3, max 20 pages)
   - Each page is sent to Groq Vision API (`meta-llama/llama-4-scout-17b-16e-instruct`)
   - Extracted text is concatenated with `[Halaman N]` markers

3. **Chunking** – If text exceeds ~8,000 chars (~2,000 tokens):
   - Split at natural boundaries (paragraph, line, sentence)
   - Each chunk summarized separately with `llama-3.1-8b-instant`
   - 2.5 s delay between chunk requests to avoid rate limits

4. **Merge** – Chunk summaries are merged recursively until a single summary remains. Retries on 429 (rate limit) up to 3 times.

5. **Response** – Streamed as NDJSON: `progress` events, then `summary` or `error`.

### Meeting Analysis Flow

1. **Text extraction** – Same as above. Transcript truncated to 30,000 chars if longer.

2. **Normalization** – `normalizeTranscript()` parses `Speaker: text` turns, strips Indonesian prefixes (Bpk., Ibu, Pak, Bu), merges continuation lines.

3. **LLM analysis** – Single Groq call with `llama-3.1-8b-instant`:
   - System prompt: meeting analysis engine, stance classification (support/mixed/oppose), risk types (hedging, deflection, vagueness, etc.)
   - User prompt: leader name/position, transcript, task description

4. **Post-processing** – Parse JSON, merge duplicate speakers, derive `agreement_confidence` from stances when missing.

5. **Response** – JSON with `leader`, `participants` (points, risks, summary per person).

### Models

| Purpose            | Model                                      |
|--------------------|--------------------------------------------|
| Text summarization | `llama-3.1-8b-instant`                     |
| PDF OCR (Vision)   | `meta-llama/llama-4-scout-17b-16e-instruct`|
| Meeting analysis   | `llama-3.1-8b-instant`                     |

### Limits

- Max file size: 500 MB
- Max transcript length (meeting): 30,000 chars
- Max PDF pages for OCR: 20
