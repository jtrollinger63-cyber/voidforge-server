"""Embeddable search proxy.

Search engines send X-Frame-Options / CSP frame-ancestors headers, so they refuse to
load inside an <iframe> (which is what a Google Sites "Embed" is). This server fetches
the engine's HTML result page for you, drops the headers that forbid framing, and
rewrites links so that clicking around stays inside the proxy. Result links to other
sites open in a new tab (those sites forbid framing too).

Only HTML documents are proxied. Images, CSS and fonts are left pointing at the
engine's own CDN, so the browser loads them directly. Scripts are removed.

Run:  python server.py        (PORT, default 8080)
"""
import asyncio
import base64
import html
import ipaddress
import os
import re
import socket
import time
from collections import defaultdict, deque
from html.parser import HTMLParser
from urllib.parse import parse_qsl, quote_plus, urljoin, urlsplit

import aiohttp
from aiohttp import web
from aiohttp.abc import AbstractResolver
from yarl import URL

# --------------------------------------------------------------------------- config

PORT = int(os.environ.get("PORT", "8080"))
HOST = os.environ.get("HOST", "0.0.0.0")
# Which pages may embed the proxy. "*" is fine: it has no logins or cookies to protect.
# ("*" does not cover pages opened from disk, hence "file:", which lets embed-test.html work locally.)
# To lock it down: FRAME_ANCESTORS="https://sites.google.com https://*.googleusercontent.com"
FRAME_ANCESTORS = os.environ.get("FRAME_ANCESTORS", "* file:")
RATE_LIMIT_PER_MIN = int(os.environ.get("RATE_LIMIT_PER_MIN", "90"))
MAX_BYTES = 4 * 1024 * 1024
# Only for testing behind an egress proxy (HTTPS_PROXY). Never needed on a normal host.
TRUST_ENV_PROXY = os.environ.get("TRUST_ENV_PROXY") == "1"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)

ENGINES = {
    "bing": {"name": "Bing", "url": "https://www.bing.com/search?q={q}", "hosts": ["bing.com"]},
    "ddg": {
        "name": "DuckDuckGo",
        "url": "https://html.duckduckgo.com/html/?q={q}",
        "hosts": ["duckduckgo.com"],
    },
    "wiki": {
        "name": "Wikipedia",
        "url": "https://en.wikipedia.org/w/index.php?search={q}",
        "hosts": ["wikipedia.org"],
    },
}
# ENGINES=bing,wiki  -> choose which engines are offered, first one is the default.
ENABLED = [e.strip() for e in os.environ.get("ENGINES", "bing,ddg,wiki").split(",") if e.strip() in ENGINES]
if not ENABLED:
    ENABLED = list(ENGINES)

# The proxy will ONLY fetch these hosts (and their subdomains). This is what stops it
# being an open proxy. EXTRA_ALLOWED_HOSTS=example.org,foo.com adds more.
ALLOWED = {h for e in ENABLED for h in ENGINES[e]["hosts"]}
ALLOWED |= {h.strip().lower() for h in os.environ.get("EXTRA_ALLOWED_HOSTS", "").split(",") if h.strip()}

HOST_RE = re.compile(r"^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$")


# --------------------------------------------------------------------------- url helpers


def host_allowed(host):
    host = (host or "").lower().rstrip(".")
    return any(host == h or host.endswith("." + h) for h in ALLOWED)


def unwrap(url):
    """Strip click-tracking redirect wrappers so results link straight to the target."""
    p = urlsplit(url)
    host = (p.hostname or "").lower()
    q = dict(parse_qsl(p.query))
    try:
        if host.endswith("duckduckgo.com") and p.path.rstrip("/") == "/l" and q.get("uddg"):
            return urljoin(url, q["uddg"])
        if host.endswith("bing.com") and p.path == "/ck/a" and q.get("u", "").startswith("a1"):
            raw = q["u"][2:]
            return urljoin(url, base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)).decode("utf-8"))
        if host.startswith("www.google.") and p.path == "/url" and (q.get("q") or q.get("url")):
            return urljoin(url, q.get("q") or q.get("url"))
    except (ValueError, UnicodeDecodeError):
        pass
    return url


def proxify(url):
    """Absolute URL -> local /p/ path, or None if the host is not on the allow-list."""
    try:
        p = urlsplit(url)
        port = p.port
    except ValueError:
        return None
    if p.scheme not in ("http", "https") or not p.hostname or p.username or p.password:
        return None
    if port not in (None, 80, 443) or not host_allowed(p.hostname):
        return None
    out = "/p/%s/%s%s" % (p.scheme, p.hostname, p.path or "/")
    if p.query:
        out += "?" + p.query
    if p.fragment:
        out += "#" + p.fragment
    return out


def parse_proxy_path(raw_path):
    """'/p/https/host/some/path?x=1' -> (scheme, host, path, query) or None."""
    try:
        scheme, host, tail = raw_path[len("/p/"):].split("/", 2)
    except ValueError:
        return None
    tail = tail.split("#", 1)[0]
    path, _, query = tail.partition("?")
    host = host.lower()
    if scheme not in ("http", "https") or not HOST_RE.match(host):
        return None
    return scheme, host, "/" + path, query


def engine_for_host(host):
    for key in ENABLED:
        if any(host == h or host.endswith("." + h) for h in ENGINES[key]["hosts"]):
            return key
    return None


# --------------------------------------------------------------------------- html rewriting

CSS_URL = re.compile(r"""url\(\s*(["']?)(.*?)\1\s*\)""", re.I | re.S)
CSS_IMPORT = re.compile(r"""@import\s+(["'])(.*?)\1""", re.I)
SCHEME_RE = re.compile(r"^\s*([a-z][a-z0-9+.-]*):", re.I)
DROP_ATTRS = {"integrity", "nonce", "crossorigin", "referrerpolicy", "ping", "srcdoc"}
DROP_LINK_RELS = {"preload", "prefetch", "modulepreload", "preconnect", "dns-prefetch", "prerender"}
NAV_ATTRS = {
    ("a", "href"), ("area", "href"), ("form", "action"), ("iframe", "src"), ("frame", "src"),
    ("button", "formaction"), ("input", "formaction"),
}
RESOURCE_ATTRS = {"href", "src", "poster", "data", "background"}
REFRESH_RE = re.compile(r"^(\s*[\d.]*\s*[;,]?\s*(?:url\s*=\s*)?)['\"]?(.*?)['\"]?\s*$", re.I | re.S)

BAR_CSS = (
    "<style>.vfp-bar{box-sizing:border-box;padding:8px 10px;background:#f3f4f6;border-bottom:1px solid #d6d9de;"
    "font:14px/1.2 system-ui,sans-serif}.vfp-bar form{display:flex;gap:6px;margin:0;"
    "position:sticky;left:10px;width:min(100%,calc(100vw - 36px))}"
    ".vfp-bar input,.vfp-bar select,.vfp-bar button{font:inherit;height:34px;box-sizing:border-box;margin:0;"
    "padding:0 10px;border:1px solid #b9bec7;border-radius:8px;background:#fff;color:#111}"
    ".vfp-bar input{flex:1;min-width:0}.vfp-bar button{background:#2563eb;border-color:#2563eb;color:#fff;cursor:pointer}"
    "</style>"
)


def esc(value):
    return html.escape(value, quote=True)


def css_absolute(css, base):
    """Make url(...) and @import references absolute so they still work from our origin."""

    def fix_url(m):
        u = m.group(2).strip()
        if not u or u.startswith(("data:", "#")):
            return m.group(0)
        return 'url("%s")' % urljoin(base, u).replace('"', "%22")

    def fix_import(m):
        return '@import "%s"' % urljoin(base, m.group(2)).replace('"', "%22")

    return CSS_IMPORT.sub(fix_import, CSS_URL.sub(fix_url, css))


def bar_html(engine_key, query):
    options = "".join(
        '<option value="%s"%s>%s</option>' % (k, " selected" if k == engine_key else "", esc(ENGINES[k]["name"]))
        for k in ENABLED
    )
    return (
        '<div class="vfp-bar"><form action="/search" method="get">'
        '<input type="search" name="q" value="%s" placeholder="Search" aria-label="Search">'
        '<select name="engine" aria-label="Search engine">%s</select>'
        '<button type="submit">Search</button></form></div>%s' % (esc(query), options, BAR_CSS)
    )


class Rewriter(HTMLParser):
    """Re-emits the page with scripts removed and links pointed back at the proxy."""

    def __init__(self, base, bar):
        super().__init__(convert_charrefs=False)
        self.base = base
        self.bar = bar
        self.out = []
        self.in_script = False
        self.in_style = False

    # -- url rewriting
    def nav_url(self, value):
        """Link/form target: stay inside the proxy for engine hosts, otherwise go direct."""
        v = value.strip()
        if not v or v.startswith("#"):
            return v, False
        scheme = (SCHEME_RE.match(v) or [None, ""])[1].lower()
        if scheme in ("mailto", "tel", "sms"):
            return v, False
        if scheme in ("javascript", "vbscript", "data", "blob"):
            return "#", False
        full = unwrap(urljoin(self.base, v))
        if urlsplit(full).scheme not in ("http", "https"):
            return "#", False
        local = proxify(full)
        return (local, False) if local else (full, True)

    def resource_url(self, value):
        v = value.strip()
        if not v or v.startswith("#") or SCHEME_RE.match(v) and not v.lower().startswith(("http:", "https:")):
            return value
        return urljoin(self.base, v)

    def srcset(self, value):
        parts = []
        for cand in re.split(r"\s*,\s+(?=\S)", value.strip()):
            bits = cand.split(None, 1)
            if bits:
                bits[0] = self.resource_url(bits[0])
                parts.append(" ".join(bits))
        return ", ".join(parts)

    # -- tag handling
    def _emit_tag(self, tag, attrs, selfclose):
        rendered = "".join(
            " " + name if value is None else ' %s="%s"' % (name, esc(value)) for name, value in attrs
        )
        self.out.append("<%s%s%s>" % (tag, rendered, " /" if selfclose else ""))

    def _tag(self, tag, attrs, selfclose):
        a = {k.lower(): v for k, v in attrs}
        if tag == "script":
            self.in_script = not selfclose
            return
        if tag == "noscript":
            return  # keep the contents; scripts are gone so the fallback is what we want
        if tag == "base":
            if a.get("href"):
                self.base = urljoin(self.base, a["href"])
            return
        if tag == "meta" and (a.get("http-equiv") or "").lower() in ("content-security-policy", "x-frame-options", "set-cookie"):
            return
        if tag == "link" and DROP_LINK_RELS & set((a.get("rel") or "").lower().split()):
            return

        external = False
        hidden = ""
        new = []
        is_get_form = tag == "form" and (a.get("method") or "get").lower() == "get"
        for name, value in attrs:
            n = name.lower()
            if n.startswith("on") or n in DROP_ATTRS or n == "target" and tag in ("a", "area", "form"):
                continue
            if value is not None:
                if (tag, n) in NAV_ATTRS:
                    value, external = self.nav_url(value)
                    if is_get_form and n == "action" and "?" in value and value.startswith("/p/"):
                        # A GET form drops the action's own query string on submit; keep it as hidden fields.
                        value, _, qs = value.partition("?")
                        hidden = "".join(
                            '<input type="hidden" name="%s" value="%s">' % (esc(k), esc(v))
                            for k, v in parse_qsl(qs.split("#")[0], keep_blank_values=True)
                        )
                elif n in ("srcset", "imagesrcset"):
                    value = self.srcset(value)
                elif n in RESOURCE_ATTRS:
                    value = self.resource_url(value)
                elif n == "style":
                    value = css_absolute(value, self.base)
                elif n == "content" and tag == "meta" and (a.get("http-equiv") or "").lower() == "refresh":
                    m = REFRESH_RE.match(value)
                    if m and m.group(2):
                        value = m.group(1) + self.nav_url(m.group(2))[0]
            new.append((name, value))
        if external and tag in ("a", "area"):
            new += [("target", "_blank"), ("rel", "noopener noreferrer")]

        self._emit_tag(tag, new, selfclose)
        if hidden:
            self.out.append(hidden)
        if tag == "style" and not selfclose:
            self.in_style = True
        if tag == "body" and self.bar:
            self.out.append(self.bar)
            self.bar = ""

    def handle_starttag(self, tag, attrs):
        self._tag(tag, attrs, False)

    def handle_startendtag(self, tag, attrs):
        self._tag(tag, attrs, True)

    def handle_endtag(self, tag):
        if tag == "script":
            self.in_script = False
        elif tag == "style":
            self.in_style = False
            self.out.append("</style>")
        elif tag != "noscript":
            self.out.append("</%s>" % tag)

    def handle_data(self, data):
        if self.in_script:
            return
        self.out.append(css_absolute(data, self.base) if self.in_style else data)

    def handle_entityref(self, name):
        self.out.append("&%s;" % name)

    def handle_charref(self, name):
        self.out.append("&#%s;" % name)

    def handle_decl(self, decl):
        if decl.lower().startswith("doctype"):
            self.out.append("<!%s>" % decl)

    # comments, processing instructions and CDATA sections are dropped on purpose


def rewrite_html(text, base, engine_key, query):
    r = Rewriter(base, bar_html(engine_key, query))
    r.feed(text)
    r.close()
    return "".join(r.out)


# --------------------------------------------------------------------------- pages

PAGE_CSS = """
:root{color-scheme:light dark;--bg:#fff;--fg:#14171c;--muted:#5d6572;--line:#c9ced6;--ac:#2563eb}
@media(prefers-color-scheme:dark){:root{--bg:#14171c;--fg:#eef0f3;--muted:#9aa3b0;--line:#363c46;--ac:#6b9bff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{max-width:640px;margin:0 auto;padding:7vh 16px 24px}h1{font-size:1.5rem;margin:0 0 16px}
form{display:flex;flex-wrap:wrap;gap:8px}input[type=search]{flex:1 1 220px;min-width:0}
input,select,button{font:inherit;height:44px;padding:0 14px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--fg)}
button{background:var(--ac);border-color:var(--ac);color:#fff;cursor:pointer;font-weight:600}
p.note{color:var(--muted);font-size:.9rem;margin-top:20px}a{color:var(--ac)}
"""


def page(title, body, status=200, extra_headers=None):
    doc = (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1"><title>%s</title>'
        "<style>%s</style></head><body><main>%s</main></body></html>" % (esc(title), PAGE_CSS, body)
    )
    resp = web.Response(text=doc, status=status, content_type="text/html", charset="utf-8")
    resp.headers.update(base_headers())
    if extra_headers:
        resp.headers.update(extra_headers)
    return resp


def base_headers():
    return {
        "Content-Security-Policy": (
            "default-src * data: blob:; script-src 'none'; style-src * 'unsafe-inline'; object-src 'none'; "
            "base-uri 'none'; form-action 'self'; frame-ancestors %s" % FRAME_ANCESTORS
        ),
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
    }


def error_page(title, message, status):
    body = "<h1>%s</h1><p>%s</p><p><a href=\"/\">Back to search</a></p>" % (esc(title), message)
    return page(title, body, status)


# --------------------------------------------------------------------------- handlers


async def home(request):
    options = "".join('<option value="%s">%s</option>' % (k, esc(ENGINES[k]["name"])) for k in ENABLED)
    body = (
        "<h1>Search</h1><form action=\"/search\" method=\"get\">"
        '<input type="search" name="q" placeholder="Search the web" aria-label="Search" required>'
        '<select name="engine" aria-label="Search engine">%s</select>'
        '<button type="submit">Search</button></form>'
        '<p class="note">Results open inside this page. Links to other websites open in a new tab.</p>' % options
    )
    resp = page("Search", body)
    resp.headers["Cache-Control"] = "public, max-age=300"
    return resp


async def search(request):
    q = request.query.get("q", "").strip()[:300]
    engine = request.query.get("engine", ENABLED[0])
    if engine not in ENABLED:
        engine = ENABLED[0]
    if not q:
        raise web.HTTPFound("/")
    target = proxify(ENGINES[engine]["url"].format(q=quote_plus(q)))
    raise web.HTTPFound(target)


async def health(request):
    return web.Response(text="ok")


def looks_blocked(status, text):
    return status in (202, 403, 429) or "anomaly-modal" in text


async def proxy(request):
    if request.method not in ("GET", "HEAD", "POST"):
        return error_page("Not allowed", "This proxy only handles page loads and search forms.", 405)
    parsed = parse_proxy_path(request.raw_path)
    if not parsed:
        return error_page("Bad link", "That address is not a valid proxied page.", 400)
    scheme, host, path, query = parsed
    if not host_allowed(host):
        return error_page("Not available", "This proxy only loads search engine pages.", 403)
    url = URL.build(scheme=scheme, host=host, path=path, query_string=query, encoded=True)

    headers = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "Accept-Language": request.headers.get("Accept-Language", "en-US,en;q=0.9"),
    }
    data = None
    if request.method == "POST":
        data = await request.read()
        headers["Content-Type"] = request.headers.get("Content-Type", "application/x-www-form-urlencoded")

    session = request.app["session"]
    try:
        async with session.request(
            "GET" if request.method == "HEAD" else request.method, url, data=data, headers=headers, allow_redirects=False
        ) as resp:
            if resp.status in (301, 302, 303, 307, 308) and resp.headers.get("Location"):
                loc = unwrap(urljoin(str(url), resp.headers["Location"]))
                local = proxify(loc)
                if local:
                    return web.Response(
                        status=307 if resp.status in (307, 308) else 302, headers={"Location": local, "Cache-Control": "no-store"}
                    )
                safe = loc if urlsplit(loc).scheme in ("http", "https") else "#"
                return page(
                    "Opens in a new tab",
                    '<h1>This link leaves the search proxy</h1><p><a href="%s" target="_blank" rel="noopener noreferrer">%s</a></p>'
                    '<p><a href="/">Back to search</a></p>' % (esc(safe), esc(safe)),
                )
            ctype = resp.headers.get("Content-Type", "").lower()
            if "html" not in ctype:
                return error_page("Can't show this", "The proxy only displays web pages, not files or images.", 415)
            body = bytearray()
            async for chunk in resp.content.iter_chunked(65536):
                body += chunk
                if len(body) > MAX_BYTES:
                    return error_page("Too large", "That page is too big to proxy.", 502)
            status, charset = resp.status, resp.charset
    except (aiohttp.ClientError, asyncio.TimeoutError, OSError) as exc:
        return error_page("Search engine unreachable", "The search engine did not respond (%s)." % esc(type(exc).__name__), 502)

    if not charset:
        m = re.search(rb"charset=[\"']?([\w-]+)", bytes(body[:2048]), re.I)
        charset = m.group(1).decode("ascii") if m else "utf-8"
    try:
        text = bytes(body).decode(charset, "replace")
    except LookupError:
        text = bytes(body).decode("utf-8", "replace")

    engine = engine_for_host(host)
    if looks_blocked(status, text):
        name = ENGINES[engine]["name"] if engine else "The site"
        return error_page(
            "%s blocked this request" % name,
            "%s is refusing automated requests from this server (it showed a bot check or rate limit). "
            "Wait a minute, or pick a different engine in the search box." % esc(name),
            502,
        )

    qs = dict(parse_qsl(query))
    q = qs.get("q") or qs.get("search") or qs.get("query") or ""
    out = rewrite_html(text, str(url), engine, q)
    resp = web.Response(
        body=b"" if request.method == "HEAD" else out.encode("utf-8"),
        status=status if status < 600 else 502,
        content_type="text/html",
        charset="utf-8",
    )
    resp.headers.update(base_headers())
    return resp


# --------------------------------------------------------------------------- plumbing


class PublicOnlyResolver(AbstractResolver):
    """Refuses to connect to private/loopback/link-local addresses (SSRF guard)."""

    def __init__(self):
        self._inner = aiohttp.ThreadedResolver()

    async def resolve(self, host, port=0, family=socket.AF_INET):
        infos = await self._inner.resolve(host, port, family)
        ok = [i for i in infos if ipaddress.ip_address(i["host"].split("%")[0]).is_global]
        if not ok:
            raise OSError("%s does not resolve to a public address" % host)
        return ok

    async def close(self):
        await self._inner.close()


_hits = defaultdict(deque)


@web.middleware
async def rate_limit(request, handler):
    if request.path.startswith("/p/") or request.path == "/search":
        # Best effort: X-Forwarded-For is client-supplied, so this stops accidents, not attackers.
        ip = request.headers.get("X-Forwarded-For", "").split(",")[0].strip() or request.remote or "?"
        now = time.monotonic()
        dq = _hits[ip]
        while dq and now - dq[0] > 60:
            dq.popleft()
        if len(dq) >= RATE_LIMIT_PER_MIN:
            return error_page("Slow down", "Too many searches from your network. Try again in a minute.", 429)
        dq.append(now)
        if len(_hits) > 5000:
            for k in [k for k, v in _hits.items() if not v or now - v[-1] > 60]:
                _hits.pop(k, None)
    return await handler(request)


async def session_ctx(app):
    connector = aiohttp.TCPConnector(
        resolver=None if TRUST_ENV_PROXY else PublicOnlyResolver(), limit=50, ttl_dns_cache=300
    )
    app["session"] = aiohttp.ClientSession(
        connector=connector,
        timeout=aiohttp.ClientTimeout(total=20),
        trust_env=TRUST_ENV_PROXY,
        max_line_size=65536,
        max_field_size=65536,
    )
    yield
    await app["session"].close()


def make_app():
    app = web.Application(client_max_size=256 * 1024, middlewares=[rate_limit])
    app.cleanup_ctx.append(session_ctx)
    app.router.add_get("/", home)
    app.router.add_get("/health", health)
    app.router.add_get("/search", search)
    app.router.add_route("*", "/p/{tail:.*}", proxy)
    return app


if __name__ == "__main__":
    web.run_app(make_app(), host=HOST, port=PORT)
