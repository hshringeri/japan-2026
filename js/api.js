import { API } from "./config.js";
import { storage } from "./util.js";

// Talking to the Worker: the shared plan, plan edits and the chat. Writes and chat need the
// trip passcode, which is asked for once and kept on this phone.

export const apiReady = () => !!API;

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const passcode = {
  get: () => storage.get("tripPass", ""),
  set: (v) => storage.set("tripPass", v),
  clear: () => storage.set("tripPass", ""),
};

async function call(path, { method = "GET", body, timeout = 15000 } = {}) {
  if (!API) throw new ApiError(0, "no_api", "The trip server isn't set up yet.");
  if (!navigator.onLine) throw new ApiError(0, "offline", "You're offline.");
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: { "content-type": "application/json", ...(method === "POST" ? { "x-trip-pass": passcode.get() } : {}) },
      body: body == null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "network", "Couldn't reach the trip server.");
  }
  return res;
}

async function json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.code || "error", data.error || `Server said ${res.status}`);
  return data;
}

export const fetchPlan = async () => json(await call("/plan", { timeout: 5000 }));
export const sendOps = async (ops) => json(await call("/plan/ops", { method: "POST", body: { ops, by: "app" } }));

// Streams one chat message. onEvent(name, data) gets text, tool, plan, done and error events.
export async function sendChat(body, onEvent) {
  const res = await call("/chat", { method: "POST", body, timeout: 180000 });
  if (!res.ok) await json(res);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let cut;
    while ((cut = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const name = chunk.match(/^event: (.+)$/m)?.[1];
      const data = chunk.match(/^data: (.+)$/m)?.[1];
      if (name && data) onEvent(name, JSON.parse(data));
    }
  }
}
