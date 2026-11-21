import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { authCallbackUrl, signInWithGoogle } from "@/lib/supabase/oauth";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({
    auth: {
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      signInWithOAuth: vi.fn(),
      resetPasswordForEmail: vi.fn(),
    },
  }),
}));

// Imported after the mocks so the form picks up the mocked router/client.
import { LoginForm } from "@/app/login/login-form";

describe("Google sign-in", () => {
  it("builds the auth-callback URL and encodes the destination", () => {
    expect(authCallbackUrl("https://auditflow.app", "/dashboard")).toBe(
      "https://auditflow.app/auth/callback?next=%2Fdashboard",
    );
    expect(authCallbackUrl("http://localhost:3000", "/login?next=/dashboard")).toBe(
      "http://localhost:3000/auth/callback?next=%2Flogin%3Fnext%3D%2Fdashboard",
    );
  });

  it("calls Supabase OAuth with provider google and the callback URL", async () => {
    const signInWithOAuth = vi.fn().mockResolvedValue({ error: null });
    const client = { auth: { signInWithOAuth } } as never;

    const error = await signInWithGoogle(client, "https://auditflow.app", "/dashboard");

    expect(error).toBeNull();
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "https://auditflow.app/auth/callback?next=%2Fdashboard" },
    });
  });

  it("surfaces the Supabase OAuth error instead of throwing", async () => {
    const failure = new Error("Provider not enabled");
    const signInWithOAuth = vi.fn().mockResolvedValue({ error: failure });
    const client = { auth: { signInWithOAuth } } as never;

    const error = await signInWithGoogle(client, "https://auditflow.app", "/dashboard");

    expect(error).toBe(failure);
  });

  it("renders a Continue with Google button on the login form", () => {
    const markup = renderToStaticMarkup(createElement(LoginForm, { next: "/dashboard" }));
    expect(markup).toContain("Continue with Google");
    expect(markup).toContain("or continue with email");
  });
});
