# Familiar DB

Team wiki for Familiar. The home page links to the Roster (every character, their types, evolutions, villains, gags and encounter tier, with Types, Anime, Rarity and Stats tabs) and to text pages: Story, Gameplay, Lore, World, Glossary, Art & style and Roadmap.

Every form has its own dex number, Pokémon-style: a base form is #001 and its evolutions are #002, #003, and the next character carries on from there. Numbers go tier by tier (Starters first, Legendaries last, characters with no tier yet at the end), in roster order within a tier, so changing a tier or adding or removing a form shifts the numbers after it.

Live site: https://zpivill.github.io/familiar-db/

## Editing online

1. Ask the repo owner to add you as a collaborator on this repo, then accept the invite from your email or GitHub notifications.
2. Make a token: open https://github.com/settings/tokens/new?scopes=public_repo&description=Familiar%20DB, set Expiration to what you like, and click **Generate token**. Copy it.
3. On the live site, click **Sign in to edit** and paste the token. Your browser remembers it, so you only do this once per browser.

Then:

- Click a picture slot and press Ctrl+V to paste a picture, or drag a picture file onto it.
- Click a character to edit its name, anime, villain or gag tag, encounter tier, its forms and their types.
- Every change saves to this repo as a commit under your name. Pictures show up straight away; other changes reach the live site for everyone within about a minute.

Keep your token private. If it leaks, delete it at https://github.com/settings/tokens.

## Editing on your own computer

Double-click `start.bat` (or run `py serve.py` and open http://localhost:8000). Changes save to `data/characters.json` and pictures to `images/`; commit and push them to publish.

## Character pages

Clicking a character opens its own page (for example `#c/tanjiro`, or `#c/tanjiro/2` for its second form), laid out like a pokemondb entry: picture, familiar data and hidden roles, abilities, base stats, evolution line and moves learned by level, with links to the previous and next dex number. Signed-in editors get an **Edit character** button that opens the editor.

Abilities, roles, stats and moves show as placeholders until they are added to `data/characters.json`. All of these fields are optional:

- On a character: `"abilities": [{ "name": "...", "text": "...", "like": "Intimidate" }, ..., { "name": "...", "text": "...", "hidden": true }]`, up to two plus a hidden one. `like` names the familiar effect it works like, for balancers. A form can have its own `abilities` to override the character's.
- On a character: `"roles": ["Support", "Gimmick"]` and `"roleNote": "..."`: one or two hidden roles saying how the team expects it to be played. Players never see these.
- On each form in `stages`: `"stats": { "vit": 50, "pow": 60, "grd": 50, "ene": 40, "wil": 50, "spe": 65 }` (Vitality, Power, Guard, Energy, Will, Speed), `"level": 16` (the level it evolves into this form), and `"evolve": "..."` for any other way of evolving.
- On each form: `"signature": "move-id"` and `"learn": [{ "lv": 1, "move": "razor-shell", "as": "Water Surface Slash" }, { "lv": "evo", "move": "...", "as": "..." }]`. `as` is the character's own name for a generic move; `"lv": "evo"` means learned on evolving into this form. An off-type move adds `"why"` with the reason from the anime.

## Moves

`data/moves.json` lists every move, shown on the Moves page (`#moves`). Generic moves have an `id`, plain `name`, `type`, `category` (Physical, Energy or Status), `size` (light, standard, heavy or status), `power`, `accuracy`, `pp`, optional `priority` and `effect`, and `basic: true` if any character can learn it without a new name. Signature moves add `signature: true`, `owner` (character id), `form` (0 for the first form) and `source` (where it comes from in the anime). The Moves page lists every character's name for each generic move, worked out from the learnsets.

## Editing the text pages

Story, Gameplay, Lore and the other text pages come from `data/wiki.json`. Each page has a title, a one-line blurb and sections of entries (`t` is the entry's name, `n` its text, `plan: true` marks it as a plan that may change). Only settled things go here; ideas still being discussed stay in the game map. Edit the file on GitHub (the pencil icon) and the site updates within about a minute.

## Battle simulator

The **Battle simulator** page (`#sim`) runs AI against AI battles in batches of thousands and reports balance data: win rates per character, ability, move, type and teammate pair, head-to-head matchups, and what share of damage comes from signature moves. Pick one on one, team singles or duos, the number of battles, which tiers and forms take part, and press Run. Battles run in Web Workers in the background (a few thousand a second), and every table can be sorted and downloaded as CSV. **Watch a battle** plays one battle step by step, and **Rules** shows the damage formula, status effects and field effects, plus any move or ability text the simulator can't read yet.

**Team search** (team singles and duos) ranks full teams instead of characters. *Strongest teams* searches over several generations: random teams first, then each generation keeps the best fifth, tries swaps and mixes, and adds fresh teams, with new picks leaning toward characters who are winning. The last generation replays the best 32 teams against each other. *Meta chain* finds the strongest team, then the best counter to it, then the best counter to that one, and so on, and ends with every meta team playing every other one. Both show a playstyle line for each team, worked out from how it wins (who lands its knockouts, how long its wins take, what it spends its turns on, and what its members share), and the strongest-teams search also lists the most common members of the top teams.

Each character battles with four moves picked from its form's learnset plus its signature, and rolls one of its abilities. The code lives in `sim/`:

- `sim/rules.js`: the type chart and every number worth tuning (STAB, crit, status strength, battle level, Vitality multiplier).
- `sim/compile.js`: reads the move effects in `data/moves.json` and the ability texts in `data/characters.json` into rules. A new ability or move written in the same style as the existing ones works without code changes; anything it can't read shows up under Rules.
- `sim/battle.js` (the engine), `sim/ai.js` (the battle AI), `sim/batch.js` (batches and totals), `sim/worker.js` (the Web Worker), `sim/page.js` (the page).

From a terminal: `node sim/cli.mjs 5000 duel` runs 5,000 one on one battles (`team` or `duos` for the other formats), `node sim/cli.mjs 1 team 7 watch` prints one battle's log, and `node sim/test/mechanics.mjs` checks single rules.
