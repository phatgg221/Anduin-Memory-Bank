// Server-side only (used by proxy.ts): verifies the refresh-token cookie issued by the FastAPI backend.
import { errors, jwtVerify } from "jose";

/** Must match REFRESH_COOKIE in backend/app/modules/auth/router.py. */
export const REFRESH_COOKIE = "dejavu_refresh";

export interface VerifiedSession {
  userId: string;
}

let secretKey: Uint8Array | null = null;

function getSecretKey(): Uint8Array {
  if (!secretKey) {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
      // Fail closed and loudly: without the backend's secret no session can be verified.
      throw new Error("JWT_SECRET is missing for the frontend. It must be the same value the backend uses (.env).");
    }
    secretKey = new TextEncoder().encode(secret); // PyJWT signs HS256 with the UTF-8 bytes of the same string
  }
  return secretKey;
}

export async function verifyRefreshToken(token: string | undefined): Promise<VerifiedSession | null> {
  if (!token) return null;
  const key = getSecretKey();
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
      requiredClaims: ["sub", "jti", "exp", "type"],
    });
    if (payload.type !== "refresh" || typeof payload.sub !== "string") return null;
    return { userId: payload.sub };
  } catch (error) {
    if (error instanceof errors.JWSSignatureVerificationFailed) {
      console.warn(
        "[proxy] Refresh cookie has an invalid signature — is JWT_SECRET identical for frontend and backend?",
      );
    }
    return null;
  }
}
