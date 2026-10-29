/* Compact selection-driven charts for the dashboard home page. */
function renderSelectionVizzes(events, selected, travelers, mode, hotelClass, homeCity) {
  const artistHost = document.getElementById("artistMiniViz");
  const cityHost = document.getElementById("cityMiniViz");
  const treemapHost = document.getElementById("eventTreemapMini");
  if (!artistHost || !cityHost || !treemapHost) return;
  if (!selected) {
    artistHost.textContent = "Choose an event to compare its performer across cities.";
    cityHost.textContent = "Choose an event to see its city's event mix.";
    treemapHost.textContent = "Choose an event to see its cost breakdown.";
    return;
  }

  const esc = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const categoryLabel = selected.type === "sports" ? "Team across cities" : selected.type === "theater" ? "Show across cities" : "Artist across cities";
  document.getElementById("artist-viz-title").textContent = categoryLabel;
  document.getElementById("artistVizLink").href = performerHref(selected.performer, selected.type);
  document.getElementById("cityVizLink").href = `cities.html?city=${encodeURIComponent(selected.city)}`;

  const performerEvents = events.filter(event => event.performer === selected.performer);
  const performerRows = unique(performerEvents.map(event => event.city)).map(city => {
    const cityEvents = performerEvents.filter(event => event.city === city);
    const best = cityEvents.map(event => ({ event, cost: tripCost(event, travelers, mode, hotelClass, homeCity) })).sort((a, b) => a.cost.total - b.cost.total)[0];
    return { city, total: best.cost.total };
  }).sort((a, b) => a.total - b.total);
  const artistMax = Math.max(1, ...performerRows.map(row => row.total));
  artistHost.innerHTML = `<p class="selection-name">${esc(selected.performer)}</p><div class="mini-bars">${performerRows.map((row, index) => `<div class="mini-bar-row${row.city === selected.city ? " active" : ""}"><span>${esc(row.city)}</span><i><b style="width:${row.total / artistMax * 100}%"></b></i><strong>${money(row.total)}</strong>${index === 0 && performerRows.length > 1 ? '<em>best</em>' : ""}</div>`).join("")}</div>`;

  const cityEvents = events.filter(event => event.city === selected.city);
  const typeMeta = {
    concert: { label: "Artists", color: "#78aefc" },
    sports: { label: "Sports", color: "#ff8052" },
    theater: { label: "Performances", color: "#ad8aff" },
    event: { label: "Other", color: "#38c997" }
  };
  const counts = Object.entries(cityEvents.reduce((acc, event) => { acc[event.type] = (acc[event.type] || 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]);
  const totalEvents = Math.max(1, cityEvents.length);
  const avgTicket = cityEvents.reduce((sum, event) => sum + event.ticket, 0) / totalEvents;
  cityHost.innerHTML = `<p class="selection-name">${esc(selected.city)} <small>${cityEvents.length} sampled events · ${money(avgTicket)} avg. ticket</small></p><div class="mix-bar" aria-label="Event type distribution">${counts.map(([type, count]) => `<i style="width:${count / totalEvents * 100}%;background:${typeMeta[type]?.color || typeMeta.event.color}" title="${esc(typeMeta[type]?.label || type)}: ${count}"></i>`).join("")}</div><div class="mix-key">${counts.map(([type, count]) => `<span><i style="background:${typeMeta[type]?.color || typeMeta.event.color}"></i>${esc(typeMeta[type]?.label || type)} <b>${count}</b></span>`).join("")}</div>`;

  const trip = tripCost(selected, travelers, mode, hotelClass, homeCity);
  const parts = [
    { label: "Tickets", value: trip.tickets, color: "#78aefc" },
    { label: "Hotel", value: trip.hotel, color: "#ff8052" },
    { label: "Meals", value: trip.meals, color: "#38c997" },
    { label: mode === "drive" ? "Parking" : "Transit", value: trip.localTravel, color: "#ad8aff" }
  ].filter(part => part.value > 0).sort((a, b) => b.value - a.value);
  const rects = treemapLayout(parts, 0, 0, 320, 96, true);
  treemapHost.innerHTML = `<svg class="mini-treemap" viewBox="0 0 320 96" role="img" aria-label="Cost breakdown for ${esc(selected.name)}">${rects.map(rect => `<g><rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="2" fill="${rect.item.color}"><title>${esc(rect.item.label)}: ${money(rect.item.value)}</title></rect>${rect.width > 32 && rect.height > 18 ? `<text x="${rect.x + 5}" y="${rect.y + 15}">${esc(rect.item.label)}</text>${rect.width > 46 && rect.height > 29 ? `<text class="value" x="${rect.x + 5}" y="${rect.y + 29}">${money(rect.item.value)}</text>` : ""}` : ""}</g>`).join("")}</svg>`;
}

function treemapLayout(items, x, y, width, height, vertical) {
  if (!items.length) return [];
  if (items.length === 1) return [{ item: items[0], x, y, width, height }];
  const total = items.reduce((sum, item) => sum + item.value, 0);
  let split = 1, running = items[0].value;
  while (split < items.length - 1 && running < total / 2) running += items[split++].value;
  const ratio = running / total;
  if (vertical) {
    const firstWidth = width * ratio;
    return [...treemapLayout(items.slice(0, split), x, y, firstWidth - 2, height, false), ...treemapLayout(items.slice(split), x + firstWidth, y, width - firstWidth, height, false)];
  }
  const firstHeight = height * ratio;
  return [...treemapLayout(items.slice(0, split), x, y, width, firstHeight - 2, true), ...treemapLayout(items.slice(split), x, y + firstHeight, width, height - firstHeight, true)];
}
