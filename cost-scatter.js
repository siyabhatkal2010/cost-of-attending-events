/* Ticket vs. local-cost scatterplot; uses the same estimates as the planner. */
function renderCostScatter(events, travelers, mode, selectedId, onSelect) {
  const host = document.getElementById('costScatter');
  if (!host || !events.length) return;
  const width = 900, height = 420, left = 78, right = 26, top = 26, bottom = 68;
  const plotW = width-left-right, plotH = height-top-bottom;
  const records = events.map(event => {
    const c = tripCost(event, travelers, mode);
    return {event, x:c.tickets, y:c.hotel+c.meals+c.localTravel, total:c.total};
  });
  const maxX = Math.max(1,...records.map(d=>d.x))*1.12;
  const maxY = Math.max(1,...records.map(d=>d.y))*1.12;
  const x = value => left + value/maxX*plotW;
  const y = value => top + plotH - value/maxY*plotH;
  const esc = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const colors = {'New York':'#78aefc','Los Angeles':'#ff8052','Chicago':'#38c997','Houston':'#ad8aff','Phoenix':'#f0c674'};
  let svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Scatterplot of ticket costs versus local trip costs for ${travelers} traveler(s), using ${mode === 'drive'?'parking':'transit'}" xmlns="http://www.w3.org/2000/svg">`;
  for(let i=0;i<=4;i++) {
    const vx=maxX*i/4, vy=maxY*i/4, gx=x(vx), gy=y(vy);
    svg+=`<line x1="${gx}" y1="${top}" x2="${gx}" y2="${top+plotH}" stroke="#34414a"/><line x1="${left}" y1="${gy}" x2="${left+plotW}" y2="${gy}" stroke="#34414a"/><text x="${gx}" y="${top+plotH+23}" text-anchor="middle" fill="#bcc4c7" font-size="13">${money(vx)}</text><text x="${left-12}" y="${gy+4}" text-anchor="end" fill="#bcc4c7" font-size="13">${money(vy)}</text>`;
  }
  svg+=`<text x="${left+plotW/2}" y="${height-12}" text-anchor="middle" fill="#f4ecdf" font-size="15">Tickets (total for party)</text><text transform="translate(18 ${top+plotH/2}) rotate(-90)" text-anchor="middle" fill="#f4ecdf" font-size="15">Hotel + meals + local travel</text>`;
  records.forEach((d,i)=>{
    const active=d.event.id===selectedId;
    svg+=`<circle data-point="${i}" cx="${x(d.x)}" cy="${y(d.y)}" r="${active?9:6}" fill="${colors[d.event.city]||'#78aefc'}" fill-opacity="${active?1:.78}" stroke="${active?'#ffffff':'#151b20'}" stroke-width="${active?3:1}" tabindex="0" role="button" aria-label="${esc(d.event.name)} in ${esc(d.event.city)}: tickets ${money(d.x)}, local costs ${money(d.y)}, total ${money(d.total)}"><title>${esc(d.event.name)} · ${esc(d.event.city)} · ${esc(dateLabel(d.event.date))}\nTickets: ${money(d.x)}\nLocal costs: ${money(d.y)}\nTotal: ${money(d.total)}\nClick to plan this event</title></circle>`;
  });
  svg+='</svg>';
  host.innerHTML=svg;
  host.querySelectorAll('[data-point]').forEach(node=>{
    const select=()=>onSelect(records[Number(node.dataset.point)].event);
    node.addEventListener('click',select);
    node.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}});
  });
  document.getElementById('scatterCount').textContent=`${records.length} sample events · ${travelers} traveler${travelers===1?'':'s'} · ${mode==='drive'?'drive + park':'transit'}`;
}
