"""Build data/hours.json: each place's opening hours as text plus, where it can be read, a week.

Hours come from tools/hours-manual.json when a place has an entry there, else from the hours
written in the place's info line ("Tue–Fri 11:30–14:30 & 18:00–20:30, closed Mon").

Each entry: {"text": shown as is, "week": {"mon": [["17:00", "24:00"]], ...} or null, "kind": ...}
  kind "regular"   fixed weekly hours, so the app can say open or closed right now
       "events"    a live house or club: doors depend on the night's show
       "irregular" opens on days it posts (Instagram, calendar), so check before going
       "closed"    no longer operating
Times past midnight run on ("25:00" is 1 a.m.). Run with --report to list what didn't parse.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
NAMES = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}

TIME = r"(\d{1,2})(?::(\d{2}))?"
RANGE = re.compile(rf"{TIME}\s*[–-]\s*{TIME}")
DAY = r"(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*"
DAYSPEC = re.compile(rf"\b({DAY}(?:\s*[–/-]\s*{DAY})*(?:\s*,\s*{DAY})*|daily|weekdays?|weekends?|every day)\b", re.I)
HOURISH = re.compile(rf"{TIME}\s*[–-]\s*{TIME}|\bclosed\b|\bfrom \d", re.I)


def days_of(spec):
    s = spec.lower()
    if s in ("daily", "every day"):
        return set(range(7))
    if s.startswith("weekday"):
        return {0, 1, 2, 3, 4}
    if s.startswith("weekend"):
        return {5, 6}
    out = set()
    for part in re.split(r"\s*[/,]\s*", s):
        ends = [NAMES[d[:3]] for d in re.findall(DAY, part, re.I)]
        if len(ends) == 2 and re.search(r"[–-]", part):
            a, b = ends
            out |= {d % 7 for d in range(a, b + (7 if b < a else 0) + 1)}
        else:
            out |= set(ends)
    return out


def hhmm(h, m):
    return f"{int(h):02d}:{m or '00'}"


def ranges(text):
    out = []
    for h1, m1, h2, m2 in RANGE.findall(text):
        a, b = int(h1) * 60 + int(m1 or 0), int(h2) * 60 + int(m2 or 0)
        if int(h1) > 30 or int(h2) > 30:
            continue
        # "13–05" and "18:30–01:30" run past midnight
        if b <= a:
            b += 24 * 60
        out.append([hhmm(*divmod(a, 60)), f"{b // 60:02d}:{b % 60:02d}"])
    return out


def parse(text):
    """Text like 'Tue–Fri 11:30–14:30 & 18:00–20:30, closed Mon' → week dict, or None."""
    week = {d: None for d in DAYS}  # None = not stated, [] = closed
    base = None
    # Overrides in brackets: "6:00–23:00 (Tue 11:00–23:00)"
    text = re.sub(r"\(([^)]*)\)", r", \1", text)
    clauses = [c.strip() for c in re.split(r"[,;·]|\bbut\b", text) if c.strip()]
    for c in clauses:
        low = c.lower()
        if "closed" in low or "holiday" in low and DAYSPEC.search(c):
            spec = DAYSPEC.search(c)
            if spec and not RANGE.search(c):
                for d in days_of(spec.group(1)):
                    week[DAYS[d]] = []
                continue
        r = ranges(c)
        if not r:
            continue
        spec = DAYSPEC.search(c)
        if spec and spec.start() < RANGE.search(c).start():
            for d in days_of(spec.group(1)):
                week[DAYS[d]] = r
        elif base is None:
            base = r
    if base is None and all(v is None for v in week.values()):
        return None
    for d in DAYS:
        if week[d] is None:
            week[d] = base if base is not None else []
    return week


def hours_text(info):
    """The part of an info line that gives hours: the ' · ' segments with times or 'closed'."""
    segs = [s.strip() for s in (info or "").split(" · ")]
    # Ranges that aren't hours: "7–8 seats", "20–30 min trail", "15–17 Jan", "100 cap"
    keep = [s for s in segs if HOURISH.search(s) and not re.search(
        r"[¥]|\bcap\b|\bmin\b|seats?\b|people|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b|tickets?", s, re.I)]
    return " · ".join(keep)


def main():
    places = json.load(open(os.path.join(ROOT, "data/places.json")))
    manual_path = os.path.join(ROOT, "tools/hours-manual.json")
    manual = json.load(open(manual_path)) if os.path.exists(manual_path) else {}
    manual.pop("_note", None)
    unknown = set(manual) - {p["id"] for p in places}
    if unknown:
        sys.exit(f"hours-manual.json has ids not in places.json: {sorted(unknown)}")
    out, report = {}, []
    for p in places:
        m = manual.get(p["id"])
        if m:
            entry = {"text": m["text"], "kind": m.get("kind", "regular")}
            week = m["week"] if "week" in m else (parse(m.get("parse", m["text"])) if entry["kind"] == "regular" else None)
            if m.get("source"):
                entry["source"] = m["source"]
        else:
            text = hours_text(p["listings"][0].get("info"))
            if not text:
                report.append(f"NO HOURS  {p['id']}")
                continue
            irregular = re.search(r"irregular|vary|varies|until sold out|seatings", text, re.I)
            entry = {"text": text, "kind": "regular"}
            week = parse(text)
            if irregular and not week:
                entry["kind"] = "irregular"
        if entry["kind"] == "regular":
            if week and any(week.values()):
                entry["week"] = week
            else:
                report.append(f"TEXT ONLY {p['id']:45} {entry['text']}")
        out[p["id"]] = entry
    json.dump(out, open(os.path.join(ROOT, "data/hours.json"), "w"), ensure_ascii=False, indent=1)
    kinds = {}
    for e in out.values():
        k = e["kind"] + ("" if e["kind"] != "regular" or "week" in e else " (text only)")
        kinds[k] = kinds.get(k, 0) + 1
    print(f"{len(out)}/{len(places)} places have hours: {kinds}")
    if "--report" in sys.argv:
        print("\n".join(report))


if __name__ == "__main__":
    main()
