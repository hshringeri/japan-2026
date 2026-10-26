import { fold, storage } from "./util.js";

// One filter shared by the list and the map. Levels drill down in this order:
// city → area → kind → category → detail tags (cuisine, genre, style) → practical flags.
const EMPTY = { city: null, area: null, kind: null, category: null, tags: [], q: "" };

const listeners = new Set();
const preset = new URLSearchParams(location.search).get("f");
export const filter = { ...EMPTY, ...(preset ? JSON.parse(preset) : storage.get("filter", {})) };

export function setFilter(patch) {
  Object.assign(filter, patch);
  // Dropping a level clears the levels that only make sense beneath it
  if ("city" in patch && !patch.city) filter.area = null;
  if ("city" in patch && patch.city && filter.area && !patch.area) filter.area = null;
  if ("kind" in patch && patch.kind !== undefined) {
    filter.category = null;
    filter.tags = filter.tags.filter((t) => t.startsWith("flags:"));
  }
  storage.set("filter", { ...filter, q: "" });
  listeners.forEach((fn) => fn(filter));
}
export const clearFilter = () => setFilter({ ...EMPTY });
export const onFilter = (fn) => listeners.add(fn);

export function toggleTag(tag) {
  const tags = filter.tags.includes(tag) ? filter.tags.filter((t) => t !== tag) : [...filter.tags, tag];
  setFilter({ tags });
}

export function matches(p, f = filter) {
  if (f.city && p.city !== f.city) return false;
  if (f.area && p.area !== f.area) return false;
  if (f.kind && !p.kinds.includes(f.kind)) return false;
  if (f.category && !p.categories.includes(f.category)) return false;
  const byFacet = {};
  for (const t of f.tags) {
    const [facet, value] = t.split(/:(.*)/s);
    (byFacet[facet] ||= []).push(value);
  }
  for (const [facet, values] of Object.entries(byFacet)) {
    const have = p.tags?.[facet] || [];
    // Flags narrow (cash only AND open late); other facets widen (sushi OR ramen)
    if (facet === "flags" ? !values.every((v) => have.includes(v)) : !values.some((v) => have.includes(v))) return false;
  }
  if (f.q) {
    for (const word of f.q.split(/\s+/).map(fold).filter(Boolean)) {
      if (!p.search.includes(word)) return false;
    }
  }
  return true;
}

function counts(list, valuesOf) {
  const m = new Map();
  for (const p of list) for (const v of new Set(valuesOf(p))) if (v) m.set(v, (m.get(v) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(b[0]));
}

const FACET_FOR_KIND = { eat: "cuisine", music: "genre", shop: "style" };

// The chips to offer next, given what's already picked
export function suggestions(places, data, f = filter) {
  const results = places.filter((p) => matches(p, f));
  const groups = [];
  const add = (key, label, entries, opts = {}) => {
    let chips = entries.map(([value, count]) => ({ key, value, count, label: opts.name ? opts.name(value) : value }));
    if (opts.narrowOnly) chips = chips.filter((c) => c.count < results.length);
    if (chips.length > (opts.min ?? 1)) groups.push({ key, label, chips });
  };

  const kindsHere = counts(results, (p) => p.kinds);
  const kind = f.kind || (kindsHere.length === 1 ? kindsHere[0][0] : null);

  const place = () => {
    if (!f.city) add("city", "City", counts(results, (p) => [p.city]), { name: (v) => data.cityName[v], min: 0 });
    else if (!f.area) add("area", "Area", counts(results, (p) => [p.area]));
  };
  const what = () => {
    if (!f.kind) add("kind", "What", kindsHere, { name: (v) => data.kindName[v] });
    if (kind && !f.category) {
      const cats = counts(results, (p) => p.categories.filter((c) => data.taxonomy.kinds.find((k) => k.id === kind).categories.includes(c)));
      add("category", "Type", cats);
    }
    const facet = FACET_FOR_KIND[kind];
    if (facet) {
      add(facet, null, counts(results, (p) => p.tags?.[facet] || []).filter(([v]) => !f.tags.includes(`${facet}:${v}`)), { narrowOnly: true, min: 0 });
    }
  };
  // Once you've said what you want (Eat), its types and cuisines come before more places
  if (f.kind) { what(); place(); } else { place(); what(); }
  if (f.category || f.area || results.length <= 60) {
    add("flags", null, counts(results, (p) => p.tags?.flags || []).filter(([v]) => !f.tags.includes(`flags:${v}`)), { narrowOnly: true, min: 0 });
  }
  return { results, groups };
}

// What's picked, in drill-down order, for the breadcrumb chips
export function picked(data, f = filter) {
  const out = [];
  if (f.city) out.push({ key: "city", label: data.cityName[f.city] });
  if (f.area) out.push({ key: "area", label: f.area });
  if (f.kind) out.push({ key: "kind", label: data.kindName[f.kind] });
  if (f.category) out.push({ key: "category", label: f.category });
  for (const t of f.tags) out.push({ key: "tag", value: t, label: t.split(/:(.*)/s)[1] });
  return out;
}

export function applyChip(key, value) {
  if (key === "city" || key === "area" || key === "kind" || key === "category") setFilter({ [key]: value });
  else toggleTag(`${key}:${value}`);
}

export function removePicked(item) {
  if (item.key === "tag") toggleTag(item.value);
  else setFilter({ [item.key]: null });
}
