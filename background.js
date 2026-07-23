// Jewish Community Finder — background service worker.
// Does all network fetches (Overpass + Nominatim) so content scripts
// aren't subject to host-page CSP/CORS.

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

function buildQuery(b) {
  const bbox = `${b.south},${b.west},${b.north},${b.east}`;
  return `[out:json][timeout:30];
(
  nwr["amenity"="place_of_worship"]["religion"="jewish"](${bbox});
  nwr["building"="synagogue"](${bbox});
  nwr["amenity"~"^(mikveh|mikvah)$"](${bbox});
  nwr["diet:kosher"~"^(yes|only|limited)$"](${bbox});
  nwr["cuisine"~"kosher",i](${bbox});
  nwr["name"~"kosher|glatt",i]["amenity"~"^(restaurant|fast_food|cafe|ice_cream|bakery)$"](${bbox});
  nwr["name"~"kosher|glatt",i]["shop"](${bbox});
  nwr["amenity"~"^(school|kindergarten|college|university)$"]["religion"="jewish"](${bbox});
  nwr["amenity"~"^(school|kindergarten)$"]["name"~"yeshiv|talmud|torah|hebrew academy|jewish|bais yaakov|beis yaakov|beth jacob|cheder|solomon schechter|hillel",i](${bbox});
);
out center 400;`;
}

async function fetchOverpass(bounds) {
  const query = buildQuery(bounds);
  let lastErr = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!res.ok) throw new Error('Overpass HTTP ' + res.status);
      const json = await res.json();
      return { elements: json.elements || [] };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Overpass request failed');
}

async function geocode(q) {
  const url =
    'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' +
    encodeURIComponent(q);
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  if (!res.ok) throw new Error('Geocoder HTTP ' + res.status);
  const json = await res.json();
  if (!json.length) throw new Error('No results for "' + q + '"');
  const hit = json[0];
  const [south, north, west, east] = hit.boundingbox.map(Number);
  return {
    bounds: { south, west, north, east },
    label: hit.display_name,
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'jcf:overpass') {
    fetchOverpass(msg.bounds)
      .then(sendResponse)
      .catch((e) => sendResponse({ error: String(e.message || e) }));
    return true;
  }
  if (msg && msg.type === 'jcf:geocode') {
    geocode(msg.q)
      .then(sendResponse)
      .catch((e) => sendResponse({ error: String(e.message || e) }));
    return true;
  }
});

// Toolbar icon: toggle the panel on the current tab. If the content script
// isn't there yet (site not in content_scripts matches), inject it on demand.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'jcf:toggle' });
  } catch (e) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      });
      await chrome.tabs.sendMessage(tab.id, { type: 'jcf:toggle' });
    } catch (e2) {
      // Restricted page (chrome://, Web Store, etc.) — nothing we can do.
    }
  }
});
