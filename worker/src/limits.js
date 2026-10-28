// Every cap on the chat in one place. The Worker enforces all of them; the app repeats the
// message length only to say so before you hit send.
//
// A chat never locks. Once it gets long, its older messages are summarized and the chat carries
// on from the summary, so what bounds spending is the per-message caps and the daily budget.
export const LIMITS = {
  bodyBytes: 16384,         // whole request
  messageChars: 2000,       // one message
  summarizeAfterTurns: 20,  // your messages before the older ones are summarized
  summarizeAtTokens: 90000, // or once a request reads this much, guide included (Haiku costs 5x past 100K)
  toolRounds: 6,            // tool calls the model may make for one message
  replyTokens: 2048,        // max_tokens per reply
  webSearches: 1,           // per message; each one adds a lot of text to the chat
  dayMessages: 500,         // across the group, per Japan day
  dayTokens: 10_000_000,    // input tokens across the group, per Japan day (cache reads count a tenth)
};

export class LimitError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const CHAT_ID = /^[a-z0-9-]{8,40}$/;
const DATE = /^2026-11-\d\d$/;

// The raw request text in, a checked { chatId, text, date, here } out
export function parseChatRequest(raw) {
  if (new TextEncoder().encode(raw).length > LIMITS.bodyBytes) throw new LimitError(413, "too_large", "That request is too large.");
  let body;
  try { body = JSON.parse(raw); } catch { throw new LimitError(400, "bad_json", "The request wasn't valid JSON."); }
  if (!body || typeof body !== "object") throw new LimitError(400, "bad_json", "The request wasn't valid JSON.");
  if (typeof body.chatId !== "string" || !CHAT_ID.test(body.chatId)) throw new LimitError(400, "bad_chat", "Missing or malformed chat id.");
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) throw new LimitError(400, "empty", "Type a message first.");
  if ([...text].length > LIMITS.messageChars) throw new LimitError(413, "too_long", `Keep it under ${LIMITS.messageChars} characters.`);
  const date = typeof body.date === "string" && DATE.test(body.date) ? body.date : null;
  let here = null;
  const h = body.here;
  if (h && typeof h.lat === "number" && typeof h.lng === "number" && Math.abs(h.lat) <= 90 && Math.abs(h.lng) <= 180) {
    here = { lat: h.lat, lng: h.lng, accuracy: typeof h.accuracy === "number" ? Math.round(h.accuracy) : null };
  }
  return { chatId: body.chatId, text, date, here };
}

export function checkThread(meta) {
  if (meta.busyUntil && meta.busyUntil > Date.now()) throw new LimitError(409, "busy", "Still answering your last message.");
}

// Time to fold the older messages into a summary before adding another
export const needsSummary = (meta) =>
  meta.count > 0 && (meta.turns >= LIMITS.summarizeAfterTurns || meta.lastInputTokens >= LIMITS.summarizeAtTokens);

export function checkBudget(day) {
  if (day.messages >= LIMITS.dayMessages || day.tokens >= LIMITS.dayTokens) {
    throw new LimitError(429, "budget", "The group has used today's chat budget. It resets at midnight in Japan.");
  }
}

// What a reply's usage costs against the daily token budget
export const budgetTokens = (u) =>
  (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + Math.ceil((u.cache_read_input_tokens || 0) / 10);

// Everything the last call read: the guide and places, the tools and the chat itself
export const contextTokens = (u) =>
  (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
