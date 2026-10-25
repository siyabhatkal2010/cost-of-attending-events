const CITY_COSTS = {
  "New York": { hotel: 336, meal: 25, parking: 65, transit: 3 },
  "Los Angeles": { hotel: 169, meal: 26.5, parking: 40, transit: 1.75 },
  Chicago: { hotel: 233, meal: 20.5, parking: 45, transit: 2.5 },
  Houston: { hotel: 136, meal: 20.38, parking: 25, transit: 1.25 },
  Phoenix: { hotel: 154, meal: 20, parking: 20, transit: 2 }
};

const CITY_COORDS = {
  "New York": [40.7128, -74.006],
  "Los Angeles": [34.0522, -118.2437],
  Chicago: [41.8781, -87.6298],
  Houston: [29.7604, -95.3698],
  Phoenix: [33.4484, -112.074]
};

function parseCSV(text) {
  const rows = [];
  let row = [], value = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (ch === '"' && quoted && next === '"') { value += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { row.push(value); value = ""; }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i++;
      row.push(value); value = "";
      if (row.some(cell => cell !== "")) rows.push(row);
      row = [];
    } else value += ch;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  const headers = rows.shift() || [];
  return rows.map(values => Object.fromEntries(headers.map((h, i) => [h, values[i] || ""])));
}

async function loadEvents() {
  const response = await fetch("data/major_event_ticket_prices.csv");
  if (!response.ok) throw new Error(`Event data could not be loaded (${response.status}).`);
  return parseCSV(await response.text()).map(row => {
    const priceForTwo = Number(row.last_valid_ticket_cost_for_two || row.current_ticket_cost_for_two);
    return {
      city: row.pilot_city,
      state: row.pilot_state,
      id: row.event_id,
      name: row.event_name,
      performer: row.performer || row.event_name,
      type: row.event_type || "event",
      date: new Date(`${row.event_date}T${row.event_time || "12:00:00"}`),
      venue: row.canonical_major_venue || row.venue_name,
      lat: Number(row.venue_lat),
      lng: Number(row.venue_lng),
      ticket: priceForTwo / 2
    };
  }).filter(event => event.city && event.name && Number.isFinite(event.ticket));
}

function tripCost(event, travelers = 1, travelMode = "drive") {
  const city = CITY_COSTS[event.city];
  const rooms = Math.ceil(travelers / 2);
  const tickets = event.ticket * travelers;
  const hotel = city.hotel * rooms;
  const meals = city.meal * travelers;
  const localTravel = travelMode === "transit" ? city.transit * 2 * travelers : city.parking;
  return { tickets, hotel, meals, localTravel, rooms, total: tickets + hotel + meals + localTravel };
}

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function dateLabel(date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function byName(a, b) { return a.localeCompare(b, undefined, { sensitivity: "base" }); }
function unique(values) { return [...new Set(values)].sort(byName); }

function siteHeader(active) {
  const links = [["index.html", "explore", "Explore"], ["cities.html", "cities", "Cities"], ["artists.html", "artists", "Artists"]];
  return `<header class="site-header">
    <a class="brand" href="index.html"><span class="brand-mark" aria-hidden="true">$</span><span class="brand-text">The Real Ticket</span></a>
    <nav class="site-nav" aria-label="Main navigation">
      ${links.map(([href, key, label]) => `<a href="${href}"${key === active ? ' aria-current="page"' : ""}>${label}</a>`).join("")}
    </nav>
  </header>`;
}

function siteFooter() {
  return `<footer class="site-footer"><span>CSCE 447 project prototype</span><span>Sample prices · updated October 2026</span></footer>`;
}

function showLoadError(target, error) {
  target.innerHTML = `<p class="empty"><strong>We couldn't load the sample data.</strong><br>${error.message}<br><br>Open this folder through a local web server instead of opening the file directly.</p>`;
}
