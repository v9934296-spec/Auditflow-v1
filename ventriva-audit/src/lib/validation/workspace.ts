import "server-only";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { readBounded, TRUSTED_ORIGIN } from "./bridge";

export const WorkspaceIdea = z.object({
  requestId: z.uuid(),
  kind: z.enum(["preview", "full"]),
  name: z.string().trim().min(1).max(150),
  concept: z.string().trim().min(1).max(4000),
  target_customer: z.string().trim().max(2000),
});

const reportSchema = z.object({
  name: z.string(),
  status: z.string(),
  progress: z.string().nullable(),
  kind: z.enum(["preview", "full"]),
  report: z.record(z.string(), z.json()).nullable(),
  sources: z.array(z.object({ title: z.string().optional(), url: z.string() })),
});
const createdSchema = z.object({ id: z.uuid() });

async function requestLegacy<T>(
  userId: string, operation: "create" | "read", data: object, schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  const origin = process.env.VENTRIVA_BRIDGE_ORIGIN;
  const secret = process.env.VENTRIVA_BRIDGE_SECRET;
  if (origin !== TRUSTED_ORIGIN || !secret || secret.length < 32 || !z.uuid().safeParse(userId).success) {
    return { ok: false, status: 503 };
  }
  const path = "/api/internal/v1/analyses/" + operation;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID();
  const body = JSON.stringify(data);
  const digest = createHash("sha256").update(body).digest("hex");
  const signature = createHmac("sha256", secret)
    .update(`POST\n${path}\n${userId}\n${timestamp}\n${nonce}\n${digest}`).digest("hex");
  try {
    const response = await fetch(origin + path, {
      method: "POST", body, cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "content-type": "application/json", "x-bridge-user-id": userId, "x-bridge-timestamp": timestamp,
        "x-bridge-nonce": nonce, "x-bridge-signature": signature,
      },
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, status: [402, 404, 409].includes(response.status) ? response.status : 503 };
    }
    const parsed = schema.safeParse(await readBounded(response, 1_048_576));
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, status: 503 };
  } catch {
    return { ok: false, status: 503 };
  }
}

export function startWorkspaceAnalysis(userId: string, input: z.infer<typeof WorkspaceIdea>) {
  const { kind, requestId, ...idea } = input;
  return requestLegacy(userId, "create", { kind, request_id: requestId, idea }, createdSchema);
}

export function readWorkspaceAnalysis(userId: string, id: string) {
  return requestLegacy(userId, "read", { id }, reportSchema);
}
