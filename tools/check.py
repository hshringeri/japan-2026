"""Prove the data files hold everything the original single-page guide had.

Rebuilds every entry's original HTML from data/places.json and compares it, in page order,
with the source. Every editorial fragment in data/guide.json must appear verbatim in the
source, every image must match its original bytes, and every non-entry text run in the
source must be accounted for.

Usage: python3 tools/check.py [source.html]
"""
import base64, html, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract import ROOT, load_source  # noqa: E402


def esc(s):
    return html.escape(s, quote=True)


def render_listing(name, l):
    if l["url"]:
        h4 = f'<a href="{esc(l["url"])}" target="_blank" rel="noopener">{esc(name)} <span class="arr">↗</span></a>'
    else:
        h4 = esc(name)
    info = f' · {esc(l["info"])}' if l["info"] is not None else ""
    return (f'<article class="e"><h4>{h4}</h4><p class="d">{esc(l["desc"])}</p>'
            f'<p class="m"><a class="map" href="{esc(l["mapUrl"])}" target="_blank" rel="noopener">⌖ {esc(l["address"])}</a>{info}</p></article>')


def main():
    src = load_source()
    places = {p["id"]: p for p in json.load(open(os.path.join(ROOT, "data/places.json"), encoding="utf-8"))}
    guide = json.load(open(os.path.join(ROOT, "data/guide.json"), encoding="utf-8"))
    errors = []

    # 1. Entries, in page order, rebuilt byte for byte
    rebuilt = []
    used = {pid: 0 for pid in places}
    for city in guide["cities"]:
        for b in city["blocks"]:
            if b["type"] != "category":
                continue
            for pid in b["places"]:
                p = places[pid]
                matches = [l for l in p["listings"] if l["category"] == b["name"]]
                rebuilt.append(render_listing(p["name"], matches[0]))
                used[pid] += 1
    body = src.split('<div id="t-bycat"')[0] + src.split('<section class="city" id="osaka">')[1]
    original = re.findall(r'<article class="e">.*?</article>', body, re.S)
    if len(original) != len(rebuilt):
        errors.append(f"entry count: original {len(original)}, rebuilt {len(rebuilt)}")
    for i, (o, r) in enumerate(zip(original, rebuilt)):
        # A name that had no link in the source may gain one in the data; that is an
        # addition, not a change, so compare it unwrapped. A source link that changed
        # or vanished still shows up as a difference.
        if not re.match(r'<article class="e"><h4><a ', o):
            r = re.sub(r'^<article class="e"><h4><a [^>]*>(.*?) <span class="arr">↗</span></a></h4>',
                       r'<article class="e"><h4>\1</h4>', r)
        if o != r:
            errors.append(f"entry {i} differs:\n  original: {o[:300]}\n  rebuilt:  {r[:300]}")
    for pid, n in used.items():
        if n != len(places[pid]["listings"]):
            errors.append(f"{pid}: {len(places[pid]['listings'])} listings but referenced {n} times")

    # 2. Tokyo by-category view holds only entries already in the by-neighbourhood view
    bycat = src.split('<div id="t-bycat"')[1].split('<section class="city" id="osaka">')[0]
    missing = set(re.findall(r'<article class="e">.*?</article>', bycat, re.S)) - set(original)
    if missing:
        errors.append(f"{len(missing)} entries only exist in the Tokyo by-category view")

    # 3. Editorial fragments appear verbatim
    def must_contain(label, frag):
        if frag and frag not in src:
            errors.append(f"{label} not found verbatim: {frag[:120]}")

    c = guide["cover"]
    for k in ("lede", "mast", "caption"):
        must_contain(f"cover.{k}", c[k])
    for chip in c["chips"]:
        must_contain("cover chip", f"<li>{esc(chip).replace('&#x27;', chr(39))}</li>")
    for k in ("manifesto", "discovery", "tocNote", "footer"):
        must_contain(k, guide[k])
    must_contain("rules.title", guide["rules"]["title"])
    for li in guide["rules"]["items"]:
        must_contain("rule", f"<li>{li}</li>")
    for t in guide["toc"]:
        must_contain("toc", t["html"])
    for city in guide["cities"]:
        for k in ("dek", "name", "jp"):
            must_contain(f"{city['id']}.{k}", city[k])
        must_contain(f"{city['id']}.hero.caption", city["hero"]["caption"])
        for b in city["blocks"]:
            if b["type"] == "hood":
                must_contain("hood dek", f'<p class="hooddek">{b["dek"]}</p>')
            elif b["type"] in ("tip", "gone"):
                must_contain(b["type"], f'<aside class="{b["type"]}">{b["html"]}</aside>')
            elif b["type"] == "band":
                must_contain("band caption", b["caption"])

    # 4. Images match the original bytes
    figs = [guide["cover"]] + [x for city in guide["cities"] for x in [city["hero"]] + [b for b in city["blocks"] if b["type"] == "band"]]
    originals = {base64.b64decode(m) for m in re.findall(r"data:image/\w+;base64,([A-Za-z0-9+/=]+)", src)}
    for f in figs:
        if open(os.path.join(ROOT, "img/original", os.path.basename(f["img"])), "rb").read() not in originals:
            errors.append(f"image {f['img']} does not match any original")
    if len(figs) != len(originals):
        errors.append(f"image count: original {len(originals)}, extracted {len(figs)}")

    # 5. No stray text: strip everything accounted for and see what visible text is left
    rest = re.sub(r"<head>.*?</head>|<script>.*?</script>|<div id=\"t-bycat\".*?(?=<section class=\"city\" id=\"osaka\">)", "", src, flags=re.S)
    rest = re.sub(r'<article class="e">.*?</article>|<nav class="(?:hoodnav|catindex|toc)">.*?</nav>|<div class="tview".*?</div>', "", rest, flags=re.S)
    fragments = [c["lede"], c["mast"], c["caption"], guide["manifesto"], guide["discovery"], guide["tocNote"],
                 guide["footer"], guide["rules"]["title"], *guide["rules"]["items"], *c["issue"], "In this issue"]
    for city in guide["cities"]:
        fragments += [city["dek"], city["hero"]["caption"], city["num"], city["name"], city["jp"]]
        for b in city["blocks"]:
            fragments += {"hood": lambda: [b["dek"], html.escape(b["name"], quote=False)],
                          "category": lambda: [html.escape(b["name"], quote=False)],
                          "band": lambda: [b["caption"]],
                          "tip": lambda: [b["html"]], "gone": lambda: [b["html"]]}[b["type"]]()
    fragments += [f"<li>{esc(ch).replace('&#x27;', chr(39))}</li>" for ch in c["chips"]]
    for frag in sorted(set(fragments), key=len, reverse=True):
        rest = rest.replace(frag, "")
    leftover = text = html.unescape(re.sub(r"<[^>]+>", " ", rest))
    leftover = " ".join(text.split())
    if leftover:
        errors.append(f"unaccounted text: {leftover[:500]}")

    n_listings = sum(len(p["listings"]) for p in places.values())
    if errors:
        print("FAIL")
        print("\n".join(errors[:40]))
        sys.exit(1)
    print(f"OK: {len(rebuilt)} entries rebuilt byte for byte apart from new name links ({len(places)} places, {n_listings} listings), "
          f"{len(figs)} images identical, no unaccounted text")


if __name__ == "__main__":
    main()
