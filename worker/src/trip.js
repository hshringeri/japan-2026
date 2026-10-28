import { DurableObject } from "cloudflare:workers";
import { applyOps, seedItems, PlanError } from "./plan.js";
import { loadData } from "./context.js";
import { japanTime } from "../../js/hours.js";

const CHAT_DAYS = 45;      // chats nobody has used for this long are deleted
const HISTORY = 30;        // recent plan changes kept for the chat's context

// One instance, named "trip", holds everything shared: the live plan, chat threads and the
// group's daily budget. A Durable Object runs one request at a time, so edits never interleave.
export class Trip extends DurableObject {
  async #data() {
    return loadData(this.env);
  }

  async #ctx() {
    const data = await this.#data();
    return {
      people: data.trip.people,
      dates: data.trip.days.map((d) => d.date),
      placeIds: new Set(data.places.map((p) => p.id)),
      placeCoords: Object.fromEntries(data.places.filter((p) => p.lat != null).map((p) => [p.id, { lat: p.lat, lng: p.lng }])),
    };
  }

  // The live plan, seeded from trip.json the first time anyone asks
  async plan() {
    let plan = await this.ctx.storage.get("plan");
    if (!plan) plan = await this.reset("seed");
    return plan;
  }

  async reset(by = "reset") {
    const data = await this.#data();
    const plan = { version: 1, updatedAt: Date.now(), items: seedItems(data.trip), history: [{ at: Date.now(), by, changes: [{ text: "Plan loaded from trip.json" }] }] };
    const old = await this.ctx.storage.get("plan");
    if (old) plan.version = old.version + 1;
    await this.ctx.storage.put("plan", plan);
    return plan;
  }

  // An invalid op comes back as { error } (thrown errors lose their class over RPC)
  async edit(ops, by) {
    const plan = await this.plan();
    let result;
    try {
      result = applyOps(plan.items, ops, await this.#ctx());
    } catch (e) {
      if (e instanceof PlanError) return { error: e.message };
      throw e;
    }
    const next = {
      version: plan.version + 1,
      updatedAt: Date.now(),
      items: result.items,
      history: [{ at: Date.now(), by, changes: result.changes }, ...plan.history].slice(0, HISTORY),
    };
    await this.ctx.storage.put("plan", next);
    return { plan: next, changes: result.changes, inverse: result.inverse };
  }

  async chatMeta(id) {
    return (await this.ctx.storage.get(`chat:${id}`)) || { turns: 0, lastInputTokens: 0, count: 0, created: Date.now(), summary: null, planVersion: null };
  }

  // A chat's stored messages, exactly as the API returned them
  async chat(id) {
    const meta = await this.chatMeta(id);
    const rows = await this.ctx.storage.list({ prefix: `msg:${id}:` });
    return { meta, messages: [...rows.values()] };
  }

  async setBusy(id, until) {
    const meta = await this.chatMeta(id);
    if (meta.count === 0 && until) await this.#prune();
    meta.busyUntil = until;
    await this.ctx.storage.put(`chat:${id}`, meta);
  }

  // Appends one finished turn. Within a thread nothing earlier is ever rewritten.
  // planVersion is the plan the model has now seen in full.
  async saveTurn(id, messages, lastInputTokens, planVersion) {
    const meta = await this.chatMeta(id);
    const rows = {};
    messages.forEach((m, i) => (rows[`msg:${id}:${String(meta.count + i).padStart(4, "0")}`] = m));
    meta.count += messages.length;
    meta.turns += 1;
    meta.lastInputTokens = lastInputTokens;
    meta.planVersion = planVersion;
    meta.updated = Date.now();
    meta.busyUntil = 0;
    await this.ctx.storage.put({ ...rows, [`chat:${id}`]: meta });
    return meta;
  }

  // A long chat starts a fresh thread that opens with a summary of everything before it
  async restart(id, summary) {
    const meta = await this.chatMeta(id);
    await this.#deleteRows(id);
    const next = { ...meta, turns: 0, lastInputTokens: 0, count: 0, summary, planVersion: null, summaries: (meta.summaries || 0) + 1, updated: Date.now() };
    await this.ctx.storage.put(`chat:${id}`, next);
    return next;
  }

  async #deleteRows(id) {
    const keys = [...(await this.ctx.storage.list({ prefix: `msg:${id}:` })).keys()];
    // delete() takes at most 128 keys at a time
    for (let i = 0; i < keys.length; i += 128) await this.ctx.storage.delete(keys.slice(i, i + 128));
  }

  async #prune() {
    const cutoff = Date.now() - CHAT_DAYS * 864e5;
    const metas = await this.ctx.storage.list({ prefix: "chat:" });
    for (const [key, meta] of metas) {
      if ((meta.updated || meta.created) >= cutoff) continue;
      await this.#deleteRows(key.slice(5));
      await this.ctx.storage.delete(key);
    }
  }

  // Today's usage in Japan time
  async budget() {
    const day = japanTime().date;
    return (await this.ctx.storage.get(`budget:${day}`)) || { day, messages: 0, tokens: 0 };
  }

  async spend({ messages = 0, tokens = 0 }) {
    const b = await this.budget();
    b.messages += messages;
    b.tokens += tokens;
    await this.ctx.storage.put(`budget:${b.day}`, b);
    return b;
  }
}
