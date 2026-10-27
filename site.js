const DATA_FILES = { events: "data/major_event_ticket_prices.csv", costs: "data/city_costs.xlsx" };
// city_costs.xlsx is the only source of city costs. Its columns are found by matching these words in the header row.
const COST_COLUMNS = { metro: "metro", hotel: "hotel", meal: "inexpensive meal", parking: "parking / day", transit: "transit" };
const PEOPLE_PER_ROOM = 2;

function norm(value) { return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim(); }
function esc(value) { return String(value).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function median(values) {
  const sorted = [...values].sort((a, b) => a - b), mid = sorted.length >> 1;
  return sorted.length ? (sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2) : NaN;
}

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

function coordinate(value) { return String(value).trim() === "" ? NaN : Number(value); }

function parseEvents(text) {
  return parseCSV(text).map(row => {
    const priceForTwo = [row.last_valid_ticket_cost_for_two, row.current_ticket_cost_for_two].map(Number).find(price => price > 0);
    return {
      city: row.pilot_city.trim(),
      state: row.pilot_state,
      id: row.event_id,
      name: row.event_name.trim(),
      performer: row.performer || row.event_name,
      type: norm(row.event_type) || "other",
      date: new Date(`${row.event_date}T${row.event_time || "12:00:00"}`),
      venue: row.canonical_major_venue || row.venue_name,
      lat: coordinate(row.venue_lat),
      lng: coordinate(row.venue_lng),
      ticket: priceForTwo / 2
    };
  }).filter(event => event.city && event.name && Number.isFinite(event.ticket) && !isNaN(event.date));
}

async function fetchData(path, asBuffer = false) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} could not be loaded (${response.status}).`);
  return asBuffer ? response.arrayBuffer() : response.text();
}

async function loadEvents() { return parseEvents(await fetchData(DATA_FILES.events)); }

// Reads the metro cost table from city_costs.xlsx (needs SheetJS on the page).
function parseCosts(buffer) {
  if (!window.XLSX) throw new Error("The spreadsheet library (SheetJS) did not load, so city costs are unavailable.");
  const workbook = XLSX.read(buffer, { type: "array" });
  const grid = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, blankrows: true, defval: null });
  const headerIndex = grid.findIndex(row => row && norm(row[0]) === COST_COLUMNS.metro);
  if (headerIndex < 0) throw new Error("The city costs sheet needs a header row that starts with \"Metro\".");
  const header = grid[headerIndex].map(norm);
  const column = key => {
    const i = header.findIndex(h => h.includes(COST_COLUMNS[key]));
    if (i < 0) throw new Error(`The city costs sheet has no column containing "${COST_COLUMNS[key]}".`);
    return i;
  };
  const ix = { hotel: column("hotel"), meal: column("meal"), parking: column("parking"), transit: column("transit") };
  const rows = {};
  for (let i = headerIndex + 1; i < grid.length; i++) {
    const row = grid[i]; if (!row || row[0] == null || String(row[0]).trim() === "") break;
    rows[String(row[0]).trim()] = { hotel: +row[ix.hotel], meal: +row[ix.meal], parking: +row[ix.parking], transit: +row[ix.transit] };
  }
  return rows;
}

async function loadCityCosts() { return parseCosts(await fetchData(DATA_FILES.costs, true)); }

// Matches an event city ("Houston") to a cost row ("Houston metro") without hard-coded names
function matchCost(city, costRows) {
  const c = norm(city), keys = Object.keys(costRows);
  const k = keys.find(k => norm(k) === c) || keys.find(k => norm(k).startsWith(c)) || keys.find(k => c.startsWith(norm(k)));
  return k ? costRows[k] : null;
}

// Keys city costs by event city. Events in a city with no cost row are dropped and the city is listed in `missing`.
function joinCityCosts(allEvents, costRows) {
  const costs = {}, missing = [];
  unique(allEvents.map(e => e.city)).forEach(city => {
    const row = matchCost(city, costRows);
    if (row) costs[city] = row; else missing.push(city);
  });
  const events = allEvents.filter(e => costs[e.city]);
  if (!events.length) throw new Error("No events matched a city in the city costs sheet.");
  return { events, costs, missing };
}

async function loadTripData() {
  const [events, costRows] = await Promise.all([loadEvents(), loadCityCosts()]);
  return joinCityCosts(events, costRows);
}

// One hotel night, one inexpensive meal per traveler, and either a day of parking or round-trip transit
function stayCost(cityCosts, travelers = 1, travelMode = "drive") {
  const rooms = Math.ceil(travelers / PEOPLE_PER_ROOM);
  const hotel = cityCosts.hotel * rooms;
  const meals = cityCosts.meal * travelers;
  const localTravel = travelMode === "transit" ? cityCosts.transit * 2 * travelers : cityCosts.parking;
  return { rooms, hotel, meals, localTravel, total: hotel + meals + localTravel };
}

function tripCost(event, costs, travelers = 1, travelMode = "drive") {
  if (!costs[event.city]) throw new Error(`No city costs found for ${event.city}.`);
  const stay = stayCost(costs[event.city], travelers, travelMode), tickets = event.ticket * travelers;
  return { ...stay, tickets, total: tickets + stay.total };
}

// A city's center is the median venue location of its events; events without coordinates are skipped.
function cityCenters(events) {
  const centers = {};
  unique(events.map(e => e.city)).forEach(city => {
    const located = events.filter(e => e.city === city && Number.isFinite(e.lat) && Number.isFinite(e.lng));
    if (located.length) centers[city] = [median(located.map(e => e.lat)), median(located.map(e => e.lng))];
  });
  return centers;
}

function cityCenterError(city) { return `No coordinates for ${city}: none of its events in ${DATA_FILES.events} has venue_lat and venue_lng.`; }

function cityCenter(centers, city) {
  if (!centers[city]) throw new Error(cityCenterError(city));
  return centers[city];
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