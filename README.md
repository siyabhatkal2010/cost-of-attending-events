# The Real Ticket

A static site (plain HTML, CSS and JavaScript, no build step) that estimates the total cost of attending concerts, games and shows in five US metros: New York, Los Angeles, Chicago, Houston and Phoenix. CSCE 447 class project.

## Run it locally

The pages load their data with `fetch`, so serve the folder instead of opening the files directly:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000/>.

## Data

- `data/major_event_ticket_prices.csv`: the sampled events, venue coordinates and ticket prices.
- `data/city_costs.xlsx`: hotel, meal, parking and transit costs per metro. **This is the only place to edit city costs.** Every page reads it through `loadCityCosts()` in `site.js`; nothing is hard-coded in the JavaScript.

City centers (used for the map) are not stored anywhere: `cityCenters()` in `site.js` takes the median venue location of each city's events in the CSV.

## Google Maps (optional)

The map on the Explore page uses the Google Maps JavaScript API when a key is configured, and falls back to a Leaflet/OpenStreetMap map (with a short notice) when there is no key or Google fails to load.

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project and enable the **Maps JavaScript API** (billing must be set up, but light use stays inside the free tier).
2. Create an API key under *APIs & Services → Credentials*.
3. Restrict the key:
   - **Application restriction:** *Websites (HTTP referrers)*, allowing `http://localhost:8000/*` (and `http://127.0.0.1:8000/*`) plus your deployed domain, for example `https://yourname.github.io/*`.
   - **API restriction:** *Maps JavaScript API* only.
4. Copy `config.example.js` to `config.js` and paste the key into `googleMapsApiKey`. `config.js` is in `.gitignore`, so the key is never committed.
5. Optionally create a Map ID with a dark cloud style and put it in `googleMapId`. The default `"DEMO_MAP_ID"` works for development; the map asks Google for its dark color scheme either way.

A browser API key is always visible to anyone who opens the page (it is in the network requests), so keeping it out of git is not enough on its own. **The referrer restriction is what stops other sites from using your key.** On a static deployment you still have to publish a `config.js` with the key; the restriction is what keeps that safe.

Without `config.js`, the browser logs one 404 for it; the page works normally.
