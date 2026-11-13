import { fail, tcgapi } from "@/lib/tcgapi";

const TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 8 * 1024 * 1024; // the API's own limit

// One photo in, the API's answer out. include=prices adds the top match's prices at no extra charge.
export async function POST(req: Request) {
  const type = req.headers.get("content-type") ?? "";
  if (!TYPES.includes(type)) return fail(415, "Send a JPEG, PNG or WebP image.", "INVALID_IMAGE");
  if (Number(req.headers.get("content-length")) > MAX_BYTES) {
    return fail(413, "The photo is larger than 8 MB.", "INVALID_IMAGE");
  }
  const image = await req.arrayBuffer();
  if (!image.byteLength || image.byteLength > MAX_BYTES) {
    return fail(400, "Send one photo of up to 8 MB.", "INVALID_IMAGE");
  }
  return tcgapi(req, "/v1/identify?include=prices", {
    method: "POST",
    headers: { "Content-Type": type },
    body: image,
  });
}
