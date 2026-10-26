"""Find one photo per place and write data/photos.json.

Tries, in order:
  1. the place's own website (its og:image / twitter:image), checked to be a real photo, not a logo
  2. Wikimedia Commons, searched by the place's name (temples, shrines, baths, landmarks)
  3. Wikimedia Commons, the nearest geotagged photo to the place's coordinates
  4. Wikimedia Commons, a photo of the place's area

Images are linked, not copied into the repo. Each entry keeps its source and credit.
Re-running keeps existing entries; pass --refresh to redo them all, or ids to redo some.
"""
import io, json, math, os, re, sys, html, time, unicodedata
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin, urlparse, quote
import urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data/photos.json")
UA = "japan-2026-trip-guide/1.0 (https://github.com/hshringeri/japan-2026)"
BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"
SKIP_HOSTS = ("instagram.com", "facebook.com", "x.com", "twitter.com", "google.com", "goo.gl", "tiktok.com")
COMMONS = "https://commons.wikimedia.org/w/api.php"


def get(url, ua=BROWSER_UA, limit=4_000_000, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept-Language": "en,ja;q=0.8"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(limit), r.geturl(), r.headers.get("Content-Type", "")


def api(**params):
    params = {"format": "json", "formatversion": "2", **params}
    q = "&".join(f"{k}={quote(str(v))}" for k, v in params.items())
    # Commons rate-limits bursts; back off and retry
    for wait in (2, 5, 10, 20, 40, 60):
        try:
            return json.loads(get(f"{COMMONS}?{q}", ua=UA)[0])
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            time.sleep(wait)
    return json.loads(get(f"{COMMONS}?{q}", ua=UA)[0])


def looks_like_photo(url):
    """Fetch the image and keep it only if it's big enough and photo-shaped."""
    try:
        data, final, ctype = get(url)
        if "svg" in ctype or final.lower().endswith(".svg"):
            return False
        im = Image.open(io.BytesIO(data))
        w, h = im.size
        if w < 480 or h < 300 or not (0.6 <= w / h <= 2.4):
            return False
        # Logos and flat graphics have few colours
        small = im.convert("RGB").resize((64, 64))
        return len(set(small.getdata())) > 900
    except Exception:
        return False


def from_website(place):
    for l in place["listings"]:
        url = l.get("url")
        if not url or any(h in urlparse(url).netloc for h in SKIP_HOSTS):
            continue
        try:
            body, final, ctype = get(url, limit=600_000)
        except Exception:
            continue
        if "html" not in ctype:
            continue
        page = body.decode("utf-8", "ignore")
        for prop in ("og:image", "og:image:url", "twitter:image", "twitter:image:src"):
            for m in re.finditer(r"<meta[^>]+>", page, re.I):
                tag = m.group(0)
                if re.search(rf'(property|name)=["\']{re.escape(prop)}["\']', tag, re.I):
                    c = re.search(r'content=["\']([^"\']+)', tag, re.I)
                    if c:
                        src = urljoin(final, html.unescape(c.group(1).strip()))
                        if src.startswith("http") and src not in BLOCKED and url not in BLOCKED and looks_like_photo(src):
                            host = urlparse(final).netloc.replace("www.", "")
                            return {"src": src, "source": "site", "credit": host, "link": url}
    return None


def commons_info(titles):
    """Thumbnail URL, size and credit for File: titles, keeping photos only."""
    if not titles:
        return []
    titles = titles[:15]
    r = api(action="query", titles="|".join(titles), prop="imageinfo",
            iiprop="url|size|mime|extmetadata", iiurlwidth=900)
    out = []
    by_title = {p["title"]: p for p in r.get("query", {}).get("pages", [])}
    for t in titles:
        p = by_title.get(t)
        ii = (p or {}).get("imageinfo", [{}])[0]
        if ii.get("mime") not in ("image/jpeg", "image/webp", "image/png"):
            continue
        w, h = ii.get("width", 0), ii.get("height", 0)
        if w < 800 or not h or not (0.6 <= w / h <= 2.4):
            continue
        meta = ii.get("extmetadata", {})
        artist = re.sub(r"<[^>]+>", "", meta.get("Artist", {}).get("value", "")).strip()
        lic = meta.get("LicenseShortName", {}).get("value", "")
        try:
            lat, lng = float(meta["GPSLatitude"]["value"]), float(meta["GPSLongitude"]["value"])
        except (KeyError, ValueError):
            lat = lng = None
        out.append({"landscape": w >= h * 1.15, "lat": lat, "lng": lng, "src": ii["thumburl"], "credit": ", ".join(x for x in (artist[:60], lic) if x) or "Wikimedia Commons",
                    "link": ii["descriptionurl"], "title": t})
    return out


BAD_WORDS = re.compile(r"map|logo|plan|diagram|sign|seal|stamp|ticket|menu|receipt|chart|icon|flag|coat of arms|\.png$", re.I)


def fold(s):
    s = unicodedata.normalize("NFKD", s)
    return re.sub(r"[^a-z0-9]", "", "".join(c for c in s if not unicodedata.combining(c)).lower())


NOISE = re.compile(r"\b(temple|shrine|honten|tokyo|osaka|kyoto|the|bar|cafe|side halls?)\b|\(.*?\)", re.I)


def km(a_lat, a_lng, b_lat, b_lng):
    r = math.pi / 180
    h = math.sin((b_lat - a_lat) * r / 2) ** 2 + math.cos(a_lat * r) * math.cos(b_lat * r) * math.sin((b_lng - a_lng) * r / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def commons_by_name(place):
    name = place["name"]
    key = fold(NOISE.sub(" ", name))
    # Generic names ("Contact", "Ether") match unrelated files; only search distinctive ones
    if len(key) < 7:
        return None
    r = api(action="query", list="search", srnamespace=6, srlimit=15, srsearch=f'intitle:"{NOISE.sub(" ", name).strip()}"')
    # The file's own title has to name the place, not just its description
    titles = [s["title"] for s in r.get("query", {}).get("search", [])
              if not BAD_WORDS.search(s["title"]) and key in fold(s["title"])]
    # Same-named places elsewhere are common: a geotag has to be close, and without one the title has to say where
    where = {fold(w) for w in re.split(r"[ &,()/-]+", " ".join(
        [place["city"], place.get("area", ""), place.get("neighbourhood", ""), place.get("ward", ""), place.get("hood", "")])) if len(w) > 3}
    for c in commons_info(titles):
        if c["src"] in BLOCKED:
            continue
        if c["lat"] is not None and place.get("lat"):
            if km(place["lat"], place["lng"], c["lat"], c["lng"]) > 3:
                continue
        elif not any(w and w in fold(c["title"]) for w in where):
            continue
        return {**c, "source": "commons-name"}
    return None


GOOD_WORDS = re.compile(r"street|dori|d[oō]ri|shotengai|sh[oō]tengai|arcade|alley|yokocho|yokoch[oō]|building|bldg|exterior|"
                        r"entrance|facade|store|shop|night|town|avenue|crossing|district|neighbo|area|view|panoramio|cityscape", re.I)
SKIP_WORDS = re.compile(r"food|ramen|curry|sushi|meal|dish|lunch|dinner|breakfast|beer|drink|coffee|cake|noodle|rice|udon|soba|"
                        r"portrait|cosplay|selfie|people|girl|boy|man\b|woman|idol|concert|live|train|series|car\b|bus\b|"
                        r"cat\b|dog\b|bird|flower|plate|bowl|interior|ceiling|toilet|platform|kei|gyoza|yakitori|tofu|tempura|"
                        r"ラーメン|うどん|そば|蕎麦|定食|餃子|丼|カレー|寿司|焼|酒|麺|料理|ランチ|スカジャン", re.I)
USED = set()
# Photos rejected by eye: off-topic, misleading or (one hijacked site) spam
BLOCKED_PATH = os.path.join(ROOT, "tools/photos-blocked.txt")
BLOCKED = set(open(BLOCKED_PATH).read().split()) if os.path.exists(BLOCKED_PATH) else set()
USED_LOCK = __import__("threading").Lock()


def dark(src):
    try:
        data = get(re.sub(r"/\d+px-", "/120px-", src), ua=UA)[0]
        im = Image.open(io.BytesIO(data)).convert("L").resize((32, 32))
        return sum(im.getdata()) / 1024 < 60
    except Exception:
        return False


def commons_nearby(place, radii=(150, 400, 1000)):
    lat, lng = place["lat"], place["lng"]
    where = {fold(w) for w in re.split(r"[ &,()/-]+", " ".join(
        [place.get("area", ""), place.get("neighbourhood", ""), place.get("ward", "")])) if len(w) > 3}
    for radius in radii:
        r = api(action="query", list="geosearch", gsnamespace=6, gscoord=f"{lat}|{lng}", gsradius=radius, gslimit=60)
        geo = [g for g in r.get("query", {}).get("geosearch", []) if not BAD_WORDS.search(g["title"])]
        dist = {g["title"]: g["dist"] for g in geo}
        titles = [g["title"] for g in geo]
        cands = []
        for i in range(0, min(len(titles), 45), 15):
            cands += commons_info(titles[i:i + 15])

        def score(c):
            t = c["title"]
            sc = 0
            if GOOD_WORDS.search(t): sc += 3
            if SKIP_WORDS.search(t): sc -= 6
            if any(x and x in fold(t) for x in where): sc += 2
            return sc - dist.get(t, radius) / 150

        cands = [c for c in cands if c.get("landscape")]
        # Shops, bars and baths shouldn't show someone's dinner: their photo's title has to describe a street, building or the area
        floor = -4 if place["kinds"] == ["eat"] else 1
        for c in sorted(cands, key=score, reverse=True):
            if score(c) + (dist.get(c["title"], radius) / 150 if floor > 0 else 0) < floor or score(c) < -4:
                break
            # Reserve before the brightness check so two places can't take the same photo
            with USED_LOCK:
                if c["src"] in USED or c["src"] in BLOCKED or c["link"] in BLOCKED:
                    continue
                USED.add(c["src"])
            if dark(c["src"]):
                continue
            return {**c, "source": "commons-near", "radius": radius}
    return None


AREA_QUERY = {
    "Outskirts & day trips": None,  # too vague; falls back to the nearest photo with a wider radius
}


def commons_area(place):
    q = AREA_QUERY.get(place["area"], f'{place["area"].split(" & ")[0].split(" (")[0]} {place["city"].capitalize()} street')
    if not q:
        return None
    r = api(action="query", list="search", srnamespace=6, srlimit=15, srsearch=q)
    titles = [s["title"] for s in r.get("query", {}).get("search", []) if not BAD_WORDS.search(s["title"])]
    for c in commons_info(titles):
        with USED_LOCK:
            if c["src"] in USED or c["src"] in BLOCKED:
                continue
            USED.add(c["src"])
        return {**c, "source": "commons-area"}
    return None


def find(place):
    for step in (from_website, commons_by_name):
        try:
            hit = step(place)
            if hit:
                return hit
        except Exception as e:
            print("  ", place["id"], step.__name__, e, file=sys.stderr)
    try:
        if place.get("lat"):
            hit = commons_nearby(place)
            if hit:
                return hit
        hit = commons_area(place)
        if hit:
            return hit
        if place.get("lat"):
            return commons_nearby(place, radii=(3000, 15000))
    except Exception as e:
        print("  ", place["id"], "commons", e, file=sys.stderr)
    return None


def main():
    places = json.load(open(os.path.join(ROOT, "data/places.json")))
    have = json.load(open(OUT)) if os.path.exists(OUT) else {}
    args = sys.argv[1:]
    redo = set(a for a in args if not a.startswith("--"))
    USED.update(v["src"] for k, v in have.items() if k not in redo and "--refresh" not in args)
    if redo:
        todo = [p for p in places if p["id"] in redo]
    else:
        todo = [p for p in places if "--refresh" in args or p["id"] not in have]
    print(f"{len(todo)} to find")

    def work(p):
        hit = find(p)
        print(f"{p['id']:50} {hit['source'] if hit else 'NONE'}")
        return p["id"], hit

    with ThreadPoolExecutor(3) as pool:
        for pid, hit in pool.map(work, todo):
            if hit:
                for k in ("title", "lat", "lng", "landscape"):
                    hit.pop(k, None)
                have[pid] = hit
    order = [p["id"] for p in places]
    out = {k: have[k] for k in order if k in have}
    json.dump(out, open(OUT, "w"), ensure_ascii=False, indent=1)
    missing = [p["id"] for p in places if p["id"] not in out]
    from collections import Counter
    print(Counter(v["source"] for v in out.values()), "missing", len(missing), missing)


if __name__ == "__main__":
    main()
