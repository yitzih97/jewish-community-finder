# Changelog

## 1.0.3 — 2026-08-06
- **Fixed the broken map preview in the detail card.** OpenStreetMap was
  blocking the extension's tile requests (their usage policy), so the preview
  showed an "Access blocked" image. Switched to keyless Esri satellite imagery
  — you now get a real aerial photo of the exact building.
- **Multi-service places.** When one institution offers several things that are
  each mapped nearby — e.g. a Chabad that also runs a preschool and a mikvah —
  they're now merged into a single result showing all its category badges, and
  it counts under each of those categories. (Only services that are actually in
  the map data are shown; nothing is invented.)
- Multi-service pins get a gold ring so they stand out on the map.

## 1.0.2 — 2026-08-02
- **New "Chabad" category.** Finds Chabad houses / Chabad centers near you
  (gold home icon). Chabad locations are split out from the Shuls list.
- **Shul icon is now the Star of David** (our logo), in navy.
- **All logo marks unified** to the app icon — the panel header, the
  bottom-right button, and the toolbar icon now use the same navy
  Star-of-David roundel.
- **Fixed the panel getting stuck on "Searching the area…"** — every data
  source now has a hard timeout, so a slow or unreachable source can no longer
  hang the whole panel. It now resolves to results (or "Nothing found") every
  time. (Note: in places with no Jewish community, an empty result is correct.)

## 1.0.1 — 2026-07-24
- **Mikvahs now work.** Added the mikvah.org global directory (~1,160 mikvahs
  worldwide) as the mikvah source — OpenStreetMap had almost none.
- **Jewish schools vastly improved.** Switched to the NCES private-school
  location database (every US private school, filtered to Jewish schools by
  name). A Lakewood search went from 5 schools to 77. OpenStreetMap is kept as
  a fallback outside the US, and duplicates are merged.
- **Google Maps–style info cards.** Hover a map pin for a quick card; click a
  pin (or any result in the list) for a larger card with a location map
  preview and one-tap **Navigate**, **Street View**, and **Open in Google
  Maps**.
- Map previews are composed from OpenStreetMap tiles inside the extension, so
  no host site can block them.
- Pins no longer flicker while hovering.

## 1.0.0 — 2026-07-23
- Initial release: shuls, kosher food, and Jewish schools from OpenStreetMap,
  overlaid on Zillow, Airbnb, Trulia, Redfin, Realtor.com, StreetEasy,
  Booking.com, Vrbo, and Google Maps.
- Color-coded pins on the site's own map, a results panel sorted by distance,
  category filters, and a search box for any area.
- Custom category icons and colors.
