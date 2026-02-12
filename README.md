# PDF Scanner

A simple web app to upload PDFs, compress them, and get AI-generated summaries.

## Features

- **Upload PDFs** – Add files via file picker or drag and drop (max 500 MB per file).
- **Compress** – Reduce PDF size; download the compressed file.
- **Summarize** – Extract text and get a concise summary via Google Gemini.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Download the bundled Ghostscript (runs automatically on `npm run build`, or run `npm run setup:ghostscript` once).

3. Set your Google (Gemini) API key for the summarization feature:

   - Copy `.env.local.example` to `.env.local`.
   - Add your key: `GOOGLE_API_KEY=your-key` (get one at [Google AI Studio](https://aistudio.google.com/apikey))

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

Ghostscript is automatically used on Vercel. The build downloads a Linux Ghostscript binary during `npm run build` (Linux only). No extra setup needed—just deploy:

```bash
vercel
```

Or connect your repo to [Vercel](https://vercel.com) for automatic deployments.

## Compression (Ghostscript)

The compressor uses a **bundled Ghostscript Linux binary** (same for local and Vercel). The binary is downloaded during `npm run build` or via `npm run setup:ghostscript`.

**Run locally with Linux:** Use WSL, Docker, or native Linux so the Linux binary can run. On Windows without WSL/Docker, install Ghostscript and add `bin/ghostscript` manually, or run the app in WSL/Docker.

## Tech

- Next.js 14 (App Router), React 18, TypeScript
- **Ghostscript** for PDF compression, `pdf-parse` for text extraction, Google Gemini API for summaries
