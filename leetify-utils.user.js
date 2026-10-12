// ==UserScript==
// @name         Leetify Utils
// @namespace    https://github.com/shakerrdev/leetify-utils
// @version      2.0.0
// @description  Shows every player's Premier rating change on Leetify match pages.
// @author       shakerrdev
// @match        https://leetify.com/*
// @connect      api.cs-prod.leetify.com
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @noframes
// @homepageURL  https://github.com/shakerrdev/leetify-utils
// @supportURL   https://github.com/shakerrdev/leetify-utils/issues
// @updateURL    https://raw.githubusercontent.com/shakerrdev/leetify-utils/main/leetify-utils.user.js
// @downloadURL  https://raw.githubusercontent.com/shakerrdev/leetify-utils/main/leetify-utils.user.js
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = typeof GM_info !== 'undefined' ? GM_info.script.version : '2.0.0';
  const API = 'https://api.cs-prod.leetify.com/api/games/';
  const MATCH_ID = /\/match-details\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  const STEAM_ID = /7656119\d{10}/;
  const RATING_TEXT = /^[\d\s,.'\u00a0\u202f]{1,12}$/;
  const CHROME = 'header, nav, [role="navigation"], [role="banner"]';
  const TABLE = 'table, [role="table"], [role="grid"]';
  const ROW = 'tr, [role="row"]';
  const CELL = 'td, th, [role="cell"], [role="gridcell"]';
  const STRUCTURE = `a, ${CELL}, ${ROW}, ${TABLE}`;
  const PREMIER = 11;
  const FALLBACK_DELAY = 1500;
  const RETRY_AFTER = 30000;
  const SKILL_GROUPS = [
    'Silver I', 'Silver II', 'Silver III', 'Silver IV', 'Silver Elite', 'Silver Elite Master',
    'Gold Nova I', 'Gold Nova II', 'Gold Nova III', 'Gold Nova Master',
    'Master Guardian I', 'Master Guardian II', 'Master Guardian Elite', 'Distinguished Master Guardian',
    'Legendary Eagle', 'Legendary Eagle Master', 'Supreme Master First Class', 'Global Elite',
  ];
  const TIERS = [
    [30000, '#ffd700'], [25000, '#eb4b4b'], [20000, '#d32ce6'], [15000, '#8847ff'],
    [10000, '#4b69ff'], [5000, '#5e98d9'], [0, '#b0c3d9'],
  ];

  const games = new Map();
  const last = { matchId: null, links: 0, candidates: 0, badges: 0, afterName: 0, waiting: 0, placed: 0 };
  let timer = 0;
  let shownMatch = null;

  addStyle(`
    .lu-change { display: inline-flex; align-items: center; gap: 5px; margin-inline: 3px 5px; vertical-align: middle; font: 600 12px/1 system-ui, -apple-system, "Segoe UI", sans-serif; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .lu-rating { color: var(--lu-tier); font-weight: 700; font-size: 13px; letter-spacing: .01em; }
    .lu-rating small { font-size: .78em; }
    .lu-change[data-shows="new"] .lu-rating { opacity: .7; }
    .lu-delta { display: inline-flex; flex-direction: column; align-items: center; gap: 2px; font-size: 11px; }
    .lu-delta i { font-style: normal; font-size: 12px; color: #c9d1d9; opacity: .75; }
    .lu-up { color: #45d483; }
    .lu-down { color: #ff6b6b; }
    .lu-same { color: #9aa4ad; }
    .lu-tag { padding: 2px 5px; border-radius: 4px; font-size: 10px; letter-spacing: .06em; text-transform: uppercase; background: rgb(69 212 131 / .16); color: #45d483; }
  `);

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Copy debug report', copyReport);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  addEventListener('popstate', schedule);
  schedule();

  function schedule() {
    if (!timer) timer = setTimeout(run, 120);
  }

  function run() {
    timer = 0;
    const matchId = currentMatchId();
    clearStale(matchId);
    if (!matchId) {
      shownMatch = null;
      return;
    }
    const game = load(matchId);
    if (matchId !== shownMatch) {
      shownMatch = matchId;
      game.linksSince = 0;
    }
    if (game.status === 'ready') annotate(matchId, game);
  }

  function currentMatchId() {
    const m = location.pathname.match(MATCH_ID);
    return m ? m[1].toLowerCase() : null;
  }

  function clearStale(matchId) {
    for (const chip of document.querySelectorAll('.lu-change')) {
      if (chip.dataset.match !== matchId) chip.remove();
    }
  }

  function load(matchId) {
    let game = games.get(matchId);
    if (game && !(game.status === 'error' && Date.now() - game.failedAt > RETRY_AFTER)) return game;
    game = { status: 'loading', players: new Map(), error: null, linksSince: 0 };
    games.set(matchId, game);
    request(API + matchId)
      .then((data) => {
        game.players = parseGame(data);
        game.dataStatus = data && data.status;
        game.status = 'ready';
      })
      .catch((err) => {
        game.status = 'error';
        game.failedAt = Date.now();
        game.error = String((err && err.message) || err);
        console.warn('[Leetify Utils] Could not load match', matchId, err);
      })
      .finally(schedule);
    return game;
  }

  function request(url) {
    const xhr = typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest
      : typeof GM !== 'undefined' && GM.xmlHttpRequest ? GM.xmlHttpRequest : null;
    if (!xhr) {
      return fetch(url, { credentials: 'omit' }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
    }
    return new Promise((resolve, reject) => {
      xhr({
        method: 'GET',
        url,
        headers: { Accept: 'application/json' },
        timeout: 20000,
        onload: (r) => {
          if (r.status < 200 || r.status >= 300) return reject(new Error(`HTTP ${r.status}`));
          try { resolve(JSON.parse(r.responseText)); } catch (_) { reject(new Error('response is not JSON')); }
        },
        onerror: () => reject(new Error('network error')),
        ontimeout: () => reject(new Error('timed out')),
      });
    });
  }

  function parseGame(data) {
    const names = new Map();
    for (const p of Object.values((data && data.playerStats) || {})) {
      if (p && p.steam64Id) names.set(String(p.steam64Id), String(p.name || ''));
    }
    const players = new Map();
    for (const s of Object.values((data && data.matchmakingGameStats) || {})) {
      const id = String((s && s.steam64Id) || '');
      if (!STEAM_ID.test(id)) continue;
      players.set(id, {
        id,
        name: names.get(id) || '',
        rank: Number(s.rank) || 0,
        oldRank: Number(s.oldRank) || 0,
        type: Number(s.rankType) || 0,
        changed: s.rankChanged !== false,
      });
    }
    return players;
  }

  function annotate(matchId, game) {
    const links = playerLinks(game.players);
    if (links.size && !game.linksSince) game.linksSince = Date.now();

    const hits = [];
    const seen = new Set();
    let premiers = 0;
    for (const [id, els] of links) {
      const p = game.players.get(id);
      if (!change(p) || !isPremier(p)) continue;
      premiers++;
      for (const el of els) {
        const badge = findBadge(el, p);
        if (!badge || seen.has(badge.el)) continue;
        seen.add(badge.el);
        hits.push({ p, ...badge });
      }
    }
    const badges = trustedBadges(hits, premiers);
    const covered = new Set(badges.map((b) => b.p.id));

    const targets = [...badges];
    const wait = game.linksSince + FALLBACK_DELAY - Date.now();
    let waiting = 0;
    for (const [id, els] of links) {
      const p = game.players.get(id);
      if (!change(p) || covered.has(id)) continue;
      if (wait > 0) {
        waiting++;
        continue;
      }
      targets.push({ p, el: els.find((e) => e.textContent.trim()) || els[0], shows: 'none' });
    }
    if (waiting && !game.recheck) {
      game.recheck = setTimeout(() => { game.recheck = 0; schedule(); }, wait + 20);
    }

    let placed = 0;
    const keep = new Set();
    for (const t of targets) {
      const { chip, added } = place(matchId, t);
      keep.add(chip);
      if (added) placed++;
    }
    for (const chip of document.querySelectorAll('.lu-change')) if (!keep.has(chip)) chip.remove();
    Object.assign(last, {
      matchId, links: links.size, candidates: hits.length, badges: badges.length,
      afterName: targets.length - badges.length, waiting, placed,
    });
  }

  function trustedBadges(hits, premiers) {
    const groups = new Map();
    for (const hit of hits) {
      if (!groups.has(hit.sig)) groups.set(hit.sig, []);
      groups.get(hit.sig).push(hit);
    }
    const playersIn = (g) => new Set(g.map((x) => x.p.id)).size;
    const rank = (g) => (g.some((x) => x.known) ? 1000 : 0) + playersIn(g);
    let best = [];
    for (const g of groups.values()) if (rank(g) > rank(best)) best = g;
    if (!best.length) return [];
    if (best.some((x) => x.known)) return best;
    if (playersIn(best) >= Math.max(2, Math.ceil(premiers / 2))) return best;
    if (premiers === 1 && best[0].level < 2) return best;
    return [];
  }

  function playerLinks(players) {
    const found = new Map();
    const add = (id, el) => {
      if (!found.has(id)) found.set(id, []);
      if (!found.get(id).includes(el)) found.get(id).push(el);
    };
    const anchors = [];
    for (const a of document.querySelectorAll('a[href*="7656119"]')) {
      const id = (a.getAttribute('href').match(STEAM_ID) || [])[0];
      if (id && players.has(id) && !a.closest(`.lu-change, ${CHROME}`)) anchors.push([id, a]);
    }
    const inTables = anchors.filter(([, a]) => a.closest(TABLE));
    for (const [id, a] of inTables.length ? inTables : anchors) add(id, a);
    if (found.size) return found;

    const byName = new Map();
    for (const p of players.values()) {
      if (!p.name) continue;
      byName.set(p.name, byName.has(p.name) ? null : p.id);
    }
    if (!byName.size || !document.body) return found;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const id = byName.get(node.nodeValue.trim());
      const el = node.parentElement;
      if (!id || !el || el.closest(`.lu-change, script, style, title, ${CHROME}`)) continue;
      add(id, el.closest('a') || el);
    }
    return found;
  }

  function isPremier(p) {
    return p.type === PREMIER || p.rank > SKILL_GROUPS.length || p.oldRank > SKILL_GROUPS.length;
  }

  function change(p) {
    if (!p || !p.rank) return null;
    if (!p.changed && p.rank === p.oldRank) return null;
    if (isPremier(p)) return { premier: true, diff: p.oldRank ? p.rank - p.oldRank : null };
    if (!p.oldRank || p.rank === p.oldRank) return null;
    return { premier: false, diff: Math.sign(p.rank - p.oldRank) };
  }

  function findBadge(el, p) {
    const scopes = [[el, 0]];
    const cell = el.closest(CELL);
    const row = el.closest(ROW);
    if (cell) scopes.push([cell, 1]);
    if (row) scopes.push([row, 2]);
    else for (let up = el.parentElement, i = 0; up && up !== document.body && i < 3; up = up.parentElement, i++) scopes.push([up, 2]);

    for (const [scope, level] of scopes) {
      for (const [value, shows] of [[p.rank, 'new'], [p.oldRank, 'old']]) {
        if (!value || (shows === 'old' && value === p.rank)) continue;
        const hit = ratingElement(scope, String(value));
        if (!hit) continue;
        const target = hit.inside ? hit.el : outermost(hit.el, scope, String(value));
        const classes = [...target.classList].map((c) => c.replace(/\d+/g, '')).sort().join('.');
        const sig = `${level}|${hit.inside ? 'in|' : ''}${target.tagName}.${classes}`;
        return { el: target, inside: hit.inside, known: hit.known, level, sig, shows };
      }
    }
    return null;
  }

  function outermost(el, scope, want) {
    let top = el;
    for (let up = top.parentElement; up && up !== scope && !up.matches(STRUCTURE); up = up.parentElement) {
      if (up.childElementCount !== 1 || digits(textOf(up)) !== want) break;
      top = up;
    }
    return top;
  }

  function ratingElement(scope, want) {
    for (const known of scope.querySelectorAll('app-cs-rating')) {
      if (digits(textOf(known)) === want) return { el: known, known: true };
    }
    let holder = null;
    for (const e of scope.querySelectorAll('*')) {
      if (holder && !holder.contains(e)) break;
      if (e.closest('.lu-change') || !looksLikeRating(e, want)) continue;
      if (!e.matches(STRUCTURE)) return { el: e };
      holder = holder || e;
    }
    return holder && { el: holder, inside: true };
  }

  function looksLikeRating(el, want) {
    const text = textOf(el);
    return text.length <= 24 && RATING_TEXT.test(text.trim()) && digits(text) === want;
  }

  function textOf(el) {
    if (!el.querySelector('.lu-change')) return el.textContent;
    let text = '';
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.parentElement.closest('.lu-change')) text += n.nodeValue;
    }
    return text;
  }

  function digits(text) {
    return String(text || '').replace(/\D/g, '');
  }

  function place(matchId, { p, el, shows, inside }) {
    const key = `${matchId}:${p.id}:${p.oldRank}:${p.rank}:${shows}`;
    const before = shows === 'new';
    const neighbour = inside
      ? (before ? el.firstElementChild : el.lastElementChild)
      : (before ? el.previousElementSibling : el.nextElementSibling);
    if (neighbour && neighbour.classList.contains('lu-change')) {
      if (neighbour.dataset.key === key) return { chip: neighbour, added: false };
      neighbour.remove();
    }
    const chip = buildChip(p, shows);
    chip.dataset.key = key;
    chip.dataset.match = matchId;
    chip.dataset.player = p.id;
    if (inside) el[before ? 'prepend' : 'append'](chip);
    else el[before ? 'before' : 'after'](chip);
    return { chip, added: true };
  }

  function buildChip(p, shows) {
    const c = change(p);
    const chip = h('span', 'lu-change');
    chip.dataset.shows = shows;

    if (!c.premier) {
      const up = c.diff > 0;
      chip.append(h('span', up ? 'lu-up' : 'lu-down', `${up ? '▲' : '▼'} ${SKILL_GROUPS[p.rank - 1] || `rank ${p.rank}`}`));
      chip.title = `${up ? 'Ranked up' : 'Ranked down'}: ${SKILL_GROUPS[p.oldRank - 1] || p.oldRank} → ${SKILL_GROUPS[p.rank - 1] || p.rank}`;
      return chip;
    }

    if (c.diff === null) {
      chip.append(h('span', 'lu-tag', 'new'));
      if (shows === 'none') chip.append(rating(p.rank));
      chip.title = `First Premier rating in this match: ${fmt(p.rank)}`;
      return chip;
    }

    const delta = h('span', 'lu-delta');
    delta.append(h('b', c.diff > 0 ? 'lu-up' : c.diff < 0 ? 'lu-down' : 'lu-same', signed(c.diff)), h('i', null, '→'));
    if (shows === 'new') chip.append(rating(p.oldRank), delta);
    else if (shows === 'old') chip.append(delta, rating(p.rank));
    else chip.append(rating(p.oldRank), delta, rating(p.rank));
    chip.title = `Premier rating: ${fmt(p.oldRank)} → ${fmt(p.rank)} (${signed(c.diff)})`;
    return chip;
  }

  function rating(value) {
    const el = h('span', 'lu-rating');
    el.style.setProperty('--lu-tier', TIERS.find(([min]) => value >= min)[1]);
    const text = fmt(value);
    const cut = text.length > 4 ? text.length - 4 : text.length;
    el.append(text.slice(0, cut));
    if (cut < text.length) el.append(h('small', null, text.slice(cut)));
    return el;
  }

  function fmt(n) {
    return Number(n).toLocaleString('en-US');
  }

  function signed(n) {
    return n > 0 ? `+${fmt(n)}` : n < 0 ? `\u2212${fmt(-n)}` : '±0';
  }

  function h(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  function addStyle(css) {
    if (typeof GM_addStyle === 'function') return GM_addStyle(css);
    const style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).append(style);
    return style;
  }

  function copyReport() {
    const matchId = currentMatchId();
    const game = matchId && games.get(matchId);
    const players = game ? [...game.players.values()] : [];
    const links = game && game.status === 'ready' ? playerLinks(game.players) : new Map();
    const first = [...links.values()][0];
    const sample = first ? (first[0].closest(ROW) || first[0].parentElement || first[0]) : null;
    const report = {
      script: `Leetify Utils ${VERSION}`,
      manager: typeof GM_info !== 'undefined' ? `${GM_info.scriptHandler} ${GM_info.version}` : 'unknown',
      url: location.href,
      matchId,
      api: game ? { status: game.status, error: game.error, gameStatus: game.dataStatus } : null,
      players: players.map((p) => ({ name: p.name, rank: p.rank, oldRank: p.oldRank, rankType: p.type, links: (links.get(p.id) || []).length })),
      lastRun: { ...last },
      chipsOnPage: document.querySelectorAll('.lu-change').length,
      csRatingElements: document.querySelectorAll('app-cs-rating').length,
      steamLinks: document.querySelectorAll('a[href*="7656119"]').length,
      sampleRowHtml: sample ? clean(sample.outerHTML).slice(0, 4000) : null,
    };
    const text = JSON.stringify(report, null, 2);
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text, 'text');
      alert('Leetify Utils: debug report copied. Paste it into a chat.');
    } else {
      prompt('Leetify Utils debug report (copy it):', text);
    }
  }

  function clean(html) {
    return html
      .replace(/\s_ng(content|host)-[\w-]+="[^"]*"/g, '')
      .replace(/\s(style|srcset)="[^"]*"/g, '')
      .replace(/\s{2,}/g, ' ');
  }
})();
