import "server-only";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { z } from "zod";

export const LinkCode = z.string().regex(/^[A-Za-z0-9_-]{32}$/);
const TRUSTED_ORIGIN = "https://venturelens-l2q2.onrender.com";
const REDEEM_PATH = "/api/internal/v1/link/redeem";
const REVOKE_PATH = "/api/internal/v1/link/revoke";
const MAX_RESPONSE_BYTES = 2_048;

type LinkResult =
  | { status: "linked" | "revoked"; revoked?: boolean }
  | { status: "conflict" | "unavailable" };

/** Signs the exact bytes of a fixed-path POST. Never takes user-supplied URLs. */
export async function updateLegacyLink(
  userId: string, operation: "redeem" | "revoke", code?: string,
): Promise<LinkResult> {
  const secret = process.env.VENTRIVA_BRIDGE_SECRET;
  if (!secret || secret.length < 32 ||
      process.env.VENTRIVA_BRIDGE_ORIGIN !== TRUSTED_ORIGIN ||
      !z.uuid().safeParse(userId).success) return { status: "unavailable" };
  if (operation === "redeem" && (!code || !LinkCode.safeParse(code).success)) {
    return { status: "conflict" };
  }
  const path = operation === "redeem" ? REDEEM_PATH : REVOKE_PATH;
  const body = operation === "redeem" ? JSON.stringify({ code }) : "{}";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID();
  const digest = createHash("sha256").update(body).digest("hex");
  const signature = createHmac("sha256", secret)
    .update(`POST\n${path}\n${userId}\n${timestamp}\n${nonce}\n${digest}`).digest("hex");
  try {
    const response = await fetch(`${TRUSTED_ORIGIN}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bridge-user-id": userId,
        "x-bridge-timestamp": timestamp,
        "x-bridge-nonce": nonce,
        "x-bridge-signature": signature,
        "x-request-id": randomUUID(),
      },
      body,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 409) return { status: "conflict" };
    if (!response.ok) return { status: "unavailable" };
    const size = response.headers.get("content-length");
    if (size && Number(size) > MAX_RESPONSE_BYTES) return { status: "unavailable" };
    if (!response.body) return { status: "unavailable" };
    const reader = response.body.getReader();
    let length = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_RESPONSE_BYTES) return { status: "unavailable" };
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const raw = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.length; }
    const parsed = JSON.parse(new TextDecoder().decode(raw)) as unknown;
    if (operation === "redeem") {
      if (z.object({ status: z.literal("linked") }).strict().safeParse(parsed).success) {
        return { status: "linked" };
      }
    } else {
      const valid = z.object({ revoked: z.boolean() }).strict().safeParse(parsed);
      if (valid.success) return { status: "revoked", revoked: valid.data.revoked };
    }
    return { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
