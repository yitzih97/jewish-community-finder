// Jewish Community Finder — content script.
// Reads the map area from the page URL, asks the background worker for
// OpenStreetMap data, and shows a panel + pins overlaid on the site's map.

(() => {
  if (window.__jcfLoaded) return;
  window.__jcfLoaded = true;

  // ---------------------------------------------------------------- config

  const CATS = {
    shul: { label: 'Shuls', emoji: '✡️', color: '#1e3a8a' },
    chabad: { label: 'Chabad', emoji: '🏠', color: '#b8860b' },
    kosher: { label: 'Kosher Food', emoji: '🍽️', color: '#ea580c' },
    school: { label: 'Jewish Schools', emoji: '🎓', color: '#059669' },
    mikvah: { label: 'Mikvahs', emoji: '💧', color: '#2196f3' },
  };

  // The app's mark: a solid Star of David. Used as the shul icon and, on white,
  // as the panel/fab/toolbar logo.
  const STAR_PATHS =
    '<path d="M12 4.5 18.5 15.75H5.5Z"/><path d="M12 19.5 5.5 8.25H18.5Z"/>';

  // Category glyphs (24×24 viewBox, fill = currentColor, white cutouts).
  const ICONS = {
    shul: STAR_PATHS,
    chabad: '<path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>',
    kosher:
      '<path d="M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5' +
      'v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z"/>',
    school:
      '<rect x="11.3" y="1" width="1.4" height="3.4"/>' +
      '<rect x="12.7" y="1.3" width="4.3" height="2.3"/>' +
      '<path d="M12 3.9 17.2 8.6H6.8Z"/>' +
      '<rect x="8" y="8.6" width="8" height="12.9"/>' +
      '<rect x="1.5" y="12.2" width="6.5" height="9.3"/>' +
      '<rect x="16" y="12.2" width="6.5" height="9.3"/>' +
      '<g fill="#fff"><circle cx="12" cy="11.2" r="1.4"/>' +
      '<rect x="10.7" y="16.2" width="2.6" height="5.3"/>' +
      '<rect x="3" y="14.2" width="1.7" height="2"/>' +
      '<rect x="5.6" y="14.2" width="1.7" height="2"/>' +
      '<rect x="16.9" y="14.2" width="1.7" height="2"/>' +
      '<rect x="19.5" y="14.2" width="1.7" height="2"/></g>',
    mikvah:
      '<path d="M12 1.8c2.9 3.9 4.7 6.2 4.7 8.5a4.7 4.7 0 0 1-9.4 0' +
      'C7.3 8 9.1 5.7 12 1.8Z"/>' +
      '<circle cx="10.2" cy="9.6" r="1" fill="#fff"/>' +
      '<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">' +
      '<path d="M2.6 18.1q2.35-1.9 4.7 0t4.7 0t4.7 0t4.7 0"/>' +
      '<path d="M2.6 21.3q2.35-1.9 4.7 0t4.7 0t4.7 0t4.7 0"/></g>',
  };

  function catSvg(cat, size) {
    return (
      `<svg viewBox="0 0 24 24" width="${size}" height="${size}"` +
      ` fill="currentColor" aria-hidden="true">${ICONS[cat]}</svg>`
    );
  }

  // Full roundel (navy disc + white star) for the floating button; on the
  // navy panel header we show just the white star.
  function logoRoundel(size) {
    return (
      `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">` +
      `<circle cx="12" cy="12" r="12" fill="#1e3a8a"/>` +
      `<g fill="#fff">${STAR_PATHS}</g></svg>`
    );
  }
  function starSvg(size, color) {
    return (
      `<svg viewBox="0 0 24 24" width="${size}" height="${size}"` +
      ` fill="${color}" aria-hidden="true">${STAR_PATHS}</svg>`
    );
  }

  const state = {
    open: false,
    bounds: null, // {south, west, north, east}
    boundsSource: null, // 'map' | 'geocode'
    areaLabel: '',
    places: [],
    enabled: { shul: true, chabad: true, kosher: true, school: true, mikvah: true },
    loading: false,
    error: null,
    lastHref: location.href,
    lastFetchKey: null,
  };
  const cache = new Map(); // bboxKey -> places

  // ------------------------------------------------------------- messaging

  function askBackground(msg, ms = 20000) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (fn, arg) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        fn(arg);
      };
      // Never let a stalled source hang the panel on "Searching…" forever.
      const timer = setTimeout(
        () => finish(reject, new Error('Timed out')),
        ms
      );
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) {
            finish(reject, new Error(chrome.runtime.lastError.message));
          } else if (res && res.error) {
            finish(reject, new Error(res.error));
          } else {
            finish(resolve, res);
          }
        });
      } catch (e) {
        finish(reject, e);
      }
    });
  }

  // ------------------------------------------------------ bounds detection

  function detectMapBounds() {
    const href = location.href;
    const host = location.hostname;

    // Zillow: searchQueryState JSON in the URL contains mapBounds.
    if (host.includes('zillow.com')) {
      const m = href.match(/searchQueryState=([^&#]+)/);
      if (m) {
        try {
          const stateObj = JSON.parse(decodeURIComponent(m[1]));
          const b = stateObj.mapBounds;
          if (b && isFinite(b.south)) {
            return {
              south: b.south, west: b.west, north: b.north, east: b.east,
            };
          }
        } catch (e) { /* fall through */ }
      }
    }

    // Airbnb (and others): ne_lat / ne_lng / sw_lat / sw_lng query params.
    const p = new URLSearchParams(location.search);
    if (p.get('ne_lat') && p.get('sw_lat')) {
      const b = {
        north: +p.get('ne_lat'), east: +p.get('ne_lng'),
        south: +p.get('sw_lat'), west: +p.get('sw_lng'),
      };
      if ([b.north, b.east, b.south, b.west].every(isFinite)) return b;
    }

    // Google Maps style: @lat,lng,zoomz
    const gm = href.match(/@(-?\d+\.\d+),(-?\d+\.\d+),(\d+(?:\.\d+)?)z/);
    if (gm) {
      const lat = +gm[1], lng = +gm[2], zoom = +gm[3];
      const degPerPx = 360 / (256 * Math.pow(2, zoom));
      const lngSpan = window.innerWidth * degPerPx;
      const latSpan =
        window.innerHeight * degPerPx * Math.cos((lat * Math.PI) / 180);
      return {
        south: lat - latSpan / 2, north: lat + latSpan / 2,
        west: lng - lngSpan / 2, east: lng + lngSpan / 2,
      };
    }

    return null;
  }

  // When there are no live map bounds in the URL, guess a place name from
  // the URL so we can geocode it.
  function guessAreaQuery() {
    const host = location.hostname;
    const path = decodeURIComponent(location.pathname);
    let m;
    if (host.includes('zillow.com')) {
      m = path.match(/\/([^\/]+)_rb\/?/);
      if (m) return m[1].replace(/-/g, ' ');
    }
    if (host.includes('airbnb.')) {
      m = path.match(/\/s\/([^\/]+)/);
      if (m) return m[1].replace(/--/g, ', ').replace(/-/g, ' ');
    }
    if (host.includes('trulia.com')) {
      m = path.match(/^\/([A-Z]{2})\/([^\/]+)/);
      if (m) return `${m[2].replace(/_/g, ' ')}, ${m[1]}`;
    }
    if (host.includes('redfin.com')) {
      m = path.match(/\/city\/\d+\/([A-Z]{2})\/([^\/]+)/);
      if (m) return `${m[2].replace(/-/g, ' ')}, ${m[1]}`;
    }
    if (host.includes('realtor.com')) {
      m = path.match(/realestateandhomes-search\/([^\/]+)/);
      if (m) return m[1].replace(/[_-]/g, ' ');
    }
    if (host.includes('streeteasy.com')) {
      m = path.match(/for-(?:sale|rent)\/([^\/]+)/);
      if (m) return m[1].replace(/-/g, ' ') + ', New York';
    }
    return null;
  }

  // ---------------------------------------------------------------- places

  function classify(tags) {
    const amenity = tags.amenity || '';
    const name = (tags.name || '').toLowerCase();
    // Chabad houses are shuls too — split them into their own category.
    if (/chabad|lubavitch/.test(name) || tags.denomination === 'lubavitch') {
      return 'chabad';
    }
    if (amenity === 'place_of_worship' || tags.building === 'synagogue') {
      return 'shul';
    }
    if (/^(mikveh|mikvah)$/.test(amenity)) return 'mikvah';
    if (/^(school|kindergarten|college|university)$/.test(amenity)) {
      return 'school';
    }
    return 'kosher';
  }

  function buildAddress(t) {
    const street = [t['addr:housenumber'], t['addr:street']]
      .filter(Boolean).join(' ');
    return [street, t['addr:city']].filter(Boolean).join(', ');
  }

  function haversineMiles(lat1, lon1, lat2, lon2) {
    const R = 3958.8;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function processElements(elements, bounds) {
    const centerLat = (bounds.north + bounds.south) / 2;
    const centerLng = (bounds.east + bounds.west) / 2;
    const seen = new Set();
    const places = [];
    for (const el of elements) {
      const tags = el.tags || {};
      const lat = el.lat != null ? el.lat : el.center && el.center.lat;
      const lng = el.lon != null ? el.lon : el.center && el.center.lon;
      if (lat == null || lng == null) continue;
      const name = tags.name || tags['name:en'] || '(Unnamed)';
      const dedupeKey = `${name}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      places.push({
        id: el.type + el.id,
        name,
        cat: classify(tags),
        lat,
        lng,
        address: buildAddress(tags),
        website: tags.website || tags['contact:website'] || null,
        phone: tags.phone || tags['contact:phone'] || null,
        distance: haversineMiles(centerLat, centerLng, lat, lng),
      });
    }
    places.sort((a, b) => a.distance - b.distance);
    return places;
  }

  // Fold mikvah.org results into the OSM place list, skipping any that sit on
  // top of a place OSM already returned, then re-sort by distance.
  function mergeMikvahs(places, mikvahs, bounds) {
    const centerLat = (bounds.north + bounds.south) / 2;
    const centerLng = (bounds.east + bounds.west) / 2;
    const seen = new Set(
      places.map((p) => `${p.lat.toFixed(3)}|${p.lng.toFixed(3)}`)
    );
    for (const mk of mikvahs || []) {
      const dk = `${mk.lat.toFixed(3)}|${mk.lng.toFixed(3)}`;
      if (seen.has(dk)) continue;
      seen.add(dk);
      places.push({
        ...mk,
        distance: haversineMiles(centerLat, centerLng, mk.lat, mk.lng),
      });
    }
    places.sort((a, b) => a.distance - b.distance);
    return places;
  }

  // Fold NCES school results into the list. Dedupe against schools OSM already
  // returned — by name (same school, slightly different coords across sources)
  // and by location — so a school mapped in both sources appears once.
  function normName(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16);
  }
  function mergeSchools(places, schools, bounds) {
    const centerLat = (bounds.north + bounds.south) / 2;
    const centerLng = (bounds.east + bounds.west) / 2;
    const seenName = new Set(
      places.filter((p) => p.cat === 'school').map((p) => normName(p.name))
    );
    const seenCoord = new Set(
      places.map((p) => `${p.lat.toFixed(3)}|${p.lng.toFixed(3)}`)
    );
    for (const s of schools || []) {
      const nk = normName(s.name);
      const ck = `${s.lat.toFixed(3)}|${s.lng.toFixed(3)}`;
      if (seenName.has(nk) || seenCoord.has(ck)) continue;
      seenName.add(nk);
      seenCoord.add(ck);
      places.push({
        ...s,
        distance: haversineMiles(centerLat, centerLng, s.lat, s.lng),
      });
    }
    places.sort((a, b) => a.distance - b.distance);
    return places;
  }

  function bboxKey(b) {
    return [b.south, b.west, b.north, b.east]
      .map((v) => v.toFixed(3)).join(',');
  }

  async function loadPlaces() {
    if (!state.bounds) return;
    const key = bboxKey(state.bounds);
    state.lastFetchKey = key;
    if (cache.has(key)) {
      state.places = cache.get(key);
      state.error = null;
      renderAll();
      return;
    }
    state.loading = true;
    state.error = null;
    renderPanel();

    const bounds = state.bounds;
    // OSM (shuls/food/schools) and mikvah.org run in parallel and independently
    // — if one source is down, we still show whatever the other returned.
    const [osmRes, mkRes, schRes] = await Promise.allSettled([
      askBackground({ type: 'jcf:overpass', bounds }),
      askBackground({ type: 'jcf:mikvahs', bounds }),
      askBackground({ type: 'jcf:schools', bounds }),
    ]);
    // Ignore stale responses if the user moved the map meanwhile.
    if (state.lastFetchKey !== key) return;

    let places = [];
    const osmOk = osmRes.status === 'fulfilled';
    const mkOk = mkRes.status === 'fulfilled';
    const schOk = schRes.status === 'fulfilled';
    if (osmOk) places = processElements(osmRes.value.elements, bounds);
    if (mkOk) places = mergeMikvahs(places, mkRes.value.mikvahs, bounds);
    if (schOk) places = mergeSchools(places, schRes.value.schools, bounds);

    if (!osmOk && !mkOk && !schOk) {
      state.error =
        (osmRes.reason && osmRes.reason.message) || 'Lookup failed';
      state.places = [];
    } else {
      state.error = null;
      state.places = places;
      cache.set(key, places);
      if (cache.size > 20) cache.delete(cache.keys().next().value);
    }
    state.loading = false;
    renderAll();
  }

  async function refreshArea({ force = false } = {}) {
    const mapBounds = detectMapBounds();
    if (mapBounds) {
      const changed =
        !state.bounds || bboxKey(mapBounds) !== bboxKey(state.bounds);
      state.bounds = mapBounds;
      state.boundsSource = 'map';
      state.areaLabel = 'Current map area';
      if (changed || force) await loadPlaces();
      else renderAll();
      return;
    }
    if (state.bounds && !force) {
      renderAll();
      return;
    }
    const q = guessAreaQuery();
    if (q) {
      await searchArea(q);
    } else {
      state.error = null;
      renderAll();
    }
  }

  async function searchArea(q) {
    state.loading = true;
    state.error = null;
    renderPanel();
    try {
      const res = await askBackground({ type: 'jcf:geocode', q });
      state.bounds = res.bounds;
      state.boundsSource = 'geocode';
      state.areaLabel = res.label.split(',').slice(0, 3).join(',');
      await loadPlaces();
    } catch (e) {
      state.loading = false;
      state.error = e.message;
      renderPanel();
    }
  }

  // -------------------------------------------------------------------- UI

  const host = document.createElement('div');
  host.id = 'jcf-root';
  const shadow = host.attachShadow({ mode: 'open' });
  document.documentElement.appendChild(host);

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont,
        "Segoe UI", Roboto, sans-serif; }
    .fab {
      position: fixed; bottom: 22px; right: 22px; z-index: 2147483000;
      width: 48px; height: 48px; border-radius: 50%; border: none;
      background: #1e3a8a; cursor: pointer; padding: 0;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 14px rgba(0,0,0,.35);
    }
    .fab:hover { background: #27479e; }
    .fab svg { display: block; }
    .panel {
      position: fixed; top: 84px; right: 14px; z-index: 2147483001;
      width: 348px; max-height: calc(100vh - 130px);
      background: #fff; border-radius: 14px; overflow: hidden;
      box-shadow: 0 10px 34px rgba(0,0,0,.30); display: flex;
      flex-direction: column; color: #1f2937;
    }
    .hdr {
      background: linear-gradient(135deg, #1e3a8a, #312e81); color: #fff;
      padding: 12px 14px; display: flex; align-items: center; gap: 8px;
    }
    .hdr .title { font-weight: 700; font-size: 14px; flex: 1; }
    .hdr button {
      background: none; border: none; color: #c7d2fe; cursor: pointer;
      font-size: 15px; padding: 2px 4px;
    }
    .hdr button:hover { color: #fff; }
    .searchrow { display: flex; gap: 6px; padding: 10px 12px 4px; }
    .searchrow input {
      flex: 1; border: 1px solid #d1d5db; border-radius: 8px;
      padding: 7px 10px; font-size: 13px; outline: none; color: #111827;
      background: #fff;
    }
    .searchrow input:focus { border-color: #1e3a8a; }
    .searchrow button {
      border: none; background: #1e3a8a; color: #fff; border-radius: 8px;
      padding: 7px 12px; font-size: 13px; cursor: pointer;
    }
    .area {
      font-size: 11.5px; color: #6b7280; padding: 6px 14px 2px;
      display: flex; justify-content: space-between; align-items: center;
    }
    .area .refresh {
      background: none; border: none; color: #1e3a8a; cursor: pointer;
      font-size: 11.5px; padding: 0;
    }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px; }
    .chip {
      border-radius: 999px; border: 1.5px solid; padding: 4px 10px;
      font-size: 12px; cursor: pointer; background: #fff; user-select: none;
    }
    .chip.off { opacity: .38; border-color: #9ca3af !important;
      color: #6b7280 !important; }
    .list { overflow-y: auto; flex: 1; padding: 2px 0 6px; }
    .item {
      padding: 9px 14px; border-top: 1px solid #f3f4f6; cursor: pointer;
    }
    .item:hover { background: #f8fafc; }
    .item .name { font-size: 13.5px; font-weight: 600; color: #111827; }
    .item .meta { font-size: 11.5px; color: #6b7280; margin-top: 2px; }
    .item .links { margin-top: 3px; }
    .item .links a {
      font-size: 11.5px; color: #1e3a8a; text-decoration: none;
      margin-right: 10px;
    }
    .item .links a:hover { text-decoration: underline; }
    .empty, .loading, .err {
      padding: 22px 16px; text-align: center; font-size: 13px; color: #6b7280;
    }
    .err { color: #b91c1c; }
    .foot {
      font-size: 10.5px; color: #9ca3af; text-align: center;
      padding: 6px 10px 8px; border-top: 1px solid #f3f4f6;
    }
    .pin-overlay {
      position: fixed; z-index: 2147482999; pointer-events: none;
    }
    .pin {
      position: absolute; width: 24px; height: 24px; border-radius: 50%;
      background: #fff; border: 2px solid currentColor;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 1px 5px rgba(0,0,0,.5);
      transform: translate(-50%, -50%); pointer-events: auto; cursor: pointer;
    }
    .pin:hover { transform: translate(-50%, -50%) scale(1.3); z-index: 5; }
    .chip svg { vertical-align: -2px; margin-right: 3px; }
    .cicon {
      display: inline-flex; flex: none; width: 22px; height: 22px;
      border-radius: 50%; background: #fff; border: 1.5px solid currentColor;
      align-items: center; justify-content: center; margin-right: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,.18);
    }
    .item .name { display: flex; align-items: center; }

    /* hover popup — compact card, like Google Maps' pin hover */
    .hovercard {
      position: fixed; z-index: 2147483004; width: 216px;
      background: #fff; color: #1f2937; border-radius: 10px;
      box-shadow: 0 6px 22px rgba(0,0,0,.28); overflow: hidden;
      pointer-events: none; transform: translate(-50%, -100%);
      margin-top: -12px; display: none;
    }
    .hovercard .hc-body { padding: 9px 11px; }
    .hovercard .hc-name {
      font-size: 13px; font-weight: 700; display: flex; align-items: center;
      gap: 6px; line-height: 1.25;
    }
    .hovercard .hc-meta { font-size: 11px; color: #6b7280; margin-top: 3px; }
    .hovercard .hc-hint {
      font-size: 10.5px; color: #9ca3af; margin-top: 5px;
    }
    .hovercard .hc-badge {
      flex: none; width: 20px; height: 20px; border-radius: 50%;
      background: #fff; border: 1.5px solid currentColor;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .hovercard::after {
      content: ""; position: absolute; left: 50%; bottom: -7px;
      transform: translateX(-50%);
      border-left: 7px solid transparent; border-right: 7px solid transparent;
      border-top: 7px solid #fff;
    }

    /* detail modal — larger card with actions */
    .detail-back {
      position: fixed; inset: 0; z-index: 2147483005;
      background: rgba(17,24,39,.45); display: none;
      align-items: center; justify-content: center; padding: 20px;
    }
    .detail {
      width: 340px; max-width: calc(100vw - 40px); max-height: calc(100vh - 60px);
      background: #fff; color: #1f2937; border-radius: 16px; overflow: hidden;
      box-shadow: 0 20px 60px rgba(0,0,0,.4); display: flex; flex-direction: column;
    }
    .detail-map {
      position: relative; height: 150px; background: #e5e7eb; flex: none;
    }
    .detail-map img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .detail-map .dm-spin {
      position: absolute; inset: 0; display: flex; align-items: center;
      justify-content: center; font-size: 12px; color: #6b7280;
    }
    .detail-x {
      position: absolute; top: 10px; right: 10px; width: 30px; height: 30px;
      border-radius: 50%; border: none; background: rgba(255,255,255,.92);
      color: #374151; font-size: 16px; cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,.3);
    }
    .detail-x:hover { background: #fff; }
    .detail-body { padding: 14px 16px 4px; overflow-y: auto; }
    .detail-title {
      font-size: 18px; font-weight: 800; letter-spacing: -.01em;
      display: flex; align-items: center; gap: 9px; line-height: 1.2;
    }
    .detail-badge {
      flex: none; width: 30px; height: 30px; border-radius: 50%;
      background: #fff; border: 2px solid currentColor;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .detail-cat { font-size: 12px; font-weight: 600; margin-top: 5px; }
    .detail-rows { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
    .detail-row {
      display: flex; gap: 9px; font-size: 13px; color: #374151;
      align-items: flex-start;
    }
    .detail-row .dr-ic { flex: none; width: 16px; text-align: center; opacity: .6; }
    .detail-row a { color: #1e3a8a; text-decoration: none; }
    .detail-row a:hover { text-decoration: underline; }
    .detail-actions {
      display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
      padding: 14px 16px 16px;
    }
    .detail-actions a {
      display: flex; align-items: center; justify-content: center; gap: 6px;
      padding: 10px 8px; border-radius: 9px; font-size: 13px; font-weight: 600;
      text-decoration: none; cursor: pointer; border: 1px solid #e5e7eb;
      color: #1f2937; background: #f9fafb;
    }
    .detail-actions a:hover { background: #f3f4f6; }
    .detail-actions a.primary {
      grid-column: 1 / -1; background: #1e3a8a; color: #fff; border-color: #1e3a8a;
    }
    .detail-actions a.primary:hover { background: #27479e; }
  `;

  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    shadow.adoptedStyleSheets = [sheet];
  } catch (e) {
    const styleEl = document.createElement('style');
    styleEl.textContent = CSS;
    shadow.appendChild(styleEl);
  }

  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.innerHTML = starSvg(26, '#fff');
  fab.title = 'Show shuls, Chabad, kosher food, schools & mikvahs in this area';
  fab.addEventListener('click', () => togglePanel());
  shadow.appendChild(fab);

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.style.display = 'none';
  shadow.appendChild(panel);

  const pinOverlay = document.createElement('div');
  pinOverlay.className = 'pin-overlay';
  pinOverlay.style.display = 'none';
  shadow.appendChild(pinOverlay);

  const hoverCard = document.createElement('div');
  hoverCard.className = 'hovercard';
  shadow.appendChild(hoverCard);

  const detailBack = document.createElement('div');
  detailBack.className = 'detail-back';
  shadow.appendChild(detailBack);
  detailBack.addEventListener('click', (e) => {
    if (e.target === detailBack) closeDetail();
  });

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function mapsUrl(p) {
    return (
      'https://www.google.com/maps/search/?api=1&query=' +
      encodeURIComponent(`${p.name} ${p.lat},${p.lng}`)
    );
  }

  function directionsUrl(p) {
    return (
      'https://www.google.com/maps/dir/?api=1&destination=' +
      encodeURIComponent(`${p.lat},${p.lng}`) +
      '&travelmode=driving'
    );
  }

  function streetViewUrl(p) {
    return (
      'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=' +
      encodeURIComponent(`${p.lat},${p.lng}`)
    );
  }

  // ------------------------------------------------------- hover + detail cards

  let hoverHideTimer = null;
  let lastPinSig = null;

  function showHoverCard(p, pinEl) {
    if (detailBack.style.display === 'flex') return;
    clearTimeout(hoverHideTimer);
    const c = CATS[p.cat];
    const meta = [c.label, `${p.distance.toFixed(1)} mi away`, p.address]
      .filter(Boolean).join(' · ');
    hoverCard.innerHTML = `
      <div class="hc-body">
        <div class="hc-name" style="color:${c.color}">
          <span class="hc-badge">${catSvg(p.cat, 12)}</span>
          <span style="color:#111827">${esc(p.name)}</span>
        </div>
        <div class="hc-meta">${esc(meta)}</div>
        <div class="hc-hint">Click for photos, directions &amp; more →</div>
      </div>`;
    const r = pinEl.getBoundingClientRect();
    hoverCard.style.left = r.left + r.width / 2 + 'px';
    hoverCard.style.top = r.top + 'px';
    hoverCard.style.display = 'block';
  }

  function hideHoverCard(delay) {
    clearTimeout(hoverHideTimer);
    hoverHideTimer = setTimeout(() => {
      hoverCard.style.display = 'none';
    }, delay || 0);
  }

  function detailRow(icon, html) {
    return `<div class="detail-row"><span class="dr-ic">${icon}</span>
      <span>${html}</span></div>`;
  }

  function openDetail(p) {
    hideHoverCard(0);
    const c = CATS[p.cat];
    const rows = [];
    if (p.address) rows.push(detailRow('📍', esc(p.address)));
    rows.push(detailRow('📏', `${p.distance.toFixed(1)} miles from map center`));
    if (p.phone) {
      rows.push(detailRow('📞',
        `<a href="tel:${esc(p.phone)}">${esc(p.phone)}</a>`));
    }
    if (p.website) {
      rows.push(detailRow('🔗',
        `<a href="${esc(p.website)}" target="_blank" rel="noopener">Website ↗</a>`));
    }
    detailBack.innerHTML = `
      <div class="detail" role="dialog" aria-label="${esc(p.name)}">
        <div class="detail-map">
          <div class="dm-spin">Loading map…</div>
          <button class="detail-x" title="Close">✕</button>
        </div>
        <div class="detail-body">
          <div class="detail-title" style="color:${c.color}">
            <span class="detail-badge">${catSvg(p.cat, 16)}</span>
            <span style="color:#111827">${esc(p.name)}</span>
          </div>
          <div class="detail-cat" style="color:${c.color}">${c.emoji} ${c.label}</div>
          <div class="detail-rows">${rows.join('')}</div>
        </div>
        <div class="detail-actions">
          <a class="primary" href="${mapsUrl(p)}" target="_blank" rel="noopener">
            ${catSvg(p.cat, 14)} Open in Google Maps ↗</a>
          <a href="${directionsUrl(p)}" target="_blank" rel="noopener">🧭 Navigate</a>
          <a href="${streetViewUrl(p)}" target="_blank" rel="noopener">📷 Street View</a>
        </div>
      </div>`;
    detailBack.style.display = 'flex';
    detailBack.querySelector('.detail-x')
      .addEventListener('click', closeDetail);

    // Lazy-load the composed map preview from the background worker.
    const mapWrap = detailBack.querySelector('.detail-map');
    askBackground({
      type: 'jcf:staticmap', lat: p.lat, lng: p.lng, color: c.color,
    }).then((res) => {
      if (detailBack.style.display !== 'flex') return;
      const img = document.createElement('img');
      img.alt = 'Map of ' + p.name;
      img.src = res.dataUrl;
      const spin = mapWrap.querySelector('.dm-spin');
      if (spin) spin.remove();
      mapWrap.insertBefore(img, mapWrap.firstChild);
    }).catch(() => {
      const spin = mapWrap.querySelector('.dm-spin');
      if (spin) spin.textContent = 'Map preview unavailable';
    });
  }

  function closeDetail() {
    detailBack.style.display = 'none';
    detailBack.innerHTML = '';
  }

  function visiblePlaces() {
    return state.places.filter((p) => state.enabled[p.cat]);
  }

  function renderPanel() {
    if (!state.open) return;
    const counts = {};
    for (const k of Object.keys(CATS)) counts[k] = 0;
    for (const p of state.places) counts[p.cat]++;

    const chips = Object.entries(CATS)
      .map(([key, c]) => {
        const on = state.enabled[key];
        return `<div class="chip ${on ? '' : 'off'}" data-cat="${key}"
          style="border-color:${c.color};color:${c.color}">
          ${catSvg(key, 12)} ${c.label} (${counts[key]})</div>`;
      })
      .join('');

    let body;
    if (state.loading) {
      body = `<div class="loading">Searching the area…</div>`;
    } else if (state.error) {
      body = `<div class="err">${esc(state.error)}</div>`;
    } else if (!state.bounds) {
      body = `<div class="empty">Couldn't detect the map area on this page.
        Search a neighborhood or city above.</div>`;
    } else if (!visiblePlaces().length) {
      body = `<div class="empty">Nothing found in this area.<br>
        Try zooming out, or note that OpenStreetMap data can be incomplete
        in some neighborhoods.</div>`;
    } else {
      body = visiblePlaces()
        .map((p) => {
          const c = CATS[p.cat];
          const meta = [
            c.label,
            `${p.distance.toFixed(1)} mi`,
            p.address,
          ].filter(Boolean).join(' · ');
          const links =
            `<a href="${mapsUrl(p)}" target="_blank" rel="noopener">Maps ↗</a>` +
            (p.website
              ? `<a href="${esc(p.website)}" target="_blank" rel="noopener">Website ↗</a>`
              : '') +
            (p.phone ? `<a href="tel:${esc(p.phone)}">${esc(p.phone)}</a>` : '');
          return `<div class="item" data-id="${p.id}">
            <div class="name"><span class="cicon" style="color:${c.color}">${catSvg(p.cat, 13)}</span>${esc(p.name)}</div>
            <div class="meta">${esc(meta)}</div>
            <div class="links">${links}</div>
          </div>`;
        })
        .join('');
      body = `<div class="list">${body}</div>`;
    }

    panel.innerHTML = `
      <div class="hdr">
        ${starSvg(18, '#fff')}<span class="title">Jewish Community Finder</span>
        <button data-act="close" title="Close">✕</button>
      </div>
      <div class="searchrow">
        <input type="text" placeholder="Search an area (e.g. Teaneck, NJ)" />
        <button data-act="go">Go</button>
      </div>
      <div class="area">
        <span>${esc(state.areaLabel || 'No area selected')}</span>
        <button class="refresh" data-act="refresh">↻ Refresh</button>
      </div>
      <div class="chips">${chips}</div>
      ${body}
      <div class="foot">Data © OpenStreetMap contributors — may be incomplete.
        Always verify kashrus & minyan times locally.</div>
    `;

    panel.querySelector('[data-act="close"]')
      .addEventListener('click', () => togglePanel(false));
    panel.querySelector('[data-act="refresh"]')
      .addEventListener('click', () => refreshArea({ force: true }));
    const input = panel.querySelector('input');
    const go = () => input.value.trim() && searchArea(input.value.trim());
    panel.querySelector('[data-act="go"]').addEventListener('click', go);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go();
      e.stopPropagation();
    });
    panel.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const cat = chip.dataset.cat;
        state.enabled[cat] = !state.enabled[cat];
        renderAll();
      });
    });
    panel.querySelectorAll('.item').forEach((item) => {
      item.addEventListener('click', (e) => {
        if (e.target.tagName === 'A') return;
        const p = state.places.find((x) => x.id === item.dataset.id);
        if (p) openDetail(p);
      });
    });
  }

  // ------------------------------------------------------------ pin overlay

  const MAP_SELECTORS = [
    '#search-page-map',
    '[data-testid="search-page-map"]',
    '[data-testid="map/GoogleMap"]',
    '#MapCanvas',
    '.gm-style',
    'div[aria-label="Map"]',
  ];

  function findMapContainer() {
    let best = null;
    let bestArea = 0;
    for (const sel of MAP_SELECTORS) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const area = r.width * r.height;
      if (r.width > 250 && r.height > 250 && area > bestArea) {
        best = r;
        bestArea = area;
      }
    }
    return best;
  }

  function mercN(lat) {
    return Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  }

  function renderPins() {
    // Pins are only accurate when the bounds came from the site's own map
    // viewport (URL bounds), not from a geocoded place-name.
    if (!state.open || state.boundsSource !== 'map' || !state.bounds) {
      pinOverlay.style.display = 'none';
      return;
    }
    const rect = findMapContainer();
    if (!rect) {
      pinOverlay.style.display = 'none';
      return;
    }
    const b = state.bounds;
    // Skip rebuilding when nothing moved — keeps pin hover from flickering on
    // the periodic tick, and only re-renders when the map actually shifts.
    const sig = [
      Math.round(rect.left), Math.round(rect.top),
      Math.round(rect.width), Math.round(rect.height),
      bboxKey(b), visiblePlaces().length,
      Object.values(state.enabled).join(''),
    ].join('|');
    if (sig === lastPinSig && pinOverlay.style.display === 'block') return;
    lastPinSig = sig;

    pinOverlay.style.display = 'block';
    pinOverlay.style.left = rect.left + 'px';
    pinOverlay.style.top = rect.top + 'px';
    pinOverlay.style.width = rect.width + 'px';
    pinOverlay.style.height = rect.height + 'px';
    pinOverlay.innerHTML = '';
    const topM = mercN(b.north);
    const spanM = topM - mercN(b.south);
    for (const p of visiblePlaces()) {
      if (p.lat < b.south || p.lat > b.north) continue;
      if (p.lng < b.west || p.lng > b.east) continue;
      const x = ((p.lng - b.west) / (b.east - b.west)) * 100;
      const y = ((topM - mercN(p.lat)) / spanM) * 100;
      const pin = document.createElement('div');
      pin.className = 'pin';
      pin.style.left = x + '%';
      pin.style.top = y + '%';
      pin.style.color = CATS[p.cat].color;
      pin.innerHTML = catSvg(p.cat, 14);
      pin.addEventListener('mouseenter', () => showHoverCard(p, pin));
      pin.addEventListener('mouseleave', () => hideHoverCard(120));
      pin.addEventListener('click', (e) => {
        e.stopPropagation();
        openDetail(p);
      });
      pinOverlay.appendChild(pin);
    }
  }

  function renderAll() {
    renderPanel();
    renderPins();
  }

  function togglePanel(force) {
    state.open = force != null ? force : !state.open;
    panel.style.display = state.open ? 'flex' : 'none';
    if (state.open) {
      refreshArea();
    } else {
      pinOverlay.style.display = 'none';
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'jcf:toggle') {
      togglePanel();
      sendResponse({ ok: true });
    }
  });

  // Track SPA navigation / map panning (URL updates) and keep pins glued
  // to the map container.
  let refreshTimer = null;
  setInterval(() => {
    if (!state.open) return;
    if (location.href !== state.lastHref) {
      state.lastHref = location.href;
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => refreshArea(), 700);
    }
    renderPins();
  }, 600);
  window.addEventListener('resize', renderPins);
})();
