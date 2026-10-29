import { chat } from "./chat.js";
import { LimitError, parseChatRequest, checkThread, checkBudget, LIMITS } from "./limits.js";

export { Trip } from "./trip.js";

// Routes
//   GET  /plan        the live plan (public; the same data is in the public repo)
//   GET  /places      places the chat added to the map (public, like the guide)
//   POST /places/add  { proposal } → put a place the chat suggested on the map  (passcode)
//   POST /places/remove, /places/restore  { id } → take one off, or put it back  (passcode)
//   POST /plan/ops    { ops: [...] } → apply edits                 (passcode)
//   POST /plan/reset  reseed from data/trip.json                    (passcode)
//   POST /chat        { chatId, text, date?, here? } → event stream (passcode)
//   GET  /limits      the caps, so the app can show them

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

function cors(req, env) {
  const origin = req.headers.get("origin");
  const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  if (!origin || !allowed.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-trip-pass",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

// Compares in constant time so the passcode can't be guessed a character at a time
async function passOk(req, env) {
  const given = req.headers.get("x-trip-pass") || "";
  if (!env.TRIP_PASSCODE || !given) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(given)), crypto.subtle.digest("SHA-256", enc.encode(env.TRIP_PASSCODE))]);
  return crypto.subtle.timingSafeEqual(a, b);
}

async function readBody(req, max) {
  const len = +req.headers.get("content-length");
  if (len > max) throw new LimitError(413, "too_large", "That request is too large.");
  const text = await req.text();
  if (new TextEncoder().encode(text).length > max) throw new LimitError(413, "too_large", "That request is too large.");
  return text;
}

const stub = (env) => env.TRIP.get(env.TRIP.idFromName("trip"));

function stream(run, headers) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const send = (event, data) => writer.write(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)).catch(() => {});
  (async () => {
    try {
      await run(send);
    } catch (e) {
      const known = e instanceof LimitError;
      if (!known) console.error(e);
      send("error", { code: known ? e.code : "server", message: known ? e.message : "Something went wrong talking to Claude. Try again in a moment." });
    } finally {
      writer.close().catch(() => {});
    }
  })();
  return new Response(readable, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", ...headers } });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const h = cors(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    // A browser on another site gets nothing; tools without an Origin header still need the passcode
    const origin = req.headers.get("origin");
    if (origin && !h["access-control-allow-origin"]) return json({ error: "Not allowed from this site" }, 403);

    try {
      if (req.method === "GET" && url.pathname === "/plan") {
        const p = await stub(env).plan();
        return json({ version: p.version, updatedAt: p.updatedAt, items: p.items, history: p.history.slice(0, 10) }, 200, { ...h, "cache-control": "no-store" });
      }
      if (req.method === "GET" && url.pathname === "/places") {
        const p = await stub(env).livePlaces();
        return json(p, 200, { ...h, "cache-control": "no-store" });
      }
      if (req.method === "GET" && url.pathname === "/limits") return json(LIMITS, 200, h);

      if (req.method !== "POST") return json({ error: "Not found" }, 404, h);
      if (!(await passOk(req, env))) return json({ code: "passcode", error: "Wrong or missing trip passcode." }, 401, h);

      if (url.pathname === "/plan/ops") {
        let body;
        try { body = JSON.parse(await readBody(req, 16384)); } catch (e) { if (e instanceof LimitError) throw e; return json({ error: "The request wasn't valid JSON." }, 400, h); }
        const by = typeof body.by === "string" ? body.by.slice(0, 40) : "app";
        const r = await stub(env).edit(body.ops, by);
        if (r.error) return json({ error: r.error }, 400, h);
        return json({ version: r.plan.version, items: r.plan.items, changes: r.changes, inverse: r.inverse }, 200, h);
      }
      if (["/places/add", "/places/remove", "/places/restore"].includes(url.pathname)) {
        let body;
        try { body = JSON.parse(await readBody(req, 1024)); } catch (e) { if (e instanceof LimitError) throw e; return json({ error: "The request wasn't valid JSON." }, 400, h); }
        const s = stub(env);
        const r = url.pathname === "/places/add"
          ? await s.addProposal(String(body?.proposal || ""))
          : await s.setRemoved(String(body?.id || ""), url.pathname === "/places/remove");
        if (r.error) return json({ error: r.error, same: r.same || null }, 400, h);
        return json({ ...(await s.livePlaces()), place: r.place, already: !!r.already }, 200, h);
      }
      if (url.pathname === "/plan/reset") {
        const p = await stub(env).reset("reset");
        return json({ version: p.version, items: p.items }, 200, h);
      }
      if (url.pathname === "/chat") {
        const chatReq = parseChatRequest(await readBody(req, LIMITS.bodyBytes));
        const s = stub(env);
        // Checked here too so a full chat or spent budget is a plain 409/429, not a stream
        checkThread(await s.chatMeta(chatReq.chatId));
        checkBudget(await s.budget());
        return stream((send) => chat({ env, stub: s, req: chatReq, send }), h);
      }
      return json({ error: "Not found" }, 404, h);
    } catch (e) {
      if (e instanceof LimitError) return json({ code: e.code, error: e.message }, e.status, h);
      console.error(e);
      return json({ error: "Server error" }, 500, h);
    }
  },
};
