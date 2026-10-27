// The event map behind one small interface, so index.html doesn't care which map library is active:
//   const view = createMapView(element, { onCityClick(city), onNotice(message) });
//   view.update(cityData, selection, filterState);
// cityData:    [{ city, center: [lat, lng], best: { event, cost }, passes, reason }]
//              best is the city's cheapest trip; passes/reason say whether any event in the city passes the filters.
// selection:   { city, travelers, travelMode }
// filterState: { homeCenter: [lat, lng] | null, maxMiles: number | null }
// Google Maps is used when window.APP_CONFIG (config.js) has a key; otherwise, or if Google fails, Leaflet is used.

const METERS_PER_MILE = 1609.344;
const US_CENTER = [38.4, -96.8];

// ---------- Shared marker and info content ----------
// Cost level is relative to the other cities that pass the filters: the cheapest third, middle third or priciest third of the range.
function costLevels(cityData) {
  const totals = cityData.filter(item => item.passes).map(item => item.best.cost.total);
  const min = Math.min(...totals), max = Math.max(...totals);
  return Object.fromEntries(cityData.map(item => {
    if (!item.passes) return [item.city, "off"];
    const t = max > min ? (item.best.cost.total - min) / (max - min) : .5;
    return [item.city, t < 1 / 3 ? "low" : t < 2 / 3 ? "mid" : "high"];
  }));
}

function peopleLabel(n) { return `${n} ${n === 1 ? "person" : "people"}`; }

function markerLabel(item, selection) {
  const { event, cost } = item.best;
  return `${item.city}: cheapest trip ${money(cost.total)} for ${peopleLabel(selection.travelers)}, ${event.name}.` +
    `${item.reason ? ` ${item.reason}.` : ""} Select to choose this city's next event.`;
}

function paintPin(pin, item, level, selection) {
  pin.className = `price-pin level-${level}${item.city === selection.city ? " is-selected" : ""}${item.passes ? "" : " is-muted"}`;
  pin.innerHTML = `<span class="price-pin-dot"></span><span class="price-pin-label"><span class="price-pin-city">${esc(item.city)}</span> <strong>${money(item.best.cost.total)}</strong>` +
    `${item.reason ? `<span class="price-pin-note">${esc(item.reason)}</span>` : ""}</span>`;
}

function mapInfoHTML(item, selection) {
  const { event, cost } = item.best, n = selection.travelers;
  const line = (label, value) => `<li><span>${label}</span><strong>${money(value)}</strong></li>`;
  return `<div class="map-info-body">
    <p class="map-info-city">${esc(item.city)}${item.reason ? ` <span class="filter-tag">${esc(item.reason)}</span>` : ""}</p>
    <p class="map-info-event">Cheapest trip: <strong>${esc(event.name)}</strong><br>${dateLabel(event.date)} · ${esc(event.venue)}</p>
    <ul class="breakdown">${line(`Tickets · ${n} × ${money(event.ticket)}`, cost.tickets)}${line(`Hotel · ${cost.rooms} room${cost.rooms > 1 ? "s" : ""}`, cost.hotel)}${line("Meals", cost.meals)}${line(selection.travelMode === "transit" ? "Round-trip transit" : "Parking", cost.localTravel)}${line(`Total for ${peopleLabel(n)}`, cost.total)}</ul>
  </div>`;
}

// Web Mercator pixel position at a zoom level (both Google and Leaflet use 256px tiles)
function projectPoint([lat, lng], zoom) {
  const size = 256 * 2 ** zoom, sin = Math.sin(lat * Math.PI / 180);
  return [(lng + 180) / 360 * size, (.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size];
}

// Puts each label on the first side (right, left, top, bottom) where it doesn't cover another city's dot or label
// or run past the edge of the map. pins: [{ center, pin }]; view: the visible [southWest, northEast] as [lat, lng] pairs.
// Runs again after every zoom or pan.
function layoutLabels(pins, zoom, view) {
  const sides = ["right", "left", "top", "bottom"], gap = 15, placed = [];
  const overlap = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const points = pins.map(p => projectPoint(p.center, zoom));
  points.forEach(([x, y]) => placed.push([x - 9, y - 9, x + 9, y + 9]));
  pins.map((p, i) => ({ ...p, point: points[i] })).sort((a, b) => a.point[0] - b.point[0]).forEach(({ pin, point: [x, y] }) => {
    const label = pin.querySelector(".price-pin-label");
    const w = label.offsetWidth || 110, h = label.offsetHeight || 24;
    const boxes = {
      right: [x + gap, y - h / 2, x + gap + w, y + h / 2], left: [x - gap - w, y - h / 2, x - gap, y + h / 2],
      top: [x - w / 2, y - gap - h, x + w / 2, y - gap], bottom: [x - w / 2, y + gap, x + w / 2, y + gap + h]
    };
    const offscreen = box => {
      if (!view) return 0;
      const [left, bottom] = projectPoint(view[0], zoom), [right, top] = projectPoint(view[1], zoom), inside = [left + 4, top + 4, right - 4, bottom - 4];
      return (box[2] - box[0]) * (box[3] - box[1]) - overlap(box, inside);
    };
    const cost = side => offscreen(boxes[side]) + placed.reduce((sum, box) => sum + overlap(boxes[side], box), 0);
    const side = sides.find(s => cost(s) === 0) || sides.reduce((a, b) => (cost(a) <= cost(b) ? a : b));
    sides.forEach(s => pin.classList.toggle(`label-${s}`, s === side));
    placed.push(boxes[side]);
  });
}

function withTimeout(promise, ms, message) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
}

// ---------- Google Maps implementation ----------
function loadGoogleMapsApi(key) {
  // Google's dynamic bootstrap loader: https://developers.google.com/maps/documentation/javascript/load-maps-js-api
  (g=>{var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{await (a=m.createElement("script"));e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);a.src=`https://maps.${c}apis.com/maps/api/js?`+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})({ key, v: "weekly" });
}

async function createGoogleMapView(element, config, handlers) {
  loadGoogleMapsApi(config.googleMapsApiKey);
  const [{ Map, InfoWindow, Circle }, { AdvancedMarkerElement }, core] = await withTimeout(
    Promise.all(["maps", "marker", "core"].map(name => google.maps.importLibrary(name))), 10000, "Google Maps took too long to load.");
  // Google calls this global when the key is invalid, restricted or the API isn't enabled
  window.gm_authFailure = () => handlers.onFailure("Google Maps rejected the API key.");

  // A Map ID is required for advanced markers. Dark color scheme matches the site; a cloud style on the Map ID can refine it.
  const map = new Map(element, {
    mapId: config.googleMapId || "DEMO_MAP_ID", colorScheme: (core.ColorScheme && core.ColorScheme.DARK) || "DARK",
    center: { lat: US_CENTER[0], lng: US_CENTER[1] }, zoom: 4, minZoom: 3, maxZoom: 12,
    disableDefaultUI: true, zoomControl: true, gestureHandling: "cooperative", clickableIcons: false
  });
  const info = new InfoWindow({ headerDisabled: true, disableAutoPan: true });
  const markers = new globalThis.Map();
  let circle = null, framed = false, hovered = null;

  function showInfo(city) {
    const entry = markers.get(city); if (!entry) return;
    hovered = city;
    info.setContent(mapInfoHTML(entry.item, entry.selection));
    info.open({ anchor: entry.marker, map, shouldFocus: false });
  }
  function hideInfo(city) { if (hovered === city) { info.close(); hovered = null; } }
  function relayout() {
    if (!markers.size) return;
    const bounds = map.getBounds(), corner = point => [point.lat(), point.lng()];
    layoutLabels([...markers.values()].map(({ item, pin }) => ({ center: item.center, pin })), map.getZoom() || 4, bounds && [corner(bounds.getSouthWest()), corner(bounds.getNorthEast())]);
  }
  map.addListener("idle", relayout);

  return {
    update(cityData, selection, filterState) {
      const levels = costLevels(cityData);
      cityData.forEach(item => {
        if (!markers.has(item.city)) {
          const content = document.createElement("div"), pin = document.createElement("div");
          content.className = "price-pin-google"; content.appendChild(pin);
          const marker = new AdvancedMarkerElement({ map, position: { lat: item.center[0], lng: item.center[1] }, content, gmpClickable: true });
          // Newer API versions make the marker itself the DOM element; older ones expose it as marker.element
          const host = marker instanceof HTMLElement ? marker : marker.element;
          if (host === marker) marker.addEventListener("gmp-click", () => handlers.onCityClick(item.city));
          else marker.addListener("click", () => handlers.onCityClick(item.city));
          host.addEventListener("mouseenter", () => showInfo(item.city));
          host.addEventListener("mouseleave", () => hideInfo(item.city));
          host.addEventListener("focusin", () => showInfo(item.city));
          host.addEventListener("focusout", () => hideInfo(item.city));
          markers.set(item.city, { marker, pin });
        }
        const entry = markers.get(item.city);
        Object.assign(entry, { item, selection });
        paintPin(entry.pin, item, levels[item.city], selection);
        entry.marker.title = markerLabel(item, selection);
        entry.marker.zIndex = item.city === selection.city ? 10 : 1;
      });
      relayout();
      if (hovered) showInfo(hovered);

      if (filterState.homeCenter && filterState.maxMiles) {
        const options = { center: { lat: filterState.homeCenter[0], lng: filterState.homeCenter[1] }, radius: filterState.maxMiles * METERS_PER_MILE };
        if (!circle) circle = new Circle({ map, clickable: false, strokeColor: "#78aefc", strokeOpacity: .9, strokeWeight: 2, fillColor: "#78aefc", fillOpacity: .08, ...options });
        else { circle.setOptions(options); circle.setMap(map); }
      } else if (circle) circle.setMap(null);

      if (!framed && cityData.length) {
        const bounds = new core.LatLngBounds();
        cityData.forEach(item => bounds.extend({ lat: item.center[0], lng: item.center[1] }));
        map.fitBounds(bounds, { top: 50, right: 70, bottom: 110, left: 70 });
        framed = true;
      }
    },
    destroy() { info.close(); markers.forEach(({ marker }) => { marker.map = null; }); if (circle) circle.setMap(null); window.gm_authFailure = null; }
  };
}

// ---------- Leaflet fallback ----------
function createLeafletMapView(element, handlers) {
  if (!window.L) throw new Error("The fallback map library (Leaflet) did not load.");
  const map = L.map(element, { center: US_CENTER, zoom: 4, minZoom: 3, maxZoom: 12, scrollWheelZoom: false });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  const markers = new Map();
  let circle = null, framed = false;
  const relayout = () => {
    const bounds = map.getBounds();
    layoutLabels([...markers.values()].map(marker => ({ center: marker.item.center, pin: marker.getElement().querySelector(".price-pin") })), map.getZoom(),
      [[bounds.getSouth(), bounds.getWest()], [bounds.getNorth(), bounds.getEast()]]);
  };
  map.on("moveend", relayout);

  return {
    update(cityData, selection, filterState) {
      const levels = costLevels(cityData);
      cityData.forEach(item => {
        if (!markers.has(item.city)) {
          const marker = L.marker(item.center, {
            icon: L.divIcon({ className: "price-pin-icon", html: '<div class="price-pin"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
            keyboard: true, riseOnHover: true
          });
          marker.on("click", () => handlers.onCityClick(item.city));
          marker.bindTooltip("", { direction: "auto", offset: [0, 0], className: "map-info", opacity: 1 });
          marker.addTo(map);
          marker.getElement().setAttribute("role", "button");
          marker.getElement().addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); handlers.onCityClick(item.city); }
          });
          markers.set(item.city, marker);
        }
        const marker = markers.get(item.city), icon = marker.getElement();
        marker.item = item;
        // Repaint the existing icon instead of calling setIcon, so keyboard focus stays on the marker
        paintPin(icon.querySelector(".price-pin"), item, levels[item.city], selection);
        icon.setAttribute("aria-label", markerLabel(item, selection));
        marker.setTooltipContent(mapInfoHTML(item, selection));
        marker.setZIndexOffset(item.city === selection.city ? 1000 : 0);
      });

      if (filterState.homeCenter && filterState.maxMiles) {
        const radius = filterState.maxMiles * METERS_PER_MILE;
        if (!circle) circle = L.circle(filterState.homeCenter, { radius, interactive: false, color: "#78aefc", weight: 2, fillOpacity: .08 }).addTo(map);
        else { circle.setLatLng(filterState.homeCenter); circle.setRadius(radius); if (!map.hasLayer(circle)) circle.addTo(map); }
      } else if (circle) circle.remove();

      if (!framed && cityData.length) {
        map.fitBounds(L.latLngBounds(cityData.map(item => item.center)), { paddingTopLeft: [70, 50], paddingBottomRight: [70, 110] });
        framed = true;
      }
      relayout();
    },
    destroy() { map.remove(); }
  };
}

// ---------- Facade: Google when possible, Leaflet otherwise ----------
function createMapView(element, { onCityClick, onNotice }) {
  const config = window.APP_CONFIG || {};
  let impl = null, lastArgs = null, fellBack = false;

  function useLeaflet(reason) {
    if (fellBack) return;
    fellBack = true;
    if (impl) { try { impl.destroy(); } catch (error) { console.warn(error); } impl = null; }
    // Google leaves its own nodes and inline styles behind; Leaflet needs a clean container
    element.replaceChildren(); element.removeAttribute("style");
    try {
      impl = createLeafletMapView(element, { onCityClick });
      onNotice(`${reason} Showing the basic map instead.`);
      if (lastArgs) impl.update(...lastArgs);
    } catch (error) {
      onNotice(`${reason} ${error.message} The trip planner still works.`);
    }
  }

  if (!config.googleMapsApiKey) useLeaflet("No Google Maps API key is set (see README).");
  else {
    createGoogleMapView(element, config, { onCityClick, onFailure: useLeaflet })
      .then(google => {
        if (fellBack) { google.destroy(); return; }
        impl = google;
        if (lastArgs) impl.update(...lastArgs);
      })
      .catch(error => useLeaflet(`Google Maps didn't load: ${error.message}`));
  }

  return {
    update(...args) {
      lastArgs = args;
      if (!impl) return;
      try { impl.update(...args); }
      catch (error) { console.error(error); if (!fellBack) useLeaflet(`Google Maps hit an error: ${error.message}`); }
    }
  };
}
