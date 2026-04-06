export function getJwtSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required. Set it in .env.local");
  }
  return new TextEncoder().encode(secret);
}
