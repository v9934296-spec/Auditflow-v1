import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { App } from "@octokit/app";
import { serverEnv } from "@/lib/env";

/**
 * GitHub App integration. Required app permissions (set in GitHub → Developer settings):
 *   Repository: Contents = Read-only, Metadata = Read-only
 *   Subscribe to events: Installation, Installation repositories, Push
 *   "Request user authorization (OAuth) during installation" = enabled
 * No write permissions are ever requested.
 */

let app: App | null = null;

export function githubApp(): App {
  if (app) return app;
  const env = serverEnv();
  app = new App({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    oauth: { clientId: env.GITHUB_APP_CLIENT_ID, clientSecret: env.GITHUB_APP_CLIENT_SECRET },
    webhooks: { secret: env.GITHUB_WEBHOOK_SECRET },
  });
  return app;
}

// ───────────────────────── Install state (CSRF + user binding) ─────────────────────────

const STATE_TTL_MS = 15 * 60 * 1000;

function sign(payload: string): string {
  return createHmac("sha256", serverEnv().STATE_SIGNING_SECRET).update(payload).digest("base64url");
}

export function createInstallState(userId: string): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString("base64url");
  const payload = `${userId}.${nonce}.${Date.now() + STATE_TTL_MS}`;
  return { state: `${payload}.${sign(payload)}`, nonce };
}

export function verifyInstallState(state: string, userId: string, cookieNonce: string | undefined): boolean {
  const parts = state.split(".");
  if (parts.length !== 4 || !cookieNonce) return false;
  const [uid, nonce, exp, sig] = parts as [string, string, string, string];
  const expected = sign(`${uid}.${nonce}.${exp}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  if (uid !== userId || nonce !== cookieNonce) return false;
  return Number(exp) > Date.now();
}

export function installUrl(state: string): string {
  return `https://github.com/apps/${serverEnv().GITHUB_APP_SLUG}/installations/new?state=${encodeURIComponent(state)}`;
}

// ───────────────────────── Ownership verification ─────────────────────────

/**
 * Exchanges the OAuth code GitHub sends with the setup callback and confirms the
 * signed-in GitHub user actually has access to `installationId`. Without this,
 * anyone could claim someone else's installation id.
 */
export async function verifyInstallationAccess(code: string, installationId: number): Promise<{ ok: boolean; login?: string }> {
  const env = serverEnv();
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: env.GITHUB_APP_CLIENT_ID, client_secret: env.GITHUB_APP_CLIENT_SECRET, code }),
  });
  if (!tokenRes.ok) return { ok: false };
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
  if (!access_token) return { ok: false };
  const headers = { authorization: `Bearer ${access_token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
  try {
    for (let page = 1; page <= 10; page++) {
      const res = await fetch(`https://api.github.com/user/installations?per_page=100&page=${page}`, { headers });
      if (!res.ok) return { ok: false };
      const json = (await res.json()) as { installations: { id: number; account: { login: string } | null }[] };
      const hit = json.installations.find((i) => i.id === installationId);
      if (hit) return { ok: true, login: hit.account?.login };
      if (json.installations.length < 100) break;
    }
    return { ok: false };
  } finally {
    // Revoke the user token immediately; we only needed it for this check.
    await fetch(`https://api.github.com/applications/${env.GITHUB_APP_CLIENT_ID}/token`, {
      method: "DELETE",
      headers: { authorization: `Basic ${Buffer.from(`${env.GITHUB_APP_CLIENT_ID}:${env.GITHUB_APP_CLIENT_SECRET}`).toString("base64")}`, accept: "application/vnd.github+json", "content-type": "application/json" },
      body: JSON.stringify({ access_token }),
    }).catch(() => undefined);
  }
}

// ───────────────────────── Repository access ─────────────────────────

export interface GithubRepo {
  id: number;
  full_name: string;
  default_branch: string;
  private: boolean;
}

export async function getInstallation(installationId: number): Promise<{ login: string; type: string }> {
  const res = await githubApp().octokit.request("GET /app/installations/{installation_id}", { installation_id: installationId });
  const account = res.data.account as { login?: string; slug?: string; type?: string } | null;
  return { login: account?.login ?? account?.slug ?? "unknown", type: account?.type ?? "Organization" };
}

export async function listInstallationRepos(installationId: number): Promise<GithubRepo[]> {
  const octokit = await githubApp().getInstallationOctokit(installationId);
  const out: GithubRepo[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = await octokit.request("GET /installation/repositories", { per_page: 100, page });
    const repos = res.data.repositories as GithubRepo[];
    out.push(...repos.map((r) => ({ id: r.id, full_name: r.full_name, default_branch: r.default_branch, private: r.private })));
    if (repos.length < 100) break;
  }
  return out;
}

/** Short-lived token restricted to ONE repository with contents:read. */
export async function repoScopedToken(installationId: number, githubRepoId: number): Promise<string> {
  const res = await githubApp().octokit.request("POST /app/installations/{installation_id}/access_tokens", {
    installation_id: installationId,
    repository_ids: [githubRepoId],
    permissions: { contents: "read", metadata: "read" },
  });
  return res.data.token;
}

function ghHeaders(token: string) {
  return { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "ventriva-audit" };
}

export async function resolveHeadSha(token: string, fullName: string, branch: string): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${fullName}/commits/${encodeURIComponent(branch)}`, { headers: { ...ghHeaders(token), accept: "application/vnd.github.sha" } });
  if (!res.ok) throw new Error(`Could not resolve ${fullName}@${branch} (HTTP ${res.status}).`);
  return (await res.text()).trim();
}

export async function downloadTarball(token: string, fullName: string, sha: string, maxBytes: number): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(`https://api.github.com/repos/${fullName}/tarball/${sha}`, { headers: ghHeaders(token), redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Tarball download failed (HTTP ${res.status}).`);
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > maxBytes) {
    await res.body.cancel();
    throw new Error(`Repository archive is ${Math.round(len / 1024 / 1024)} MB, above this tier's limit.`);
  }
  return res.body;
}

/** Files changed between two commits, or null when the diff is too large to enumerate. */
export async function changedFiles(token: string, fullName: string, base: string, head: string): Promise<Set<string> | null> {
  if (base === head) return new Set();
  const res = await fetch(`https://api.github.com/repos/${fullName}/compare/${base}...${head}?per_page=300`, { headers: ghHeaders(token) });
  if (!res.ok) return null;
  const json = (await res.json()) as { files?: { filename: string; previous_filename?: string }[] };
  if (!json.files || json.files.length >= 300) return null;
  return new Set(json.files.flatMap((f) => [f.filename, ...(f.previous_filename ? [f.previous_filename] : [])]));
}
