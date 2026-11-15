# Search proxy for Google Sites

Search engines refuse to load inside an `<iframe>` (they send `X-Frame-Options` /
`frame-ancestors`), and a Google Sites "Embed" is an iframe. This small server fetches the
engine's result page, drops the headers that forbid framing, and rewrites links so you stay
inside it. Links to other websites open in a new tab (those sites forbid framing too).

Engines: **Bing**, **DuckDuckGo**, **Wikipedia**. Only HTML pages go through the server;
images, CSS and fonts load straight from the engine. Scripts are removed.

## Deploy on Render (free)

1. Render dashboard → **New → Web Service** → pick this repo and branch.
2. Runtime **Python**, build `pip install -r requirements.txt`, start `python server.py`
   (or use **New → Blueprint**, which reads `render.yaml`).
3. When it's live you get `https://<name>.onrender.com`. Open it — you should see a search box.

The free tier sleeps after ~15 min idle, so the first load after a break takes ~30–60 s.

## Put it in Google Sites

**Insert → Embed → By URL**, paste `https://<name>.onrender.com/`, then Insert and resize.
(Or **Embed code**: `<iframe src="https://<name>.onrender.com/" width="100%" height="700" style="border:0"></iframe>`)

## Settings (environment variables, all optional)

| Variable | Default | What it does |
| --- | --- | --- |
| `ENGINES` | `bing,ddg,wiki` | Engines offered, first is the default. |
| `FRAME_ANCESTORS` | `*` | Who may embed it. Lock down with `https://sites.google.com https://*.googleusercontent.com` (add your custom domain if you use one). |
| `RATE_LIMIT_PER_MIN` | `90` | Requests per client per minute. |
| `EXTRA_ALLOWED_HOSTS` | – | Extra hosts (and subdomains) the proxy may load. |

## Limits worth knowing

- **Bot checks.** Engines sometimes refuse requests from hosting providers. If one does, the
  page says so and you can switch engine from the bar. Bing and Wikipedia worked in testing;
  DuckDuckGo returned a bot check from the datacenter I tested from, so it may or may not work from Render.
- **Google Search is not included.** It needs JavaScript to show results, which this proxy removes.
  For Google results use a [Programmable Search Engine](https://programmablesearchengine.google.com/)
  and paste its snippet into Embed → Embed code — no proxy needed.
- It is not an open proxy: it only fetches the engine hosts above, refuses private/internal
  addresses, and rate-limits per client.

## Develop / test

```bash
pip install -r requirements.txt
python server.py                 # http://localhost:8080
python -m unittest test_server -v
```
