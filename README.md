# Jewish Community Finder (Chrome extension)

Shows every **shul**, **kosher restaurant/food store**, **Jewish school**, and
**mikvah** in the map area you're browsing on Zillow, Airbnb, Trulia, Redfin,
Realtor.com, StreetEasy, Booking.com, Vrbo, Google Maps — and any other site
via the toolbar button.

Data sources (all free, no API key needed):
- **Shuls & kosher food** — OpenStreetMap
- **Jewish schools** — NCES private-school location service (every US private
  school, filtered to Jewish schools by name), with OpenStreetMap as a
  fallback outside the US
- **Mikvahs** — the mikvah.org global directory (~1,160 worldwide)

Hover a map pin for a quick info card; click it (or any result in the list)
for a larger card with a location map preview and buttons to Navigate,
open Street View, or open it in Google Maps.

## Install

1. Open Chrome and go to `chrome://extensions`
2. Turn on **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select this folder (`jewish-community-finder`)

## Use

- On Zillow / Airbnb / etc., a small **✡ button** appears in the bottom-right
  corner. Click it to open the panel.
- On **any other website**, click the extension's toolbar icon to open it.
- The extension reads the map area from the page URL:
  - **Zillow**: pan/zoom the map once so the URL contains the map bounds
  - **Airbnb**: enable "Search as I move the map" or just move the map
  - If no map bounds are found, it guesses the city from the URL — or you can
    type any area in the panel's search box (e.g. `Teaneck, NJ`).
- Toggle the category chips (Shuls / Kosher Food / Jewish Schools / Mikvahs)
  to filter. Click any result to open it in Google Maps.
- When live map bounds are available, colored **pins** are overlaid on the
  site's map: gold = shul, orange = kosher food, green = school,
  blue = mikvah.

## Notes & limitations

- OpenStreetMap coverage varies by neighborhood — a missing listing means
  OSM doesn't have it mapped, not that it doesn't exist. Strong coverage in
  most major Jewish communities.
- **Always verify kashrus certification and minyan times independently** —
  map data says nothing about hashgacha.
- Overlay pins are positioned from the URL's map bounds, so they can drift by
  a small amount mid-pan; they snap back when the site updates its URL.
- Privacy: the extension makes requests only to `overpass-api.de` /
  `overpass.kumi.systems` (map data) and `nominatim.openstreetmap.org`
  (area search). Nothing else is collected or sent anywhere.
