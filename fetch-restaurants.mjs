/**
 * fetch-restaurants.mjs
 *
 * Fetches ALL Rappi restaurants for Cúcuta, Villa del Rosario, and Los Patios
 * by combining catalog + search queries + store detail for coordinates.
 *
 * Usage: node fetch-restaurants.mjs <bearer-token>
 */

import { readFileSync, writeFileSync, existsSync } from "fs";

// ─── Config ───────────────────────────────────────────────────────────
const BASE_URL = "https://services.grability.rappi.com";

const CITIES = [
  { name: "Cúcuta", lat: 7.8891, lng: -72.4967 },
  { name: "Villa del Rosario", lat: 7.8394, lng: -72.4745 },
  { name: "Los Patios", lat: 7.8403, lng: -72.5051 },
];

// Search queries to find restaurants beyond the catalog
const SEARCH_QUERIES = [
  "comida", "restaurante", "cafe", "panaderia", "heladeria", "parrilla",
  "sushi", "pollo", "arabe", "rapida", "dulces", "postres", "jugos",
  "natural", "bowl", "poke", "wok", "hamburguesa", "pizza", "empanadas",
  "tacos", "asian", "mexicana", "italiana", "colombiana", "breakfast",
  "brunch", "coffee", "te", "smoothie", "ensalada", "comida rapida",
];

// Non-restaurant keywords to filter out from search results
const EXCLUDE_KEYWORDS = [
  "farmatodo", "olimpica", "metro", "exito", "makro", "cruz verde",
  "drogueria", "farmacia", "miniso", "la rebaja", "inglesa", "medipiel",
  "aruma", "farmanorte", "la economia", "nestle", "nespresso", "licor",
  "licores", "atlantic foods", "linea estetica",
];

const DEFAULT_HEADERS = {
  accept: "application/json",
  "accept-language": "es-CO",
  "app-version": "e1de6be43aa29091011474615d7ac0810051c36a",
  needappsflyerid: "false",
  origin: "https://www.rappi.com.co",
  referer: "https://www.rappi.com.co/",
  "user-agent":
    "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36",
  vendor: "rappi",
  "x-application-id":
    "rappi-microfront-web/e1de6be43aa29091011474615d7ac0810051c36a",
};

// ─── Token ────────────────────────────────────────────────────────────
function getToken() {
  const args = process.argv.slice(2);
  const tokenIdx = args.indexOf("--token");
  if (tokenIdx !== -1 && args[tokenIdx + 1]) return args[tokenIdx + 1];
  const configIdx = args.indexOf("--config");
  if (configIdx !== -1 && args[configIdx + 1])
    return JSON.parse(readFileSync(args[configIdx + 1], "utf-8")).token;
  if (args[0] && !args[0].startsWith("--")) return args[0];
  for (const p of [".rappi-config.json", "../.rappi-config.json"]) {
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf-8")).token;
  }
  console.error("❌ Usage: node fetch-restaurants.mjs <bearer-token>");
  process.exit(1);
}

// ─── API ──────────────────────────────────────────────────────────────
function buildHeaders(token) {
  return {
    ...DEFAULT_HEADERS,
    authorization: `Bearer ${token}`,
    deviceid: "rappi-maps-cli",
  };
}

async function apiPost(path, body, token) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { ...buildHeaders(token), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json();
}

async function apiGet(path, token) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: buildHeaders(token) });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Step 1: Get catalog restaurants (already have coordinates) ──────
async function fetchCatalog(city, token) {
  const data = await apiPost(
    "/api/restaurant-bus/stores/catalog-paged/home",
    { lat: city.lat, lng: city.lng, store_type: "restaurant", offset: 0, limit: 200 },
    token
  );
  return (data.stores || []).map((s) => ({
    store_id: s.store_id,
    name: s.name,
    address: s.address || "",
    lat: s.location?.[1] ?? null,
    lng: s.location?.[0] ?? null,
    logo: s.logo ? `https://images.rappi.com/${s.logo}` : "",
    score: typeof s.rating === "object" ? (s.rating?.score ?? 0) : (s.rating ?? 0),
    store_type: s.store_type || "",
    is_available: s.is_currently_available === true,
    status: s.status || "",
    eta: s.eta || "",
    source: "catalog",
  }));
}

// ─── Step 2: Search for more restaurants ──────────────────────────────
async function searchRestaurants(city, token) {
  const results = new Map(); // store_id -> minimal info

  for (const q of SEARCH_QUERIES) {
    try {
      const data = await apiPost(
        "/api/pns-global-search-api/v1/unified-search?is_prime=false",
        { query: q, lat: city.lat, lng: city.lng },
        token
      );
      for (const s of data.stores || []) {
        if (results.has(s.store_id)) continue;
        // Filter: only restaurants, exclude non-food stores
        if (s.store_type !== "restaurant" && s.parent_store_type !== "restaurants") continue;
        const name = (s.store_name || "").toLowerCase();
        if (EXCLUDE_KEYWORDS.some((kw) => name.includes(kw))) continue;

        results.set(s.store_id, {
          store_id: s.store_id,
          name: s.store_name,
          logo: s.logo ? `https://images.rappi.com/${s.logo}` : "",
          is_available: s.is_currently_available === true,
          status: s.is_closed ? "CLOSED" : "OPEN",
          eta: s.eta || "",
          score: typeof s.store_rating_score === "object" ? (s.store_rating_score?.score ?? 0) : (s.store_rating_score ?? 0),
          source: "search",
        });
      }
      await sleep(150);
    } catch {
      // skip failed queries
    }
  }
  return [...results.values()];
}

// ─── Step 3: Get coordinates for search-only stores ───────────────────
async function getStoreCoords(storeId, token) {
  try {
    const d = await apiGet(`/api/web-gateway/web/stores-router/id/${storeId}/`, token);
    return {
      lat: d.lat,
      lng: d.lng,
      address: d.address || "",
      store_type: d.store_type?.description || "",
      score: typeof d.score === "object" ? (d.score?.score ?? 0) : (d.score ?? 0),
    };
  } catch {
    return null;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────
async function main() {
  const token = getToken();
  console.log("🔑 Token loaded\n");

  const allRestaurants = [];
  const seenIds = new Set();

  for (const city of CITIES) {
    console.log(`📍 ${city.name}`);

    // 1. Catalog (fast, has coords)
    const catalog = await fetchCatalog(city, token);
    console.log(`   📋 Catalog: ${catalog.length} restaurants`);
    for (const r of catalog) {
      if (!seenIds.has(r.store_id)) {
        seenIds.add(r.store_id);
        r.city = city.name;
        allRestaurants.push(r);
      }
    }

    // 2. Search (finds more)
    const searched = await searchRestaurants(city, token);
    const newFromSearch = searched.filter((s) => !seenIds.has(s.store_id));
    console.log(`   🔍 Search: ${searched.length} found, ${newFromSearch.length} new`);

    // 3. Get coordinates for new stores
    if (newFromSearch.length > 0) {
      console.log(`   📡 Fetching coordinates for ${newFromSearch.length} stores...`);
      for (let i = 0; i < newFromSearch.length; i++) {
        const s = newFromSearch[i];
        process.stdout.write(`\r   [${i + 1}/${newFromSearch.length}] ${s.name?.slice(0, 40)}`);
        const coords = await getStoreCoords(s.store_id, token);
        if (coords && coords.lat && coords.lng) {
          seenIds.add(s.store_id);
          allRestaurants.push({
            ...s,
            lat: coords.lat,
            lng: coords.lng,
            address: coords.address,
            city: city.name,
          });
        }
        await sleep(200);
      }
      process.stdout.write("\n");
    }

    console.log(`   ✅ Total unique so far: ${allRestaurants.length}\n`);
  }

  // Final stats
  const withCoords = allRestaurants.filter((r) => r.lat && r.lng);
  const available = withCoords.filter((r) => r.is_available).length;

  console.log(`\n══════════════════════════════════════`);
  console.log(`✅ Total unique restaurants: ${withCoords.length}`);
  console.log(`   🟢 Abiertos: ${available}`);
  console.log(`   🔴 Cerrados: ${withCoords.length - available}`);
  console.log(`══════════════════════════════════════\n`);

  writeFileSync("restaurants.json", JSON.stringify(withCoords, null, 2));
  console.log(`💾 restaurants.json saved`);

  writeFileSync("map.html", generateMapHTML(withCoords));
  console.log(`🗺️  map.html saved`);
}

// ─── HTML Map ─────────────────────────────────────────────────────────
function esc(str) {
  return String(str).replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
}

function generateMapHTML(restaurants) {
  const markers = restaurants
    .filter((r) => r.lat && r.lng)
    .map(
      (r) => `
    L.marker([${r.lat}, ${r.lng}], {
      icon: L.divIcon({
        className: 'custom-marker',
        html: '<div class="marker-dot ${r.is_available ? "available" : "unavailable"}"></div>',
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      })
    }).addTo(map).bindPopup(\`
      <div style="min-width:220px">
        ${r.logo ? `<img src="${esc(r.logo)}" style="width:100%;height:60px;object-fit:cover;border-radius:6px;margin-bottom:6px" onerror="this.style.display='none'">` : ""}
        <strong style="font-size:14px">${esc(r.name)}</strong><br>
        <span style="color:#666;font-size:12px">${esc(r.address)}</span><br>
        <span style="font-size:12px">⭐ ${esc(r.score)} · ${esc(r.status)}</span><br>
        <span style="font-size:12px;color:${r.is_available ? "#16a34a" : "#dc2626"}">${r.is_available ? "✅ Abierto" : "❌ Cerrado"}</span><br>
        <span style="font-size:11px;color:#888">🕐 ${esc(r.eta)} · 📍 ${esc(r.city)}</span>
      </div>
    \`)`
    )
    .join("\n    ");

  const available = restaurants.filter((r) => r.is_available).length;
  const unavailable = restaurants.filter((r) => !r.is_available).length;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rappi Restaurants — Norte de Santander</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    #map { width: 100vw; height: 100vh; }
    .search-box {
      position: fixed; top: 12px; left: 50px; z-index: 1000;
      background: white; border-radius: 10px; padding: 4px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    }
    .search-box input {
      border: none; outline: none; font-size: 14px; padding: 10px 16px;
      width: 320px; border-radius: 8px; background: #f5f5f5;
    }
    .search-box input:focus { background: #fff; box-shadow: 0 0 0 2px #6366f1; }
    .info-panel {
      position: fixed; top: 12px; right: 12px; z-index: 1000;
      background: white; border-radius: 12px; padding: 16px 20px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15); max-width: 280px;
    }
    .info-panel h2 { font-size: 16px; margin-bottom: 8px; color: #1a1a1a; }
    .info-panel .stat { display: flex; justify-content: space-between; font-size: 13px; margin: 4px 0; }
    .info-panel .stat .label { color: #666; }
    .info-panel .stat .value { font-weight: 600; }
    .info-panel .stat .value.green { color: #16a34a; }
    .info-panel .stat .value.red { color: #dc2626; }
    .info-panel .stat .value.blue { color: #6366f1; }
    .info-panel .divider { border-top: 1px solid #eee; margin: 8px 0; }
    .legend { display: flex; gap: 12px; margin-top: 8px; font-size: 12px; color: #666; }
    .legend span { display: flex; align-items: center; gap: 4px; }
    .legend .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .legend .dot.green { background: #16a34a; }
    .legend .dot.red { background: #dc2626; }
    .custom-marker .marker-dot {
      width: 10px; height: 10px; border-radius: 50%;
      border: 2px solid white; box-shadow: 0 1px 4px rgba(0,0,0,0.3);
    }
    .custom-marker .marker-dot.available { background: #16a34a; }
    .custom-marker .marker-dot.unavailable { background: #dc2626; }
    .leaflet-popup-content-wrapper { border-radius: 10px; }
  </style>
</head>
<body>
  <div id="map"></div>
  <div class="search-box">
    <input type="text" id="search" placeholder="🔍 Buscar restaurante..." autocomplete="off">
  </div>
  <div class="info-panel">
    <h2>🛵 Rappi Restaurants</h2>
    <div class="stat"><span class="label">Total</span><span class="value blue">${restaurants.length}</span></div>
    <div class="stat"><span class="label">Abiertos</span><span class="value green">${available}</span></div>
    <div class="stat"><span class="label">Cerrados</span><span class="value red">${unavailable}</span></div>
    <div class="divider"></div>
    <div class="stat"><span class="label">Cúcuta</span><span class="value">${restaurants.filter((r) => r.city === "Cúcuta").length}</span></div>
    <div class="stat"><span class="label">Villa del Rosario</span><span class="value">${restaurants.filter((r) => r.city === "Villa del Rosario").length}</span></div>
    <div class="stat"><span class="label">Los Patios</span><span class="value">${restaurants.filter((r) => r.city === "Los Patios").length}</span></div>
    <div class="legend">
      <span><span class="dot green"></span> Abierto</span>
      <span><span class="dot red"></span> Cerrado</span>
    </div>
  </div>
  <script>
    const map = L.map('map', { zoomControl: true }).setView([7.856, -72.49], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    ${markers}

    const allMarkers = [];
    map.eachLayer(l => { if (l instanceof L.Marker) allMarkers.push(l); });
    if (allMarkers.length > 0) {
      const group = L.featureGroup(allMarkers);
      map.fitBounds(group.getBounds().pad(0.1));
    }

    // Search
    const searchInput = document.getElementById('search');
    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      let visible = 0;
      allMarkers.forEach(m => {
        const popup = m.getPopup()?.getContent() || '';
        const match = !q || popup.toLowerCase().includes(q);
        if (match) { m.addTo(map); visible++; }
        else { map.removeLayer(m); }
      });
      if (q && visible > 0) {
        const group = L.featureGroup(allMarkers.filter(m => map.hasLayer(m)));
        map.fitBounds(group.getBounds().pad(0.1));
      }
    });
  </script>
</body>
</html>`;
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
