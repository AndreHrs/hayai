import { SignJWT, jwtVerify } from "jose";
import { config } from "../config/env";

const secret = new TextEncoder().encode(config.jwtSecret);

export interface JWTPayload {
  userId: string;
  email: string;
  role?: string;
  [key: string]: any;
}

export async function signJWT(payload: JWTPayload): Promise<string> {
  const jwt = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(config.jwtExpiration)
    .sign(secret);

  return jwt;
}

export async function verifyJWT(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, secret);
  return payload as JWTPayload;
}
