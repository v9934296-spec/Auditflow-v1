import { describe, expect, it } from "vitest";
import { jwtRole, redact } from "@/lib/analysis/redact";
import { FAKE_STRIPE_LIVE, fakeJwt } from "./helpers/fixtures";

describe("redact", () => {
  it("masks known token formats", () => {
    const aws = ["AKIA", "ABCDEFGHIJKLMNOP"].join("");
    const out = redact(`const k = "${FAKE_STRIPE_LIVE}"; const aws = "${aws}";`);
    expect(out).not.toContain(FAKE_STRIPE_LIVE);
    expect(out).not.toContain(aws);
    expect(out).toContain("[REDACTED");
  });
  it("masks JWTs and generic secret assignments", () => {
    const jwt = fakeJwt("service_role");
    const out = redact(`SUPABASE_KEY=${jwt}\nWEBHOOK_SECRET="hunter2hunter2"`);
    expect(out).not.toContain(jwt);
    expect(out).not.toContain("hunter2hunter2");
  });
  it("keeps env references readable", () => {
    expect(redact("API_KEY = process.env.API_KEY")).toContain("process.env.API_KEY");
  });
  it("decodes JWT roles", () => {
    expect(jwtRole(fakeJwt("service_role"))).toBe("service_role");
    expect(jwtRole(fakeJwt("anon"))).toBe("anon");
    expect(jwtRole("not.a.jwt")).toBeNull();
  });
});
