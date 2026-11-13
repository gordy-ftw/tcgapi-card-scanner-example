import { timingSafeEqual } from "node:crypto";

// TCGAPI_URL exists so the tests can point the app at a mock API.
const API = process.env.TCGAPI_URL ?? "https://api.tcgapi.dev";

// What a visitor has to type before they can scan:
//   "key"  - no TCGAPI_KEY on the server: each visitor scans with their own API key.
//   "code" - the server's key pays, and ACCESS_CODE stops strangers from spending its scans.
//   null   - the server's key pays for anyone who can reach the app. Fine on localhost only.
export function needs(): "key" | "code" | null {
  if (!process.env.TCGAPI_KEY) return "key";
  return process.env.ACCESS_CODE ? "code" : null;
}

export const fail = (status: number, message: string, code: string) =>
  Response.json({ error: { message, code } }, { status });

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// Call the TCG API for this visitor. The API key is added here, on the server.
export async function tcgapi(req: Request, path: string, init: RequestInit = {}) {
  const mode = needs();
  const typed = req.headers.get("x-scanner-secret") ?? "";
  if (mode === "key" && !typed) return fail(401, "Enter your TCG API key.", "SECRET_REQUIRED");
  if (mode === "code" && !same(typed, process.env.ACCESS_CODE!)) {
    return fail(401, "Wrong access code.", "SECRET_REQUIRED");
  }

  let upstream: Response;
  try {
    upstream = await fetch(API + path, {
      ...init,
      headers: { ...init.headers, "X-API-Key": mode === "key" ? typed : process.env.TCGAPI_KEY! },
    });
  } catch {
    return fail(502, "Could not reach the TCG API.", "UPSTREAM_UNREACHABLE");
  }
  // Pass the API's answer through as it is: { data, meta } or { error: { message, code } }.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
