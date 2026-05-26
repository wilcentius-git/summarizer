import { z } from "zod";

export const loginSchema = z.object({
  nip: z.string().min(1, "NIP is required").max(30, "NIP tidak valid").trim(),
  pass: z.string().min(1, "Password is required").max(200, "Password terlalu panjang"),
});

export const whitelistNipSchema = z.object({
  nip: z
    .string()
    .trim()
    .min(1, "NIP is required")
    .max(30, "NIP tidak valid"),
});
