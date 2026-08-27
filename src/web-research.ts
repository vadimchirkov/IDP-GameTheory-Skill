import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface ResearchSource {
  id: string;
  title: string;
  url: string;
  excerpt: string;
  query: string;
  purpose?: string;
  field?: string;
  fetchedAt: string;
}

export interface ResearchQuery { query: string; purpose?: string; field?: string }

const MAX_RESPONSE_BYTES = 750_000;
const requestSignal = (signal?: AbortSignal) => signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);

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

function privateAddress(address: string): boolean {
  if (address === "::1" || address === "::" || address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:")) return true;
  const match = address.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return false;
  const [a, b] = [Number(match[1]), Number(match[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

async function publicUrl(value: string): Promise<URL> {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only public HTTP pages can be researched");
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".local")) throw new Error("Private hosts cannot be researched");
  if (isIP(hostname) && privateAddress(hostname)) throw new Error("Private hosts cannot be researched");
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => privateAddress(address))) throw new Error("Private hosts cannot be researched");
  return url;
}

function pageText(html: string): string {
  return decodeHtml(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " "));
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
export async function researchWeb(query: string, limit = 6, signal?: AbortSignal): Promise<ResearchSource[]> {
  const normalized = query.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!normalized) return [];
  try {
    const endpoint = new URL("https://html.duckduckgo.com/html/");
    endpoint.searchParams.set("q", normalized);
    const response = await fetch(endpoint, {
      headers: { "user-agent": "ScenarioResearch/1.0" },
      redirect: "error",
      signal: requestSignal(signal),
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
          query: normalized,
          fetchedAt: new Date().toISOString(),
        });
        if (sources.length >= Math.min(Math.max(limit, 1), 8)) break;
      } catch { /* Ignore malformed result links. */ }
    }
    return sources;
  } catch (error) {
    if (signal?.aborted) throw error;
    return [];
  }
}

/** Fetches a small, text-only public page. Redirect targets are validated too. */
export async function openPublicPage(value: string, signal?: AbortSignal): Promise<{ title: string; url: string; excerpt: string }> {
  let url = await publicUrl(value);
  for (let redirects = 0; redirects < 4; redirects += 1) {
    const response = await fetch(url, {
      headers: { "user-agent": "FluminaPublicResearch/1.0", accept: "text/html,text/plain;q=0.8" },
      redirect: "manual",
      signal: requestSignal(signal),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Research page redirected without a location");
      url = await publicUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) throw new Error(`Research page returned HTTP ${response.status}`);
    const type = response.headers.get("content-type") ?? "";
    if (!/text\/(html|plain)/i.test(type)) throw new Error("Research page is not text");
    const html = await limitedText(response);
    const title = decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").slice(0, 160) || url.hostname;
    return { title, url: url.href, excerpt: pageText(html).slice(0, 3_000) };
  }
  throw new Error("Research page redirected too many times");
}

/** Searches and opens at most two useful pages per query, with a small global cap. */
export async function researchPublicContext(queries: readonly ResearchQuery[], signal?: AbortSignal): Promise<ResearchSource[]> {
  if (signal?.aborted) throw signal.reason;
  const searches = await Promise.all(queries.slice(0, 3).map(async (item) => ({ item, results: await researchWeb(item.query, 4, signal) })));
  const seen = new Set<string>();
  const candidates = searches.flatMap(({ item, results }) => results.slice(0, 2).map((result) => ({ item, result })))
    .filter(({ result }) => !seen.has(result.url) && Boolean(seen.add(result.url)))
    .slice(0, 6);
  return Promise.all(candidates.map(async ({ item, result }, index) => {
    let opened: Awaited<ReturnType<typeof openPublicPage>> | undefined;
    try { opened = await openPublicPage(result.url, signal); } catch (error) {
      if (signal?.aborted) throw error;
      /* Search snippets remain useful when a page blocks automated reading. */
    }
    return {
      ...result,
      id: `source-${index + 1}`,
      title: opened?.title || result.title,
      url: opened?.url || result.url,
      excerpt: opened?.excerpt || result.excerpt,
      ...(item.field ? { field: item.field } : {}),
      ...(item.purpose ? { purpose: item.purpose } : {}),
    };
  }));
}
