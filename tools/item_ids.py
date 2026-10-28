"""Give every plan item in data/trip.json a stable "id", so manual edits, the AI chat and the
shared plan in the Worker can all point at the same item. Items that already have one keep it;
new ones get "<date>-<n>" with the next free number for that day.

Usage: python3 tools/item_ids.py
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "data/trip.json")


def main():
    trip = json.load(open(PATH, encoding="utf-8"))
    taken = {i["id"] for d in trip["days"] for i in d["items"] if i.get("id")}
    added = 0
    for day in trip["days"]:
        n = 1
        for idx, item in enumerate(day["items"]):
            if item.get("id"):
                continue
            while f"{day['date']}-{n}" in taken:
                n += 1
            item_id = f"{day['date']}-{n}"
            taken.add(item_id)
            # id first, the rest in its original order
            day["items"][idx] = {"id": item_id, **item}
            added += 1
    with open(PATH, "w", encoding="utf-8") as f:
        json.dump(trip, f, ensure_ascii=False, indent=1)
    print(f"{added} item ids added")


if __name__ == "__main__":
    main()
