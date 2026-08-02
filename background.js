// Jewish Community Finder — background service worker.
// Does all network fetches (Overpass + Nominatim) so content scripts
// aren't subject to host-page CSP/CORS.

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// fetch with a hard timeout so a stalled host can never hang the panel.
function fetchT(url, opts = {}, ms = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() =>
    clearTimeout(timer)
  );
}

function buildQuery(b) {
  const bbox = `${b.south},${b.west},${b.north},${b.east}`;
  return `[out:json][timeout:30];
(
  nwr["amenity"="place_of_worship"]["religion"="jewish"](${bbox});
  nwr["building"="synagogue"](${bbox});
  nwr["name"~"chabad|lubavitch",i](${bbox});
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
      const res = await fetchT(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      }, 25000);
      if (!res.ok) throw new Error('Overpass HTTP ' + res.status);
      const json = await res.json();
      return { elements: json.elements || [] };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Overpass request failed');
}

// Mikvahs: OpenStreetMap has almost none, so we use the mikvah.org global
// directory (~1,160 worldwide). Every directory page embeds the full dataset
// as `var mikvaos = [...]`; we fetch it once, cache it, and filter by bounds.
const MIKVAH_URL = 'https://mikvah.org/directory/directory.asp';
const MIKVAH_TTL = 24 * 60 * 60 * 1000; // refresh at most once a day
let mikvahCache = { data: null, ts: 0 };

async function loadMikvahDirectory() {
  if (mikvahCache.data && Date.now() - mikvahCache.ts < MIKVAH_TTL) {
    return mikvahCache.data;
  }
  const res = await fetchT(MIKVAH_URL, {
    headers: { 'Accept': 'text/html' },
  }, 20000);
  if (!res.ok) throw new Error('mikvah.org HTTP ' + res.status);
  const html = await res.text();
  const m = html.match(/var\s+mikvaos\s*=\s*(\[[\s\S]*?\]);/);
  if (!m) throw new Error('mikvah.org: dataset not found');
  const list = JSON.parse(m[1]);
  mikvahCache = { data: list, ts: Date.now() };
  return list;
}

async function fetchMikvahs(b) {
  const list = await loadMikvahDirectory();
  const out = [];
  for (const mk of list) {
    if (typeof mk.lat !== 'number' || typeof mk.lng !== 'number') continue;
    if (mk.lat < b.south || mk.lat > b.north) continue;
    if (mk.lng < b.west || mk.lng > b.east) continue;
    const addr = [mk.addr, mk.city, mk.state].filter(Boolean).join(', ');
    out.push({
      id: 'mikvah' + mk.id,
      name: mk.name || 'Mikvah',
      cat: 'mikvah',
      lat: mk.lat,
      lng: mk.lng,
      address: addr,
      website: mk.url ? 'https://mikvah.org' + mk.url : null,
      phone: mk.phone || null,
    });
  }
  return { mikvahs: out };
}

// Jewish schools: OpenStreetMap maps almost none (5 in all of Lakewood), so we
// query NCES's authoritative private-school location service (every US private
// school, with coordinates) by map bounds and keep the ones whose name matches
// a Jewish-school pattern. Everything in that service is already a school.
const NCES_SCHOOLS_URL =
  'https://services1.arcgis.com/Ua5sjt3LWTPigjyD/ArcGIS/rest/services/' +
  'Private_School_Locations_Current/FeatureServer/0/query';
const SCHOOL_KEYWORDS = [
  'YESHIV', 'MESIVTA', 'TALMUD', 'TORAH', 'HEBREW', 'BAIS YAAKOV',
  'BEIS YAAKOV', 'BETH JACOB', 'BAIS ', 'BEIS ', 'BNOS', 'CHEDER', 'JEWISH',
  'SCHECHTER', 'RAMAZ', 'RAMBAM', 'HESCHEL', 'KOLLEL', 'DARCHEI', 'TIFERES',
  'MOReSHES', 'HALB', 'HANC', 'YAVNEH', 'MAGEN DAVID', 'HILLEL', 'AKIVA',
];

async function fetchSchools(b) {
  const where = SCHOOL_KEYWORDS
    .map((k) => `UPPER(NAME) LIKE '%${k.trim()}%'`)
    .join(' OR ');
  const params = new URLSearchParams({
    where,
    geometry: `${b.west},${b.south},${b.east},${b.north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'PPIN,NAME,STREET,CITY,STATE,ZIP,LAT,LON',
    returnGeometry: 'false',
    f: 'json',
  });
  const res = await fetchT(NCES_SCHOOLS_URL + '?' + params.toString(), {}, 15000);
  if (!res.ok) throw new Error('NCES HTTP ' + res.status);
  const json = await res.json();
  const feats = json.features || [];
  const titleCase = (s) =>
    s.replace(/\w\S*/g, (w) => w[0] + w.slice(1).toLowerCase());
  const out = [];
  for (const f of feats) {
    const a = f.attributes || {};
    if (typeof a.LAT !== 'number' || typeof a.LON !== 'number') continue;
    const addr = [titleCase(a.STREET || ''), titleCase(a.CITY || ''), a.STATE]
      .filter(Boolean).join(', ');
    out.push({
      id: 'nces' + a.PPIN,
      name: a.NAME ? titleCase(a.NAME) : 'Jewish School',
      cat: 'school',
      lat: a.LAT,
      lng: a.LON,
      address: addr,
      website: null,
      phone: null,
    });
  }
  return { schools: out };
}

// Compose a small map preview (like the thumbnail on a Google Maps place card)
// by stitching OpenStreetMap tiles onto an OffscreenCanvas and drawing a marker
// at the exact location. Done in the worker so the host page's CSP can't block
// the tile requests, and returned as one self-contained data URL.
async function makeStaticMap({ lat, lng, color }) {
  const zoom = 16;
  const w = 304;
  const h = 150;
  const world = 256 * Math.pow(2, zoom);
  const wx = ((lng + 180) / 360) * world;
  const latRad = (lat * Math.PI) / 180;
  const wy =
    ((1 -
      Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) /
      2) *
    world;
  const left = wx - w / 2;
  const top = wy - h / 2;
  const n = Math.pow(2, zoom);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(0, 0, w, h);
  for (let tx = Math.floor(left / 256); tx <= Math.floor((left + w) / 256); tx++) {
    for (let ty = Math.floor(top / 256); ty <= Math.floor((top + h) / 256); ty++) {
      if (ty < 0 || ty >= n) continue;
      const wrapX = ((tx % n) + n) % n;
      try {
        const r = await fetchT(
          `https://tile.openstreetmap.org/${zoom}/${wrapX}/${ty}.png`,
          {}, 8000
        );
        if (!r.ok) continue;
        const bmp = await createImageBitmap(await r.blob());
        ctx.drawImage(bmp, Math.round(tx * 256 - left), Math.round(ty * 256 - top));
      } catch (e) {
        /* skip missing tile */
      }
    }
  }
  // Marker: teardrop-ish dot with a white ring, centered on the location.
  const cx = w / 2;
  const cy = h / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 9, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, 6.5, 0, Math.PI * 2);
  ctx.fillStyle = color || '#e11d48';
  ctx.fill();
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return { dataUrl: 'data:image/png;base64,' + btoa(bin) };
}

async function geocode(q) {
  const url =
    'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' +
    encodeURIComponent(q);
  const res = await fetchT(url, { headers: { 'Accept-Language': 'en' } }, 12000);
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
  if (msg && msg.type === 'jcf:mikvahs') {
    fetchMikvahs(msg.bounds)
      .then(sendResponse)
      .catch((e) => sendResponse({ error: String(e.message || e) }));
    return true;
  }
  if (msg && msg.type === 'jcf:schools') {
    fetchSchools(msg.bounds)
      .then(sendResponse)
      .catch((e) => sendResponse({ error: String(e.message || e) }));
    return true;
  }
  if (msg && msg.type === 'jcf:staticmap') {
    makeStaticMap(msg)
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
