import { createHash } from "node:crypto";
import { Resolver } from "node:dns/promises";
import { get } from "node:https";
import { BlockList, isIP } from "node:net";
import { load } from "cheerio";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) blocked.addSubnet(address, prefix);

export function pageUrl(input: string): URL {
  const url = new URL(input.trim());
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      isIP(url.hostname.replace(/^\[|\]$/g, "")) || !url.hostname.includes(".")) {
    throw new Error("Enter a public HTTPS page URL.");
  }
  url.hash = "";
  if (url.href.length > 2048) throw new Error("The URL is too long.");
  return url;
}

export async function readPage(input: string) {
  const url = pageUrl(input);
  const signal = AbortSignal.timeout(10_000);
  const resolver = new Resolver({ timeout: 1500, tries: 2 });
  const addresses = await resolver.resolve4(url.hostname);
  const address = addresses[0];
  if (!address || addresses.some((candidate) => blocked.check(candidate))) {
    throw new Error("The page must resolve to a public address.");
  }

  // Pin the checked address for the connection while retaining hostname TLS verification.
  const html = await new Promise<string>((resolve, reject) => {
    const request = get(url, {
      agent: false,
      family: 4,
      signal,
      lookup: (_hostname, _options, callback) => callback(null, address, 4),
      headers: { accept: "text/html,application/xhtml+xml", "user-agent": "VentrivaWatch/1.0" },
    }, (response) => {
      if (response.statusCode !== 200 ||
          !/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(response.headers["content-type"] ?? "")) {
        response.destroy();
        reject(new Error("Use a direct URL that returns an HTML page."));
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 1_000_000) {
          response.destroy(new Error("This page is too large to check."));
          return;
        }
        chunks.push(chunk);
      });
      response.once("error", reject);
      response.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    request.once("error", reject);
  });
  return pageSnapshot(html);
}

export function pageSnapshot(html: string) {
  const $ = load(html);
  $("script, style, noscript, svg, iframe, canvas, [hidden]").remove();
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
  const title = normalize($("title").first().text()).slice(0, 180);
  const text = normalize($("body").text()).slice(0, 120_000);
  return { text, title, digest: createHash("sha256").update(text).digest("hex") };
}

export function pageDiff(before: string, after: string) {
  const lines = (text: string) => text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const previous = new Set(lines(before));
  const current = new Set(lines(after));
  const missing = (source: Set<string>, target: Set<string>) =>
    [...source].filter((line) => !target.has(line)).slice(0, 12).map((line) => line.slice(0, 500));
  return { added: missing(current, previous), removed: missing(previous, current) };
}
