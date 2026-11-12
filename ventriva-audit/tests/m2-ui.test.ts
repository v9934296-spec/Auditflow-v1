import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductModuleCards } from "@/components/product-module-cards";
import ValidatePage from "@/app/validate/page";
import MonitorPage from "@/app/monitor/page";

describe("M2 rendered navigation and module handoff", () => {
  it("renders all three module routes and labels the separate account", () => {
    const markup = renderToStaticMarkup(createElement(ProductModuleCards));
    expect(markup).toContain('href="/validate"');
    expect(markup).toContain('href="/dashboard"');
    expect(markup).toContain('href="/monitor"');
    expect(markup).toContain("Separate application and sign-in");
    expect(markup).toContain("eligible Audit Pro access");
  });

  it("explains the separate Ventriva login before linking to its live site", () => {
    const markup = renderToStaticMarkup(createElement(ValidatePage));
    expect(markup).toContain("its own account, sign-in, saved reports, subscriptions and billing");
    expect(markup).toContain('href="https://venturelens-l2q2.onrender.com"');
    expect(markup).toContain("Sign in separately");
  });

  it("keeps monitoring attached to the existing audit dashboard", () => {
    const markup = renderToStaticMarkup(createElement(MonitorPage));
    expect(markup).toContain("Monitoring lives inside the existing audit dashboard");
    expect(markup).toContain('href="/login?next=/dashboard"');
    expect(markup).toContain("untested fixes are not counted as new passes");
  });
});
