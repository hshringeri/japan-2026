# Japan 2026

The trip guide and planner at https://hshringeri.github.io/japan-2026/. On a phone it runs like an app with three tabs: List, Map and Plan. Add it to your home screen from the share menu and it opens full screen and keeps working with a weak signal.

There's no build step. GitHub Pages serves the files as they are.

## Where things live

| File | What it holds |
| --- | --- |
| `data/places.json` | Every place in the guide: the original text, coordinates, area and tags |
| `data/trip.json` | The trip: stays, day by day plans, open questions |
| `data/guide.json` | The magazine's editorial text: cover, house rules, intros, tips, Gone notes, credits |
| `data/geo.json` | Geocoding results with their sources and notes |
| `data/taxonomy.json` | Kinds (Shop, Eat, Music…) and which categories sit under each |
| `js/` | The app |
| `guide.css` | The original magazine styles, used by the Guide view |

## Common edits

To add an Airbnb address, find the stay in `data/trip.json` and fill in `address`, `lat` and `lng`, then delete its `precisionNote`. Google Maps gives you the coordinates when you long-press a spot.

To change the plan, edit the `items` for that day in `data/trip.json`. An item with a `time` ("14:30") feeds the Now / Next card. `status` can be `"booked"` or `"tbd"`. Setting `"place": "<id>"` links an item to a guide place by its id from `data/places.json`.

To add a guide place, add it to `data/places.json` with `lat` and `lng`, then run `python3 tools/tag.py`.

## Tools

- `tools/check.py` proves no content from the original single-page guide was lost. It rebuilds every original entry byte for byte from the data. Run it before merging.
- `tools/extract.py` was the one-time split of the original page into data files.
- `tools/merge_geo.py` folds geocoding results into the places and assigns each one an area.
- `tools/tag.py` assigns kinds, cuisine, genre, shop style and practical flags.
- `tools/resize-images.sh` makes the app's copies of the photos.

To test locally, run `python3 -m http.server` in this folder and open http://localhost:8000. Adding `?now=2026-11-20T22:30` to the URL makes the app act as if it's that moment in Japan, and `?day=2026-11-24` opens on that trip day.
