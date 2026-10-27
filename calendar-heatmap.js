/* Calendar heatmap: cheapest estimated event trip on each day. */
function initCalendarHeatmap(events, onChoose) {
  const host = document.getElementById('calendarHeatmap');
  const monthSelect = document.getElementById('calendarMonth');
  const detail = document.getElementById('calendarDetail');
  if (!host || !monthSelect || !detail) return;
  const months = [...new Set(events.filter(e => !isNaN(e.date)).map(e => `${e.date.getFullYear()}-${String(e.date.getMonth()+1).padStart(2,'0')}`))].sort();
  if (!months.length) { host.textContent = 'No dated events available.'; return; }
  monthSelect.innerHTML = '';
  months.forEach(m => { const [y, mo] = m.split('-').map(Number); const option = document.createElement('option'); option.value = m; option.textContent = new Date(y,mo-1,1).toLocaleDateString('en-US',{month:'long',year:'numeric'}); monthSelect.append(option); });
  monthSelect.value = months[0];
  function update() {
    const [year, month] = monthSelect.value.split('-').map(Number);
    const n = Number(document.getElementById('travelers').value);
    const mode = document.getElementById('travelMode').value;
    const byDay = new Map();
    events.forEach(event => {
      if (event.date.getFullYear() !== year || event.date.getMonth() !== month-1) return;
      const day = event.date.getDate();
      const total = tripCost(event,n,mode).total;
      const old = byDay.get(day);
      if (!old || total < old.total) byDay.set(day,{event,total});
    });
    const prices = [...byDay.values()].map(d=>d.total);
    const min = Math.min(...prices), max = Math.max(...prices);
    host.replaceChildren();
    const weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    weekdays.forEach(d => { const label=document.createElement('span'); label.className='calendar-weekday'; label.textContent=d; host.append(label); });
    const first = new Date(year,month-1,1).getDay();
    for(let i=0;i<first;i++){const spacer=document.createElement('span');spacer.className='calendar-spacer';host.append(spacer);}
    const days = new Date(year,month,0).getDate();
    for(let day=1;day<=days;day++) {
      const record=byDay.get(day), cell=document.createElement('button');
      cell.type='button'; cell.className='calendar-day'; cell.textContent=String(day);
      if(record){
        const intensity=max===min?0.65:0.2+0.8*(1-(record.total-min)/(max-min));
        cell.style.backgroundColor=`rgba(56,201,151,${intensity.toFixed(3)})`;
        cell.style.color=intensity>0.52?'#081b16':'#f4ecdf';
        cell.title=`${dateLabel(record.event.date)}: ${money(record.total)} — ${record.event.name} (${record.event.city})`;
        cell.setAttribute('aria-label',cell.title);
        cell.addEventListener('mouseenter',()=>{detail.textContent=cell.title;});
        cell.addEventListener('focus',()=>{detail.textContent=cell.title;});
        cell.addEventListener('click',()=>onChoose(record.event));
      }else{cell.disabled=true;cell.classList.add('calendar-no-event');cell.title='No sampled event';}
      host.append(cell);
    }
    detail.textContent=`${byDay.size} dates with sampled events. Darker green means a lower estimated total for ${n} traveler${n===1?'':'s'}. Select a date to plan the cheapest sampled event that day.`;
  }
  monthSelect.addEventListener('change',update);
  document.getElementById('travelers').addEventListener('change',update);
  document.getElementById('travelMode').addEventListener('change',update);
  update();
}
