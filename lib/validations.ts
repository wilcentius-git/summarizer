import { z } from "zod";

export const loginSchema = z.object({
  nip: z.string().min(1, "NIP is required").trim(),
  pass: z.string().min(1, "Password is required"),
});
