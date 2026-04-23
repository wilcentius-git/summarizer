import { z } from "zod";

const SIMPEG_LOGIN_URL =
  "https://e-arsip.kemenkum.go.id/index.php/api/login_simpeg";

const simpegSuccessSchema = z.object({
  success: z.literal(true),
  data: z.object({
    nip: z.string(),
    name: z.string().optional(),
    foto: z.string().optional(),
  }),
});

const simpegFailureSchema = z.object({
  success: z.literal(false),
});

export type SimpegLoginResult =
  | { ok: true; nip: string; name?: string }
  | { ok: false; reason: "invalid_credentials" | "bad_response" }
  | { ok: false; reason: "config"; message: string };

export async function loginViaSimpeg(
  nip: string,
  pass: string
): Promise<SimpegLoginResult> {
  const bearer = process.env.PUSDATIN_BEARER_TOKEN;
  if (!bearer) {
    return { ok: false, reason: "config", message: "PUSDATIN_BEARER_TOKEN is not set" };
  }

  const controller = new AbortController();
  const timeoutMs = 20_000;
  const tid = setTimeout(() => controller.abort(), timeoutMs);

  const requestBody = JSON.stringify({ user: nip, pass });
  console.log("[Pusdatin] before fetch", { nip });

  let res: Response;
  try {
    res = await fetch(SIMPEG_LOGIN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bearer}`,
      },
      body: requestBody,
      signal: controller.signal,
    });
  } catch (e) {
    console.error("[Pusdatin] fetch threw:", e);
    return { ok: false, reason: "bad_response" };
  } finally {
    clearTimeout(tid);
  }

  let responseText: string;
  try {
    responseText = await res.text();
  } catch (e) {
    console.error("[Pusdatin] reading response body failed:", e);
    return { ok: false, reason: "bad_response" };
  }

  console.log("[Pusdatin] after fetch", { status: res.status });

  let json: unknown;
  try {
    json = JSON.parse(responseText);
  } catch {
    return { ok: false, reason: "bad_response" };
  }

  const fail = simpegFailureSchema.safeParse(json);
  if (fail.success) {
    return { ok: false, reason: "invalid_credentials" };
  }

  const success = simpegSuccessSchema.safeParse(json);
  if (success.success) {
    const data = success.data.data;
    return {
      ok: true,
      nip: data.nip,
      ...(data.name !== undefined && data.name !== ""
        ? { name: data.name }
        : {}),
    };
  }

  return { ok: false, reason: "bad_response" };
}
