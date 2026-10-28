// Every cap on the chat in one place. The Worker enforces all of them; the app repeats the
// message length only to say so before you hit send.
export const LIMITS = {
  bodyBytes: 4096,          // whole request
  messageChars: 500,        // one message
  threadTurns: 12,          // your messages per chat
  threadTokens: 60000,      // input tokens the last reply used, roughly how big the chat has grown
  toolRounds: 6,            // tool calls Sonnet may make for one message
  replyTokens: 2048,        // max_tokens per reply
  webSearches: 2,           // per message
  dayMessages: 200,         // across the group, per Japan day
  dayTokens: 3_000_000,     // input tokens across the group, per Japan day (cache reads count a tenth)
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
  if (meta.turns >= LIMITS.threadTurns || meta.lastInputTokens >= LIMITS.threadTokens) {
    throw new LimitError(409, "chat_full", "This chat is full. Start a new one to keep going.");
  }
  if (meta.busyUntil && meta.busyUntil > Date.now()) throw new LimitError(409, "busy", "Still answering your last message.");
}

export function checkBudget(day) {
  if (day.messages >= LIMITS.dayMessages || day.tokens >= LIMITS.dayTokens) {
    throw new LimitError(429, "budget", "The group has used today's chat budget. It resets at midnight in Japan.");
  }
}

// What a reply's usage costs against the daily token budget
export const budgetTokens = (u) =>
  (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + Math.ceil((u.cache_read_input_tokens || 0) / 10);

// How big the chat is now: everything the last call read
export const contextTokens = (u) =>
  (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
