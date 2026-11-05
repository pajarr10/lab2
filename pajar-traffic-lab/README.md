# PAJAR TRAFFIC LAB

Passive request monitor for a Cloudflare Worker. This version replaces the old Pages load tester with a Worker that receives requests for its own site, counts them, and displays live traffic metrics.

## What changed

- Removed the outbound load-test engine and arbitrary target URL field.
- Removed allowlist management and all KV bindings.
- Removed Pages Functions routing.
- Added a Cloudflare Worker entry point and static asset binding.
- Added a SQLite-backed Durable Object for persistent lifetime counters.
- Added live 60-second RPS graph, response status breakdown, method totals, recent request list, latency, and body-byte estimates.

The Worker does not send requests to external hosts. All non-monitoring requests are passed to this Worker's own static assets.

## Storage model

No JSON file or Workers KV is used. A deployed Worker cannot write changes back to a bundled JSON asset or use a persistent local disk. The lifetime counters are stored in the Durable Object's SQLite storage. The 60-second chart and recent-request list are in memory and reset if the Durable Object restarts.

The persistent counter is updated once per counted request. The dashboard polls the metrics endpoint every five seconds; those poll calls are not included in traffic totals, but they still use Worker/Durable Object requests. Free-plan usage limits still apply. Check current Cloudflare usage in the dashboard before any controlled test.

## Deploy to Cloudflare Workers

This project uses a Durable Object, so deploy it with Wrangler rather than the Pages drag-and-drop uploader.

1. Install Node.js and npm on your computer.
2. Extract this ZIP and open a terminal in the extracted `pajar-traffic-lab` folder.
3. Install Wrangler:

   ```bash
   npm install
   ```

4. Sign in to Cloudflare:

   ```bash
   npx wrangler login
   ```

5. Start a local preview:

   ```bash
   npm run dev
   ```

6. Deploy:

   ```bash
   npm run deploy
   ```

Wrangler reads `wrangler.toml`, creates the SQLite-backed Durable Object migration, and deploys the static dashboard from `public/` with the Worker.

## Dashboard endpoints

- `GET /api/health` — simple health response; excluded from traffic totals.
- `GET /api/metrics` — counters and live chart data; excluded from traffic totals.
- `GET /target` and `HEAD /target` — small receiver endpoint that returns HTTP 200 and is included in traffic totals.
- Other paths are passed to the Worker's own static asset binding and counted after the response.

## Metric notes

- A successful response is HTTP 200–399; other status codes are counted as failed.
- Current RPS is the average for the last five seconds. Peak RPS is the largest per-second count observed by this Durable Object.
- Bytes are estimated from the `Content-Length` header only. This is body size, not full network traffic or wire-level bytes.
- Only requests that reach this Worker are counted. Cloudflare may block or challenge traffic before Worker execution; those requests do not appear here.
- `/target` accepts only GET and HEAD. It does not read request bodies or forward requests anywhere.
- Request paths are logged without query-string values. Client IP addresses and request bodies are not stored.
- The live chart and recent request list are in-memory. The lifetime totals persist in SQLite.

This is a monitoring lab, not a DDoS tool. Use only with traffic you are authorized to send to infrastructure you control, and stay within Cloudflare's current plan limits.
