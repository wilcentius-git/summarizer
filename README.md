# Document Summarizer

A simple web app to upload documents and get AI-generated summaries.

## Features

- **Upload documents** – Add files via file picker or drag and drop (max 500 MB per file). Supports: **PDF**, **DOCX**, **DOC**, **TXT**, **RTF**, **ODT**.
- **Summarize** – Extract text and get a concise summary via Groq (Llama). Supports scanned PDFs via OCR and image understanding (Groq Vision).

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
- **pdf-parse** for PDF text extraction; **pdfjs-dist** + **@napi-rs/canvas** for PDF-to-image when text is missing (scanned PDFs)
- **mammoth** for DOCX/DOC text extraction; **rtf-parser** for RTF; **adm-zip** for ODT
- **Groq API** for summaries (text) and OCR/image understanding (Llama 4 Scout Vision)
