"""Make the map cards' small photos from the per-place photos in commit bc0fa73.

That commit added a photo for 317 places (img/places/<id>.jpg, with a credit in places.json)
and was reverted from main, but the files are still in git history. This crops each one to a
300x180 JPEG in img/thumbs/<id>.jpg with macOS `sips` and writes data/thumbs.json mapping place
id to the thumb's path and its credit. Places no longer in data/places.json are skipped.

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
    for f in os.listdir(OUT):
        os.remove(os.path.join(OUT, f))
    thumbs = {}
    with tempfile.TemporaryDirectory() as tmp:
        for p in old:
            photo = p.get("photo")
            if not photo or p["id"] not in current:
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
