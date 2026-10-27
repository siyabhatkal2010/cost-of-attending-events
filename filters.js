// Shared home-city, budget and distance filters. Needs site.js.
// State lives in the URL (?home=&budget=&maxmi=) so links can be shared, and in localStorage as a convenience; the URL wins.
// Pages call initFilters({ container, events }) once data loads, then use:
//   getFilters(), setFilters(changes), clearFilters(), onFiltersChange(callback),
//   eventPassesFilters(event, tripTotal), filterReasons(event, tripTotal), distanceMiles(event), setFilterSummary(matching, total, noun)
// Failing items are grayed out and labeled, never removed.

const FILTER_STORAGE_KEY = "realTicket.filters";
const FILTER_PARAMS = { home: "home", budget: "budget", maxMiles: "maxmi" };
const DISTANCE_STEPS = [25, 50, 100, 250, 500, 750, 1000, 1500, 2000, 2500];
const EARTH_RADIUS_MILES = 3958.8;
const NO_FILTERS = { home: "", budget: null, maxMiles: null };

let filterState = readFilters(), filterCenters = {};
const filterListeners = [];

function positiveOrNull(value) {
  const number = Number(value);
  return value !== null && value !== "" && Number.isFinite(number) && number > 0 ? number : null;
}

function cleanFilters(raw) {
  return { home: String(raw.home || ""), budget: positiveOrNull(raw.budget), maxMiles: positiveOrNull(raw.maxMiles) };
}

function readFilters() {
  const params = new URLSearchParams(location.search);
  if (Object.values(FILTER_PARAMS).some(name => params.has(name))) {
    return cleanFilters({ home: params.get(FILTER_PARAMS.home), budget: params.get(FILTER_PARAMS.budget), maxMiles: params.get(FILTER_PARAMS.maxMiles) });
  }
  try { return cleanFilters(JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY)) || NO_FILTERS); }
  catch (error) { return { ...NO_FILTERS }; }
}

// Adds the current filters to a same-site link (or removes them when they're cleared)
function withFilterParams(href) {
  const url = new URL(href, location.href);
  Object.entries(FILTER_PARAMS).forEach(([key, name]) => {
    if (filterState[key]) url.searchParams.set(name, filterState[key]); else url.searchParams.delete(name);
  });
  return url.origin === location.origin ? url.pathname.split("/").pop() + url.search + url.hash : url.href;
}

function saveFilters() {
  try { history.replaceState(history.state, "", withFilterParams(location.href)); } catch (error) { /* file:// pages can't always rewrite the URL */ }
  try { localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filterState)); } catch (error) { /* storage blocked: the URL still carries the filters */ }
}

function getFilters() { return { ...filterState }; }
function setFilters(changes) {
  filterState = cleanFilters({ ...filterState, ...changes });
  if (filterState.home && Object.keys(filterCenters).length && !filterCenters[filterState.home]) filterState.home = "";
  saveFilters();
  syncFilterBar();
  filterListeners.forEach(callback => callback(getFilters()));
}
function clearFilters() { setFilters(NO_FILTERS); }
function onFiltersChange(callback) { filterListeners.push(callback); }

// Distance only applies once a home city is chosen
function distanceFilterOn() { return Boolean(filterState.home && filterState.maxMiles && filterCenters[filterState.home]); }
function filtersActive() { return Boolean(filterState.budget || distanceFilterOn()); }
function homeCenter() { return (filterState.home && filterCenters[filterState.home]) || null; }

// Straight-line (haversine) miles from the home city's center to the venue. Events without venue coordinates use their city's center.
function distanceMiles(event) {
  const home = homeCenter();
  const venue = Number.isFinite(event.lat) && Number.isFinite(event.lng) ? [event.lat, event.lng] : filterCenters[event.city];
  if (!home || !venue) return NaN;
  const rad = degrees => degrees * Math.PI / 180;
  const dLat = rad(venue[0] - home[0]), dLng = rad(venue[1] - home[1]);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(home[0])) * Math.cos(rad(venue[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(a));
}

function filterReasons(event, tripTotal) {
  const reasons = [];
  if (filterState.budget && tripTotal > filterState.budget) reasons.push("Over budget");
  if (distanceFilterOn() && distanceMiles(event) > filterState.maxMiles) reasons.push(`Beyond ${filterState.maxMiles.toLocaleString()} mi`);
  return reasons;
}
function eventPassesFilters(event, tripTotal) { return filterReasons(event, tripTotal).length === 0; }

// "Over budget, beyond 250 mi"
function reasonText(reasons) { return reasons.map((reason, i) => (i ? reason.charAt(0).toLowerCase() + reason.slice(1) : reason)).join(", "); }

// One label for a group of failing events: the reason they all share, or a general one
function summarizeReasons(reasonLists) {
  const shared = (reasonLists[0] || []).filter(reason => reasonLists.every(list => list.includes(reason)));
  return shared.length ? reasonText(shared) : "No events match";
}

function filterTag(text, extraClass = "") { return `<span class="filter-tag${extraClass ? " " + extraClass : ""}">${esc(text)}</span>`; }

// ---------- Filter bar ----------
let filterBar = null, budgetTimer;

function distanceIndex(miles) {
  if (!miles) return DISTANCE_STEPS.length;
  return DISTANCE_STEPS.reduce((best, step, i) => (Math.abs(step - miles) < Math.abs(DISTANCE_STEPS[best] - miles) ? i : best), 0);
}
function distanceText(miles) { return miles ? `${miles.toLocaleString()} mi` : "No limit"; }

function renderFilterBar(container, cities) {
  container.innerHTML = `<section class="filter-bar" aria-labelledby="filterTitle">
    <div class="filter-head"><h2 class="filter-title" id="filterTitle">Filter trips</h2><p class="filter-count" id="filterCount" aria-live="polite"></p></div>
    <div class="filter-controls">
      <label class="field filter-field"><span>Home city</span><select id="filterHome"><option value="">Not set</option>${cities.map(city => `<option value="${esc(city)}">${esc(city)}</option>`).join("")}</select></label>
      <label class="field filter-field"><span>Max trip budget ($)</span><input id="filterBudget" type="number" inputmode="numeric" min="0" step="50" placeholder="No limit" aria-describedby="filterBudgetHint"><small id="filterBudgetHint">Whole group, at this page's traveler count</small></label>
      <div class="filter-field">
        <label class="filter-range-label" for="filterDistance"><span>Max distance</span><output id="filterDistanceValue" for="filterDistance"></output></label>
        <input id="filterDistance" type="range" min="0" max="${DISTANCE_STEPS.length}" step="1" aria-describedby="filterDistanceHint">
        <small id="filterDistanceHint"></small>
      </div>
      <button type="button" class="filter-clear" data-clear-filters>Clear filters</button>
    </div>
    <p class="filter-note">Budget covers tickets, hotel, meals and parking or transit. It doesn't include getting to the city (airfare or fuel), which isn't modeled yet.</p>
    <div class="filter-empty" id="filterEmpty" hidden><p><strong>No events match these filters.</strong> Everything is still shown, grayed out, so you can see what you're missing.</p><button type="button" class="filter-clear" data-clear-filters>Clear filters</button></div>
  </section>`;
  filterBar = container;
  const home = container.querySelector("#filterHome"), budget = container.querySelector("#filterBudget"), distance = container.querySelector("#filterDistance");
  home.addEventListener("change", () => setFilters({ home: home.value }));
  budget.addEventListener("input", () => { clearTimeout(budgetTimer); budgetTimer = setTimeout(() => setFilters({ budget: budget.value }), 350); });
  budget.addEventListener("change", () => { clearTimeout(budgetTimer); setFilters({ budget: budget.value }); });
  distance.addEventListener("input", () => {
    const i = Number(distance.value);
    setFilters({ maxMiles: i >= DISTANCE_STEPS.length ? null : DISTANCE_STEPS[i] });
  });
  container.querySelectorAll("[data-clear-filters]").forEach(button => button.addEventListener("click", clearFilters));
  syncFilterBar();
}

function syncFilterBar() {
  if (!filterBar) return;
  const home = filterBar.querySelector("#filterHome"), budget = filterBar.querySelector("#filterBudget"), distance = filterBar.querySelector("#filterDistance");
  home.value = filterState.home;
  // Don't rewrite the budget box while someone is typing in it
  if (document.activeElement !== budget) budget.value = filterState.budget || "";
  distance.value = distanceIndex(filterState.maxMiles);
  distance.disabled = !filterState.home;
  distance.setAttribute("aria-valuetext", distanceText(filterState.maxMiles));
  filterBar.querySelector("#filterDistanceValue").textContent = distanceText(filterState.maxMiles);
  filterBar.querySelector("#filterDistanceHint").textContent = filterState.home
    ? `Straight-line distance from central ${filterState.home} to the venue, not driving distance`
    : "Choose a home city to filter by straight-line distance";
}

// Updates the live match count and shows the empty state when nothing passes
function setFilterSummary(matching, total, noun = "events") {
  if (!filterBar) return;
  filterBar.querySelector("#filterCount").textContent = filtersActive()
    ? `${matching} of ${total} ${noun} match your filters`
    : `No filters set: all ${total} ${noun} shown`;
  filterBar.querySelector("#filterEmpty").hidden = !(filtersActive() && matching === 0 && total > 0);
}

function initFilters({ container, events } = {}) {
  if (events) {
    filterCenters = cityCenters(events);
    if (filterState.home && !filterCenters[filterState.home]) filterState.home = "";
  }
  saveFilters();
  if (container) renderFilterBar(container, Object.keys(filterCenters).sort(byName));
}

// Carry the filters along on links between pages, even when localStorage is blocked
function carryFiltersOnLink(event) {
  const link = event.target.closest && event.target.closest("a[href]");
  if (!link) return;
  const url = new URL(link.getAttribute("href"), location.href);
  if (url.origin === location.origin && /\.html$/.test(url.pathname)) link.setAttribute("href", withFilterParams(url.href));
}
document.addEventListener("click", carryFiltersOnLink, true);
document.addEventListener("auxclick", carryFiltersOnLink, true);
