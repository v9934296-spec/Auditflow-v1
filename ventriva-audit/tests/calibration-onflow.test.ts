import { describe, expect, it } from "vitest";
import { memoryIndex } from "@/lib/analysis/files";
import { analyzeRepository } from "@/lib/analysis/pipeline";
import type { FetchLike } from "@/lib/analysis/scanners/osv";

/**
 * Regression tests for the five reproduced false findings from the OnFlow
 * calibration trial (docs/dependable-promise.md, "Re-test 2026-11-20").
 * Each fix has a test proving the false finding is gone, plus two positive
 * controls proving the detectors were not neutered: a real secret in a real
 * .env file is still a P0, and a real outgoing localhost request is still
 * flagged. The fixtures are minimal slices of the OnFlow layout, not the
 * whole repo.
 */
const noVulns: FetchLike = async (url) => {
  if (url.endsWith("/querybatch")) return new Response(JSON.stringify({ results: new Array(1000).fill({}) }));
  return new Response("{}", { status: 404 });
};

const audit = (repo: Record<string, string>) =>
  analyzeRepository(memoryIndex(repo), { kind: "full_audit", fetchImpl: noVulns, disableSemgrep: true });

const CORS_MAIN_PY = [
  "from fastapi import FastAPI",
  "from fastapi.middleware.cors import CORSMiddleware",
  "",
  "app = FastAPI()",
  "",
  'origins = ["http://localhost:8081", "http://localhost:19006"]',
  "",
  "app.add_middleware(",
  "    CORSMiddleware,",
  "    allow_origins=origins,",
  "    allow_credentials=True,",
  '    allow_methods=["*"],',
  '    allow_headers=["*"],',
  ")",
  "",
].join("\n");

describe("calibration — commented example URL is not a secret", async () => {
  const result = await audit({
    "services/api/.env.example":
      "# Example environment for the API. Copy to .env and fill in real values.\n" +
      "# ONFLOW_REDIS_URL=redis://default:password@redis.railway.internal:6379\n",
  });

  it("does not flag the commented-out example URL in .env.example", () => {
    expect(result.findings.map((f) => f.ruleId)).not.toContain("secrets.db-url-with-password");
  });
});

describe("calibration — positive control: real DB URL in a real .env is still a P0", async () => {
  const result = await audit({
    ".env": "DATABASE_URL=postgres://appuser:s3cretpass@db.internal:5432/appdb\n",
  });

  it("flags the uncommented database URL as a verified P0", () => {
    const finding = result.findings.find((f) => f.ruleId === "secrets.db-url-with-password")!;
    expect(finding).toBeDefined();
    expect(finding.priority).toBe("P0");
    expect(finding.tier).toBe("verified");
    expect(finding.filePath).toBe(".env");
  });
});

describe("calibration — custom Google + JWT auth is recognised", async () => {
  const result = await audit({
    "services/api/app/core/auth.py": [
      "import jwt",
      "from datetime import datetime, timedelta",
      "",
      'SECRET_KEY = "change-me-in-production"',
      "",
      "def create_access_token(data: dict) -> str:",
      '    return jwt.encode({**data, "exp": datetime.utcnow() + timedelta(hours=1)}, SECRET_KEY, algorithm="HS256")',
      "",
      "def get_current_user(token: str):",
      '    payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])',
      '    return payload.get("sub")',
      "",
    ].join("\n"),
    "services/api/app/routers/oauth_signin.py": [
      "from google.oauth2 import id_token",
      "from google.auth.transport import requests",
      "",
      "def verify_google_id_token(token: str):",
      "    return id_token.verify_oauth2_token(token, requests.Request(), CLIENT_ID)",
      "",
    ].join("\n"),
    "services/api/requirements.txt": "fastapi\nuvicorn\ngoogle-auth\npyjwt\npydantic\npydantic-settings\n",
  });

  it("passes the auth-provider check, names the implementation, and does not vouch for its security", () => {
    const check = result.checks.find((c) => c.id === "auth-provider")!;
    expect(check.status).toBe("pass");
    expect(check.detail).toContain("Custom authentication detected (services/api/app/core/auth.py)");
    expect(check.detail).toContain("did not verify the implementation's security");
    expect(result.findings.map((f) => f.ruleId)).not.toContain("readiness.auth-provider");
  });
});

describe("calibration — Expo app with eas.json passes the build check", async () => {
  const result = await audit({
    "package.json": JSON.stringify({
      name: "onflow-mobile",
      scripts: { start: "expo start", android: "expo run:android" },
      dependencies: { expo: "52.0.0", react: "18.3.1", "react-native": "0.76.0" },
    }),
    "eas.json": JSON.stringify({
      cli: { version: ">= 12.0.0" },
      build: { production: { android: { buildType: "apk" } } },
    }),
    "app.json": JSON.stringify({ expo: { name: "onflow", slug: "onflow" } }),
  });

  it("passes the build-script check as a reproducible mobile build", () => {
    const check = result.checks.find((c) => c.id === "build-script")!;
    expect(check.status).toBe("pass");
    expect(check.detail).toBe("Mobile build configured via EAS (eas.json).");
    expect(result.findings.map((f) => f.ruleId)).not.toContain("readiness.build-script");
  });
});

describe("calibration — localhost in a CORS allowlist is not a hardcoded request target", async () => {
  const result = await audit({ "services/api/app/main.py": CORS_MAIN_PY });

  it("passes the no-hardcoded-localhost check", () => {
    const check = result.checks.find((c) => c.id === "no-hardcoded-localhost")!;
    expect(check.status).toBe("pass");
    expect(check.detail).toContain("CORS allowlists excluded");
    expect(result.findings.map((f) => f.ruleId)).not.toContain("readiness.hardcoded-localhost");
  });
});

describe("calibration — positive control: a real outgoing localhost request is still flagged", async () => {
  const result = await audit({
    "services/api/app/main.py": CORS_MAIN_PY,
    "services/api/app/worker.py": [
      "import httpx",
      "",
      "def ping():",
      "    response = httpx.get('http://localhost:8000/health')",
      "    return response.status_code",
      "",
    ].join("\n"),
  });

  it("flags the outgoing localhost request as a suspected P2", () => {
    const finding = result.findings.find((f) => f.ruleId === "readiness.hardcoded-localhost")!;
    expect(finding).toBeDefined();
    expect(finding.filePath).toBe("services/api/app/worker.py");
    expect(finding.priority).toBe("P2");
    expect(finding.tier).toBe("suspected");
  });
});

describe("calibration — Pydantic BaseSettings counts as env validation", async () => {
  const result = await audit({
    "services/api/app/core/config.py": [
      "import os",
      "from pydantic import field_validator, model_validator",
      "from pydantic_settings import BaseSettings",
      "",
      "",
      "class Settings(BaseSettings):",
      '    database_url: str = ""',
      '    redis_url: str = ""',
      "",
      '    @model_validator(mode="after")',
      "    def check_required(self):",
      '        if os.environ.get("ENV") == "production" and not self.database_url:',
      '            raise ValueError("DATABASE_URL is required in production")',
      "        return self",
      "",
      "",
      "settings = Settings()",
      "",
    ].join("\n"),
  });

  it("passes the env-validation check and names the config file", () => {
    const check = result.checks.find((c) => c.id === "env-validation")!;
    expect(check.status).toBe("pass");
    expect(check.detail).toContain("Environment validation found (services/api/app/core/config.py)");
    expect(result.findings.map((f) => f.ruleId)).not.toContain("readiness.env-validation");
  });
});
