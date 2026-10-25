# Sunnyvale Flood Risk & Depth Explorer
### USGS 3DEP LiDAR Bare-Earth DEM &times; FEMA NFHL 100-Year Base Flood Elevation (BFE)

An interactive, high-performance web application designed for Sunnyvale, California (with special focus on Lakewood Village, Calabazas Creek, and North Sunnyvale Baylands). It visualizes 100-year flood risk by subtracting USGS high-resolution LiDAR ground elevation from FEMA Base Flood Elevation ($R_{\text{BFE}} - R_{\text{DEM}}$).

---

## 🏛️ Architecture: Why Static Snapshot Outperforms Real-Time APIs

As emphasized in the project architecture design, this web application rejects live per-query federal REST APIs in favor of a **Preprocessed Static Snapshot + Pure Frontend Rendering** approach.

### Key Rationale:
1. **Infrequent Source Updates**:
   - FEMA 100-year Base Flood Elevations (BFE) and Special Flood Hazard Areas (SFHA) are revised once every several years or decades.
   - USGS 3DEP airborne LiDAR surveys occur every few years.
   - The data is quasi-static; dynamic per-request fetches waste bandwidth and introduce latency.
2. **Eliminates API Bottlenecks, Rate-Limits, and Latency**:
   - The USGS Elevation Point Query API takes 200–500ms per point. Scanning an entire municipal grid would require hundreds of thousands of HTTP requests, quickly triggering rate-limit bans or browser freezes.
   - ArcGIS REST vector polygon queries for complex county geometries are heavy and prone to gateway timeouts.
3. **Zero-Latency Client-Side Inspection**:
   - The precalculated Sunnyvale model compiles down to **less than 350 KB total assets** (`flood_depth_heatmap.png`, `flood_lookup_data.png`, and GeoJSON contours).
   - Point queries decode in **< 0.1 ms** via an offscreen HTML5 Canvas lookup buffer.
4. **Zero Hosting Cost**:
   - Can be served from any static CDN (GitHub Pages, Cloudflare Pages, AWS S3).

---

## 📐 Mathematical Model & Classification

The estimated flood depth is determined by raster algebra:
$$\text{Water Depth} = R_{\text{BFE}} - R_{\text{DEM}}$$

Where:
- $R_{\text{BFE}}$: Base Flood Elevation surface (ft NAVD88), derived from FEMA NFHL Santa Clara County (06085C) Zone AE/AH/AO attributes and hydraulic profile contour lines.
- $R_{\text{DEM}}$: Bare-Earth ground elevation (ft NAVD88), derived from USGS 3D Elevation Program (3DEP) 1-meter LiDAR.

### Risk Classification Tiers:
| Tier | Depth Range | Risk Level & Color | Description |
|---|---|---|---|
| **Tier 0** | $\le 0\text{ ft}$ | 🟢 Dry Ground / Low Risk | Ground elevation exceeds the 100-year flood water level ($R_{\text{DEM}} \ge R_{\text{BFE}}$). Property may qualify for FEMA LOMA. |
| **Tier 1** | $0 \sim 1\text{ ft}$ | 🟡 Shallow Flooding Risk | Sheet flow or shallow curb overtopping. Crawlspace vents and garages vulnerable to water ingress. |
| **Tier 2** | $1 \sim 3\text{ ft}$ | 🟠 Moderate Flooding Risk | Ground-floor inundation hazard. Critical utilities and HVAC at risk. |
| **Tier 3** | $> 3\text{ ft}$ | 🔴 Deep Water High Risk | Structural hazard, high buoyancy and vehicle floatation danger. Primarily in floodways, creek channels, and low baylands. |
| **Zone X** | 500-Year | 🔵 Moderate 500-Yr Event | 0.2% annual chance flood zone (protected from 100-year event). |

---

## 🚀 Running the Web Application Locally

Because the application fetches local JSON and PNG data via `fetch()`, run a local static HTTP server:

### Option 1: Python
```bash
cd flood_map_app
python -m http.server 8080
```
Then open [http://localhost:8080](http://localhost:8080) in your browser.

### Option 2: Node.js (npx serve)
```bash
cd flood_map_app
npx serve .
```

---

## 🛠️ Offline Preprocessing Pipeline

To re-run or adjust the data pipeline:
```bash
python flood_map_app/scripts/preprocess_pipeline.py
```
This script:
1. Reads `data/sunnyvale_dem.tif` (USGS 3DEP DEM).
2. Parses `data/fema_flood_zones.geojson` and `data/fema_bfe_lines.geojson`.
3. Performs spatial interpolation for Zone AE reaches and computes $R_{\text{BFE}} - R_{\text{DEM}}$.
4. Generates:
   - `flood_depth_heatmap.png`: RGBA visualization overlay.
   - `flood_lookup_data.png`: 4-channel data raster for instant pixel query.
   - `metadata.json`: Bounds, summary statistics, and key Sunnyvale landmarks.

---

## 🗺️ Key Features
- **Instant Address Search**: Auto-complete and geocoding bounded to Sunnyvale via Nominatim.
- **Click-to-Inspect**: Click any parcel or street to view ground elevation, BFE, flood depth, and FEMA flood zone.
- **Cross-Section Elevation Visualizer**: Interactive elevation comparison between terrain and water level.
- **Layer Controls**: Toggle depth heatmap, FEMA flood zones, and BFE contour lines with an opacity slider.
- **Basemap Switcher**: CartoDB Positron (Light), Dark Matter, OpenStreetMap, and ESRI World Satellite Imagery.
- **Sunnyvale Landmarks**: One-click jump to Lakewood Village, Calabazas Creek, Baylands Park, and Downtown.
