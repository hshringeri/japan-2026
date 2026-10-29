import { DurableObject } from "cloudflare:workers";
import { applyOps, seedItems, PlanError } from "./plan.js";
import { loadData } from "./context.js";
import { findSame, newPlaceId } from "./places.js";
import { LIMITS } from "./limits.js";
import { japanTime } from "../../js/hours.js";

const CHAT_DAYS = 45;      // chats nobody has used for this long are deleted
const HISTORY = 30;        // recent plan changes kept for the chat's context
const PROPOSAL_DAYS = 3;   // a suggested place can be added for this long

// One instance, named "trip", holds everything shared: the live plan, the places the chat added,
// chat threads and the group's daily budget. A Durable Object runs one request at a time, so
// edits never interleave.
export class Trip extends DurableObject {
  async #data() {
    return loadData(this.env);
  }

  async #ctx() {
    const data = await this.#data();
    const places = [...data.places, ...(await this.livePlaces()).items];
    return {
      people: data.trip.people,
      dates: data.trip.days.map((d) => d.date),
      placeIds: new Set(places.map((p) => p.id)),
      placeCoords: Object.fromEntries(places.filter((p) => p.lat != null).map((p) => [p.id, { lat: p.lat, lng: p.lng }])),
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

  // Places the chat added. Removed ones stay in storage, marked, so a removal can be undone.
  async places() {
    return (await this.ctx.storage.get("places")) || { version: 0, items: [] };
  }

  async livePlaces() {
    const all = await this.places();
    return { version: all.version, items: all.items.filter((p) => !p.removed) };
  }

  // Keeps candidate places until someone confirms one. Each is { place, chatId } and gets an id.
  async propose(list, chatId) {
    const now = Date.now();
    const old = await this.ctx.storage.list({ prefix: "prop:" });
    const stale = [...old].filter(([, v]) => v.at < now - PROPOSAL_DAYS * 864e5).map(([k]) => k);
    if (stale.length) await this.ctx.storage.delete(stale.slice(0, 128));
    const rows = {};
    const ids = list.map(({ place }) => {
      const id = crypto.randomUUID().slice(0, 8);
      rows[`prop:${id}`] = { place, chatId, at: now };
      return id;
    });
    await this.ctx.storage.put(rows);
    return ids;
  }

  // Saves a proposed place. From the chat, the proposal must be this chat's and from an earlier
  // message (before), so the model can't suggest and add in one go. Errors come back as { error }.
  async addProposal(id, { chatId, before } = {}) {
    const prop = await this.ctx.storage.get(`prop:${id}`);
    if (!prop) return { error: "That suggestion has expired. Ask for the place again." };
    if (chatId && prop.chatId !== chatId) return { error: "That suggestion came from another chat." };
    if (before && prop.at >= before) return { error: "Wait for them to confirm which place before adding it." };
    const all = await this.places();
    const done = prop.added && all.items.find((p) => p.id === prop.added);
    if (done && !done.removed) return { place: done, version: all.version, already: true };

    const data = await this.#data();
    const live = all.items.filter((p) => !p.removed);
    const same = findSame(prop.place.name, prop.place, [...data.places, ...live]);
    if (same) return { error: `${same.name} is already on the map.`, same };
    // Added before and taken off since: put the same one back
    if (done) return this.setRemoved(done.id, false);
    const day = await this.budget();
    if ((day.places || 0) >= LIMITS.dayPlaces) return { error: `The group has added ${LIMITS.dayPlaces} places today, the daily limit. Try again tomorrow.` };

    const taken = new Set([...data.places, ...all.items].map((p) => p.id));
    const place = { id: newPlaceId(prop.place.name, taken), ...prop.place, addedAt: Date.now() };
    const next = { version: all.version + 1, items: [...all.items, place] };
    day.places = (day.places || 0) + 1;
    await this.ctx.storage.put({ places: next, [`prop:${id}`]: { ...prop, added: place.id }, [`budget:${day.day}`]: day });
    return { place, version: next.version };
  }

  async setRemoved(id, removed) {
    const all = await this.places();
    const place = all.items.find((p) => p.id === id);
    if (!place) return { error: "Only places the chat added can be removed." };
    if (!!place.removed === removed) return { place, version: all.version };
    if (removed) place.removed = Date.now();
    else delete place.removed;
    const next = { version: all.version + 1, items: all.items };
    await this.ctx.storage.put("places", next);
    return { place, version: next.version };
  }

  async chatMeta(id) {
    return (await this.ctx.storage.get(`chat:${id}`)) || { turns: 0, lastInputTokens: 0, count: 0, created: Date.now(), summary: null, planVersion: null, placesVersion: null };
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
  // planVersion and placesVersion are the plan and chat places the model has now seen in full.
  async saveTurn(id, messages, lastInputTokens, planVersion, placesVersion) {
    const meta = await this.chatMeta(id);
    const rows = {};
    messages.forEach((m, i) => (rows[`msg:${id}:${String(meta.count + i).padStart(4, "0")}`] = m));
    meta.count += messages.length;
    meta.turns += 1;
    meta.lastInputTokens = lastInputTokens;
    meta.planVersion = planVersion;
    meta.placesVersion = placesVersion;
    meta.updated = Date.now();
    meta.busyUntil = 0;
    await this.ctx.storage.put({ ...rows, [`chat:${id}`]: meta });
    return meta;
  }

  // A long chat starts a fresh thread that opens with a summary of everything before it
  async restart(id, summary) {
    const meta = await this.chatMeta(id);
    await this.#deleteRows(id);
    const next = { ...meta, turns: 0, lastInputTokens: 0, count: 0, summary, planVersion: null, placesVersion: null, summaries: (meta.summaries || 0) + 1, updated: Date.now() };
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
    return (await this.ctx.storage.get(`budget:${day}`)) || { day, messages: 0, tokens: 0, places: 0 };
  }

  async spend({ messages = 0, tokens = 0 }) {
    const b = await this.budget();
    b.messages += messages;
    b.tokens += tokens;
    await this.ctx.storage.put(`budget:${b.day}`, b);
    return b;
  }
}
