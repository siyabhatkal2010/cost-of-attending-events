const CITY_COSTS = {
  "New York": { hotel: 336, meal: 25, parking: 65, transit: 3 },
  "Los Angeles": { hotel: 169, meal: 26.5, parking: 40, transit: 1.75 },
  Chicago: { hotel: 233, meal: 20.5, parking: 45, transit: 2.5 },
  Houston: { hotel: 136, meal: 20.38, parking: 25, transit: 1.25 },
  Phoenix: { hotel: 154, meal: 20, parking: 20, transit: 2 },
  Dallas: { hotel: 155, meal: 22, parking: 30, transit: 3 },
  Miami: { hotel: 230, meal: 25, parking: 40, transit: 2.25 },
  Atlanta: { hotel: 165, meal: 20, parking: 25, transit: 2.5 },
  Seattle: { hotel: 220, meal: 24, parking: 35, transit: 2.75 },
  Boston: { hotel: 260, meal: 25, parking: 45, transit: 2.4 },
  Philadelphia: { hotel: 190, meal: 22, parking: 35, transit: 2.5 },
  Washington: { hotel: 225, meal: 24, parking: 40, transit: 2.25 },
  "San Francisco": { hotel: 275, meal: 28, parking: 45, transit: 2.75 },
  Detroit: { hotel: 145, meal: 18, parking: 25, transit: 2 },
  Minneapolis: { hotel: 160, meal: 20, parking: 28, transit: 2.5 },
  "San Diego": { hotel: 215, meal: 24, parking: 35, transit: 2.5 },
  Tampa: { hotel: 175, meal: 21, parking: 30, transit: 2 },
  Denver: { hotel: 185, meal: 22, parking: 32, transit: 2.75 },
  Baltimore: { hotel: 165, meal: 20, parking: 30, transit: 2 },
  "St. Louis": { hotel: 145, meal: 18, parking: 25, transit: 2.5 },
  Charlotte: { hotel: 160, meal: 19, parking: 25, transit: 2.2 },
  Orlando: { hotel: 185, meal: 22, parking: 30, transit: 2 },
  "San Antonio": { hotel: 140, meal: 18, parking: 22, transit: 1.3 },
  Portland: { hotel: 180, meal: 22, parking: 32, transit: 2.8 },
  "Las Vegas": { hotel: 210, meal: 24, parking: 40, transit: 2 }
};

const CITY_COORDS = {
  "New York": [40.7128, -74.006],
  "Los Angeles": [34.0522, -118.2437],
  Chicago: [41.8781, -87.6298],
  Houston: [29.7604, -95.3698],
  Phoenix: [33.4484, -112.074],
  Dallas: [32.7767, -96.797], Miami: [25.7617, -80.1918], Atlanta: [33.749, -84.388],
  Seattle: [47.6062, -122.3321], Boston: [42.3601, -71.0589], Philadelphia: [39.9526, -75.1652],
  Washington: [38.9072, -77.0369], "San Francisco": [37.7749, -122.4194], Detroit: [42.3314, -83.0458],
  Minneapolis: [44.9778, -93.265], "San Diego": [32.7157, -117.1611], Tampa: [27.9506, -82.4572],
  Denver: [39.7392, -104.9903], Baltimore: [39.2904, -76.6122], "St. Louis": [38.627, -90.1994],
  Charlotte: [35.2271, -80.8431], Orlando: [28.5383, -81.3792], "San Antonio": [29.4241, -98.4936],
  Portland: [45.5152, -122.6784], "Las Vegas": [36.1699, -115.1398]
};

const HOTEL_COSTS = {};
const HOTEL_LABELS = {
  motel: "Motel / budget",
  standard: "Standard hotel",
  upscale: "Upscale hotel",
  five_star: "Five-star hotel"
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
  const [response, hotelResponse] = await Promise.all([
    fetch("data/synthetic_25_metro_real_event_prices.csv"),
    fetch("data/hotel_quality_costs.csv")
  ]);
  if (!response.ok) throw new Error(`Event data could not be loaded (${response.status}).`);
  if (!hotelResponse.ok) throw new Error(`Hotel data could not be loaded (${hotelResponse.status}).`);
  parseCSV(await hotelResponse.text()).forEach(row => {
    HOTEL_COSTS[row.city] = {
      motel: Number(row.motel), standard: Number(row.standard),
      upscale: Number(row.upscale), five_star: Number(row.five_star)
    };
  });
  Object.entries(CITY_COSTS).forEach(([city, costs]) => {
    if (!HOTEL_COSTS[city]) HOTEL_COSTS[city] = {
      motel: Math.round(costs.hotel * 0.7), standard: costs.hotel,
      upscale: Math.round(costs.hotel * 1.55), five_star: Math.round(costs.hotel * 2.4)
    };
  });
  return parseCSV(await response.text()).map(row => {
    const priceForTwo = Number(row.synthetic_ticket_cost_for_two || row.last_valid_ticket_cost_for_two || row.current_ticket_cost_for_two);
    const sourceType = row.analysis_category || row.event_type || "event";
    const type = sourceType === "music" ? "concert" : sourceType === "stage" ? "theater" : sourceType;
    return {
      city: row.metro || row.pilot_city,
      state: row.state || row.pilot_state,
      id: row.event_id,
      name: row.event_name,
      performer: row.performer || row.event_name,
      type,
      date: new Date(`${row.event_date}T${row.event_time || "12:00:00"}`),
      venue: row.canonical_major_venue || row.venue_name,
      venueClass: row.venue_class || "",
      venueCity: row.venue_city || row.metro || row.pilot_city,
      venueState: row.venue_state || "",
      lat: Number(row.venue_lat) || CITY_COORDS[row.metro || row.pilot_city]?.[0],
      lng: Number(row.venue_lng) || CITY_COORDS[row.metro || row.pilot_city]?.[1],
      ticket: priceForTwo / 2
    };
  }).filter(event => event.city && event.name && Number.isFinite(event.ticket));
}

function tripCost(event, travelers = 1, travelMode = "drive", hotelClass = "standard", homeCity = "") {
  const city = CITY_COSTS[event.city];
  const rooms = Math.ceil(travelers / 2);
  const tickets = event.ticket * travelers;
  const nightlyRate = HOTEL_COSTS[event.city]?.[hotelClass] || city.hotel;
  const isHomeCity = Boolean(homeCity) && event.city === homeCity;
  const hotel = isHomeCity ? 0 : nightlyRate * rooms;
  const meals = city.meal * travelers;
  const localTravel = travelMode === "transit" ? city.transit * 2 * travelers : city.parking;
  return { tickets, hotel, meals, localTravel, rooms, nightlyRate, hotelClass, homeCity, isHomeCity, total: tickets + hotel + meals + localTravel };
}

function hotelCostLabel(cost) {
  return cost.isHomeCity ? "Home city · no hotel needed" : `${HOTEL_LABELS[cost.hotelClass]} · ${cost.rooms} room${cost.rooms > 1 ? "s" : ""}`;
}

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function dateLabel(date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function byName(a, b) { return a.localeCompare(b, undefined, { sensitivity: "base" }); }
function unique(values) { return [...new Set(values)].sort(byName); }

/* ---------- Distance from a home city ----------
   Great-circle (haversine) miles from the user's home city to an event's venue, used by
   the distance filter. Returns null when no home city is picked or the venue has no
   coordinates, so callers can skip the filter instead of guessing a distance. */
const EARTH_RADIUS_MILES = 3958.8;

function haversineMiles(fromLat, fromLng, toLat, toLng) {
  const toRadians = degrees => degrees * Math.PI / 180;
  const deltaLat = toRadians(toLat - fromLat), deltaLng = toRadians(toLng - fromLng);
  const a = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(deltaLng / 2) ** 2;
  return EARTH_RADIUS_MILES * 2 * Math.asin(Math.sqrt(a));
}

function eventDistance(event, homeCity) {
  const home = CITY_COORDS[homeCity];
  if (!home) return null;
  const lat = Number.isFinite(event.lat) ? event.lat : CITY_COORDS[event.city]?.[0];
  const lng = Number.isFinite(event.lng) ? event.lng : CITY_COORDS[event.city]?.[1];
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return haversineMiles(home[0], home[1], lat, lng);
}

function milesLabel(miles) {
  return `${Math.round(miles).toLocaleString("en-US")} mi`;
}


/* ---------- Event-type segmentation ----------
   The CSV's event_type maps to three user-facing categories. Subtypes are derived on the
   frontend (the data has no genre/sport column), by ordered regex rules: first match wins,
   otherwise the category's fallback. To support new data, add a rule or tweak a regex here. */
const EVENT_CATEGORIES = {
  concert: { key: "concert", label: "Artists", noun: "artist", page: "artists.html", nav: "artists",
    searchPlaceholder: "Try Olivia Rodrigo", guide: "Artist cost guide",
    fallback: "Other",
    rules: [
      ["Rock & alternative", "performer", /def leppard|death cab|joyce manor|neighbourhood|ben folds|trans-siberian/i],
      ["Classical & orchestral", "performer", /orchestra|philharmonic|symphony|seong jin cho/i],
      ["Film & TV concerts", "performer", /in concert/i],
      ["Pop", "performer", /olivia rodrigo|teddy swims|straight no chaser/i],
      ["R&B & hip-hop", "performer", /brent faiyaz|jessie reyez|tyla/i],
      ["Country", "performer", /dolly parton/i],
      ["Electronic & dance", "performer", /john summit/i],
      ["Latin & international", "performer", /lupillo rivera|udit narayan/i]] },
  sports: { key: "sports", label: "Sports", noun: "team", page: "sports.html", nav: "sports",
    searchPlaceholder: "Try Lakers", guide: "Team cost guide",
    fallback: "Motorsports & entertainment",
    rules: [
      ["Football", "name", /football/i], ["Basketball", "name", /basketball/i],
      ["Hockey", "name", /hockey/i], ["Baseball", "name", /baseball/i], ["Soccer", "name", /soccer/i],
      ["Basketball", "performer", /lakers|clippers|rockets|suns|blue demons|cougars/i],
      ["Hockey", "performer", /blackhawks|kings|devils|islanders|rangers/i],
      ["Football", "performer", /cardinals|chargers|jets/i],
      ["Baseball", "performer", /diamondbacks/i], ["Soccer", "performer", /city fc/i]] },
  theater: { key: "theater", label: "Live events", noun: "show", page: "live-events.html", nav: "live-events",
    searchPlaceholder: "Try Wicked", guide: "Live event cost guide",
    fallback: "Broadway musicals",
    rules: [
      ["Ballet & dance", "name", /ballet|nutcracker|dance/i],
      ["Circus & spectacle", "name", /cirque|spectacular/i],
      ["Family shows", "name", /bluey|grinch/i],
      ["Plays & comedy", "name", /goes wrong|cursed child|mincemeat/i]] }
};
const CATEGORY_ORDER = ["concert", "sports", "theater"];

function categoryOf(type) { return EVENT_CATEGORIES[type] || EVENT_CATEGORIES.concert; }

function subtypeOf(event) {
  const cat = categoryOf(event.type);
  const hit = cat.rules.find(([, field, re]) => re.test(field === "name" ? event.name : event.performer));
  return hit ? hit[0] : cat.fallback;
}

function subtypesFor(type) {
  const cat = categoryOf(type);
  return [...new Set([...cat.rules.map(rule => rule[0]), cat.fallback])];
}

// One entry per performer within a category, with its most common subtype.
function groupPerformers(events, type) {
  const groups = new Map();
  events.filter(e => !type || e.type === type).forEach(e => {
    const key = `${e.type}|${e.performer}`;
    if (!groups.has(key)) groups.set(key, { name: e.performer, type: e.type, events: [] });
    groups.get(key).events.push(e);
  });
  return [...groups.values()].map(g => {
    const tally = new Map();
    g.events.forEach(e => { const s = subtypeOf(e); tally.set(s, (tally.get(s) || 0) + 1); });
    g.subtype = [...tally].sort((a, b) => b[1] - a[1])[0][0];
    g.cities = unique(g.events.map(e => e.city));
    return g;
  }).sort((a, b) => b.cities.length - a.cities.length || byName(a.name, b.name));
}

function performerHref(name, type) {
  return `artist.html?artist=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function siteHeader(active) {
  const links = [["index.html", "explore", "Explore"], ["cities.html", "cities", "Cities"], ...CATEGORY_ORDER.map(t => [categoryOf(t).page, categoryOf(t).nav, categoryOf(t).label])];
  return `<header class="site-header">
    <a class="brand" href="index.html"><span class="brand-mark" aria-hidden="true">$</span><span class="brand-text">The Real Ticket</span></a>
    <nav class="site-nav" aria-label="Main navigation">
      ${links.map(([href, key, label]) => `<a href="${href}"${key === active ? ' aria-current="page"' : ""}>${label}</a>`).join("")}
    </nav>
  </header>`;
}

function siteFooter() {
  return `<footer class="site-footer"><span>CSCE 447 project prototype</span><span>Real event listings · synthetic prices · updated November 2026</span></footer>`;
}

function showLoadError(target, error) {
  target.innerHTML = `<p class="empty"><strong>We couldn't load the sample data.</strong><br>${error.message}<br><br>Open this folder through a local web server instead of opening the file directly.</p>`;
}
