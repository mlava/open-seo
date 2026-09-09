import { timingSafeEqual } from "node:crypto";

/**
 * Forwards Bing Webmaster API calls from a non-Cloudflare egress.
 *
 * Bing throttles Cloudflare Workers' shared outbound IP range with
 * `400 {"ErrorCode":17,"Message":"ERROR!!! ThrottleIP"}` (confirmed
 * 2026-09-10 from a throwaway worker; the same key answers 200 elsewhere), so
 * the app cannot reach Bing directly from the Worker. This function relays the
 * request byte-for-byte from Vercel's egress instead.
 *
 * Not an open proxy: it only accepts callers holding BING_PROXY_SECRET, and
 * only forwards to Bing's JSON API methods. The credential (bearer header or
 * `?apikey=`) belongs to the caller and passes through untouched and unlogged.
 */
const BING_API_ORIGIN = "https://ssl.bing.com";
const BING_API_PATH_PREFIX = "/webmaster/api.svc/json/";
const METHOD_PATTERN = /^[A-Za-z]+$/;

export const config = { maxDuration: 60 };

function secretMatches(given: string | null): boolean {
  const expected = process.env.BING_PROXY_SECRET ?? "";
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function relay(request: Request): Promise<Response> {
  if (!secretMatches(request.headers.get("x-bing-proxy-secret"))) {
    return new Response("Forbidden", { status: 403 });
  }
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const url = new URL(request.url);
  const method = url.pathname.replace(/^\/+/, "");
  if (!METHOD_PATTERN.test(method)) {
    return new Response("Not Found", { status: 404 });
  }
  // Query string is appended verbatim: Bing matches `siteUrl` byte-for-byte,
  // so it must not be re-serialised on the way through.
  const target = `${BING_API_ORIGIN}${BING_API_PATH_PREFIX}${method}${url.search}`;
  const headers = new Headers();
  for (const name of ["authorization", "accept", "content-type"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === "POST" ? await request.text() : undefined,
    redirect: "manual",
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "no-store",
    },
  });
}

export const GET = relay;
export const POST = relay;
