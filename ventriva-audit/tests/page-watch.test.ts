import { describe, expect, it } from "vitest";
import { pageDiff, pageSnapshot, pageUrl } from "@/lib/watch/page";

describe("public page watches", () => {
  it("normalizes the saved URL and removes fragments", () => {
    expect(pageUrl(" https://Example.com/pricing#plans ").href).toBe("https://example.com/pricing");
  });

  it.each([
    "http://example.com", "https://example.com:8080", "https://user@example.com",
    "https://127.0.0.1", "https://[::1]", "https://localhost",
  ])("rejects an unsupported watch URL (%s)", (url) => {
    expect(() => pageUrl(url)).toThrow();
  });

  it("ignores scripts and whitespace when comparing snapshots", () => {
    const first = pageSnapshot("<title>Plans</title><body><script>alpha()</script>Basic   plan.</body>");
    const second = pageSnapshot("<title>Plans</title><body><script>beta()</script>Basic plan.</body>");
    expect(first).toEqual(second);
    expect(first.title).toBe("Plans");
    expect(first.text).toBe("Basic plan.");
  });

  it("shows added and removed copy when the snapshot changes", () => {
    const before = pageSnapshot("<body>Basic plan. Annual plan.</body>");
    const after = pageSnapshot("<body>Basic plan. Monthly plan.</body>");
    expect(after.digest).not.toBe(before.digest);
    expect(pageDiff(before.text, after.text)).toEqual({
      added: ["Monthly plan."],
      removed: ["Annual plan."],
    });
  });
});
