# PDF Scanner

A simple web app to upload PDFs, compress them, and get AI-generated summaries.

## Features

- **Upload PDFs** – Add files via file picker or drag and drop (max 500 MB per file).
- **Compress** – Reduce PDF size; download the compressed file.
- **Summarize** – Extract text and get a concise summary via Groq (Llama). Supports scanned PDFs via OCR and image understanding (Groq Vision).

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Download Ghostscript (runs automatically on `npm run build`, or run `npm run setup:ghostscript` once):

   - **Windows:** Downloads and installs Ghostscript 9.54 to `bin/ghostscript/` (may require approving the installer).
   - **Linux:** Downloads the Linux binary (for Vercel, WSL, or native Linux).

3. Set your Groq API key for the summarization feature:

   - Copy `.env.local.example` to `.env.local`.
   - Add your key: `GROQ_API_KEY=your-key` (get a free key at [console.groq.com](https://console.groq.com))

4. Run the dev server:

   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000).

## Build

```bash
npm run build
npm start
```

## Deploy to Vercel

Ghostscript is automatically used on Vercel. The build downloads a Linux Ghostscript binary during `npm run build`. Set `GROQ_API_KEY` in your Vercel project environment variables. No extra setup needed—just deploy:

```bash
vercel
```

Or connect your repo to [Vercel](https://vercel.com) for automatic deployments.

## Compression (Ghostscript)

The compressor uses a **bundled Ghostscript binary** downloaded during `npm run build` or via `npm run setup:ghostscript`:

- **Windows:** Ghostscript 9.54 is installed to `bin/ghostscript/` (no PATH changes needed).
- **Linux:** Linux binary from shelfio (for Vercel, WSL, or native Linux).

If the automatic download fails on Windows, [install Ghostscript manually](https://ghostscript.com/releases/gsdnld.html) and copy `gswin64c.exe` (and its folder) to `bin/ghostscript/`.

## Tech

- Next.js 14 (App Router), React 18, TypeScript
- **Ghostscript** for PDF compression
- **pdf-parse** for text extraction; **pdfjs-dist** + **@napi-rs/canvas** for PDF-to-image when text is missing (scanned PDFs)
- **Groq API** for summaries (text) and OCR/image understanding (Llama 4 Scout Vision)
