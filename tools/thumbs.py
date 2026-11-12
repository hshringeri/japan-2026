"""Fill missing historical thumbnails while preserving current venue photos.

Commit bc0fa73 holds the original place photos. Missing thumbnails are cropped to
300x180 JPEGs with macOS `sips`. Existing images and credits in data/thumbs.json,
including later venue additions, are retained rather than deleted or overwritten.
Places no longer in data/places.json are omitted from the manifest.

Usage: python3 tools/thumbs.py
"""
import json, os, re, subprocess, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = "bc0fa73"
OUT = os.path.join(ROOT, "img/thumbs")
W, H = 300, 180


def git(*args):
    return subprocess.run(["git", "-C", ROOT, *args], capture_output=True, check=True).stdout


def dims(path):
    out = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", path], capture_output=True, text=True).stdout
    return int(re.search(r"pixelWidth: (\d+)", out).group(1)), int(re.search(r"pixelHeight: (\d+)", out).group(1))


def crop(src, dest):
    w, h = dims(src)
    # Scale so the photo covers W x H, then crop the middle
    flag = ["--resampleWidth", str(W)] if W / w >= H / h else ["--resampleHeight", str(H)]
    subprocess.run(["sips", *flag, "-c", str(H), str(W), "-s", "format", "jpeg", "-s", "formatOptions", "60", src, "--out", dest],
                   capture_output=True, check=True)


def main():
    current = {p["id"] for p in json.load(open(os.path.join(ROOT, "data/places.json"), encoding="utf-8"))}
    old = json.loads(git("show", f"{SOURCE}:data/places.json"))
    os.makedirs(OUT, exist_ok=True)
    manifest = os.path.join(ROOT, "data/thumbs.json")
    with open(manifest, encoding="utf-8") as f:
        thumbs = {pid: photo for pid, photo in json.load(f).items() if pid in current}
    with tempfile.TemporaryDirectory() as tmp:
        for p in old:
            photo = p.get("photo")
            if not photo or p["id"] not in current:
                continue
            existing = thumbs.get(p["id"])
            if existing and os.path.isfile(os.path.join(ROOT, existing["src"])):
                continue
            raw = os.path.join(tmp, "src.jpg")
            with open(raw, "wb") as f:
                f.write(git("show", f"{SOURCE}:{photo['src']}"))
            dest = os.path.join(OUT, f"{p['id']}.jpg")
            crop(raw, dest)
            thumbs[p["id"]] = {"src": os.path.relpath(dest, ROOT), "credit": photo.get("credit")}
    with open(os.path.join(ROOT, "data/thumbs.json"), "w", encoding="utf-8") as f:
        json.dump(thumbs, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print(f"{len(thumbs)} of {len(current)} places have a photo")


if __name__ == "__main__":
    main()
