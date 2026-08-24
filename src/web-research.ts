export interface ResearchSource {
  id: string;
  title: string;
  url: string;
  excerpt: string;
}

const MAX_RESPONSE_BYTES = 750_000;

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function limitedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error("Search response is too large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Search response is too large");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(all);
}

/** Searches through one fixed public endpoint; result URLs are never fetched by the server. */
export async function researchWeb(query: string, limit = 6): Promise<ResearchSource[]> {
  const normalized = query.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!normalized) return [];
  try {
    const endpoint = new URL("https://html.duckduckgo.com/html/");
    endpoint.searchParams.set("q", normalized);
    const response = await fetch(endpoint, {
      headers: { "user-agent": "ScenarioResearch/1.0" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return [];
    const html = await limitedText(response);
    const anchors = [...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
    const snippets = [...html.matchAll(/<(?:a|div)[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/g)];
    const sources: ResearchSource[] = [];
    for (const [index, match] of anchors.entries()) {
      try {
        const redirect = new URL(match[1]!.replaceAll("&amp;", "&"), "https://duckduckgo.com");
        const target = new URL(redirect.searchParams.get("uddg") ?? redirect.href);
        if (target.protocol !== "https:" && target.protocol !== "http:") continue;
        if (sources.some((source) => source.url === target.href)) continue;
        sources.push({
          id: `source-${sources.length + 1}`,
          title: decodeHtml(match[2]!).slice(0, 160) || target.hostname,
          url: target.href,
          excerpt: decodeHtml(snippets[index]?.[1] ?? "").slice(0, 700),
        });
        if (sources.length >= Math.min(Math.max(limit, 1), 8)) break;
      } catch { /* Ignore malformed result links. */ }
    }
    return sources;
  } catch {
    return [];
  }
}
