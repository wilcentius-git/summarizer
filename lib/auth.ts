import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcrypt";
import { getJwtSecretKey } from "./jwt-secret";

const JWT_EXPIRY = "5h";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createToken(payload: { userId: string; email: string }): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(JWT_EXPIRY)
    .setIssuedAt()
    .sign(getJwtSecretKey());
}

export async function verifyToken(token: string): Promise<{ userId: string; email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecretKey());
    const userId = payload.userId as string;
    const email = payload.email as string;
    if (userId && email) return { userId, email };
    return null;
  } catch {
    return null;
  }
}
