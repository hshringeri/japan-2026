// Japan time and opening hours. No DOM or location access, so the Worker imports this too.

// The trip runs on Japan time whatever the phone is set to
const JP = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
export function japanTime(date = new Date()) {
  const p = Object.fromEntries(JP.formatToParts(date).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: +p.hour * 60 + +p.minute, time: `${p.hour}:${p.minute}` };
}

export const toMinutes = (hhmm) => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

// Opening hours, from data/hours.json. Times past midnight run on ("25:00" is 1 a.m. the next day).
export const WEEK = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const WEEK_NAME = { sun: "Sun", mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat" };
const clock = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
export const weekdayOf = (iso) => new Date(iso + "T00:00:00Z").getUTCDay();
const spans = (w, day) => (w[WEEK[(day + 7) % 7]] || []).map(([a, b]) => [toMinutes(a), toMinutes(b)]);

// Open or closed right now, Japan time: { label, cls } or null when there's nothing to say
export function openState(p, now) {
  const h = p.hours;
  if (!h) return null;
  if (h.kind === "closed") return { label: "Closed for good", cls: "gone" };
  if (h.kind === "events") return { label: "Show nights", cls: "ev" };
  if (h.kind === "irregular" || !h.week) return { label: "Hours vary", cls: "var" };
  const day = weekdayOf(now.date), t = now.minutes;
  // Still open from last night counts too
  const open = [...spans(h.week, day).map(([a, b]) => [a, b]), ...spans(h.week, day - 1).map(([a, b]) => [a - 1440, b - 1440])]
    .find(([a, b]) => a <= t && t < b);
  if (open) {
    if (open[1] - open[0] >= 1440) return { label: "Open 24 hours", cls: "open" };
    return open[1] - t <= 60 ? { label: `Closes soon · ${clock(open[1])}`, cls: "soon" } : { label: `Open · until ${clock(open[1])}`, cls: "open" };
  }
  for (let d = 0; d < 8; d++) {
    const next = spans(h.week, day + d).map(([a]) => a).filter((a) => d > 0 || a > t).sort((x, y) => x - y)[0];
    if (next != null) return { label: `Closed · opens ${d === 0 ? "" : d === 1 ? "tomorrow " : WEEK_NAME[WEEK[(day + d) % 7]] + " "}${clock(next)}`, cls: "shut" };
  }
  return { label: "Closed", cls: "shut" };
}

// One day's hours as text, for looking ahead to a trip day
export function hoursOn(p, iso) {
  const h = p.hours;
  if (!h?.week) return null;
  const s = spans(h.week, weekdayOf(iso));
  return s.length ? s.map(([a, b]) => `${clock(a)}–${clock(b)}`).join(", ") : "Closed";
}

// The week as rows for the place page, starting Monday
export function weekRows(p, today) {
  if (!p.hours?.week) return [];
  return [1, 2, 3, 4, 5, 6, 0].map((d) => ({
    day: WEEK_NAME[WEEK[d]], today: weekdayOf(today) === d,
    hours: spans(p.hours.week, d).map(([a, b]) => `${clock(a)}–${clock(b)}`).join(", ") || "Closed",
  }));
}
