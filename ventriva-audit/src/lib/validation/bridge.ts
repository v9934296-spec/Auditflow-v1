import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";

export const LegacyAnalysis = z.object({
  id: z.string().min(1).max(100),
  name: z.string().max(150),
  status: z.string().max(32),
  kind: z.enum(["preview", "full"]),
  created_at: z.string().max(64),
}).strict();
export const LegacyAnalysisList = z.object({
  analyses: z.array(LegacyAnalysis).max(20),
}).strict();

const BRIDGE_PATH = "/api/internal/v1/analyses";
const MAX_BYTES = 65_536;
const TRUSTED_ORIGIN = "https://venturelens-l2q2.onrender.com";

export type BridgeResult =
  | { status: "ok"; analyses: z.infer<typeof LegacyAnalysis>[] }
  | { status: "not_linked" | "unavailable" };

async function readBounded(response: Response): Promise<unknown> {
  const size = response.headers.get("content-length");
  if (size && Number(size) > MAX_BYTES) throw new Error("bridge response too large");
  if (!response.body) throw new Error("bridge response empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new Error("bridge response too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(joined));
}

/** Internal server-to-server read. No browser credential, legacy JWT or user-chosen URL. */
export async function listLinkedAnalyses(userId: string): Promise<BridgeResult> {
  const secret = process.env.VENTRIVA_BRIDGE_SECRET;
  const origin = process.env.VENTRIVA_BRIDGE_ORIGIN;
  if (!secret || secret.length < 32 || origin !== TRUSTED_ORIGIN) return { status: "unavailable" };
  if (!z.uuid().safeParse(userId).success) return { status: "unavailable" };

  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secret)
    .update(`GET\n${BRIDGE_PATH}\n${userId}\n${timestamp}`)
    .digest("hex");
  const traceId = randomUUID();

  try {
    const response = await fetch(`${TRUSTED_ORIGIN}${BRIDGE_PATH}`, {
      method: "GET",
      headers: {
        "x-bridge-user-id": userId,
        "x-bridge-timestamp": timestamp,
        "x-bridge-signature": signature,
        "x-request-id": traceId,
        "accept": "application/json",
      },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 404) return { status: "not_linked" };
    if (!response.ok) return { status: "unavailable" };
    const parsed = LegacyAnalysisList.safeParse(await readBounded(response));
    if (!parsed.success) return { status: "unavailable" };
    return { status: "ok", analyses: parsed.data.analyses };
  } catch {
    return { status: "unavailable" };
  }
}
