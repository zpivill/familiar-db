# Familiar DB

Team wiki and battle simulator for Familiar, an anime creature-collector game designed by r (GitHub `zpivill`). Static site, no build step: `index.html` + `app.js` + `style.css`, data in `data/`, simulator in `sim/`. Run locally with `py serve.py` (http://localhost:8000). See README.md for the site.

## World, story and design work

**Read the Design page first:** the `design` entry at the top of [data/wiki.json](data/wiki.json) (shown at `#design`). It holds the spine (the big picture every idea is checked against), the two readings table (what each system seems to be vs what is true), the region beat sheet, a dated decision log and "Where we paused". It is the handoff: a new thread should not need to reread old threads.

- Plan in four steps: spine, two readings table, region beat sheet, then build one city fully and feed back before the next.
- Work with r in small pieces: options with a lean, one question at a time. r's ideas come first. Tag Claude's fill-ins as `proposal` until r accepts.
- When something is decided, in the same PR: update its item's tag (`s`: decided / proposal / open) or table cell, add a decision log line with the date, and rewrite "Where we paused".
- New ideas must fit the spine and touch a row of the two readings table; say which.

## Balance and AI work

**Read [docs/BALANCE.md](docs/BALANCE.md) first.** It explains the data shape, battle rules, the competitive format, every file in `sim/`, how the battle and draft AIs score things, how to run batches, and known weaknesses. Past runs and findings are in [docs/balance-history.md](docs/balance-history.md); add new results there.

Rules that always apply:

- Don't change characters' stats, moves or abilities without r. Bring options with a lean and numbers. AI and tooling fixes are fine to make, with their effect on results stated.
- Moves and abilities must fit the character's canon (name the scene or trait). Gags are the only exception.
- Trust only results that repeat across 2+ runs with different seeds; archetype gaps under ~15 points are noise.
- Don't flag copyright or takedown risk; r handles it.
- Hidden dev roles are for balancers, never told to players.

## Checks

```sh
node sim/test/mechanics.mjs        # must print "all passed"
node sim/cli.mjs 2000 comp 1 --draft
node engine/tests/parity.mjs 200 comp 3 --draft --hp=3   # after any sim/ change: the Rust sim (engine/) must still say identical
```
