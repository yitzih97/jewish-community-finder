# Chrome Web Store listing — Jewish Community Finder

## Name
Jewish Community Finder

## Summary (132 chars max)
See every shul, kosher restaurant, Jewish school & mikvah on the map you're browsing — Zillow, Airbnb, Google Maps & more.

## Category
Suggested: **Shopping** or **Productivity** (Chrome no longer has a "Lifestyle" category; Productivity fits a browsing utility).

## Language
English

## Detailed description
Thinking about a house, an apartment, or a place for Shabbos — and wondering
what the Jewish community around it actually looks like? Jewish Community Finder
overlays the answers right onto the map you're already viewing.

Open a listing on Zillow, Airbnb, Trulia, Redfin, Realtor.com, StreetEasy,
Booking.com, Vrbo, or Google Maps, and click the ✡ button. The extension reads
the map's area and instantly shows you:

• Shuls — synagogues mapped in the area
• Kosher food — restaurants, takeout, bakeries, and groceries
• Jewish schools — yeshivos, day schools, and Bais Yaakovs
• Mikvahs — community mikvahs with phone and website

Everything is listed by distance and pinned in color right on the map. Hover a
pin for a quick info card; click it for a location map preview plus one-tap
Navigate, Street View, and Open in Google Maps.

Data comes from free, community-built sources — OpenStreetMap, the NCES
private-school database, and the mikvah.org directory. There's no account, no
sign-up, and nothing is tracked. On any site that isn't auto-detected, just
click the toolbar icon to open the same panel with a search box.

A note: map data says nothing about hashgacha. Always confirm kashrus
certification, minyan times, and mikvah hours with the local vaad or the
establishment itself.

## Permission justifications (Chrome asks for each)

**Host permission — real-estate / map sites (zillow.com, airbnb.com, etc.):**
The extension reads the geographic bounds of the map shown on these pages and
draws location pins onto them. Access to the page is required to detect the map
area and render the overlay.

**Host permission — map-data hosts (overpass-api.de, maps.mail.ru,
overpass.kumi.systems, nominatim.openstreetmap.org, mikvah.org,
services1.arcgis.com, tile.openstreetmap.org):**
These are the free public data services the extension queries to fetch nearby
shuls, kosher food, Jewish schools, mikvahs, and map preview tiles. Only map
coordinates are sent.

**activeTab / scripting:**
Used to open the panel on the current tab when the toolbar icon is clicked,
including sites not in the automatic list.

**Single purpose (required statement):**
Jewish Community Finder has one purpose: to display nearby Jewish community
locations (shuls, kosher food, Jewish schools, and mikvahs) on the map the user
is currently viewing.

## Are you using remote code? 
No. All logic ships in the package. The extension only fetches map *data*
(coordinates, place records, and map image tiles) from the public services
listed above — no remote scripts are loaded or executed.

## Data usage disclosures (Privacy tab)
- Does NOT collect or use personally identifiable information
- Does NOT collect health, financial, authentication, personal comms, location*, web history, or user activity data for storage/transfer
- (*The extension reads the on-screen map's coordinates to fetch nearby places, but does not collect or store the user's own location.)
- Certify: not sold to third parties; not used for unrelated purposes; not used for creditworthiness/lending.

## Privacy policy URL
https://yitzih97.github.io/jewish-community-finder/privacy.html

## Homepage / support URL
https://yitzih97.github.io/jewish-community-finder/

## Assets checklist
- [x] Icon 128×128 (in package: icons/icon128.png)
- [x] Privacy policy page (docs/privacy.html)
- [ ] At least 1 screenshot 1280×800 (generated: store/screenshot-*.png)
- [ ] Small promo tile 440×280 (generated: store/promo-440x280.png)
- [x] Packaged ZIP (docs/jewish-community-finder.zip)
