"""Fold geocoding results into data/places.json and assign each place its area.

Geocoding agents write .work/geo/out/batch-*.json; this copies them into data/geo.json
(the committed record, with sources and notes) and then applies data/geo.json to the places.
The area is the second location layer under the city (Tokyo › Shinjuku), picked from the
place's ward and neighbourhood by the rules below.

Usage: python3 tools/merge_geo.py
"""
import glob, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract import ROOT  # noqa: E402

# (area, pattern over "ward | neighbourhood"), first match wins
AREAS = {
    "tokyo": [
        ("Koenji", r"Koenji"),
        ("Shimokitazawa & Sangenjaya", r"Shimokitazawa|Sangenjaya|Kyodo"),
        ("Harajuku & Aoyama", r"Harajuku|Jingumae|Minami-Aoyama|Aoyama|Omotesando|Yoyogi$|Yoyogi \(|^Shibuya \| Yoyogi"),
        ("Ebisu", r"Ebisu"),
        ("Shibuya", r"^Shibuya"),
        ("Nakameguro & Meguro", r"^Meguro|Jiyugaoka"),
        ("Shinjuku", r"^Shinjuku"),
        ("Nakano", r"^Nakano"),
        ("Kichijoji & Nishi-Ogikubo", r"Kichijoji|Mitaka|Nishi-Ogikubo|Imagawa|Ogikubo"),
        ("Akihabara & Kanda", r"Akihabara|Kanda|Jimbocho|Suidobashi|Ochanomizu"),
        ("Ueno, Yanaka & Asakusa", r"^Taito|Sendagi|Komagome|Nezu"),
        ("Ikebukuro", r"Ikebukuro"),
        ("Ginza & Marunouchi", r"Ginza|Yaesu|Marunouchi|Yurakucho|Nihonbashi"),
        ("Minato", r"^Minato"),
        ("Sumida & Koto", r"^Sumida|^Koto"),
        ("Ota", r"^Ota"),
        ("Outskirts & day trips", r"."),
    ],
    "osaka": [
        ("Horie", r"Horie"),
        ("Amemura & Shinsaibashi", r"Amemura|Shinsaibashi|Bakuromachi|Minami-Senba|Senba"),
        ("Namba & Nipponbashi", r"Namba|Nanba|Sennichimae|Nipponbashi|Shikitsu"),
        ("Shinsekai & Nishinari", r"Shinsekai|^Nishinari|^Tennoji"),
        ("Nakazakicho & Tenma", r"Nakazakicho|Tenma|Tenjinbashi|Tenroku|Nagara|Tsurunocho"),
        ("Umeda & Kitashinchi", r"Kitashinchi|Umeda|Ohatsutenjin|Doyamacho|Toganocho|Sonezaki|Toyosaki|Nakatsu|Chayamachi|Juso|^Kita|^Yodogawa"),
        ("Kitahama & Honmachi", r"Kitahama|Honmachi|Karahori|Tanimachi|Semba|Yodoyabashi"),
        ("Fukushima", r"^Fukushima"),
        ("Kyobashi & east", r"^Miyakojima|Kyobashi|^Higashinari|Midoribashi"),
        ("Bay side", r"^Suminoe|^Taisho|^Minato|Nanko|Bentencho"),
        ("Outskirts & day trips", r"."),
    ],
    "kyoto": [
        ("Gion & Higashiyama", r"^Higashiyama|Gion|Pontocho"),
        ("Downtown", r"^Nakagyo|Kawaramachi|Kiyamachi|Teramachi|Shijo|Bukkoji|Takatsuji|Gojo|Karasuma|Nishiki"),
        ("Demachiyanagi & Sakyo", r"^Sakyo|Demachiyanagi"),
        ("Kamigyo & Nishijin", r"^Kamigyo|Nishijin|Kitano"),
        ("Kita (north)", r"^Kita\b|Daitokuji|Kamigamo|Murasakino"),
        ("Station & south", r"^Shimogyo|^Minami|^Fushimi|^Higashiyama"),
        ("West (Arashiyama & Takao)", r"^Ukyo|^Nishikyo|Arashiyama|Takao|Saiin|Umegahata"),
        ("Outskirts & day trips", r"."),
    ],
}

# Where the pin knowingly differs from the guide's address line, say so on the place page
GEO_NOTES = {}


def area_for(city, ward, hood):
    key = f"{ward or ''} | {hood or ''}"
    for name, rx in AREAS[city]:
        if re.search(rx, key):
            return name
    return None


def main():
    geo_path = os.path.join(ROOT, "data/geo.json")
    geo = json.load(open(geo_path, encoding="utf-8")) if os.path.exists(geo_path) else {}
    for f in sorted(glob.glob(os.path.join(ROOT, ".work/geo/out/batch-*.json"))):
        for g in json.load(open(f, encoding="utf-8")):
            geo[g["id"]] = g
    with open(geo_path, "w", encoding="utf-8") as f:
        json.dump(dict(sorted(geo.items())), f, ensure_ascii=False, indent=1)

    places = json.load(open(os.path.join(ROOT, "data/places.json"), encoding="utf-8"))
    missing = []
    for p in places:
        g = geo.get(p["id"])
        if not g or g.get("lat") is None:
            missing.append(p["id"])
            continue
        p["lat"], p["lng"] = round(g["lat"], 5), round(g["lng"], 5)
        p["precision"] = g.get("precision")
        p["addressJa"] = g.get("addressJa")
        p["neighbourhood"] = re.sub(r"\s*\(.*\)$", "", g.get("neighbourhood") or "") or None
        p["ward"] = g.get("ward")
        p["area"] = area_for(p["city"], g.get("ward"), g.get("neighbourhood"))
        if g.get("extraPins"):
            p["extraPins"] = [{k: e[k] for k in ("label", "lat", "lng") if k in e} for e in g["extraPins"]]
        if p["id"] in GEO_NOTES:
            p["geoNote"] = GEO_NOTES[p["id"]]
    with open(os.path.join(ROOT, "data/places.json"), "w", encoding="utf-8") as f:
        json.dump(places, f, ensure_ascii=False, indent=1)

    from collections import Counter
    for city in AREAS:
        print(city, Counter(p.get("area") for p in places if p["city"] == city and p.get("area")).most_common())
    print(f"{len(places) - len(missing)} placed, {len(missing)} without coordinates")


if __name__ == "__main__":
    main()
