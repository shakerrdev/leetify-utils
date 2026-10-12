# Leetify Utils

A userscript for [Leetify](https://leetify.com) match pages. Next to every player's Premier rating it shows the rating they had before the match and how much it changed:

```
16,642  +374  [17,016]
         →
```

The old rating is coloured by its CS2 tier, the change is green or red, and hovering it shows `Premier rating: 16,642 → 17,016 (+374)`. A player's first rating shows **NEW**. In Competitive and Wingman matches a rank change shows as `▲ Gold Nova III` / `▼ Silver Elite` after the name.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or Violentmonkey).
2. Open [`leetify-utils.user.js`](https://raw.githubusercontent.com/shakerrdev/leetify-utils/main/leetify-utils.user.js) and click **Install**.

Updates come from the same link.

## How it works

- On `leetify.com/app/match-details/<id>` it loads `https://api.cs-prod.leetify.com/api/games/<id>` (the API Leetify's own page uses; no login needed) and reads `rank`, `oldRank`, `rankType` and `rankChanged` from `matchmakingGameStats`. One request per match, kept while you stay on the site.
- Players are found by their profile links (`/profile/<Steam64 ID>`), or by name if the links don't carry an ID.
- Their rating is found next to the link: Leetify's `app-cs-rating` element, or any element whose text is exactly that player's rating. Ratings found in the same place for most players are trusted; a lone number that only happens to match (a damage value, say) is not.
- Where no rating can be found, the change goes right after the player's name instead, after a 1.5 s grace period so slow renders don't flash.
- Leetify is a single-page app: the script follows navigation between matches, re-renders and sorting, and removes its marks when you leave a match.

## Something looks off?

Open the match, then Tampermonkey menu → **Copy debug report**. It copies a short JSON report (API status, what was found on the page, and the cleaned HTML of one scoreboard row) to paste into an issue or a chat.

## Tests

The tests run the userscript in headless Chromium against a simulated match page with fixture API data (Leetify's markup, unknown markup, ratings as plain text, a badge showing the old rating, vanity links, no badges, late badges, SPA navigation, in-place re-renders, Competitive ranks, API errors).

```sh
pip install playwright && playwright install chromium
python3 test/run.py                 # or: python3 test/run.py leetify-utils.user.js <screenshot dir>
```

## History

This started in 2025 as a Firefox extension ("Leetify Rank Tracker"). Version 2.0.0 is a rewrite as a userscript; the extension is in the git history.
