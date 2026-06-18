import { z } from "zod";

export const loginSchema = z.object({
  nip: z.string().min(1, "NIP is required").max(30, "NIP tidak valid").trim(),
  pass: z.string().min(1, "Password is required").max(200, "Password terlalu panjang"),
});

export const whitelistNipSchema = z.object({
  nip: z
    .string()
    .trim()
    .regex(/^\d{18}$/, "NIP harus terdiri dari 18 digit angka"),
  satuanKerjaId: z.string().trim().min(1, "Satuan kerja wajib dipilih"),
});

export const satuanKerjaNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Nama satuan kerja wajib diisi")
    .max(200, "Nama terlalu panjang"),
});

export const whitelistSatuanKerjaSchema = z.object({
  satuanKerjaId: z.string().trim().min(1, "Satuan kerja wajib dipilih"),
});
