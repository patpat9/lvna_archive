# Lakewood Village Historical Archive (1958–2008)

Searchable digital archive preserving 50 years of community publications, civic records, historic photographs, and local history from the Lakewood Village Neighborhood Association (LVNA) in Sunnyvale, California.

- **Live Digital Archive:** [https://patpat9.github.io/lvna_archive/](https://patpat9.github.io/lvna_archive/)
- **Original Source Archive:** [https://www.grot.com/Cobwebs/LVNA/index.html](https://www.grot.com/Cobwebs/LVNA/index.html) (*Cobwebs: LVNA*, curated by Brian Smithson, 2002–2008)
- **Modern LVNA Association:** [https://lvnasv.org](https://lvnasv.org)

## Archive Contents & Features

- **The Villager:** Complete 213-issue digital collection with embedded PDF readers, issue summaries, and full text transcripts (1958–2008).
- **Neighborhood History:** 50-year chronological timeline, agricultural orchard origins, post-WWII Santa Clara Valley Airport (1945–1955), subdivision construction units, and 1970–2000 US Census demographic profiles.
- **Historical Community Guide:** Detailed neighborhood guide to parks, schools, local shopping centers, public transit corridors, 2002–2008 real estate home prices, and environmental GIS maps (seismic hazard, flood zones, VOC groundwater monitoring).
- **Activities & Events:** Community traditions, annual Dumpster Days cleanups, Lakewood Park summer picnics, holiday parades, and lighting contests with over 150 interactive lightbox photographs.
- **The LVNA:** Association history, volunteer walker network, meeting minutes, and official 1995 bylaws.
- **Civic Reference:** Historical City of Sunnyvale municipal services phone directory and archive colophon.

## Local Development

```bash
# Clone the repository
git clone https://github.com/patpat9/lvna_archive.git
cd lvna_archive

# Install dependencies
pip install -r requirements.txt

# Start the local development server
mkdocs serve
```

Then open `http://127.0.0.1:8000/` in your browser.

## Deployment

Continuous deployment to GitHub Pages is automatically handled via GitHub Actions upon pushing to the `main` branch (`.github/workflows/deploy.yml`).
