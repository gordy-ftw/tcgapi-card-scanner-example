"use client";

import { useEffect, useRef, useState } from "react";

// The parts of the API's answer this app uses. Full reference: https://tcgapi.dev/api/identify/
type Price = { printing: string; market_price: number | null };
type Candidate = {
  card_id: number;
  tcgplayer_id: number | null;
  name: string;
  number: string | null;
  set: { name: string } | null;
  game: { name: string } | null;
  image_url: string | null;
  suggested_printing: string | null;
  prices?: Price[]; // sent with the top candidate only
};
type Row = {
  id: string;
  thumb: string; // a small copy of the photo
  state: "reading" | "pick" | "done" | "problem";
  note?: string;
  retry?: boolean;
  candidates?: Candidate[]; // state "pick": the user chooses one
  card?: Candidate; // state "done"
  prices?: Price[]; // undefined while they load
  printing?: string;
  qty: number;
};

const ROWS = "scanner.rows";
const SECRET = "scanner.secret";
const money = (n: number | null) => (n == null ? "—" : `$${n.toFixed(2)}`);
const priceOf = (r: Row) => r.prices?.find((p) => p.printing === r.printing)?.market_price ?? null;
const where = (c: Candidate) => [c.set?.name, c.number].filter(Boolean).join(" · ");

// The printing the photo points to, else the first one with a price.
const likelyPrinting = (card: Candidate, prices: Price[]) =>
  (
    prices.find((p) => p.printing === card.suggested_printing) ??
    prices.find((p) => p.market_price != null) ??
    prices[0]
  )?.printing;

// Draw a camera frame or photo onto a canvas at most `side` pixels on its long edge.
function shrink(source: HTMLVideoElement | ImageBitmap, side: number) {
  const w = "videoWidth" in source ? source.videoWidth : source.width;
  const h = "videoHeight" in source ? source.videoHeight : source.height;
  const scale = Math.min(1, side / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// At most three photos are being read at once, however fast the user shoots.
let reading = 0;
const waiting: (() => void)[] = [];
async function inTurn<T>(job: () => Promise<T>) {
  if (reading >= 3) await new Promise<void>((go) => waiting.push(go));
  reading++;
  try {
    return await job();
  } finally {
    reading--;
    waiting.shift()?.();
  }
}

export default function Scanner({ needs }: { needs: "key" | "code" | null }) {
  const [ready, setReady] = useState(false); // saved list and secret are loaded
  const [rows, setRows] = useState<Row[]>([]);
  const [secret, setSecret] = useState("");
  const [denied, setDenied] = useState("");
  const [camera, setCamera] = useState<"wait" | "on" | "none">("wait");
  const [scansLeft, setScansLeft] = useState<number | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const photos = useRef(new Map<string, Blob>()); // photos not read yet, for "Try again"
  const unlocked = ready && (!needs || secret !== "");

  // The list survives a reload. Browser storage can be unavailable; the app works without it.
  useEffect(() => {
    try {
      setRows(JSON.parse(localStorage.getItem(ROWS) ?? "[]"));
      setSecret(localStorage.getItem(SECRET) ?? "");
    } catch {}
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const keep = rows.filter((r) => r.state !== "reading").map((r) => ({ ...r, retry: false }));
    try {
      localStorage.setItem(ROWS, JSON.stringify(keep));
      localStorage.setItem(SECRET, secret);
    } catch {}
  }, [ready, rows, secret]);

  // Live camera. Browsers only allow it on HTTPS or localhost; without it, photos still work.
  useEffect(() => {
    if (!unlocked) return;
    let stream: MediaStream | undefined;
    let gone = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment", width: { ideal: 2560 }, height: { ideal: 1440 } } })
      .then((s) => {
        if (gone) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        video.current!.srcObject = s; // the video's onLoadedData turns the camera "on"
      })
      .catch(() => setCamera("none"));
    if (!navigator.mediaDevices) setCamera("none");
    return () => {
      gone = true;
      stream?.getTracks().forEach((t) => t.stop());
      setCamera("wait");
    };
  }, [unlocked]);

  const update = (id: string, patch: Partial<Row>) =>
    setRows((all) => all.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  // Every request goes to this app's own server, which adds the API key.
  async function call(path: string, init: RequestInit = {}) {
    try {
      const res = await fetch(path, { ...init, headers: { ...init.headers, "x-scanner-secret": secret } });
      const json = await res.json();
      if (res.status === 401) {
        setSecret(""); // a wrong key or code: ask for it again
        setDenied(json.error?.message ?? "That was not accepted.");
      }
      return json;
    } catch {
      return { error: { message: "The request failed. Check your connection." } };
    }
  }

  async function add(source: HTMLVideoElement | ImageBitmap) {
    if ("videoWidth" in source && !source.videoWidth) return; // the camera has not sent a frame yet
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // 2048 px keeps the small print (collector number, set code) readable and the upload near 1 MB.
    const photo = shrink(source, 2048);
    const thumb = shrink(source, 120).toDataURL("image/jpeg", 0.6);
    setRows((all) => [{ id, thumb, state: "reading", qty: 1 }, ...all]);
    photos.current.set(id, await new Promise<Blob>((done) => photo.toBlob((b) => done(b!), "image/jpeg", 0.9)));
    scan(id);
  }

  async function addFiles(files: FileList) {
    for (const file of Array.from(files)) {
      const bitmap = await createImageBitmap(file).catch(() => null);
      if (!bitmap) continue; // not an image
      await add(bitmap);
      bitmap.close();
    }
  }

  async function scan(id: string) {
    update(id, { state: "reading", note: undefined, retry: false });
    const json = await inTurn(() =>
      call("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: photos.current.get(id),
      }),
    );
    // Nothing was read (no scans left, the reader is down, no connection): keep the photo to try again.
    if (json.error) return update(id, { state: "problem", note: json.error.message, retry: true });

    photos.current.delete(id);
    const { status, message, read, candidates = [], warnings = [] } = json.data;
    if (json.meta?.scans_remaining != null) setScansLeft(json.meta.scans_remaining);

    // matched: exactly one card fits everything the photo shows.
    if (status === "matched") return choose(id, candidates[0], warnings.join(" "));
    // ambiguous: several versions fit. retake: the photo was poor, but the readable parts
    // may still have found the card. Either way the user picks, which saves another scan.
    if (candidates.length) {
      const note = status === "ambiguous" ? "Several versions fit. Pick yours:" : `${message} Or pick it:`;
      return update(id, { state: "pick", note, candidates });
    }
    // retake, not_found or unsupported with nothing to offer.
    update(id, {
      state: "problem",
      note: message ?? `Not in the catalog${read?.name ? `: ${read.name}` : ""}.`,
    });
  }

  async function choose(id: string, card: Candidate, note?: string) {
    const known = card.prices && { prices: card.prices, printing: likelyPrinting(card, card.prices) };
    update(id, { state: "done", card, note, candidates: undefined, ...known });
    if (known) return;
    const json = await call(`/api/prices/${card.card_id}`);
    const prices: Price[] = json.data ?? [];
    update(id, { prices, printing: likelyPrinting(card, prices), note: json.error?.message });
  }

  function remove(id: string) {
    photos.current.delete(id);
    setRows((all) => all.filter((r) => r.id !== id));
  }

  const done = rows.filter((r) => r.state === "done");
  const count = done.reduce((n, r) => n + r.qty, 0);
  const total = done.reduce((n, r) => n + (priceOf(r) ?? 0) * r.qty, 0);

  function exportCsv() {
    const cell = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const lines = [
      ["Quantity", "Name", "Set", "Number", "Printing", "Game", "TCGplayer ID", "Card ID", "Market price"],
      ...done.map((r) => [
        r.qty,
        r.card!.name,
        r.card!.set?.name,
        r.card!.number,
        r.printing,
        r.card!.game?.name,
        r.card!.tcgplayer_id,
        r.card!.card_id,
        priceOf(r),
      ]),
    ];
    const csv = lines.map((line) => line.map(cell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: "scanned-cards.csv" }).click();
    URL.revokeObjectURL(url);
  }

  if (!ready) return null;

  if (!unlocked) {
    return (
      <form
        className="box"
        onSubmit={(e) => {
          e.preventDefault();
          setDenied("");
          setSecret(String(new FormData(e.currentTarget).get("secret")).trim());
        }}
      >
        <label htmlFor="secret">{needs === "key" ? "Your TCG API key" : "Access code"}</label>
        <input id="secret" name="secret" type="password" autoComplete="off" required />
        <button className="primary">Start scanning</button>
        {denied && <p className="bad">{denied}</p>}
        {needs === "key" && (
          <p className="dim">
            A <a href="https://tcgapi.dev/signup/">free key</a> comes with 25 scans. Your key stays in this browser
            and goes only to this app&apos;s server, which passes it to the API.
          </p>
        )}
      </form>
    );
  }

  return (
    <>
      <section className="box">
        <video ref={video} autoPlay playsInline muted hidden={camera !== "on"} onLoadedData={() => setCamera("on")} />
        <div className="actions">
          {camera === "on" && (
            <button className="primary" onClick={() => add(video.current!)}>
              Scan card
            </button>
          )}
          <label className="button">
            Add photos
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = ""; // so the same photo can be chosen again
              }}
            />
          </label>
        </div>
        {camera === "none" && (
          <p className="dim">No live camera here: it needs HTTPS or localhost, and your permission. Photos work the same.</p>
        )}
      </section>

      <section className="box">
        <div className="summary">
          <p role="status">
            <b>{count}</b> {count === 1 ? "card" : "cards"} · <b>{money(total)}</b>
            {scansLeft != null && <span className="dim"> · {scansLeft} scans left</span>}
          </p>
          <button onClick={exportCsv} disabled={!done.length}>
            Export CSV
          </button>
          <button onClick={() => confirm("Remove every card from the list?") && setRows([])} disabled={!rows.length}>
            Clear list
          </button>
        </div>
        {rows.length === 0 && (
          <p className="dim">
            One card, graded slab or sealed product per photo. Keep scanning: each photo is read in the background.
          </p>
        )}
        <ul>
          {rows.map((r) => (
            <li key={r.id}>
              <img src={r.card?.image_url ?? r.thumb} alt="" />
              <div>
                {r.state === "reading" && <p className="dim">Reading…</p>}
                {r.state === "problem" && <p className="bad">{r.note}</p>}
                {r.state === "pick" && (
                  <>
                    <p className="warn">{r.note}</p>
                    {r.candidates!.map((c) => (
                      <button key={c.card_id} className="candidate" onClick={() => choose(r.id, c)}>
                        <b>{c.name}</b> <span className="dim">{where(c)}</span>
                      </button>
                    ))}
                  </>
                )}
                {r.state === "done" && (
                  <>
                    <h2>{r.card!.name}</h2>
                    <p className="dim">{where(r.card!)}</p>
                    <div className="line">
                      {r.prices?.length ? (
                        <select
                          aria-label={`Printing of ${r.card!.name}`}
                          value={r.printing}
                          onChange={(e) => update(r.id, { printing: e.target.value })}
                        >
                          {r.prices.map((p) => (
                            <option key={p.printing} value={p.printing}>
                              {p.printing} {money(p.market_price)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="dim">{r.prices ? "No price" : "Prices…"}</span>
                      )}
                      <input
                        type="number"
                        min={1}
                        aria-label={`Quantity of ${r.card!.name}`}
                        value={r.qty}
                        onChange={(e) => update(r.id, { qty: Math.max(1, Math.floor(Number(e.target.value)) || 1) })}
                      />
                      <b>{money(priceOf(r) == null ? null : priceOf(r)! * r.qty)}</b>
                    </div>
                    {r.note && <p className="dim">{r.note}</p>}
                  </>
                )}
              </div>
              <div className="side">
                <button aria-label={`Remove ${r.card?.name ?? "this scan"}`} onClick={() => remove(r.id)}>
                  ×
                </button>
                {r.retry && <button onClick={() => scan(r.id)}>Try again</button>}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {needs && (
        <p className="dim">
          <button className="link" onClick={() => setSecret("")}>
            {needs === "key" ? "Use another API key" : "Sign out"}
          </button>
        </p>
      )}
    </>
  );
}
