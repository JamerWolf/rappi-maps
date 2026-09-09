const fs = require('fs');

const html = `<!DOCTYPE html>
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
    .refresh-btn {
      position: fixed; top: 12px; left: 380px; z-index: 1000;
      background: #6366f1; color: white; border: none; border-radius: 10px;
      padding: 10px 16px; font-size: 14px; cursor: pointer;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      display: flex; align-items: center; gap: 6px;
    }
    .refresh-btn:hover { background: #4f46e5; }
    .refresh-btn:disabled { background: #94a3b8; cursor: not-allowed; }
    .refresh-btn .spinner { display: none; width: 14px; height: 14px; border: 2px solid #fff; border-top-color: transparent; border-radius: 50%; animation: spin 0.6s linear infinite; }
    .refresh-btn.loading .spinner { display: inline-block; }
    .refresh-btn.loading .btn-text { display: none; }
    @keyframes spin { to { transform: rotate(360deg); } }
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
    .loading-msg {
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      z-index: 2000; background: white; padding: 24px 32px; border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.2); font-size: 16px; text-align: center;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <div class="loading-msg" id="loader">Cargando restaurantes...</div>
  <div class="search-box">
    <input type="text" id="search" placeholder="🔍 Buscar restaurante..." autocomplete="off" disabled>
  </div>
  <button class="refresh-btn" onclick="refreshData()">
    <span class="spinner"></span>
    <span class="btn-text">🔄 Actualizar</span>
  </button>
  <div class="info-panel" id="panel" style="display:none">
    <h2>🛵 Rappi Restaurants</h2>
    <div class="stat"><span class="label">Total</span><span class="value blue" id="stat-total">0</span></div>
    <div class="stat"><span class="label">Abiertos</span><span class="value green" id="stat-open">0</span></div>
    <div class="stat"><span class="label">Cerrados</span><span class="value red" id="stat-closed">0</span></div>
    <div class="divider"></div>
    <div class="stat"><span class="label">Cúcuta</span><span class="value" id="stat-cucuta">0</span></div>
    <div class="stat"><span class="label">Villa del Rosario</span><span class="value" id="stat-vr">0</span></div>
    <div class="stat"><span class="label">Los Patios</span><span class="value" id="stat-lp">0</span></div>
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

    let allMarkers = [];

    function esc(s) { return String(s).replace(/\\\\/g,'\\\\\\\\').replace(/\`/g,'\\\\\`').replace(/\\$/g,'\\\\\\$'); }

    function renderMarkers(restaurants) {
      allMarkers.forEach(m => map.removeLayer(m));
      allMarkers = [];
      document.getElementById('loader').style.display = 'none';
      document.getElementById('panel').style.display = '';
      document.getElementById('search').disabled = false;

      const available = restaurants.filter(r => r.is_available).length;
      document.getElementById('stat-total').textContent = restaurants.length;
      document.getElementById('stat-open').textContent = available;
      document.getElementById('stat-closed').textContent = restaurants.length - available;
      document.getElementById('stat-cucuta').textContent = restaurants.filter(r => r.city === 'Cúcuta').length;
      document.getElementById('stat-vr').textContent = restaurants.filter(r => r.city === 'Villa del Rosario').length;
      document.getElementById('stat-lp').textContent = restaurants.filter(r => r.city === 'Los Patios').length;

      restaurants.filter(r => r.lat && r.lng).forEach(r => {
        const marker = L.marker([r.lat, r.lng], {
          icon: L.divIcon({
            className: 'custom-marker',
            html: '<div class="marker-dot ' + (r.is_available ? 'available' : 'unavailable') + '"></div>',
            iconSize: [12, 12],
            iconAnchor: [6, 6],
          })
        }).addTo(map).bindPopup(
          '<div style="min-width:220px">' +
            (r.logo ? '<img src="' + esc(r.logo) + '" style="width:100%;height:60px;object-fit:cover;border-radius:6px;margin-bottom:6px" onerror="this.style.display=\\'none\\'">' : '') +
            '<strong style="font-size:14px">' + esc(r.name) + '</strong><br>' +
            '<span style="color:#666;font-size:12px">' + esc(r.address) + '</span><br>' +
            '<span style="font-size:12px">⭐ ' + esc(r.score) + ' · ' + esc(r.status) + '</span><br>' +
            '<span style="font-size:12px;color:' + (r.is_available ? '#16a34a' : '#dc2626') + '">' + (r.is_available ? '✅ Abierto' : '❌ Cerrado') + '</span><br>' +
            '<span style="font-size:11px;color:#888">🕐 ' + esc(r.eta) + ' · 📍 ' + esc(r.city) + '</span>' +
          '</div>'
        );
        allMarkers.push(marker);
      });

      if (allMarkers.length > 0) {
        const group = L.featureGroup(allMarkers);
        map.fitBounds(group.getBounds().pad(0.1));
      }
    }

    // Load data
    fetch('restaurants.json?t=' + Date.now())
      .then(r => r.json())
      .then(data => renderMarkers(data))
      .catch(() => {
        document.getElementById('loader').textContent = 'Error cargando datos';
      });

    // Search
    document.getElementById('search').addEventListener('input', (e) => {
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

    // Refresh
    async function refreshData() {
      const btn = document.querySelector('.refresh-btn');
      btn.disabled = true;
      btn.classList.add('loading');
      try {
        const res = await fetch('/refresh');
        if (res.status === 404 || res.status === 0) {
          alert('Refresh no disponible在线.\\nCorré localmente:\\nnode fetch-restaurants.mjs <token>\\nnode deploy.cjs');
          btn.disabled = false;
          btn.classList.remove('loading');
          return;
        }
        const data = await res.json();
        if (data.status === 'started') {
          const check = setInterval(async () => {
            const s = await fetch('/refresh-status').then(r => r.json());
            if (!s.refreshing) {
              clearInterval(check);
              location.reload();
            }
          }, 2000);
        } else {
          alert(data.error || 'Error');
          btn.disabled = false;
          btn.classList.remove('loading');
        }
      } catch {
        alert('Refresh no disponible在线.\\nCorré localmente:\\nnode fetch-restaurants.mjs <token>\\nnode deploy.cjs');
        btn.disabled = false;
        btn.classList.remove('loading');
      }
    }
  </script>
</body>
</html>`;

fs.writeFileSync('map.html', html);
console.log('✅ map.html generated (loads restaurants.json dynamically)');
