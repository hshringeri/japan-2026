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
GEO_NOTES = {
    "osaka-environment-0g": "The guide's address is Hokage's building. The pin uses the venue's own address: Nishi-Osaka Bldg B1F, 3-6-1 Minami-Horie, near Sakuragawa station.",
    "kyoto-big-time-kyoto": "The shop's own listing puts it at Sanjo-Teramachi (Sanjo-dori Teramachi-higashi-iru), which is where the pin is.",
    "tokyo-cafe-game-bar-kotobuki": "It's at Imagawa 4-28-20, about 1.5 km north of Nishi-Ogikubo station: a 14-minute walk from Kami-Igusa, or a bus from Nishi-Ogikubo.",
    "osaka-awesome-day-coffee": "This address matches REICHI STORE / R COFFEE's press release exactly, so check which shop is there now.",
    "kyoto-p-m-sounds-kyoto": "This looks like the same venue as P.M.SOUNDS. Its Instagram is @pmsounds.kyoto.",
    "kyoto-shibashi": "Mostly opens for booked events, and the address comes with the booking. The pin only marks the area east of Heian Shrine.",
    "kyoto-kaikan-bars": "Shitomi Kaikan is 四富会館, read Yontomi. Orizuru Kaikan is by Hankyu Saiin, about 3 km west of the other two.",
    "kyoto-cafe-de-ai": "The website link now redirects to an unrelated site. The cafe still shows in listings at this address.",
    "kyoto-siesta-8bit-cafe-la-siesta-8bit-edition": "The town is Kamiyacho (紙屋町), the same block as Bee's Knees.",
}


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
