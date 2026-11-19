/* ---------- Trip assistant (chat widget) ----------
   A floating chat panel on every page, answered by Claude through server.js (POST /api/chat).
   Claude never sees the event data directly: it calls the tools below, which run here in the
   browser on site.js's own cost model, so the chatbot's totals always match the dashboard.

   site.js is evaluated in a private scope (not as a page script) because cities.html declares
   its own globals with the same names (money, tripCost, EVENTS...). That keeps a single source
   of truth for prices without touching any page's code.

   The conversation is kept in sessionStorage so it survives moving between pages. */
(() => {
  const API_URL = "api/chat";
  const MAX_TOOL_ROUNDS = 8;
  const STORAGE_KEY = "realTicketChat.v1";
  const SUGGESTIONS = [
    "Where is it cheapest to see Gracie Abrams?",
    "Cheapest event in December for 2 people under $500?",
    "I live in Dallas. What can I see within 300 miles?",
    "Compare hotel costs in Chicago and Atlanta"
  ];

  /* ---------- Data: site.js's cost model, loaded once ---------- */

  let modelPromise;
  function costModel() {
    modelPromise ??= (async () => {
      const response = await fetch("site.js");
      if (!response.ok) throw new Error(`site.js could not be loaded (${response.status}).`);
      const exports = new Function(`${await response.text()}
        return { loadEvents, tripCost, eventDistance, subtypeOf, categoryOf, performerHref, CITY_COSTS, HOTEL_COSTS, HOTEL_LABELS };`)();
      const events = await exports.loadEvents();
      return { ...exports, events };
    })();
    modelPromise.catch(() => { modelPromise = undefined; });
    return modelPromise;
  }

  /* ---------- Tools Claude can call (schemas live in server.js) ---------- */

  const HOTEL_CLASSES = ["motel", "standard", "upscale", "five_star"];
  const round = value => Math.round(value);
  const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const validDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";

  class ToolInputError extends Error {}

  function matchCity(m, name, field) {
    if (name === undefined || name === null || name === "") return "";
    const wanted = String(name).trim().toLowerCase().replace(/^st\.? /, "st. ");
    const cities = Object.keys(m.CITY_COSTS);
    const hit = cities.find(c => c.toLowerCase() === wanted) || cities.find(c => c.toLowerCase().startsWith(wanted) || wanted.startsWith(c.toLowerCase()));
    if (!hit) throw new ToolInputError(`${field} "${name}" is not one of the site's cities: ${cities.join(", ")}.`);
    return hit;
  }

  // Tool inputs come from the model and may be partial, so coerce each field to a safe default.
  function tripSettings(m, input) {
    const travelers = Math.min(8, Math.max(1, Math.round(Number(input.travelers)) || 2));
    const hotelClass = HOTEL_CLASSES.includes(input.hotel_class) ? input.hotel_class : "standard";
    const mode = input.travel_mode === "transit" ? "transit" : "drive";
    const homeCity = matchCity(m, input.home_city, "home_city");
    return { travelers, hotelClass, mode, homeCity };
  }

  function describeSettings(m, s) {
    return { travelers: s.travelers, hotel: m.HOTEL_LABELS[s.hotelClass], local_travel: s.mode === "transit" ? "public transit" : "drive + park", home_city: s.homeCity || "none (traveling to every city)" };
  }

  function priced(m, event, s) {
    const cost = m.tripCost(event, s.travelers, s.mode, s.hotelClass, s.homeCity);
    const miles = s.homeCity ? m.eventDistance(event, s.homeCity) : null;
    return { event, cost, miles };
  }

  function eventRow(m, { event, cost, miles }) {
    return {
      name: event.name,
      performer: event.performer,
      category: m.categoryOf(event.type).label,
      subtype: m.subtypeOf(event),
      city: event.city,
      venue: event.venue,
      date: dateKey(event.date),
      time: event.date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
      ticket_per_person: round(event.ticket),
      trip_total: round(cost.total),
      breakdown: { tickets: round(cost.tickets), hotel: round(cost.hotel), meals: round(cost.meals), local_travel: round(cost.localTravel) },
      ...(cost.isHomeCity ? { note: "home city, no hotel" } : {}),
      ...(miles !== null && miles !== undefined ? { miles_from_home: round(miles) } : {}),
      page: m.performerHref(event.performer, event.type),
      city_page: `cities.html?city=${encodeURIComponent(event.city)}`
    };
  }

  function inDateRange(event, input) {
    const key = dateKey(event.date), from = validDate(input.date_from), to = validDate(input.date_to);
    return (!from || key >= from) && (!to || key <= to);
  }

  const TOOL_HANDLERS = {
    search_events(m, input) {
      const s = tripSettings(m, input);
      const city = matchCity(m, input.city, "city");
      const words = String(input.query || "").toLowerCase().split(/\s+/).filter(Boolean);
      const subtype = String(input.subtype || "").toLowerCase();
      const maxTotal = Number(input.max_total) > 0 ? Number(input.max_total) : Infinity;
      const maxMiles = Number(input.max_distance_miles) > 0 ? Number(input.max_distance_miles) : Infinity;
      if (maxMiles !== Infinity && !s.homeCity) throw new ToolInputError("max_distance_miles needs home_city.");
      const sortBy = ["ticket", "date"].includes(input.sort_by) ? input.sort_by : "total";
      const limit = Math.min(15, Math.max(1, Math.round(Number(input.limit)) || 8));

      const matches = m.events
        .filter(e => !input.category || e.type === input.category)
        .filter(e => !city || e.city === city)
        .filter(e => !subtype || m.subtypeOf(e).toLowerCase().includes(subtype))
        .filter(e => inDateRange(e, input))
        .filter(e => { const hay = `${e.name} ${e.performer} ${e.venue} ${e.city}`.toLowerCase(); return words.every(w => hay.includes(w)); })
        .map(e => priced(m, e, s))
        .filter(p => p.cost.total <= maxTotal && (maxMiles === Infinity || (p.miles ?? Infinity) <= maxMiles));
      const sorters = { total: (a, b) => a.cost.total - b.cost.total, ticket: (a, b) => a.event.ticket - b.event.ticket, date: (a, b) => a.event.date - b.event.date };
      matches.sort(sorters[sortBy]);

      const dates = m.events.map(e => dateKey(e.date)).sort();
      return {
        assumptions: describeSettings(m, s),
        match_count: matches.length,
        showing: Math.min(limit, matches.length),
        sorted_by: sortBy,
        events: matches.slice(0, limit).map(p => eventRow(m, p)),
        ...(matches.length ? {} : { hint: `No matches. Data covers ${dates[0]} to ${dates.at(-1)}; try loosening a filter.` })
      };
    },

    compare_event_cities(m, input) {
      const s = tripSettings(m, input);
      const wanted = String(input.performer || "").trim().toLowerCase();
      if (!wanted) throw new ToolInputError("performer is required.");
      const candidates = m.events.filter(e => inDateRange(e, input) && `${e.performer} ${e.name}`.toLowerCase().includes(wanted));
      if (!candidates.length) {
        const words = wanted.split(/\s+/).filter(w => w.length > 2);
        const near = [...new Set(m.events.filter(e => words.some(w => e.performer.toLowerCase().includes(w))).map(e => e.performer))].slice(0, 8);
        return { found: false, message: `No events match "${input.performer}".`, similar_performers: near };
      }
      const performers = [...new Set(candidates.map(e => e.performer))];
      const best = new Map();
      candidates.map(e => priced(m, e, s)).forEach(p => {
        const key = `${p.event.performer}|${p.event.city}`, current = best.get(key);
        if (!current) best.set(key, { ...p, count: 1 });
        else {
          current.count++;
          if (p.cost.total < current.cost.total) Object.assign(current, p);
        }
      });
      const ranked = [...best.values()].sort((a, b) => a.cost.total - b.cost.total);
      return {
        found: true,
        assumptions: describeSettings(m, s),
        matched_performers: performers,
        city_count: new Set(ranked.map(r => r.event.city)).size,
        cities: ranked.slice(0, 15).map(r => ({ ...eventRow(m, r), dates_in_this_city: r.count })),
        ...(ranked.length > 1 ? { savings_cheapest_vs_priciest: round(ranked.at(-1).cost.total - ranked[0].cost.total) } : {})
      };
    },

    city_costs(m, input) {
      const s = tripSettings(m, input);
      const list = Array.isArray(input.cities) ? input.cities.slice(0, 25) : [input.cities];
      return {
        assumptions: describeSettings(m, s),
        cities: list.map(name => {
          const city = matchCity(m, name, "city"), base = m.CITY_COSTS[city];
          const cityEvents = m.events.filter(e => e.city === city).map(e => priced(m, e, s)).sort((a, b) => a.cost.total - b.cost.total);
          return {
            city,
            hotel_per_night: Object.fromEntries(HOTEL_CLASSES.map(c => [c, round(m.HOTEL_COSTS[city]?.[c] ?? base.hotel)])),
            meal_per_person: base.meal,
            parking_per_day: base.parking,
            transit_one_way: base.transit,
            event_count: cityEvents.length,
            cheapest_event: cityEvents.length ? eventRow(m, cityEvents[0]) : null,
            city_page: `cities.html?city=${encodeURIComponent(city)}`
          };
        })
      };
    }
  };

  async function runTool(block) {
    const label = { search_events: "Searching events", compare_event_cities: "Comparing cities", city_costs: "Looking up city costs" }[block.name];
    setStatus(`${label || "Working"}…`);
    try {
      const handler = TOOL_HANDLERS[block.name];
      if (!handler) throw new ToolInputError(`Unknown tool ${block.name}.`);
      if (!block.input || typeof block.input !== "object" || Array.isArray(block.input)) throw new ToolInputError("Tool input must be a JSON object.");
      const result = handler(await costModel(), block.input);
      return { type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) };
    } catch (error) {
      return { type: "tool_result", tool_use_id: block.id, is_error: true, content: error instanceof ToolInputError ? error.message : `Tool failed: ${error.message}` };
    }
  }

  /* ---------- Conversation with the server ---------- */

  let history = [];    // API messages, replayed unchanged on every request (includes thinking blocks)
  let transcript = []; // what the panel shows: { role: "user" | "assistant" | "note", text }
  let busy = false;

  async function streamReply(onText) {
    let response;
    try {
      response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, context: { today: dateKey(new Date()), page: document.title } })
      });
    } catch {
      throw new Error("Can't reach the chat server. Start it with npm start, then open http://localhost:8000.");
    }
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      if (response.status === 404 || response.status === 405 || response.status === 501) {
        throw new Error("The assistant needs the project's Node server. Run npm start, then open http://localhost:8000.");
      }
      throw new Error(detail?.error || `The chat server returned ${response.status}.`);
    }
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = "", done = null;
    for (;;) {
      const { value, done: finished } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !finished });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === "text") onText(event.text);
        else if (event.type === "done") done = event;
        else if (event.type === "error") throw new Error(event.error);
      }
      if (finished) break;
    }
    if (!done) throw new Error("The reply was cut off. Try again.");
    return done;
  }

  async function ask(question) {
    if (busy || !question.trim()) return;
    busy = true; updateComposer();
    const rollbackTo = history.length;
    history.push({ role: "user", content: question.trim() });
    transcript.push({ role: "user", text: question.trim() });
    renderTranscript();
    const bubble = addBubble("assistant", "");
    let answer = "", roundText = "";
    const show = () => { renderMarkdown(bubble, answer + roundText); scrollToEnd(); };
    setStatus("Thinking…");

    try {
      for (let round = 0; ; round++) {
        if (round >= MAX_TOOL_ROUNDS) throw new Error("That question took too many lookups. Try asking something narrower.");
        roundText = "";
        const reply = await streamReply(text => { setStatus(""); roundText += text; show(); });

        if (reply.stop_reason === "refusal") {
          history.length = rollbackTo;
          transcript.pop();
          answer = ""; roundText = "";
          transcript.push({ role: "note", text: "The assistant can't help with that request. Try asking about events or trip costs." });
          break;
        }
        const toolUses = reply.content.filter(b => b.type === "tool_use");
        if (reply.stop_reason === "max_tokens" && toolUses.length) throw new Error("The reply ran too long. Try again.");
        history.push({ role: "assistant", content: reply.content });
        answer += roundText;
        if (reply.stop_reason !== "tool_use" || !toolUses.length) {
          if (reply.stop_reason === "pause_turn") continue;
          break;
        }
        if (answer && !/\n\s*$/.test(answer)) answer += "\n\n";
        const results = await Promise.all(toolUses.map(runTool));
        history.push({ role: "user", content: results });
        setStatus("Thinking…");
      }
      if (answer.trim()) transcript.push({ role: "assistant", text: answer.trim() });
    } catch (error) {
      history.length = rollbackTo;
      transcript.pop();
      transcript.push({ role: "note", text: error.message });
      composer.input.value = question;
    } finally {
      busy = false;
      setStatus("");
      save();
      renderTranscript();
      updateComposer();
      composer.input.focus();
    }
  }

  function save() {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ history, transcript })); } catch { /* storage full or blocked: chat still works on this page */ }
  }
  function restore() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
      if (saved && Array.isArray(saved.history) && Array.isArray(saved.transcript)) { history = saved.history; transcript = saved.transcript; }
    } catch { /* ignore unreadable storage */ }
  }
  function resetChat() {
    if (busy) return;
    history = []; transcript = [];
    save(); renderTranscript(); composer.input.focus();
  }

  /* ---------- Minimal, safe Markdown (bold, code, links to site pages, lists) ---------- */

  const escapeHTML = value => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const SITE_LINK = /^[a-z0-9-]+\.html(\?[^\s"'<>]*)?$/i;

  function inline(text) {
    return escapeHTML(text)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, label, href) => {
        const url = href.replace(/&amp;/g, "&");
        return SITE_LINK.test(url) ? `<a href="${escapeHTML(url)}">${label}</a>` : label;
      });
  }

  function renderMarkdown(target, text) {
    const html = [];
    let list = null;
    const closeList = () => { if (list) { html.push(`</${list}>`); list = null; } };
    for (const raw of text.split("\n")) {
      const line = raw.trimEnd();
      const bullet = line.match(/^\s*[-*•]\s+(.*)$/), numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
      const heading = line.match(/^#{1,4}\s+(.*)$/);
      if (bullet || numbered) {
        const kind = bullet ? "ul" : "ol";
        if (list !== kind) { closeList(); html.push(`<${kind}>`); list = kind; }
        html.push(`<li>${inline((bullet || numbered)[1])}</li>`);
      } else if (!line.trim()) {
        closeList();
      } else {
        closeList();
        html.push(heading ? `<p><strong>${inline(heading[1])}</strong></p>` : `<p>${inline(line)}</p>`);
      }
    }
    closeList();
    target.innerHTML = html.join("");
  }

  /* ---------- Widget UI ---------- */

  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "chatbot.css?v=1";
  document.head.append(stylesheet);

  const root = document.createElement("div");
  root.className = "rt-chat";
  root.innerHTML = `
    <button type="button" class="rt-chat-launcher" aria-expanded="false" aria-controls="rtChatPanel">
      <span class="rt-chat-launcher-mark" aria-hidden="true">$</span><span>Ask about a trip</span>
    </button>
    <section class="rt-chat-panel" id="rtChatPanel" role="dialog" aria-label="Trip assistant" hidden>
      <header class="rt-chat-head">
        <div><p class="rt-chat-kicker">Trip assistant</p><h2>What do you want to see?</h2></div>
        <div class="rt-chat-actions">
          <button type="button" class="rt-chat-icon" data-action="reset" title="Start a new chat" aria-label="Start a new chat">↺</button>
          <button type="button" class="rt-chat-icon" data-action="close" title="Close" aria-label="Close chat">×</button>
        </div>
      </header>
      <div class="rt-chat-log" aria-live="polite"></div>
      <p class="rt-chat-status" aria-live="polite"></p>
      <form class="rt-chat-form">
        <label class="rt-sr" for="rtChatInput">Message the trip assistant</label>
        <textarea id="rtChatInput" rows="1" maxlength="2000" placeholder="Ask about events, cities or budgets"></textarea>
        <button type="submit" class="rt-chat-send" aria-label="Send">↑</button>
      </form>
      <p class="rt-chat-foot">Answers use the site's sample estimates and exclude airfare, taxes and fees.</p>
    </section>`;

  const launcher = root.querySelector(".rt-chat-launcher");
  const panel = root.querySelector(".rt-chat-panel");
  const log = root.querySelector(".rt-chat-log");
  const statusLine = root.querySelector(".rt-chat-status");
  const composer = { form: root.querySelector(".rt-chat-form"), input: root.querySelector("textarea"), send: root.querySelector(".rt-chat-send") };

  function setStatus(text) { statusLine.textContent = text; statusLine.hidden = !text; }
  function scrollToEnd() { log.scrollTop = log.scrollHeight; }
  function updateComposer() { composer.send.disabled = busy || !composer.input.value.trim(); composer.input.setAttribute("aria-busy", String(busy)); }

  function addBubble(role, text) {
    const bubble = document.createElement("div");
    bubble.className = `rt-chat-msg rt-chat-${role}`;
    if (role === "assistant") renderMarkdown(bubble, text); else bubble.textContent = text;
    log.append(bubble);
    scrollToEnd();
    return bubble;
  }

  function renderTranscript() {
    log.innerHTML = "";
    if (!transcript.length) {
      const intro = document.createElement("div");
      intro.className = "rt-chat-empty";
      intro.innerHTML = `<p>Ask me to find the cheapest city for an artist, events that fit a budget, or what a trip costs.</p>
        <div class="rt-chat-chips">${SUGGESTIONS.map(s => `<button type="button" class="rt-chat-chip">${escapeHTML(s)}</button>`).join("")}</div>`;
      log.append(intro);
      return;
    }
    transcript.forEach(item => addBubble(item.role, item.text));
  }

  function openPanel() {
    panel.hidden = false; launcher.setAttribute("aria-expanded", "true"); root.classList.add("is-open");
    renderTranscript(); scrollToEnd(); composer.input.focus();
    costModel().catch(() => {}); // warm the data while the user types
  }
  function closePanel() {
    panel.hidden = true; launcher.setAttribute("aria-expanded", "false"); root.classList.remove("is-open");
    launcher.focus();
  }

  launcher.addEventListener("click", () => panel.hidden ? openPanel() : closePanel());
  root.querySelector('[data-action="close"]').addEventListener("click", closePanel);
  root.querySelector('[data-action="reset"]').addEventListener("click", resetChat);
  panel.addEventListener("keydown", e => { if (e.key === "Escape") closePanel(); });
  log.addEventListener("click", e => { const chip = e.target.closest(".rt-chat-chip"); if (chip) ask(chip.textContent); });
  composer.input.addEventListener("input", () => {
    updateComposer();
    composer.input.style.height = "auto";
    composer.input.style.height = `${Math.min(composer.input.scrollHeight, 120)}px`;
  });
  composer.input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); composer.form.requestSubmit(); }
  });
  composer.form.addEventListener("submit", e => {
    e.preventDefault();
    const question = composer.input.value;
    composer.input.value = ""; composer.input.style.height = "auto";
    ask(question);
  });

  restore();
  setStatus("");
  updateComposer();
  document.body.append(root);
})();
