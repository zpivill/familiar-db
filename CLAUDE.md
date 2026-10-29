# Familiar DB

Team wiki and battle simulator for Familiar, an anime creature-collector game designed by r (GitHub `zpivill`). Static site, no build step: `index.html` + `app.js` + `style.css`, data in `data/`, simulator in `sim/`. Run locally with `py serve.py` (http://localhost:8000). See README.md for the site.

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
```
