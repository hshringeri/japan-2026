"""Add kind and detail tags to data/places.json and write data/taxonomy.json.

Tags only restate what an entry's own text says. Cuisine and music genre are assigned by hand
below; shop styles and practical flags come from patterns over the entry's text.

Usage: python3 tools/tag.py
"""
import json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract import ROOT, slug  # noqa: E402

# Kind -> categories, in the guide's category order
KINDS = [
    ("shop", "Shop", ["Streetwear & Vintage", "Archive & Designer Vintage", "Watches & Vintage Hobby",
                      "Gorpcore & Snow", "Vintage Nintendo", "Art, Books & Design",
                      "Electronics & Parts", "Retro Games & PCs"]),
    ("music", "Music", ["Underground Music", "Electronic & Clubs", "Jazz Bars", "Vinyl Bars", "Record Shops"]),
    ("drink", "Drink", ["Beer & Whisky", "Cool Bars", "After Dark", "Senbero", "Cyberpunk Bars", "Karaoke Bars"]),
    ("eat", "Eat", ["Izakaya", "Yakiniku", "Omakase", "Indian", "Brunch", "Good Food"]),
    ("play", "Play", ["Board Game Bars", "Pool Bars", "Golf & Driving Range", "Bowling Alleys",
                      "Gaming Cafes", "Maid Cafes", "Curious Spaces"]),
    ("unwind", "Baths & temples", ["Onsen & Sento", "Hidden Temples & Shrines"]),
    ("cars", "Car culture", ["JDM Culture"]),
]
KIND_OF = {cat: k for k, _, cats in KINDS for cat in cats}
# Extra categories for existing places, without changing their original guide listings.
ALSO = {
    "osaka-fukumasa": ["Senbero"], "osaka-nonkiya": ["Senbero"], "osaka-izakaya-toyo": ["Senbero"],
    "osaka-tachinomi-shomin": ["Senbero"], "kyoto-tatsumi": ["Senbero"], "kyoto-tachinomi-shomin-shijo-omiya": ["Senbero"],
    "tokyo-yakitori-taisho-honten": ["Senbero"], "tokyo-shimonya-koenji": ["Senbero"],
    "kyoto-sharif": ["Karaoke Bars"],
}

CUISINE = {
    "tokyo": {
        "Yakiniku Jumbo Hanare": ["Yakiniku"], "Horumon-yaki Koei Honten": ["Yakiniku", "Horumon"],
        "Sobahouse Konjiki Hototogisu": ["Ramen"], "The Pizza Bar on 38th": ["Pizza"],
        "Tonkatsu Marushichi Ginza": ["Tonkatsu"], "Cloud Club Matcha": ["Matcha", "Cafe"], "Menchirashi": ["Udon"],
        "Yakitori Taisho (Honten)": ["Yakitori"], "Shimonya Koenji": ["Yakitori", "Motsu"],
        "AIMU": ["Pancakes", "Cafe"], "flour+water Shimokitazawa": ["Bakery", "Pancakes"],
        "nephew": ["Cafe"], "PATH": ["Pancakes", "Cafe"], "Fuunji": ["Ramen"], "Tamawarai": ["Soba"],
        "Yakitori Ebisu (Minamiguchi Honten)": ["Yakitori", "Motsu"],
        "Curry Station Niagara": ["Japanese curry", "Kissaten"], "Ponta Honke": ["Tonkatsu"],
        "Kayaba Coffee": ["Kissaten"], "Onigiri Asakusa Yadoroku": ["Onigiri"],
        "Uosan Sakaba (Tomioka)": ["Seafood"], "Sushi Mikata": ["Sushi"],
        "Ginza Sushi Horinouchi": ["Sushi"], "Hakkoku": ["Sushi"], "Erick South Yaesu": ["South Indian"],
        "Andhra Dining": ["South Indian"], "Nirvanam Kamiyacho": ["South Indian"],
        "Tandoor Bar Kamalpur (Kiba)": ["Tandoor"], "Kameido Gyoza Honten": ["Gyoza"],
        "Baird Beer Harajuku Taproom": ["Yakitori"],
        "Meat Eat UP": ["Steak"],
        "Hantei Nezu (はん亭 根津本店)": ["Kushiage"],
        "Toho Bakery (トーホーベーカリー)": ["Bakery"],
        "bricolage bread & co.": ["Bakery", "Cafe"],
        "PRISMIC TOKYO": ["Bakery", "Patisserie"],
        "Sakurai Japanese Tea Experience (櫻井焙茶研究所)": ["Matcha", "Cafe"],
        "GLITCH COFFEE & ROASTERS (Jimbocho)": ["Cafe"],
        "Boulangerie Django": ["Bakery"],
        "Katane Bakery (カタネベーカリー)": ["Bakery"],
        "Pâtisserie Sadaharu AOKI paris (Marunouchi)": ["Patisserie", "Bakery", "Cafe"],
        "Au Bon Vieux Temps (オーボンヴュータン)": ["Patisserie", "Bakery", "Cafe"],
        "PATISSERIE RYOCO (パティスリー リョーコ)": ["Patisserie", "Bakery"],
        "Yamamotoyama Fujie Sabo (山本山 ふじヱ茶房)": ["Matcha", "Cafe"],
        "Savor the Matcha": ["Matcha", "Cafe"],
        "Onibus Coffee Nakameguro (Ekimae)": ["Cafe"],
        "Fuglen Tokyo (Tomigaya)": ["Cafe"],
    },
    "elsewhere": {
        "Honjin Tsukasa (本陣つかさ)": ["Houtou", "Soba", "Venison"],
    },
    "osaka": {
        "Yakiniku Hakuundai (Tsuruhashi)": ["Yakiniku"],
        "Gyozaclub Rocklee": ["Gyoza", "Chinese"],
        "Izakaya Toyo": ["Seafood"], "Nonkiya": ["Oden"], "Tenma Sakagura": ["Doteyaki"],
        "Sushi Kirimon": ["Sushi"], "Sushiya Yohei": ["Sushi"], "Sawada (Osaka Fukushima)": ["Kappo"],
        "Columbia8 Kitahama": ["Spice curry"], "BOTANI:CURRY": ["Spice curry"],
        "Kyu Yamu-tei Karahori": ["Spice curry"], "Spice Curry Soma": ["Spice curry"],
        "maZe nishihorie": ["Cafe"], "nichi nichi BAKE": ["Cafe", "Bakery"],
        "Dramatic Curry Golden Nakazaki": ["Spice curry"], "Ramen Jinsei JET": ["Ramen"],
        "Chitose Honten": ["Udon"], "Negiyaki Yamamoto Honten": ["Okonomiyaki"],
        "Shinsekai Kushikatsu Ittoku Tsutenkaku-ten": ["Kushikatsu", "Doteyaki"],
        "Aizuya Honten": ["Takoyaki"], "Endo Sushi Central Market": ["Sushi"],
        "Tachinomi Shomin": ["Seafood"],
        "Jiyuken Namba Honten (自由軒 難波本店)": ["Yoshoku", "Japanese curry"],
        "Masahiko Ozumi Paris (Yodoyabashi)": ["Bakery", "Patisserie", "Cafe"],
        "Boulangerie Parigot (Uehonmachi)": ["Bakery"],
        "Chatei Jin (茶庭 仁)": ["Matcha", "Cafe"],
        "LiLo Coffee Roasters (Amemura)": ["Cafe"],
    },
    "kyoto": {
        "Tendan Gion Honten": ["Yakiniku"],
        "Kyoto Mai Sushi": ["Sushi"], "Gion Sushi Tadayasu": ["Sushi"], "Sushi Rakumi": ["Sushi"],
        "Gion OMAKASE SUSHI FARO (祇園鮨FARO)": ["Sushi", "Tempura"],
        "TADKA (Tadka 1 / Tadka 2)": ["South Indian"], "Shinrin Shokudo": ["Spice curry"],
        "Kerala": ["South Indian", "Tandoor"], "cafe marble Bukkoji": ["Cafe"], "Kotoro Coffee": ["Cafe"],
        "Kyosaimi Nomura (Karasuma Honten)": ["Obanzai"], "Teuchi Soba Kanei": ["Soba"],
        "Kyoto Curry Seisakusho Kariru": ["Spice curry"], "Kissa Tyrol": ["Kissaten", "Japanese curry"],
        "Toyouke Chaya": ["Tofu"],
        "Hofbäckerei Edegger-Tax Kyoto": ["Bakery", "Patisserie", "Cafe"],
        "ASSEMBLAGES KAKIMOTO": ["Patisserie", "Bakery"],
        "Ippodo Tea Kyoto Main Store / Kaboku Tearoom": ["Matcha", "Cafe"],
        "WEEKENDERS COFFEE SHINMACHI": ["Cafe"],
    },
}

GENRE = {
    "tokyo": {
        "Higashi-Koenji Niman Den-atsu": ["Hardcore"], "U.F.O.CLUB": ["Psych", "Noise", "Garage"],
        "Koenji ShowBoat": ["Punk", "Rock"], "JIROKICHI": ["Blues", "Improv"],
        "Heaven's Door": ["Punk", "Experimental"], "SPREAD": ["House", "Techno", "Bass"],
        "Bar Holly": ["Jazz"], "Little Soul Cafe": ["Soul & funk", "Disco"], "Bar LOADED": ["Rock"],
        "FORESTLIMIT": ["Experimental", "Noise"], "Contact": ["Techno", "House"],
        "Vent": ["Techno", "House"], "CIRCUS Tokyo": ["House", "Techno", "Bass"],
        "WOMB": ["Techno", "Trance"], "JAZZ UNION": ["Jazz"],
        "JBS (Jazz Blues Soul)": ["Jazz", "Blues", "Soul & funk"], "Hi-Fi Disco Bar Chaos": ["Disco", "House"],
        "Antiknock": ["Rock", "Metal"], "Ochiai Soup": ["Noise"],
        "DJ Bar Bridge": ["Disco", "House", "Soul & funk"], "Shinjuku PIT INN": ["Jazz", "Improv"],
        "DUG": ["Jazz"], "Eagle (Iiguru)": ["Jazz"], "Pit Bar": ["Hardcore"], "Silver Elephant": ["Prog"],
        "Ftarri": ["Improv"], "Shichoshitsu": ["Improv"], "Bar Isshee": ["Improv"],
        "Hikari No Uma (ひかりのうま)": ["Experimental", "Folk", "Improv"],
        "UNIT": ["Techno", "House", "Experimental"],
        "MOGRA Akihabara": ["Anime & game music", "Doujin"],
        "Mojo Cafe": ["Rock", "Soul & funk", "60s pop"],
        "John Henry's Study": ["Jazz"],
        "KATA_BAR": ["Punk", "Rock"],
        "Deathmatch in HELL": ["Metal"],
        "BAR Choshu Chikara (長州ちから)": ["Indie", "Hip-hop"],
        "RECORD BAR analog": ["City pop", "Hip-hop", "R&B"],
        "Bar Blen blen blen": ["Brazilian"],
    },
    "osaka": {
        "Environment 0g": ["Experimental"], "Hokage": ["Punk", "Metal"], "King Cobra": ["Punk"],
        "Pangea": ["Indie"], "Club Stomp": ["Garage", "Punk"], "Matsuyamachi Chikaikkai": ["Hardcore"],
        "Sengoku Daitouryo": ["Noise", "Punk"], "Holy Mountain": ["Indie", "Experimental"],
        "MagaYura": ["Ambient"], "Nambaya": ["Jazz", "Improv"], "Club Daphnia": ["Ambient", "Techno"],
        "Compufunk Records": ["House", "Disco"], "NOON + CAFE": ["House", "Hip-hop"],
        "CIRCUS Osaka": ["House", "Techno"], "PROUST": ["Jazz"], "Royal Horse": ["Jazz"],
        "Record Bar MOON SHINE": ["Rock", "Folk", "City pop"], "Bar,K": ["Jazz"],
        "Time Bomb Records (タイムボムレコード)": ["R&B", "Soul", "Punk", "Showa pops"],
        "TONE8.0 & Basement Gallery": ["Improv", "Experimental", "Noise"],
    },
    "kyoto": {
        "UrBANGUILD": ["Experimental", "Noise", "Improv", "Ambient"], "Takutaku": ["Blues", "Rock"],
        "CLUB METRO": ["Techno"], "S-Pod": ["Techno"], "Cavalier": ["Ambient", "Techno"],
        "YAMATOYA": ["Jazz"], "Tamon": ["Jazz"], "JAZZ IN Rokudenashi": ["Jazz"],
        "Hachi Record Shop & Bar": ["Jazz"], "GALAXIE500": ["Psych", "Punk", "Krautrock"],
        "Beatle momo": ["60s pop"], "Shibashi": ["Ambient"],
    },
}

EVENTS = {"tokyo-nismo-festival", "tokyo-tokyo-auto-salon-2027", "osaka-osaka-auto-messe"}

# Shop styles, matched against name + description
STYLE = [
    ("Logo-era streetwear", r"Stussy|Supreme|BAPE|hip-hop print"),
    ("Americana", r"Amekaji|American vintage|Ralph|Carhartt|Champion"),
    ("Military", r"military|militaria"),
    ("Euro vintage", r"European vintage|European and outdoor|1920s–90s European|UK and Japanese designers"),
    ("Designer", r"Margiela|Yohji|Comme des|Undercover|Helmut|Raf Simons|Rick Owens|Issey|Antwerp|designer"),
    ("Sneakers", r"sneaker"),
    ("Band tees", r"band tee|band-tee"),
    ("Skate", r"skate"),
    ("Womenswear", r"women"),
    ("Outdoor", r"outdoor|hiking|camping|gorpcore|mont-bell|Patagonia"),
    ("Ski & snow", r"\bski\b|snowboard|powder"),
    ("Bargains", r"cheapest|¥1,000 pants|sell-by-weight|under-retail|undercut|discounted|Grey-market"),
    ("Watches", r"watch"),
    ("Toys & figures", r"toys|soft vinyl|figure|model-kit"),
    ("Retro games", r"Famicom|Nintendo|retro-game|8- and 16-bit|Game & Watch"),
]

# Practical flags, matched against the info line (and description where noted)
FLAGS = [
    ("Cash only", r"cash only|cash,|no cards|cash\)", "info+desc"),
    ("Cashless", r"cashless|takes no cash|card only", "info+desc"),
    ("Walk-in", r"walk-in|walk-ins|no reservations|no bookings|reservations not accepted|reservations unavailable|no booking for", "info"),
    ("Book ahead", r"reservation only|reservation-only|book via|booking normal|reservations via|book on |OMAKASE|TableCheck|email booking|book by email|by phone reservation|book in store|book via the band|takes email bookings|book by email|bookings taken|reservations accepted|reservations available", "info+desc"),
    ("Standing", r"standing", "info+desc"),
    ("ID required", r"ID required|ID at the door", "info"),
    ("Tattoos OK", r"Tattoos OK|tattoo-friendly|tattoos (are )?(fine|welcome|allowed)", "info+desc"),
    ("Michelin", r"Michelin|Bib Gourmand", "info+desc"),
    ("Hidden entrance", r"speakeasy|unmarked|riddle|hidden-bar|hidden behind|hidden sliding", "info+desc"),
    # A closing time from midnight to 05:00 (or 24:00+ notation), never a price range like ¥3.5–4k
    ("Open late", r"(?<![¥\d.,])\d{1,2}(:\d\d)? ?[–-] ?(0?[0-5]|2[4-9])(:\d\d)?(?![\d.k,%/])"
                  r"|(?<!no )\blate\b|to ~?0[1-5]|until [0-5]:", "info"),
    # Opening between 05:00 and 08:59, never a price or seat range
    ("Morning", r"(?<![¥\d.,])0?[5-8]:\d\d ?[–-]|(?<![¥\d.,:])[5-8] ?[–-] ?\d\d(:\d\d)?(?![\d.k])|from 0?[5-8]:00|from [5-9]am|pours from 9am", "info+desc"),
]


def main():
    places = json.load(open(os.path.join(ROOT, "data/places.json"), encoding="utf-8"))
    by_name = {(p["city"], p["name"]): p for p in places}
    for table in (CUISINE, GENRE):
        for city, names in table.items():
            for n in names:
                if (city, n) not in by_name:
                    sys.exit(f"tag table names an unknown place: {city} / {n}")

    for p in places:
        cats = [l["category"] for l in p["listings"]] + ALSO.get(p["id"], [])
        kinds = list(dict.fromkeys(KIND_OF[c] for c in cats))
        desc = " ".join(l["desc"] for l in p["listings"])
        info = " ".join(l["info"] or "" for l in p["listings"])
        tags = {
            "cuisine": CUISINE.get(p["city"], {}).get(p["name"], []),
            "genre": GENRE.get(p["city"], {}).get(p["name"], []),
            "style": [t for t, rx in STYLE if "shop" in kinds and re.search(rx, p["name"] + " " + desc, re.I)],
            "flags": [t for t, rx, scope in FLAGS
                      if re.search(rx, info if scope == "info" else info + " " + desc, re.I)],
        }
        if "Walk-in" in tags["flags"] and re.search(r"reservation only|OMAKASE.in only", info, re.I):
            tags["flags"].remove("Walk-in")
        if p["id"] in EVENTS:
            tags["flags"].append("Event")
        p["kinds"] = kinds
        p["categories"] = list(dict.fromkeys(cats))
        p["tags"] = {k: v for k, v in tags.items() if v}

    taxonomy = {
        "cities": [{"id": "tokyo", "name": "Tokyo"}, {"id": "osaka", "name": "Osaka"}, {"id": "kyoto", "name": "Kyoto"}],
        "kinds": [{"id": k, "name": n, "categories": c} for k, n, c in KINDS],
        "facets": [
            {"id": "cuisine", "name": "Cuisine", "for": ["eat"]},
            {"id": "genre", "name": "Genre", "for": ["music"]},
            {"id": "style", "name": "Style", "for": ["shop"]},
            {"id": "flags", "name": "Good to know", "for": None},
        ],
    }
    with open(os.path.join(ROOT, "data/places.json"), "w", encoding="utf-8") as f:
        json.dump(places, f, ensure_ascii=False, indent=1)
    with open(os.path.join(ROOT, "data/taxonomy.json"), "w", encoding="utf-8") as f:
        json.dump(taxonomy, f, ensure_ascii=False, indent=1)

    from collections import Counter
    for facet in ("cuisine", "genre", "style", "flags"):
        print(facet, Counter(t for p in places for t in p["tags"].get(facet, [])).most_common())


if __name__ == "__main__":
    main()
