import { defineConfig } from "@trigger.dev/sdk";
import type { BuildExtension } from "@trigger.dev/build";
import { additionalFiles } from "@trigger.dev/build/extensions/core";

/** Installs a pinned Semgrep CLI into the worker image. Semgrep never executes scanned code. */
function semgrep(version: string): BuildExtension {
  return {
    name: "semgrep",
    onBuildComplete(context) {
      if (context.target === "dev") return;
      context.addLayer({
        id: "semgrep",
        image: {
          instructions: [
            "RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip && rm -rf /var/lib/apt/lists/*",
            `RUN pip3 install --no-cache-dir --break-system-packages semgrep==${version}`,
          ],
        },
      });
    },
  };
}

export default defineConfig({
  project: "proj_wqqqzkzwsjhaepczqchl",
  runtime: "node",
  dirs: ["./src/trigger"],
  maxDuration: 900,
  machine: "small-2x",
  retries: {
    enabledInDev: false,
    default: { maxAttempts: 2, minTimeoutInMs: 5_000, maxTimeoutInMs: 30_000, factor: 2 },
  },
  build: {
    external: ["eslint", "@typescript-eslint/parser", "eslint-plugin-security"],
    extensions: [additionalFiles({ files: ["./semgrep-rules/**"] }), semgrep(process.env.SEMGREP_VERSION ?? "1.183.0")],
  },
});
