"""Build data/routes.json: the driving line for every trip day that has a "route" in data/trip.json.

The route runs through the day's items that have coordinates, in plan order. The road geometry
comes from the public OSRM demo router once, here, so the app never calls a routing service.
Each entry: {"km", "minutes", "legs": [{"km", "minutes"}], "path": Google-encoded polyline}.

Usage: python3 tools/route.py
"""
import json, os, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OSRM = "https://router.project-osrm.org/route/v1/driving/"


def main():
    trip = json.load(open(os.path.join(ROOT, "data/trip.json"), encoding="utf-8"))
    out = {}
    for day in trip["days"]:
        if not day.get("route"):
            continue
        stops = [i for i in day["items"] if i.get("lat") is not None]
        coords = ";".join(f"{s['lng']},{s['lat']}" for s in stops)
        req = urllib.request.Request(OSRM + coords + "?overview=full&geometries=polyline",
                                     headers={"User-Agent": "japan-2026 trip app (tools/route.py)"})
        r = json.load(urllib.request.urlopen(req, timeout=60))
        if r.get("code") != "Ok":
            raise SystemExit(f"{day['date']}: OSRM said {r.get('code')}: {r.get('message')}")
        route = r["routes"][0]
        out[day["date"]] = {
            "km": round(route["distance"] / 1000),
            "minutes": round(route["duration"] / 60),
            "legs": [{"km": round(l["distance"] / 1000, 1), "minutes": round(l["duration"] / 60)} for l in route["legs"]],
            "path": route["geometry"],
        }
        print(f"{day['date']}: {len(stops)} stops, {out[day['date']]['km']} km, {out[day['date']]['minutes']} min")
    with open(os.path.join(ROOT, "data/routes.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
        f.write("\n")


if __name__ == "__main__":
    main()
