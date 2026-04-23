import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import https, { request as httpsRequest } from "node:https";
import { URL } from "node:url";

import { verifyToken } from "@/lib/auth";

const TTE_SIGN_URL = "https://e-arsip.kemenkum.go.id/index.php/api/tte_sign";

const insecureHttpsAgent = new https.Agent({ rejectUnauthorized: false });

function buildMultipartFormBody(
  textFields: { name: string; value: string }[],
  file: { fieldName: string; filename: string; data: Buffer; contentType: string }
): { body: Buffer; boundary: string } {
  const boundary = `----formDataSummarizer${Date.now()}`;
  const eol = "\r\n";
  const chunks: Buffer[] = [];

  for (const f of textFields) {
    const header = Buffer.from(
      `--${boundary}${eol}Content-Disposition: form-data; name="${f.name}"${eol}${eol}${f.value}${eol}`,
      "utf-8"
    );
    chunks.push(header);
  }

  const safeName = file.filename.replace(/["\r\n]/g, "_");
  const fileHeader = Buffer.from(
    `--${boundary}${eol}Content-Disposition: form-data; name="${file.fieldName}"; filename="${safeName}"${eol}Content-Type: ${file.contentType}${eol}${eol}`,
    "utf-8"
  );
  chunks.push(fileHeader, file.data, Buffer.from(eol, "utf-8"));
  chunks.push(Buffer.from(`--${boundary}--${eol}`, "utf-8"));
  return { body: Buffer.concat(chunks), boundary };
}

function postHttpsBuffer(
  urlStr: string,
  body: Buffer,
  headers: Record<string, string>
): Promise<{ statusCode: number; text: string }> {
  const url = new URL(urlStr);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        port: url.port || 443,
        method: "POST",
        agent: insecureHttpsAgent,
        headers: {
          ...headers,
          "Content-Length": String(body.length),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => {
          chunks.push(c);
        });
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString("utf-8"),
          });
        });
        res.on("error", reject);
      }
    );
    req.setTimeout(120_000, () => {
      req.destroy(new Error("Request timeout"));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

const GENERIC_ERROR = "Terjadi kesalahan.";

/** Residual error after the happy path; `success: true` here means no usable file. */
function extractPusdatinErrorMessage(json: object): string {
  if ("success" in json && json.success === true) return GENERIC_ERROR;
  const msg = (json as { msg?: unknown }).msg;
  return typeof msg === "string" && msg.trim() ? msg : GENERIC_ERROR;
}

export async function POST(request: NextRequest) {
  const bearer = process.env.PUSDATIN_BEARER_TOKEN;
  if (!bearer?.trim()) {
    return NextResponse.json(
      { error: "Konfigurasi Pusdatin tidak tersedia (PUSDATIN_BEARER_TOKEN)." },
      { status: 500 }
    );
  }

  const token = (await cookies()).get("auth-token")?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const passphrase = String((formData.get("passphrase") as string | null) ?? "").trim();
  const nip = String((formData.get("nip") as string | null) ?? "").trim();
  const file = formData.get("file");

  if (!passphrase || !nip) {
    return NextResponse.json({ error: "Passphrase dan NIP wajib diisi." }, { status: 400 });
  }

  if (nip !== payload.userId) {
    return NextResponse.json({ error: "NIP tidak sesuai akun." }, { status: 400 });
  }

  if (!file || !(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Berkas PDF wajib diunggah." }, { status: 400 });
  }

  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    return NextResponse.json({ error: "Hanya berkas PDF yang didukung." }, { status: 400 });
  }

  const fileBuf = Buffer.from(await file.arrayBuffer());
  const { body, boundary } = buildMultipartFormBody(
    [
      { name: "passphrase", value: passphrase },
      { name: "nip", value: nip },
    ],
    {
      fieldName: "file",
      filename: file.name || "document.pdf",
      data: fileBuf,
      contentType: file.type && file.type !== "application/octet-stream" ? file.type : "application/pdf",
    }
  );

  let text: string;
  try {
    text = (
      await postHttpsBuffer(TTE_SIGN_URL, body, {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      })
    ).text;
  } catch (e) {
    console.error("sign-pdf upstream:", e);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 });
  }

  const json: unknown = (() => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  })();
  if (json === null || typeof json !== "object") {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 });
  }

  if ("success" in json && json.success === true) {
    const f = (json as { success: true; file: unknown }).file;
    if (typeof f === "string" && f.length > 0) {
      return NextResponse.json({ file: f });
    }
  }

  return NextResponse.json(
    { error: extractPusdatinErrorMessage(json) },
    { status: 400 }
  );
}
