import "server-only";

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const COOKIE_NAME = "session";
const SESSION_DURATION = "30d";
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

function requireSecretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRETが設定されていません。.env.localに設定してください。");
  }
  return new TextEncoder().encode(secret);
}

type SessionPayload = {
  authenticated: true;
};

async function encrypt(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(requireSecretKey());
}

async function decrypt(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, requireSecretKey(), { algorithms: ["HS256"] });
    if (payload.authenticated !== true) return null;
    return { authenticated: true };
  } catch {
    return null;
  }
}

export async function createSession(): Promise<void> {
  const session = await encrypt({ authenticated: true });
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, session, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    expires: new Date(Date.now() + SESSION_DURATION_MS),
    path: "/",
  });
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

/** True if the request carries a valid session cookie. Used both in
 * proxy.ts (optimistic redirect) and in every Route Handler (authoritative
 * check) -- per Next.js's auth guide, proxy alone should not be the only
 * line of defense. */
export async function verifySession(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = await decrypt(token);
  return payload !== null;
}
