import { fail, tcgapi } from "@/lib/tcgapi";

// Prices for a card the user picked from an ambiguous scan. The scan itself only
// carries prices for its top candidate. This is an ordinary API request, not a scan.
export async function GET(req: Request, { params }: RouteContext<"/api/prices/[id]">) {
  const { id } = await params;
  if (!/^\d{1,12}$/.test(id)) return fail(400, "Not a card id.", "INVALID_CARD");
  return tcgapi(req, `/v1/cards/${id}/prices`);
}
