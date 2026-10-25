/**
 * Sunnyvale Flood Risk Explorer
 * Pure Frontend Rendering + Static Snapshot Architecture
 * 
 * Implements: Water Depth = R_BFE - R_DEM
 */

// Bounding box for Sunnyvale model
const BOUNDS = {
  west: -122.065,
  south: 37.335,
  east: -121.985,
  north: 37.445
};

const GRID_SIZE = {
  width: 400,
  height: 550
};

// State
let map;
let heatmapLayer;
let zones100Layer;
let zonesXShadedLayer;
let zonesXUnshadedLayer;
let bfeLayer;
let marker;
let lookupDataView = null;
let lookupCanvas = null;
let lookupCtx = null;
let lookupLoaded = false;
let metadata = null;

// Basemap configurations (100% free, public domain / open source, NO API key required)
const BASEMAPS = {
  osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  }),
  light_canvas: L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
      maxZoom: 18
    }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18
    })
  ]),
  dark_canvas: L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
      maxZoom: 18
    }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18
    })
  ]),
  satellite: L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
      maxZoom: 18
    }),
    L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18
    })
  ]),
  usgs_topo: L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; USGS The National Map',
    maxZoom: 16
  })
};

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  initMap();
  await Promise.all([loadMetadata(), initLookupData()]);
  loadRasterHeatmap();
  loadFemaVectorLayers();
  setupUIEventListeners();
  setupSearch();

  // Inspect Lakewood Village default point on start
  inspectCoordinate(37.4085, -122.0080, "Lakewood Village (North Sunnyvale)");
});

// Map Initialization
function initMap() {
  const sunnyvaleCenter = [37.4000, -122.0250];
  const maxBounds = [
    [BOUNDS.south - 0.05, BOUNDS.west - 0.05],
    [BOUNDS.north + 0.05, BOUNDS.east + 0.05]
  ];

  map = L.map('map', {
    center: sunnyvaleCenter,
    zoom: 13,
    minZoom: 12,
    maxZoom: 18,
    maxBounds: maxBounds,
    zoomControl: false
  });

  // Zoom control top right
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // Default basemap: OpenStreetMap (100% free, no API key needed)
  BASEMAPS.osm.addTo(map);

  // Click on map to inspect
  map.on('click', (e) => {
    inspectCoordinate(e.latlng.lat, e.latlng.lng);
  });
}

// Load metadata
async function loadMetadata() {
  try {
    const res = await fetch('data/metadata.json');
    metadata = await res.json();
    renderLocationPills(metadata.key_locations);
  } catch (err) {
    console.warn("Could not load metadata.json:", err);
  }
}

// Initialize data loading (High-precision Binary buffer + fallback to opaque PNG canvas)
async function initLookupData() {
  try {
    const res = await fetch('data/flood_lookup_data.bin');
    if (res.ok) {
      const buffer = await res.arrayBuffer();
      lookupDataView = new DataView(buffer);
      lookupLoaded = true;
      console.log("High-precision binary flood data loaded successfully.");
      return;
    }
  } catch (err) {
    console.warn("Binary data fetch failed, trying PNG fallback:", err);
  }

  // Fallback to Canvas with opaque PNG (Alpha = 255)
  return new Promise((resolve) => {
    lookupCanvas = document.createElement('canvas');
    lookupCanvas.width = GRID_SIZE.width;
    lookupCanvas.height = GRID_SIZE.height;
    lookupCtx = lookupCanvas.getContext('2d', { willReadFrequently: true });

    const lookupImg = new Image();
    lookupImg.crossOrigin = 'anonymous';
    lookupImg.src = 'data/flood_lookup_data.png';
    lookupImg.onload = () => {
      lookupCtx.drawImage(lookupImg, 0, 0);
      lookupLoaded = true;
      console.log("Fallback lookup raster loaded into canvas.");
      resolve();
    };
    lookupImg.onerror = () => {
      console.error("Failed to load fallback lookup raster.");
      resolve();
    };
  });
}

// Load precomputed static flood depth heatmap
function loadRasterHeatmap() {
  const imageBounds = [
    [BOUNDS.south, BOUNDS.west],
    [BOUNDS.north, BOUNDS.east]
  ];

  heatmapLayer = L.imageOverlay('data/flood_depth_heatmap.png', imageBounds, {
    opacity: 0.85,
    interactive: false,
    zIndex: 400
  }).addTo(map);
}

// Load FEMA Flood Zones and BFE Contours
async function loadFemaVectorLayers() {
  try {
    const resZones = await fetch('data/fema_flood_zones.geojson');
    const zonesData = await resZones.json();

    // 1. FEMA 100-Year SFHA (Zone AE, AH, AO, A)
    zones100Layer = L.geoJSON(zonesData, {
      filter: (f) => ['AE', 'AH', 'AO', 'A', 'VE', 'V'].includes(f.properties.FLD_ZONE),
      style: {
        color: '#c2410c',
        weight: 1.8,
        opacity: 0.85,
        fillColor: '#ea580c',
        fillOpacity: 0.08,
        dashArray: '4, 3'
      },
      onEachFeature: (feature, layer) => {
        const p = feature.properties;
        const sub = p.ZONE_SUBTY ? ` (${p.ZONE_SUBTY})` : '';
        layer.bindTooltip(`<strong>FEMA SFHA Zone ${p.FLD_ZONE}${sub}</strong><br>100-Year Base Floodplain (1% Annual Chance)`, {
          sticky: true
        });
        layer.on('mouseover', () => layer.setStyle({ weight: 3, opacity: 1, fillOpacity: 0.16 }));
        layer.on('mouseout', () => zones100Layer.resetStyle(layer));
      }
    }).addTo(map);

    // 2. FEMA Zone X (Shaded) - 500-Year (0.2% Annual Chance) & Levee Protected
    zonesXShadedLayer = L.geoJSON(zonesData, {
      filter: (f) => f.properties.FLD_ZONE === 'X' && (f.properties.ZONE_SUBTY?.includes('0.2') || f.properties.ZONE_SUBTY?.includes('LEVEE')),
      style: (feature) => {
        const isLevee = feature.properties.ZONE_SUBTY?.includes('LEVEE');
        if (isLevee) {
          return {
            color: '#0d9488',
            weight: 1.6,
            opacity: 0.85,
            fillColor: '#14b8a6',
            fillOpacity: 0.12,
            dashArray: '3, 4'
          };
        }
        return {
          color: '#0284c7',
          weight: 1.6,
          opacity: 0.85,
          fillColor: '#38bdf8',
          fillOpacity: 0.12,
          dashArray: '4, 4'
        };
      },
      onEachFeature: (feature, layer) => {
        const isLevee = feature.properties.ZONE_SUBTY?.includes('LEVEE');
        const title = isLevee
          ? `<strong>FEMA Zone X (Shaded) - Levee Protected</strong><br>Area Protected by Levee from 100-Year Flood`
          : `<strong>FEMA Zone X (Shaded) - 500-Year Floodplain</strong><br>0.2% Annual Chance Flood Hazard Area`;
        layer.bindTooltip(title, { sticky: true });
        layer.on('mouseover', () => layer.setStyle({ weight: 2.8, opacity: 1, fillOpacity: 0.22 }));
        layer.on('mouseout', () => zonesXShadedLayer.resetStyle(layer));
      }
    }).addTo(map);

    // 3. FEMA Zone X (Unshaded) - Area of Minimal Flood Hazard
    zonesXUnshadedLayer = L.geoJSON(zonesData, {
      filter: (f) => f.properties.FLD_ZONE === 'X' && f.properties.ZONE_SUBTY?.includes('MINIMAL'),
      style: {
        color: '#64748b',
        weight: 1.2,
        opacity: 0.65,
        fillColor: '#94a3b8',
        fillOpacity: 0.04,
        dashArray: '2, 3'
      },
      onEachFeature: (feature, layer) => {
        layer.bindTooltip(`<strong>FEMA Zone X (Unshaded)</strong><br>Area of Minimal Flood Hazard (Outside 500-Year Flood)`, {
          sticky: true
        });
        layer.on('mouseover', () => layer.setStyle({ weight: 2.2, opacity: 0.9, fillOpacity: 0.1 }));
        layer.on('mouseout', () => zonesXUnshadedLayer.resetStyle(layer));
      }
    }); // Not added by default to keep map clean, toggleable via checkbox
  } catch (e) {
    console.error("Error loading FEMA zones:", e);
  }

  // 4. BFE Lines GeoJSON
  try {
    const resBfe = await fetch('data/fema_bfe_lines.geojson');
    const bfeData = await resBfe.json();

    bfeLayer = L.geoJSON(bfeData, {
      style: {
        color: '#7c3aed',
        weight: 2.2,
        opacity: 0.85,
        dashArray: '5, 5'
      },
      onEachFeature: (feature, layer) => {
        const elev = feature.properties.ELEV;
        layer.bindTooltip(`BFE: ${elev} ft NAVD88`, {
          permanent: false,
          direction: 'top',
          className: 'bfe-tooltip'
        });
        layer.on('mouseover', () => {
          layer.setStyle({ weight: 3.5, color: '#4c1d95' });
        });
        layer.on('mouseout', () => {
          bfeLayer.resetStyle(layer);
        });
      }
    }).addTo(map);
  } catch (e) {
    console.error("Error loading BFE lines:", e);
  }
}

// Inspect a coordinate
function inspectCoordinate(lat, lng, label = null) {
  // Check bounds
  if (lat < BOUNDS.south || lat > BOUNDS.north || lng < BOUNDS.west || lng > BOUNDS.east) {
    showOutsideBoundsWarning(lat, lng);
    return;
  }

  // Add or update marker
  if (marker) {
    marker.setLatLng([lat, lng]);
  } else {
    const customIcon = L.divIcon({
      className: 'custom-pin-container',
      html: '<div class="custom-pin"></div>',
      iconSize: [24, 24],
      iconAnchor: [12, 24]
    });
    marker = L.marker([lat, lng], { icon: customIcon }).addTo(map);
  }

  // Sample data from binary buffer or canvas fallback
  let demFt = 0;
  let bfeFt = 0;
  let depthFt = 0;
  let riskCode = 0;

  if (lookupLoaded) {
    const col = Math.max(0, Math.min(GRID_SIZE.width - 1, Math.floor(((lng - BOUNDS.west) / (BOUNDS.east - BOUNDS.west)) * (GRID_SIZE.width - 1))));
    const row = Math.max(0, Math.min(GRID_SIZE.height - 1, Math.floor(((BOUNDS.north - lat) / (BOUNDS.north - BOUNDS.south)) * (GRID_SIZE.height - 1))));

    if (lookupDataView) {
      const idx = (row * GRID_SIZE.width + col) * 7;
      demFt = lookupDataView.getUint16(idx, true) / 10.0;
      depthFt = lookupDataView.getUint16(idx + 2, true) / 10.0;
      bfeFt = lookupDataView.getUint16(idx + 4, true) / 10.0;
      riskCode = lookupDataView.getUint8(idx + 6);
    } else if (lookupCtx) {
      const pixel = lookupCtx.getImageData(col, row, 1, 1).data;
      demFt = (pixel[0] / 255.0) * 300.0;
      depthFt = pixel[1] / 10.0;
      bfeFt = (pixel[2] / 255.0) * 300.0;
      if (depthFt > 3.0) riskCode = 5;
      else if (depthFt > 1.0) riskCode = 4;
      else if (depthFt > 0.0) riskCode = 3;
      else if (bfeFt > 0.0) riskCode = 2;
      else riskCode = 0;
    }
  }

  updateInspectionPanel({
    lat,
    lng,
    label: label || `${lat.toFixed(4)}°N, ${Math.abs(lng).toFixed(4)}°W`,
    demFt,
    bfeFt,
    depthFt,
    riskCode
  });
}

// Update the floating Inspection Card
function updateInspectionPanel(data) {
  const panel = document.getElementById('inspectPanel');
  panel.style.display = 'flex';

  document.getElementById('locationBadge').innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z"/><circle cx="12" cy="10" r="3"/></svg>
    ${data.label}
  `;

  const hero = document.getElementById('depthHero');
  const depthValEl = document.getElementById('depthValue');
  const depthUnitEl = document.getElementById('depthUnit');
  const statusPill = document.getElementById('statusPill');
  const advisoryEl = document.getElementById('advisoryContent');
  const demValEl = document.getElementById('demValue');
  const bfeValEl = document.getElementById('bfeValue');
  const zoneTagEl = document.getElementById('femaZoneTag');
  const gaugeGround = document.getElementById('gaugeGround');
  const gaugeWater = document.getElementById('gaugeWater');

  // Reset classes
  hero.className = 'depth-hero';

  let riskClass = '';
  let statusText = '';
  let advisoryText = '';
  let femaZone = 'Zone X (Minimal)';

  switch (data.riskCode) {
    case 5: // Deep Water > 3ft
      riskClass = 'risk-deep';
      statusText = 'Deep Water High Risk (> 3 ft / 深水高危区)';
      femaZone = 'Zone AE / Floodway';
      advisoryText = `<strong>Critical Flood Hazard:</strong> Inundation depth exceeds 3 feet in a 100-year flood event ($R_{\\text{BFE}} - R_{\\text{DEM}} = ${data.depthFt.toFixed(1)}\\text{ ft}$). Significant velocity hazard, vehicle floatation danger, and structural damage risk. NFIP flood insurance is mandatory for federally backed mortgages.`;
      break;

    case 4: // Moderate 1-3ft
      riskClass = 'risk-moderate';
      statusText = 'Moderate Flooding Risk (1 - 3 ft / 中度淹没风险)';
      femaZone = 'Zone AE / AH';
      advisoryText = `<strong>Moderate Flood Hazard:</strong> Inundation depth between 1 and 3 feet ($${data.depthFt.toFixed(1)}\\text{ ft}$). Water likely to reach ground floors, crawlspaces, and electrical utilities. Strict FEMA building elevation requirements apply.`;
      break;

    case 3: // Shallow 0-1ft
      riskClass = 'risk-shallow';
      statusText = 'Shallow Flooding Risk (0 - 1 ft / 浅水淹没风险)';
      femaZone = 'Zone AE / AO';
      advisoryText = `<strong>Shallow Inundation Risk:</strong> Low-depth sheet flow or street ponding up to 1 foot ($${data.depthFt.toFixed(1)}\\text{ ft}$). Foundation vents and garages vulnerable to water ingress. Sandbagging and door flood barriers recommended during extreme atmospheric rivers.`;
      break;

    case 2: // SFHA Dry (Elevation >= BFE)
      riskClass = 'risk-dry';
      statusText = 'Ground Above Flood Water (Dry / 低风险干地)';
      femaZone = 'Zone AE (Elevated)';
      advisoryText = `<strong>Natural High Ground in Floodplain:</strong> Ground elevation (${data.demFt.toFixed(1)} ft) is higher than the Base Flood Elevation (${data.bfeFt.toFixed(1)} ft). Calculated water depth is 0 ft. Property owners may qualify for a FEMA Letter of Map Amendment (LOMA) to waive mandatory flood insurance.`;
      break;

    case 1: // Zone X (Shaded) - 500-Year Flood Zone
      riskClass = 'risk-500yr';
      statusText = 'Zone X (Shaded) - 500-Year Floodplain (0.2% Annual Chance)';
      femaZone = 'Zone X (Shaded - 500-Yr)';
      advisoryText = `<strong>500-Year Floodplain (Moderate Hazard):</strong> Located in the 500-year (0.2% annual chance) flood hazard zone. While flood insurance is not federally mandated for mortgages in Zone X (Shaded), roughly 20% to 25% of all National Flood Insurance Program (NFIP) claims occur in this zone. Low-cost Preferred Risk Policies (PRP) are strongly advised.`;
      break;

    case 6: // Zone X (Shaded) - Levee Protected Area
      riskClass = 'risk-levee';
      statusText = 'Zone X (Shaded) - Levee Protected Area (Reduced Flood Risk)';
      femaZone = 'Zone X (Shaded - Levee Protected)';
      advisoryText = `<strong>Levee-Protected Area:</strong> Protected from the 100-year base flood by an accredited levee or floodwall system (e.g. along Sunnyvale channels). Residual flood risk remains in the event of levee overtopping, structural compromise, or interior storm drainage pump failure during extreme storm events.`;
      break;

    default: // Zone X (Unshaded) - Minimal Flood Hazard
      riskClass = 'risk-unshaded';
      statusText = 'Zone X (Unshaded) - Minimal Flood Hazard (Safe Ground)';
      femaZone = 'Zone X (Unshaded - Minimal)';
      advisoryText = `<strong>Area of Minimal Flood Hazard:</strong> Determined by FEMA to be outside both the 100-year (1% annual chance) and 500-year (0.2% annual chance) floodplains. Natural ground elevation (${data.demFt.toFixed(1)} ft NAVD88) provides primary flood protection.`;
      break;
  }

  hero.classList.add(riskClass);
  depthValEl.textContent = data.depthFt > 0 ? data.depthFt.toFixed(1) : '0.0';
  depthUnitEl.textContent = 'ft';
  statusPill.innerHTML = `<span>${statusText}</span>`;
  advisoryEl.innerHTML = advisoryText;

  demValEl.textContent = `${data.demFt.toFixed(1)} ft`;
  bfeValEl.textContent = data.bfeFt > 0 ? `${data.bfeFt.toFixed(1)} ft` : 'N/A';
  zoneTagEl.textContent = femaZone;

  // Update Cross-Section Gauge
  if (data.depthFt > 0) {
    const totalElev = data.demFt + data.depthFt;
    const groundPct = Math.max(25, Math.min(75, (data.demFt / totalElev) * 100));
    gaugeGround.style.width = `${groundPct}%`;
    gaugeGround.textContent = `Ground: ${data.demFt.toFixed(1)}'`;
    gaugeWater.style.width = `${100 - groundPct}%`;
    gaugeWater.textContent = `Water: +${data.depthFt.toFixed(1)}'`;
    gaugeWater.style.display = 'flex';
  } else {
    gaugeGround.style.width = '100%';
    gaugeGround.textContent = `Ground: ${data.demFt.toFixed(1)} ft (Above Flood Level)`;
    gaugeWater.style.display = 'none';
  }
}

// Location pills bar
function renderLocationPills(locations) {
  const container = document.getElementById('locationPills');
  if (!container || !locations) return;

  container.innerHTML = locations.map(loc => `
    <button class="loc-pill" onclick="jumpToLocation(${loc.lat}, ${loc.lon}, ${loc.zoom}, '${loc.name.replace(/'/g, "\\'")}')">
      ${loc.name}
    </button>
  `).join('');
}

window.jumpToLocation = function(lat, lon, zoom, label) {
  map.flyTo([lat, lon], zoom, { duration: 1.2 });
  inspectCoordinate(lat, lon, label);
};

// Search Setup
function setupSearch() {
  const searchInput = document.getElementById('searchInput');
  const searchClear = document.getElementById('searchClear');
  const searchResults = document.getElementById('searchResults');
  let debounceTimer;

  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim();
    if (query.length > 0) {
      searchClear.style.display = 'block';
    } else {
      searchClear.style.display = 'none';
      searchResults.style.display = 'none';
      return;
    }

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      executeSearch(query);
    }, 350);
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.style.display = 'none';
    searchResults.style.display = 'none';
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box')) {
      searchResults.style.display = 'none';
    }
  });
}

// Execute Geocoding Search
async function executeSearch(query) {
  const searchResults = document.getElementById('searchResults');
  searchResults.innerHTML = '<div class="search-result-item">Searching Sunnyvale...</div>';
  searchResults.style.display = 'block';

  // Sunnyvale presets match first
  const queryLower = query.toLowerCase();
  const matchedPresets = (metadata?.key_locations || []).filter(loc => 
    loc.name.toLowerCase().includes(queryLower) || loc.desc.toLowerCase().includes(queryLower)
  );

  try {
    // Query Nominatim bounded to Sunnyvale
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ' Sunnyvale CA')}&viewbox=${BOUNDS.west},${BOUNDS.north},${BOUNDS.east},${BOUNDS.south}&bounded=1&limit=5`;
    const res = await fetch(nominatimUrl, { headers: { 'Accept-Language': 'en' } });
    const remoteResults = await res.json();

    const allResults = [
      ...matchedPresets.map(p => ({
        display_name: p.name,
        lat: p.lat,
        lon: p.lon,
        is_preset: true,
        desc: p.desc
      })),
      ...remoteResults.map(r => ({
        display_name: r.display_name,
        lat: parseFloat(r.lat),
        lon: parseFloat(r.lon),
        is_preset: false,
        desc: 'Sunnyvale Address'
      }))
    ];

    if (allResults.length === 0) {
      searchResults.innerHTML = '<div class="search-result-item">No Sunnyvale locations found. Try "Lakewood Dr", "Murphy Ave", or "Calabazas Creek".</div>';
      return;
    }

    searchResults.innerHTML = allResults.slice(0, 6).map(item => `
      <div class="search-result-item" onclick="selectSearchResult(${item.lat}, ${item.lon}, '${item.display_name.replace(/'/g, "\\'")}')">
        <strong>${item.is_preset ? '★ ' : ''}${item.display_name.split(',')[0]}</strong>
        <small>${item.desc || item.display_name}</small>
      </div>
    `).join('');

  } catch (err) {
    console.warn("Geocoding failed, showing presets only:", err);
    if (matchedPresets.length > 0) {
      searchResults.innerHTML = matchedPresets.map(p => `
        <div class="search-result-item" onclick="selectSearchResult(${p.lat}, ${p.lon}, '${p.name.replace(/'/g, "\\'")}')">
          <strong>★ ${p.name}</strong>
          <small>${p.desc}</small>
        </div>
      `).join('');
    } else {
      searchResults.innerHTML = '<div class="search-result-item">No results. Try clicking on the map.</div>';
    }
  }
}

window.selectSearchResult = function(lat, lon, label) {
  document.getElementById('searchResults').style.display = 'none';
  document.getElementById('searchInput').value = label.split(',')[0];
  map.flyTo([lat, lon], 16, { duration: 1.2 });
  inspectCoordinate(lat, lon, label);
};

// UI Listeners & Controls
function setupUIEventListeners() {
  // Heatmap Opacity Slider
  const opacitySlider = document.getElementById('heatmapOpacity');
  const opacityVal = document.getElementById('opacityVal');
  opacitySlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    opacityVal.textContent = `${Math.round(val * 100)}%`;
    if (heatmapLayer) heatmapLayer.setOpacity(val);
  });

  // Layer Visibility Toggles
  document.getElementById('toggleHeatmap').addEventListener('change', (e) => {
    if (e.target.checked) map.addLayer(heatmapLayer);
    else map.removeLayer(heatmapLayer);
  });

  document.getElementById('toggle100Zones').addEventListener('change', (e) => {
    if (zones100Layer) {
      if (e.target.checked) map.addLayer(zones100Layer);
      else map.removeLayer(zones100Layer);
    }
  });

  document.getElementById('toggleXShaded').addEventListener('change', (e) => {
    if (zonesXShadedLayer) {
      if (e.target.checked) map.addLayer(zonesXShadedLayer);
      else map.removeLayer(zonesXShadedLayer);
    }
  });

  document.getElementById('toggleXUnshaded').addEventListener('change', (e) => {
    if (zonesXUnshadedLayer) {
      if (e.target.checked) map.addLayer(zonesXUnshadedLayer);
      else map.removeLayer(zonesXUnshadedLayer);
    }
  });

  document.getElementById('toggleBFE').addEventListener('change', (e) => {
    if (bfeLayer) {
      if (e.target.checked) map.addLayer(bfeLayer);
      else map.removeLayer(bfeLayer);
    }
  });

  // Basemap Switcher
  document.querySelectorAll('.basemap-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.basemap-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const basemapKey = btn.dataset.basemap;
      
      // Remove current basemaps
      Object.values(BASEMAPS).forEach(layer => {
        if (map.hasLayer(layer)) map.removeLayer(layer);
      });

      // Add selected
      if (BASEMAPS[basemapKey]) {
        BASEMAPS[basemapKey].addTo(map);
        if (typeof BASEMAPS[basemapKey].bringToBack === 'function') {
          BASEMAPS[basemapKey].bringToBack();
        } else if (BASEMAPS[basemapKey].eachLayer) {
          BASEMAPS[basemapKey].eachLayer(l => {
            if (typeof l.bringToBack === 'function') l.bringToBack();
          });
        }
      }
    });
  });

  // Close Inspection Panel
  document.getElementById('closeInspectBtn').addEventListener('click', () => {
    document.getElementById('inspectPanel').style.display = 'none';
    if (marker) map.removeLayer(marker);
    marker = null;
  });

  // Modal Controls
  const modal = document.getElementById('methodologyModal');
  document.getElementById('openMethodologyBtn').addEventListener('click', () => {
    modal.style.display = 'flex';
  });

  document.getElementById('closeModalBtn').addEventListener('click', () => {
    modal.style.display = 'none';
  });

  document.getElementById('closeModalBtnFooter').addEventListener('click', () => {
    modal.style.display = 'none';
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });
}

function showOutsideBoundsWarning(lat, lng) {
  alert(`Clicked coordinate (${lat.toFixed(4)}, ${lng.toFixed(4)}) is outside the Sunnyvale model boundary.\nPlease click within the Sunnyvale / Lakewood / Baylands study area.`);
}
