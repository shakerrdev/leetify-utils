import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

from fixtures import A, B, C, D, GAMES, PAGE_DATA

HERE = Path(__file__).parent
SCRIPT = (Path(sys.argv[1]) if len(sys.argv) > 1 else HERE.parent / "leetify-utils.user.js").read_text()
SHOTS = Path(sys.argv[2]) if len(sys.argv) > 2 else None
PAGE = (HERE / "page.html").read_text().replace("__DATA__", PAGE_DATA)

SHIM = """
window.__menu = {};
window.__clip = null;
window.__errors = [];
window.GM_info = { script: { version: '2.0.0' }, scriptHandler: 'TestShim', version: '0' };
window.GM_xmlhttpRequest = (o) => {
  fetch(o.url, { headers: o.headers }).then(async (r) => o.onload({ status: r.status, responseText: await r.text() }), () => o.onerror());
};
window.GM_addStyle = (css) => { const s = document.createElement('style'); s.textContent = css; document.head.append(s); return s; };
window.GM_setClipboard = (t) => { window.__clip = t; };
window.GM_registerMenuCommand = (name, fn) => { window.__menu[name] = fn; };
window.alert = () => {};
addEventListener('error', (e) => window.__errors.push(String(e.message)));
window.__added = 0;
new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains('lu-change')) window.__added++; })
  .observe(document, { childList: true, subtree: true });
"""

results = []
api_calls = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""))


def chips(page, scope="body"):
    return page.evaluate(f"""() => [...document.querySelectorAll('{scope} .lu-change')].map((c) => ({{
        text: c.textContent, shows: c.dataset.shows, match: c.dataset.match, title: c.title,
        next: c.nextElementSibling && c.nextElementSibling.tagName.toLowerCase(),
        prev: c.previousElementSibling && (c.previousElementSibling.className || c.previousElementSibling.tagName.toLowerCase()),
        parent: c.parentElement.tagName.toLowerCase() + '.' + c.parentElement.className,
        row: (c.closest('tr,[role=row]') || {{}}).textContent,
        delta: (c.querySelector('.lu-delta b') || {{}}).className,
        tiers: [...c.querySelectorAll('.lu-rating')].map((r) => r.style.getPropertyValue('--lu-tier')),
    }}))""")


def by_name(cs, name):
    return [c for c in cs if c["row"] and c["row"].startswith(name)] or [c for c in cs if c["row"] and name in c["row"]]


def open_page(browser, path, layout="known", extra=""):
    ctx = browser.new_context(viewport={"width": 900, "height": 700})

    def api(route):
        mid = route.request.url.rsplit("/", 1)[-1]
        api_calls.append(mid)
        if mid in GAMES:
            route.fulfill(status=200, content_type="application/json", body=json.dumps(GAMES[mid]),
                          headers={"Access-Control-Allow-Origin": "*"})
        else:
            route.fulfill(status=500, body="boom", headers={"Access-Control-Allow-Origin": "*"})

    ctx.route("https://api.cs-prod.leetify.com/**", api)
    ctx.route("https://leetify.com/**", lambda r: r.fulfill(status=200, content_type="text/html", body=PAGE))
    ctx.add_init_script(SHIM + "document.addEventListener('DOMContentLoaded', () => {\n" + SCRIPT + "\n});")
    page = ctx.new_page()
    page.goto(f"https://leetify.com{path}?layout={layout}{extra}")
    return ctx, page


def settle(page, ms=600):
    page.wait_for_timeout(ms)


with sync_playwright() as pw:
    browser = pw.chromium.launch()

    # known layout
    ctx, page = open_page(browser, f"/app/match-details/{A}")
    settle(page)
    cs = chips(page)
    check("known: one chip per player in the scoreboard", len(chips(page, "table.scoreboard")) == 10, len(cs))
    check("known: no chips outside the scoreboard", len(cs) == 10, [c["row"] for c in cs])
    check("known: nothing in the header", page.locator("header .lu-change").count() == 0)
    Golf = by_name(cs, "Golf")[0]
    check("known: Golf shows 16,642 +374 →", Golf["text"] == "16,642+374→", Golf["text"])
    check("known: chip sits right before app-rank-icon inside the link", Golf["next"] == "app-rank-icon" and Golf["parent"].startswith("a.player-meta"), Golf)
    check("known: Golf delta is green", Golf["delta"] == "lu-up", Golf["delta"])
    check("known: Golf old rating in purple tier", Golf["tiers"] == ["#8847ff"], Golf["tiers"])
    ani = by_name(cs, "Alpha")[0]
    check("known: Alpha −345 in red", ani["text"] == "16,746−345→" and ani["delta"] == "lu-down", ani)
    weyn = by_name(cs, "Charlie")[0]
    check("known: Charlie 19,999 purple → 20,118", weyn["text"].startswith("19,999+119") and weyn["tiers"] == ["#8847ff"], weyn)
    check("known: tooltip", Golf["title"] == "Premier rating: 16,642 → 17,016 (+374)", Golf["title"])
    added = page.evaluate("window.__added")
    settle(page, 1500)
    check("known: stable, no re-inserts while idle", page.evaluate("window.__added") == added == 10, (added, page.evaluate("window.__added")))
    check("known: one API request", api_calls.count(A) == 1, api_calls)

    page.evaluate("window.rerender()")
    settle(page)
    check("rerender: chips come back once", len(chips(page)) == 10, len(chips(page)))
    for _ in range(5):
        page.evaluate("document.querySelector('h1').textContent += '.'")
        page.wait_for_timeout(50)
    settle(page)
    check("rerender: still 10 after more mutations", len(chips(page)) == 10)

    page.evaluate(f"window.navigateTo('/app/match-details/{B}')")
    settle(page)
    cs = chips(page)
    check("spa: chips of A gone after navigating to B", all(c["match"] == B for c in cs), [c["match"] for c in cs])
    names = {c["row"].split("23")[0] if c["row"] else "" for c in cs}
    fresh = by_name(cs, "Fresh")
    check("spa B: first rating shows NEW", len(fresh) == 1 and fresh[0]["text"].lower() == "new" and fresh[0]["next"] == "app-rank-icon", fresh)
    check("spa B: unchanged rank without rankChanged has no chip", not by_name(cs, "Stuck"))
    draw = by_name(cs, "Draw")
    check("spa B: changed but equal shows ±0", len(draw) == 1 and "±0" in draw[0]["text"] and draw[0]["delta"] == "lu-same", draw)
    check("spa B: rank 0 has no chip", not by_name(cs, "Unranked"))
    low = by_name(cs, "Low")
    check("spa B: low rating found in the link, not the 987 cell", len(low) == 1 and low[0]["next"] == "app-rank-icon" and low[0]["text"] == "1,100−113→", low)
    check("spa B: 4 chips", len(chips(page, "table.scoreboard")) == 4, [c["text"] for c in cs])

    page.evaluate(f"window.navigateTo('/app/match-details/{A}')")
    settle(page)
    check("spa: back to A uses the cache", api_calls.count(A) == 1 and len(chips(page)) == 10, (api_calls, len(chips(page))))
    page.go_back()
    settle(page)
    check("spa: browser back to B", len(chips(page)) == 4 and all(c["match"] == B for c in chips(page)))
    page.evaluate("window.navigateTo('/app/profile/76561198000000107')")
    settle(page)
    check("spa: leaving match pages removes chips", page.locator(".lu-change").count() == 0)
    check("known: no page errors", not page.evaluate("window.__errors"), page.evaluate("window.__errors"))
    ctx.close()

    # in-place reuse
    ctx, page = open_page(browser, f"/app/match-details/{A}")
    settle(page)
    page.evaluate(f"window.reuseTo('/app/match-details/{B}')")
    settle(page)
    cs = chips(page)
    Golf = by_name(cs, "Golf")
    check("reuse: rows updated in place get B's chips", len(cs) == 4 and all(c["match"] == B for c in cs), [(c["match"][:4], c["text"]) for c in cs])
    check("reuse: Golf now 16,286 +356", len(Golf) == 1 and Golf[0]["text"] == "16,286+356→", Golf)
    ctx.close()

    # generic layout (unknown markup, badge in its own cell)
    ctx, page = open_page(browser, f"/app/match-details/{A}", "generic")
    settle(page)
    cs = chips(page)
    Golf = by_name(cs, "Golf")
    check("generic: 10 chips", len(cs) == 10, len(cs))
    check("generic: chip before the plate in the rank cell", Golf and Golf[0]["next"] == "div" and Golf[0]["parent"] == "div.rank-cell" and Golf[0]["prev"] is None, Golf)
    ctx.close()

    # rating as plain text in its own cell
    ctx, page = open_page(browser, f"/app/match-details/{A}", "celltext")
    settle(page)
    cs = chips(page)
    Golf = by_name(cs, "Golf")
    check("celltext: 10 chips inside the rank cell", len(cs) == 10 and all(c["parent"] == "div.rank-cell" for c in cs), [c["parent"] for c in cs])
    check("celltext: Golf chip first in the cell", Golf and Golf[0]["text"] == "16,642+374→" and Golf[0]["prev"] is None, Golf)
    added = page.evaluate("window.__added")
    settle(page, 2000)
    check("celltext: stable, no fallback chips later", page.evaluate("window.__added") == added == 10 and page.locator('.lu-change[data-shows="none"]').count() == 0, (added, page.evaluate("window.__added")))
    if SHOTS:
        page.locator('[role="table"]').screenshot(path=str(SHOTS / "celltext.png"))
    ctx.close()

    # badge shows the old rating
    ctx, page = open_page(browser, f"/app/match-details/{A}", "oldshown")
    settle(page)
    cs = chips(page)
    Golf = by_name(cs, "Golf")
    check("oldshown: 10 chips after the badge", len(cs) == 10 and all(c["shows"] == "old" for c in cs))
    check("oldshown: Golf → +374 17,016 after app-rank-icon", Golf and Golf[0]["text"] == "+374→17,016" and Golf[0]["prev"] == "app-rank-icon", Golf)
    ctx.close()

    # vanity links: names instead of Steam IDs
    ctx, page = open_page(browser, f"/app/match-details/{A}", "vanity")
    settle(page)
    cs = chips(page)
    check("vanity: found by name, badges used", len(chips(page, "table.scoreboard")) == 10 and all(c["shows"] == "new" for c in cs), len(cs))
    check("vanity: header name not used", page.locator("header .lu-change").count() == 0)
    ctx.close()

    # no badges at all: fallback after the name
    ctx, page = open_page(browser, f"/app/match-details/{A}", "nobadge")
    settle(page, 700)
    check("nobadge: waits before the fallback", page.locator(".lu-change").count() == 0)
    settle(page, 1300)
    cs = chips(page)
    Golf = by_name(cs, "Golf")
    check("nobadge: one fallback chip per player", len(cs) == 10 and all(c["shows"] == "none" for c in cs), len(cs))
    check("nobadge: Golf 16,642 +374 → 17,016", Golf and Golf[0]["text"] == "16,642+374→17,016" and Golf[0]["prev"] == "player-meta", Golf)
    check("nobadge: fallback in scoreboard table", len(chips(page, "table.scoreboard")) == 10)
    ctx.close()

    # badges arrive late: fallback first, then replaced
    ctx, page = open_page(browser, f"/app/match-details/{A}", "known", "&badgeDelay=2600")
    settle(page, 2200)
    check("late: fallback chips before badges exist", page.locator('.lu-change[data-shows="none"]').count() == 10)
    settle(page, 1200)
    cs = chips(page)
    check("late: replaced by badge chips", len(cs) == 10 and all(c["shows"] == "new" for c in cs), [c["shows"] for c in cs])
    ctx.close()

    # badges arrive within the grace period: no fallback flash
    ctx, page = open_page(browser, f"/app/match-details/{A}", "known", "&badgeDelay=700")
    seen_fallback = False
    for _ in range(12):
        page.wait_for_timeout(100)
        seen_fallback = seen_fallback or page.locator('.lu-change[data-shows="none"]').count() > 0
    check("grace: no fallback flash when badges come within 1.5 s", not seen_fallback and len(chips(page)) == 10)
    ctx.close()

    # competitive (skill groups)
    ctx, page = open_page(browser, f"/app/match-details/{C}")
    settle(page, 2200)
    cs = chips(page)
    Golf = by_name(cs, "Golf")
    down = by_name(cs, "Down")
    check("competitive: 2 chips (unchanged skipped)", len(cs) == 2, [c["text"] for c in cs])
    check("competitive: Golf ▲ Gold Nova III", Golf and Golf[0]["text"] == "▲ Gold Nova III" and "Gold Nova II → Gold Nova III" in Golf[0]["title"], Golf)
    check("competitive: Down ▼ Silver Elite", down and down[0]["text"] == "▼ Silver Elite", down)
    ctx.close()

    # API failure + debug report
    ctx, page = open_page(browser, f"/app/match-details/{D}")
    settle(page)
    check("error: no chips", page.locator(".lu-change").count() == 0)
    page.evaluate("window.__menu['Copy debug report']()")
    rep = json.loads(page.evaluate("window.__clip"))
    check("error: report names the failure", rep["api"]["status"] == "error" and rep["api"]["error"] == "HTTP 500", rep["api"])
    settle(page, 300)
    check("error: no retry storm", api_calls.count(D) == 1, api_calls.count(D))
    page.evaluate("(() => { const real = Date.now; Date.now = () => real() + 31000; document.querySelector('h1').textContent += '!'; })()")
    settle(page)
    check("error: retried once after 30 s", api_calls.count(D) == 2, api_calls.count(D))
    ctx.close()

    ctx, page = open_page(browser, f"/app/match-details/{A}")
    settle(page)
    page.evaluate("window.__menu['Copy debug report']()")
    rep = json.loads(page.evaluate("window.__clip"))
    check("report: counts and sample row", rep["lastRun"]["badges"] == 10 and rep["lastRun"]["placed"] == 0
          and len(rep["players"]) == 10 and "player-meta" in rep["sampleRowHtml"] and rep["chipsOnPage"] == 10, rep["lastRun"])
    if SHOTS:
        page.locator("table.scoreboard").screenshot(path=str(SHOTS / "known.png"))
    ctx.close()

    ctx, page = open_page(browser, f"/app/match-details/{B}", "oldshown")
    settle(page)
    if SHOTS:
        page.locator("table.scoreboard").screenshot(path=str(SHOTS / "oldshown.png"))
    ctx.close()
    ctx, page = open_page(browser, f"/app/match-details/{B}", "nobadge")
    settle(page, 2200)
    cs = chips(page)
    low = by_name(cs, "Low")
    check("nobadge B: a stat cell equal to a rating is not taken as a badge", len(cs) == 4 and all(c["shows"] == "none" for c in cs), [(c["text"], c["parent"]) for c in cs])
    check("nobadge B: Low after its name", low and low[0]["text"] == "1,100\u2212113→987" and low[0]["prev"] == "player-meta", low)
    if SHOTS:
        page.locator("table.scoreboard").screenshot(path=str(SHOTS / "fallback.png"))
    ctx.close()

    browser.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
