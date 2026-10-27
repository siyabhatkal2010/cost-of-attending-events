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
