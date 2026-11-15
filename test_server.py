"""Offline tests: python -m unittest test_server -v"""
import asyncio
import base64
import re
import unittest

import server

DDG_LIKE = """<!-- <!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN"> -->
<!DOCTYPE html><html><head>
<base href="https://html.duckduckgo.com/html/">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'">
<meta http-equiv="refresh" content="5; url=/html/?q=again">
<link rel="preload" href="/font.woff2" as="font" crossorigin="anonymous">
<link rel="stylesheet" href="/html.css" integrity="sha256-x" crossorigin>
<script>evil()</script><script src="/x.js"></script><script src="/y.js"/>
<noscript><style>.x{background:url(/bg.png)}</style></noscript></head>
<body onload="evil()">
<form action="/html/" method="post"><input name=q value="cats"><input type="hidden" name="s" value="30"></form>
<form action="/search?kl=us-en&amp;df=d" method="get"><input name="q"></form>
<a class="r" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fcats%3Fa%3D1&amp;rut=abc" target="_top" onclick="x()">Cats</a>
<a href="//duckduckgo.com/l/?uddg=javascript%3Aalert(1)">bad uddg</a>
<a href="javascript:alert(1)">bad</a>
<a href="/html/?q=dogs&amp;s=30" target="_blank">next</a>
<a href="#top">top</a><a href="mailto:a@b.c">mail</a>
<img src="//external-content.duckduckgo.com/ip3/example.com.ico" srcset="/a.png 1x, /b.png 2x" style="background:url('/s.png')">
<!-- hidden --><iframe srcdoc="&lt;script&gt;1&lt;/script&gt;"></iframe>
<p>Fish &amp; chips &copy; &#169; 5 < 6</p></body></html>"""


def render(src=DDG_LIKE, base="https://html.duckduckgo.com/html/?q=cats"):
    return server.rewrite_html(src, base, "ddg", 'ca"ts')


class RewriteTests(unittest.TestCase):
    def setUp(self):
        self.out = render()

    def test_scripts_handlers_and_framing_headers_removed(self):
        self.assertNotRegex(self.out, r"(?i)<script|evil\(|onload|onclick|srcdoc|Content-Security-Policy|<base|integrity|crossorigin|preload|<!--")

    def test_result_link_unwrapped_and_opens_in_new_tab(self):
        m = re.search(r'<a class="r" [^>]*>', self.out).group(0)
        self.assertIn('href="https://example.com/cats?a=1"', m)
        self.assertIn('target="_blank"', m)
        self.assertIn('rel="noopener noreferrer"', m)
        self.assertNotIn("_top", m)

    def test_dangerous_urls_neutralised(self):
        self.assertEqual(self.out.count('href="javascript:'), 0)
        self.assertEqual(len(re.findall(r'<a href="#">', self.out)), 2)

    def test_engine_links_stay_in_proxy_and_lose_target(self):
        m = re.search(r'<a href="/p/https/html\.duckduckgo\.com/html/\?q=dogs&amp;s=30"[^>]*>', self.out)
        self.assertIsNotNone(m)
        self.assertNotIn("target", m.group(0))

    def test_post_form_goes_through_proxy(self):
        self.assertIn('<form action="/p/https/html.duckduckgo.com/html/" method="post">', self.out)

    def test_get_form_query_moves_to_hidden_fields(self):
        self.assertRegex(self.out, r'<form action="/p/https/html\.duckduckgo\.com/search" method="get"><input type="hidden" name="kl" value="us-en"><input type="hidden" name="df" value="d">')

    def test_fragment_and_mailto_untouched(self):
        self.assertIn('href="#top"', self.out)
        self.assertIn('href="mailto:a@b.c"', self.out)

    def test_resources_made_absolute_not_proxied(self):
        self.assertIn('href="https://html.duckduckgo.com/html.css"', self.out)
        self.assertIn('src="https://external-content.duckduckgo.com/ip3/example.com.ico"', self.out)
        self.assertIn("https://html.duckduckgo.com/a.png 1x, https://html.duckduckgo.com/b.png 2x", self.out)
        self.assertIn("url(&quot;https://html.duckduckgo.com/s.png&quot;)", self.out)
        self.assertIn('url("https://html.duckduckgo.com/bg.png")', self.out)

    def test_meta_refresh_rewritten(self):
        self.assertIn('content="5; url=/p/https/html.duckduckgo.com/html/?q=again"', self.out)

    def test_noscript_unwrapped_and_text_preserved(self):
        self.assertNotIn("noscript", self.out)
        self.assertIn("Fish &amp; chips &copy; &#169; 5 < 6", self.out)

    def test_bar_injected_once_with_escaped_query(self):
        self.assertEqual(self.out.count('class="vfp-bar"'), 1)
        self.assertIn('value="ca&quot;ts"', self.out)
        self.assertIn("<!DOCTYPE html>", self.out)


class UrlTests(unittest.TestCase):
    def test_unwrap_bing(self):
        target = "https://example.org/a?b=1"
        u = "a1" + base64.urlsafe_b64encode(target.encode()).decode().rstrip("=")
        self.assertEqual(server.unwrap("https://www.bing.com/ck/a?!&&p=abc&u=%s&ntb=1" % u), target)

    def test_unwrap_bing_relative_target(self):
        u = "a1" + base64.urlsafe_b64encode(b"/images/search?q=x").decode().rstrip("=")
        self.assertEqual(server.unwrap("https://www.bing.com/ck/a?u=" + u), "https://www.bing.com/images/search?q=x")

    def test_unwrap_garbage_is_left_alone(self):
        url = "https://www.bing.com/ck/a?u=a1!!!notbase64"
        self.assertEqual(server.unwrap(url), url)

    def test_proxify(self):
        self.assertEqual(server.proxify("https://www.bing.com/search?q=a+b#x"), "/p/https/www.bing.com/search?q=a+b#x")
        for bad in ("https://evil.com/", "https://www.bing.com.evil.com/", "https://u:p@www.bing.com/",
                    "https://www.bing.com:8443/", "javascript:alert(1)", "ftp://www.bing.com/", "https://127.0.0.1/"):
            self.assertIsNone(server.proxify(bad), bad)

    def test_parse_proxy_path(self):
        self.assertEqual(server.parse_proxy_path("/p/https/WWW.Bing.com/search?q=1"), ("https", "www.bing.com", "/search", "q=1"))
        for bad in ("/p/", "/p/https/", "/p/https/host", "/p/gopher/www.bing.com/x", "/p/https/a@b.com/x",
                    "/p/https/bing.com:80/x", "/p/https/bing.com%2f@evil.com/x", "/p/https/bing.com\\@evil.com/x"):
            self.assertIsNone(server.parse_proxy_path(bad), bad)


class ResolverTests(unittest.TestCase):
    def test_private_addresses_refused(self):
        async def run():
            r = server.PublicOnlyResolver()
            try:
                for host in ("localhost", "127.0.0.1", "169.254.169.254", "10.0.0.1"):
                    with self.assertRaises(OSError, msg=host):
                        await r.resolve(host, 80)
            finally:
                await r.close()

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
