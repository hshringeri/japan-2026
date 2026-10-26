"""Extract the original single-page guide into data/places.json, data/guide.json and img/.

Usage: python3 tools/extract.py [source.html]
Defaults to the last single-file version of index.html in git history.
"""
import base64, hashlib, html, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_COMMIT = "8ee240f"


def load_source():
    if len(sys.argv) > 1:
        return open(sys.argv[1], encoding="utf-8").read()
    return subprocess.run(["git", "show", f"{SOURCE_COMMIT}:index.html"], cwd=ROOT,
                          capture_output=True, text=True, check=True).stdout


def text(fragment):
    return html.unescape(re.sub(r"<[^>]+>", "", fragment)).strip()


def slug(s):
    s = html.unescape(s).lower().replace("&", " ")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def save_image(data_uri, name):
    m = re.match(r"data:image/(\w+);base64,(.*)", data_uri, re.S)
    ext = "jpg" if m.group(1) == "jpeg" else m.group(1)
    os.makedirs(os.path.join(ROOT, "img/original"), exist_ok=True)
    with open(os.path.join(ROOT, f"img/original/{name}.{ext}"), "wb") as f:
        f.write(base64.b64decode(m.group(2)))
    # The app serves a resized copy (tools/resize-images.sh); the original stays for tools/check.py
    return f"img/{name}.{ext}"


def figure(fig_html, name):
    img = re.search(r'<img src="([^"]+)" alt="([^"]*)">', fig_html)
    cap = re.search(r"<figcaption>(.*?)</figcaption>", fig_html, re.S)
    return {"img": save_image(img.group(1), name), "alt": html.unescape(img.group(2)),
            "caption": cap.group(1) if cap else None}


ARTICLE = re.compile(
    r'<article class="e"><h4>(?:<a href="(?P<url>[^"]+)" target="_blank" rel="noopener">(?P<lname>.*?) <span class="arr">↗</span></a>|(?P<name>.*?))</h4>'
    r'<p class="d">(?P<desc>.*?)</p>'
    r'<p class="m"><a class="map" href="(?P<map>[^"]+)" target="_blank" rel="noopener">⌖ (?P<addr>.*?)</a>(?: · (?P<info>.*?))?</p></article>',
    re.S)


def parse_article(a):
    m = ARTICLE.fullmatch(a)
    if not m:
        raise ValueError("unrecognised entry markup: " + a[:200])
    return {
        "name": html.unescape(m["lname"] if m["url"] else m["name"]),
        "url": html.unescape(m["url"]) if m["url"] else None,
        "desc": html.unescape(m["desc"]),
        "address": html.unescape(m["addr"]),
        "mapUrl": html.unescape(m["map"]),
        "info": html.unescape(m["info"]) if m["info"] is not None else None,
    }


def main():
    src = load_source()
    places, order = {}, []

    def add_listing(city, hood, category, a):
        e = parse_article(a)
        pid = f"{city}-{slug(e['name'])}"
        if pid not in places:
            places[pid] = {"id": pid, "city": city, "name": e["name"], "hood": hood, "listings": []}
            order.append(pid)
        e.pop("name")
        places[pid]["listings"].append({"category": category, **e})
        return pid

    # Cover, intro and house rules
    cover_html = re.search(r'<header class="cover meme">(.*?)</header>', src, re.S).group(1)
    issue = re.findall(r"<span>(.*?)</span>", re.search(r'<div class="issue">(.*?)</div>', cover_html).group(1))
    guide = {
        "title": text(re.search(r"<title>(.*?)</title>", src).group(1)),
        "cover": {
            **figure(re.search(r'<img [^>]+>', cover_html).group(0) + re.search(r"<figcaption>.*?</figcaption>", cover_html, re.S).group(0), "cover"),
            "issue": [html.unescape(s) for s in issue],
            "lede": re.search(r'<p class="lede">(.*?)</p>', cover_html, re.S).group(1),
            "chips": [html.unescape(c) for c in re.findall(r"<li>(.*?)</li>", cover_html)],
            "mast": re.search(r'<h1 class="mast">(.*?)</h1>', cover_html).group(1),
        },
        "manifesto": re.search(r'<aside class="manifesto">(.*?)</aside>', src, re.S).group(1),
        "discovery": re.search(r'<p class="cornersrc">(.*?)</p>', src, re.S).group(1),
        "toc": [{"href": h, "html": t} for h, t in re.findall(r'<nav class="toc">.*?</nav>', src, re.S) and
                re.findall(r'<a (?:class="sub" )?href="([^"]+)">(.*?)</a>', re.search(r'<nav class="toc">(.*?)</nav>', src, re.S).group(1))],
        "tocNote": re.search(r'</nav>\s*<p style="[^"]*">(.*?)</p>', src, re.S).group(1),
        "rules": {
            "title": re.search(r'<div class="rules"><h3>(.*?)</h3>', src).group(1),
            "items": re.findall(r"<li>(.*?)</li>", re.search(r'<div class="rules">.*?</ul>', src, re.S).group(0)),
        },
        "cities": [],
        "footer": re.search(r"<footer>(.*?)</footer>", src, re.S).group(1),
    }

    # Cities: a flat sequence of blocks in page order
    sections = re.findall(r'<section class="city" id="(\w+)">(.*?)</section>', src, re.S)
    band_n = 0
    for city, body in sections:
        if city == "tokyo":
            body = body.split('<div id="t-bycat"')[0]
        head = re.search(r'<div class="cityhead">(.*?)</div></div>', body, re.S).group(1)
        ttl = re.search(r'<span class="num">(.*?)</span><h2>(.*?)</h2><span class="jp">(.*?)</span>', head)
        c = {
            "id": city, "num": ttl.group(1), "name": ttl.group(2), "jp": ttl.group(3),
            "hero": figure(re.search(r'<figure class="hero">(.*?)</figure>', head, re.S).group(1), f"{city}-hero"),
            "dek": re.search(r'<p class="dek">(.*?)</p>', body, re.S).group(1),
            "blocks": [],
        }
        hood = None
        token = re.compile(
            r'<div class="hood" id="(?P<hid>[^"]+)"><h3 class="hoodttl">(?P<hname>.*?)</h3><p class="hooddek">(?P<hdek>.*?)</p>'
            r'|<div class="cat"(?: id="(?P<cid>[^"]+)")?><h3>(?P<cname>.*?)</h3><div class="grid">(?P<cbody>.*?</article>)</div>'
            r'|<figure class="band">(?P<band>.*?)</figure>'
            r'|<aside class="(?P<akind>tip|gone)">(?P<abody>.*?)</aside>', re.S)
        for m in token.finditer(body):
            if m["hid"]:
                hood = html.unescape(m["hname"])
                c["blocks"].append({"type": "hood", "id": m["hid"], "name": hood, "dek": m["hdek"]})
            elif m["cname"]:
                cat = html.unescape(m["cname"])
                ids = [add_listing(city, hood, cat, a) for a in re.findall(r'<article class="e">.*?</article>', m["cbody"], re.S)]
                c["blocks"].append({"type": "category", "id": m["cid"], "name": cat, "places": ids})
            elif m["band"] is not None:
                band_n += 1
                c["blocks"].append({"type": "band", **figure(m["band"], f"band-{band_n}")})
            else:
                c["blocks"].append({"type": m["akind"], "html": m["abody"]})
        guide["cities"].append(c)

    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    with open(os.path.join(ROOT, "data/places.json"), "w", encoding="utf-8") as f:
        json.dump([places[p] for p in order], f, ensure_ascii=False, indent=1)
    with open(os.path.join(ROOT, "data/guide.json"), "w", encoding="utf-8") as f:
        json.dump(guide, f, ensure_ascii=False, indent=1)
    n_listings = sum(len(p["listings"]) for p in places.values())
    print(f"{len(places)} places, {n_listings} listings, {len(guide['cities'])} cities")


if __name__ == "__main__":
    main()
