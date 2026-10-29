/* Compact selection-driven charts for the dashboard home page. */
function renderSelectionVizzes(events, selected, travelers, mode, hotelClass, homeCity) {
  const artistHost = document.getElementById("artistMiniViz");
  const cityHost = document.getElementById("cityMiniViz");
  if (!artistHost || !cityHost) return;
  if (!selected) {
    artistHost.textContent = "Choose an event to compare its performer across cities.";
    cityHost.textContent = "Choose an event to see its city's event mix.";
    return;
  }

  const esc = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const categoryLabel = selected.type === "sports" ? "Team across cities" : selected.type === "theater" ? "Show across cities" : "Artist across cities";
  document.getElementById("artist-viz-title").textContent = categoryLabel;
  document.getElementById("artistVizLink").href = `artist.html?artist=${encodeURIComponent(selected.performer)}`;
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
}
