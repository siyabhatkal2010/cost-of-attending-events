// The Real Ticket: static file server + the trip-assistant chat endpoint.
//
//   npm install
//   ant auth login          (once; signs this computer in to your Anthropic account)
//   npm start               then open http://localhost:8000
//
// The browser never sees the API key. It sends the conversation to POST /api/chat and this
// server forwards it to Claude with a fixed system prompt and tool list. The tools run in the
// browser (chatbot.js), on the same site.js cost model the dashboard uses, so the chatbot's
// numbers always match the rest of the site. The server only relays.

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8000;
const MODEL = "claude-opus-5-5";

// Abuse limits for a public endpoint: the conversation comes from the browser, so cap its size.
const MAX_BODY_BYTES = 400_000;
const MAX_MESSAGES = 80;
const MAX_USER_TEXT = 2_000;

// Credentials: the sign-in saved by `ant auth login`. An ANTHROPIC_API_KEY environment variable,
// if set (e.g. on a hosting service), takes precedence.
let client = null;
try {
  client = new Anthropic();
} catch (error) {
  console.warn("No Anthropic credentials found:", error.message);
}

const CITIES = [
  "New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "Dallas", "Miami", "Atlanta", "Seattle",
  "Boston", "Philadelphia", "Washington", "San Francisco", "Detroit", "Minneapolis", "San Diego", "Tampa",
  "Denver", "Baltimore", "St. Louis", "Charlotte", "Orlando", "San Antonio", "Portland", "Las Vegas"
];

const SYSTEM_PROMPT = `You are the trip assistant on "The Real Ticket", a CSCE 447 class project website that estimates the full cost of attending concerts, sports games and live shows in 25 major US metro areas.

What the site's estimates include: tickets, one hotel night (one room per two travelers; removed when the event is in the traveler's home city), one meal per traveler, and local travel (one day of parking when driving, or round-trip transit fare per traveler). They exclude airfare, taxes and fees. Event listings are real; ticket prices and city costs are synthetic planning estimates (November 2026 sample). Say so when someone treats a number as a real quote.

Cities covered: ${CITIES.join(", ")}.
Categories: concert (shown on the site as "Artists"), sports, theater (shown as "Live events": Broadway, ballet, circus, family shows, plays).
Hotel classes: motel, standard (default), upscale, five_star. Travel modes: drive (default), transit. Default party size: 2 travelers.

How to answer:
- Never state a price, date, venue or event from memory. Get every number from a tool call, and give the totals the tools return; do not re-add them yourself.
- Use search_events for "what's on", cheapest/priciest, budget, date and distance questions; compare_event_cities to find the cheapest city for a specific artist, team or show; city_costs for a city's hotel, meal, parking and transit rates.
- If the user hasn't said how many people, which hotel class, or how they'll get around, use the defaults and mention which ones you assumed, briefly. Ask a clarifying question only when you can't make a sensible guess.
- If the user mentions where they live and it's one of the 25 cities, pass it as home_city (it removes the hotel for events there and enables distance filters).
- Keep replies short: this is a small chat panel. Lead with the answer, then at most a few bullet points. Use **bold** for the key number.
- Link events and cities using the relative "page" URLs the tools return, as Markdown links, e.g. [Olivia Rodrigo](artist.html?artist=Olivia%20Rodrigo&type=concert). Never invent other URLs.
- If nothing matches, say so and suggest the nearest alternative (another date, city or budget).
- Stay on topic: events, trip costs and how to use this site. Politely decline unrelated requests.`;

/** @type {Anthropic.Beta.BetaTool[]} */
const TOOLS = [
  {
    name: "search_events",
    description: "Search the site's events and price each one as a whole trip with the site's cost model. Returns matching events sorted as requested, each with its trip total and cost breakdown, plus the total number of matches. All filters are optional; omit any you don't need.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free text matched against event name, performer/team, venue and city, e.g. 'Lakers' or 'Wicked'." },
        category: { type: "string", enum: ["concert", "sports", "theater"] },
        subtype: { type: "string", description: "Genre or sport, e.g. 'Pop', 'Basketball', 'Broadway musicals'." },
        city: { type: "string", description: "Only events in this metro (one of the 25 cities)." },
        date_from: { type: "string", description: "YYYY-MM-DD, inclusive." },
        date_to: { type: "string", description: "YYYY-MM-DD, inclusive." },
        max_total: { type: "number", description: "Maximum whole-trip cost in USD for the whole party." },
        max_distance_miles: { type: "number", description: "Straight-line miles from home_city. Requires home_city." },
        travelers: { type: "integer", minimum: 1, maximum: 8 },
        hotel_class: { type: "string", enum: ["motel", "standard", "upscale", "five_star"] },
        travel_mode: { type: "string", enum: ["drive", "transit"] },
        home_city: { type: "string", description: "Traveler's home metro, if it is one of the 25 cities." },
        sort_by: { type: "string", enum: ["total", "ticket", "date"], description: "Default 'total' (cheapest trip first)." },
        limit: { type: "integer", minimum: 1, maximum: 15, description: "Default 8." }
      },
      additionalProperties: false
    }
  },
  {
    name: "compare_event_cities",
    description: "For one artist, team or show, find every city where it appears and rank the cities by whole-trip cost (cheapest date in each city). Use for 'where is it cheapest to see X'.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        performer: { type: "string", description: "Artist, team or show name, e.g. 'Olivia Rodrigo'." },
        travelers: { type: "integer", minimum: 1, maximum: 8 },
        hotel_class: { type: "string", enum: ["motel", "standard", "upscale", "five_star"] },
        travel_mode: { type: "string", enum: ["drive", "transit"] },
        home_city: { type: "string" },
        date_from: { type: "string", description: "YYYY-MM-DD, inclusive." },
        date_to: { type: "string", description: "YYYY-MM-DD, inclusive." }
      },
      required: ["performer"],
      additionalProperties: false
    }
  },
  {
    name: "city_costs",
    description: "Local cost rates for one or more of the 25 cities: nightly hotel rate by class, meal, daily parking, one-way transit fare, plus how many events the city has and its cheapest event trip for the given party.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        cities: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 25 },
        travelers: { type: "integer", minimum: 1, maximum: 8 },
        hotel_class: { type: "string", enum: ["motel", "standard", "upscale", "five_star"] },
        travel_mode: { type: "string", enum: ["drive", "transit"] }
      },
      required: ["cities"],
      additionalProperties: false
    }
  }
];

/* ---------- Request validation ---------- */

function validMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) return false;
  if (messages[0].role !== "user") return false;
  return messages.every(m => {
    if (!m || (m.role !== "user" && m.role !== "assistant")) return false;
    if (typeof m.content === "string") return m.role === "user" && m.content.length <= MAX_USER_TEXT;
    return Array.isArray(m.content);
  });
}

function contextText(context) {
  const today = /^\d{4}-\d{2}-\d{2}$/.test(context?.today) ? context.today : new Date().toISOString().slice(0, 10);
  const page = typeof context?.page === "string" ? context.page.slice(0, 120).replace(/[^\w .,:|/&?=%-]/g, "") : "";
  return `Today's date is ${today}.${page ? ` The user is on the page "${page}".` : ""}`;
}

// After a mid-answer model fallback, blocks the declined model produced before the final
// `fallback` marker must not be replayed (only text and the marker itself). Clean them here
// so the browser can store the content as-is.
function replayableContent(content) {
  const boundary = content.map(b => b.type).lastIndexOf("fallback");
  if (boundary < 0) return content;
  return content.filter((b, i) => i >= boundary || !["thinking", "redacted_thinking", "tool_use", "server_tool_use"].includes(b.type));
}

/* ---------- /api/chat ---------- */

async function handleChat(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return sendJSON(res, 400, { error: "Request body must be JSON under 400 KB." });
  }
  if (!validMessages(body.messages)) return sendJSON(res, 400, { error: "Invalid conversation." });
  if (!client) return sendJSON(res, 503, { error: "The chat server isn't signed in to Anthropic. Run ant auth login (or set ANTHROPIC_API_KEY) and restart it." });

  res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" });
  const send = obj => res.write(JSON.stringify(obj) + "\n");

  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    output_config: { effort: "low" }, // a chat panel: quick replies; the tools do the precise work
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // if a safety classifier declines, retry on Anthropic's recommended model
    cache_control: { type: "ephemeral" },
    system: [
      { type: "text", text: SYSTEM_PROMPT },
      { type: "text", text: contextText(body.context) }
    ],
    tools: TOOLS,
    messages: body.messages
  });
  req.on("close", () => { if (!res.writableEnded) stream.abort(); });
  stream.on("text", text => send({ type: "text", text }));

  try {
    const message = await stream.finalMessage();
    send({ type: "done", stop_reason: message.stop_reason, content: replayableContent(message.content) });
  } catch (error) {
    if (stream.aborted) return;
    console.error("Claude request failed:", error);
    send({ type: "error", error: describeError(error) });
  }
  res.end();
}

function describeError(error) {
  if (error instanceof Anthropic.AuthenticationError) return "The server's Anthropic sign-in was rejected. Run ant auth login again, and unset ANTHROPIC_API_KEY if it holds an old key.";
  if (error instanceof Anthropic.RateLimitError) return "The assistant is busy right now. Try again in a moment.";
  if (error instanceof Anthropic.BadRequestError) return "The assistant couldn't read this conversation. Start a new chat.";
  if (error instanceof Anthropic.APIError) return `The assistant hit an error (${error.status ?? "network"}). Try again.`;
  // Raised by the SDK before any request when it finds no key and no `ant auth login` profile.
  if (/authentication method/i.test(error?.message || "")) return "The chat server isn't signed in to Anthropic. Run ant auth login and restart it.";
  return "The assistant's reply was cut off. Try again.";
}

/* ---------- Static files ---------- */

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};
const PRIVATE = new Set(["server.js", "package.json", "package-lock.json", "node_modules"]);

async function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    return sendJSON(res, 400, { error: "Bad URL" });
  }
  const relative = path.normalize(urlPath === "/" ? "index.html" : urlPath.slice(1));
  const parts = relative.split(path.sep);
  // Never serve dotfiles, server code, or anything outside the site folder.
  if (parts.some(p => p.startsWith(".")) || PRIVATE.has(parts[0]) || !MIME[path.extname(relative).toLowerCase()]) {
    return sendJSON(res, 404, { error: "Not found" });
  }
  try {
    const data = await fs.readFile(path.join(ROOT, relative));
    res.writeHead(200, { "Content-Type": MIME[path.extname(relative).toLowerCase()] });
    res.end(data);
  } catch {
    sendJSON(res, 404, { error: "Not found" });
  }
}

/* ---------- Plumbing ---------- */

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { reject(new Error("too large")); req.destroy(); }
      else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJSON(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

http.createServer((req, res) => {
  if (req.url.startsWith("/api/chat")) {
    if (req.method !== "POST") return sendJSON(res, 405, { error: "Use POST" });
    return handleChat(req, res).catch(error => {
      console.error(error);
      if (!res.headersSent) sendJSON(res, 500, { error: "Server error" });
      else res.end();
    });
  }
  if (req.method !== "GET" && req.method !== "HEAD") return sendJSON(res, 405, { error: "Method not allowed" });
  serveStatic(req, res);
}).listen(PORT, () => {
  console.log(`The Real Ticket: http://localhost:${PORT}`);
  if (!client) console.warn("Not signed in to Anthropic: the site works, but the chat assistant is unavailable. Run ant auth login or set ANTHROPIC_API_KEY.");
});
