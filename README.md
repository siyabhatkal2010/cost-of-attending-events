# The Real Ticket

Estimates the full cost of attending concerts, games and shows in 25 US metros (CSCE 447 project).

## Run it

```bash
npm install
ant auth login            # once per computer: signs in to your Anthropic account
npm start                 # http://localhost:8000
```

The pages are static, so any web server can show them, but the **trip assistant** chat bubble needs `npm start`: `server.js` uses your Anthropic sign-in to relay the chat to Claude. Install the `ant` CLI from https://github.com/anthropics/anthropic-cli/releases (Windows: the `windows_amd64.zip`). On a hosting service, set an `ANTHROPIC_API_KEY` environment variable instead.

## Trip assistant

- `chatbot.js` / `chatbot.css`: the floating chat widget, included on every page.
- `server.js`: serves the site and `POST /api/chat`, which streams replies from Claude (`claude-opus-5-5`).
- Claude answers by calling three tools (`search_events`, `compare_event_cities`, `city_costs`) that run **in the browser** on `site.js`'s `tripCost()`, so its numbers match the dashboard. To change what the assistant knows or says, edit the tool handlers in `chatbot.js`, and the tool schemas and system prompt in `server.js`.
- Each message costs a little API usage. The endpoint has no login, so don't expose a server with your key to the public internet for long.
