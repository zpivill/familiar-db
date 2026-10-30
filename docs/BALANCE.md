# Balance and AI handoff

This is the guide for anyone (person or Claude) picking up **character balancing** and **battle AI work** on Familiar. Read it before you open the code. It explains how the simulator is put together, what each file is for, how to run batches, how the AI thinks, what has been tried so far, and the design rules that every balance change has to follow.

The results of earlier balance runs are in [balance-history.md](balance-history.md). The README covers the site itself (roster, wiki pages, editing).

## Contents

1. [Ground rules from r](#1-ground-rules-from-r)
2. [Data: characters, moves, abilities, stats](#2-data-characters-moves-abilities-stats)
3. [Battle rules](#3-battle-rules)
4. [The competitive format](#4-the-competitive-format)
5. [Simulator architecture (sim/)](#5-simulator-architecture-sim)
6. [How the battle AI chooses moves](#6-how-the-battle-ai-chooses-moves)
7. [How the draft AI picks its 6](#7-how-the-draft-ai-picks-its-6)
8. [Builds: EVs, natures, IVs, items](#8-builds-evs-natures-ivs-items)
9. [Archetypes](#9-archetypes)
10. [Running batches](#10-running-batches)
11. [Reading results: trust only what repeats](#11-reading-results-trust-only-what-repeats)
12. [Known weaknesses and open questions](#12-known-weaknesses-and-open-questions)
13. [Making a change, step by step](#13-making-a-change-step-by-step)

---

## 1. Ground rules from r

r owns the game design. These rules come from r and they are not up for change without asking r.

- **Decide balance changes together with r.** Don't change a character's stats, moves or abilities on your own. Run the numbers, then bring r two or three options with your lean and what each one does to the results. AI and tooling fixes (sim/ai.js, sim/draft.js, reports) can go ahead on their own, since they don't change the game, but say what they change in the results.
- **Moves and abilities must fit canon.** A fan should recognise every signature move and ability as that character's, and you should be able to name the scene or trait it comes from. No generic filler. The only exception is a pure gag or a well-known funny trait (for example Kaido's Drunk ability). If a balance fix needs a new tool on a character (a barrier, redirection, speed control), only give it where the anime backs it.
- **Renamed moves keep their generic name.** Only very basic moves are reused without a rename. Every renamed move shows its generic move in brackets in the UI, for example "Water Wheel (Waterfall)", so the power level is obvious. In data that's `"move": "waterfall", "as": "Water Wheel"` in a learnset.
- **Hidden roles.** Each character has one or two dev roles (`roles` in characters.json: Attack, Support, Speed, Defence, Gimmick, Setter, Terrain, Buffer, Priority...). They describe intent for balancers and are never told to players in the game (they may show on the team site for now). Roles are intent, not locks: an attacking build of a support is fine.
- **The goal is many viable metas.** Balance for a VGC-like competitive doubles format where many cores and counter teams are viable and a creative build can beat a copied meta team. Not "make every character equal".
- **Tiers are progression, not power promises.** Each character has a hidden encounter tier (`rarity`): starter, first-route, pre-mid, mid, post-mid, pseudo, mythical, legendary. First-routers can't be overpowered, but a few may have niche builds. Mythicals are almost always weaker than legendaries. Villains default to legendary.
- **Mono-types vs dual types:** dual types have an edge. Some monos (not all) get about +25 stat total to make up for it; others make up for it through abilities and team fit. Decide case by case.
- **No copyright or takedown flags.** r has decided to remodel characters as needed. Don't raise copyright risk on picks unless r asks.
- **Gag characters are on purpose** (Cole Palmer, Sunthorn Phu, the Bocchi the Rock band, Inazuma Eleven players and others). They stay. Gags can be weak.

## 2. Data: characters, moves, abilities, stats

Everything the simulator knows comes from two files. A balance change is almost always an edit to one of them.

### data/characters.json

An array of 175 characters. Each has `id`, `name`, `anime`, `villain`, `gag`, `rarity` (tier, see above), optional `early: true`, `roles`, `roleNote`, `abilities`, and `stages` (one per form). Example, trimmed:

```json
{
  "id": "kaido", "name": "Kaido", "anime": "One Piece", "villain": true, "rarity": "legendary",
  "stages": [{
    "name": "Hybrid Kaido", "types": ["Beast", "Fire"],
    "stats": { "vit": 150, "pow": 140, "grd": 120, "ene": 100, "wil": 90, "spe": 80 },
    "signature": "boro-breath",
    "learn": [
      { "lv": 1, "move": "bite", "as": "Dragon Bite", "why": "Off-type (Dark): a dragon's jaws." },
      { "lv": 60, "move": "outrage", "as": "Ragnaraku" }
    ]
  }],
  "abilities": [
    { "name": "Strongest Creature", "text": "At full Vitality he takes 0.75x damage, and a hit that would knock him out leaves him at 1.", "like": "Multiscale + Sturdy" },
    { "name": "Thunder Bagua", "text": "His physical moves do 1.2x and have a 10% chance to Stun.", "like": "club boost", "hidden": true }
  ],
  "roles": ["Attack", "Defence"]
}
```

- **Stats** (per form): `vit` Vitality (HP), `pow` Power (physical attack), `grd` Guard (physical defence), `ene` Energy (energy attack), `wil` Will (energy defence), `spe` Speed. These replace the Pokémon names hp/atk/def/spa/spd/spe.
- **Forms:** each form in `stages` is its own entrant in the sim, keyed `id` for the first form and `id/2`, `id/3` for later ones (so `asta/3` is Devil Union Asta). `level` on a form is the level it evolves at; `"lv": "evo"` in a learnset means learned on evolving. Later forms keep earlier moves.
- **Abilities:** up to two plus one `hidden`. A form can override with its own `abilities`. Each battle rolls one. `like` names the Pokémon effect it works like, for balancers.
- **Learnsets:** `learn` is the per-form level-up list. `as` is the character's name for a generic move. An off-type move needs a `why` from the anime.

### data/moves.json

`{ note, moves: [...] }`, 466 moves. Generic move:

```json
{ "id": "tackle", "name": "Tackle", "type": "Neutral", "category": "Physical", "size": "light", "power": 40, "accuracy": 100, "pp": 30, "basic": true }
```

Fields: `id`, `name`, `type`, `category` (Physical, Energy or Status), `size` (light 40-60 power / 20-30 PP, standard 70-90 / 10-15, heavy 100-120 / 5-8, status, signature), `power`, `accuracy`, `pp`, optional `priority` and `effect` (plain English), `basic: true` if anyone can learn it without a rename. Signature moves add `signature: true`, `owner` (character id), `form` (0 = first form) and `source` (the scene it comes from). Every character battles with 4 learnset moves plus its signature, which is always on.

### Effects are plain English, compiled by sim/compile.js

Move `effect` text and ability `text` are read sentence by sentence by regex patterns in `sim/compile.js` and turned into rule objects (`fx` for moves, `ab` for abilities). **If you write a new effect in the same style as existing ones, it works with no code change.** Any sentence that mentions a mechanic but matches no pattern goes into `unsupported` and is listed on the Simulator's **Rules** tab, so check there after editing text. Known unsimulated effects: Snatch, Time Leap, Mind Read.

## 3. Battle rules

All tunable numbers live in `sim/rules.js` (`RULES`, `COMPETITIVE`, `TRAINING`, `ITEMS`, `ITEM_NUM`), so most rule changes are one edit and a rerun.

- **Types:** 15 types (Fire, Water, Ice, Wind, Earth, Lightning, Light, Dark, Spirit, Cosmic, Time, Tech, Beast, Blood, Neutral). The chart is the draft chart from the game map, defined as SUPER / RESISTS / IMMUNE tables in rules.js.
- **Damage:** Pokémon-style formula (`calc` in sim/battle.js) with level, attack / defence stats, stage boosts, STAB 1.5x, crits 1.5x, random roll 0.85-1, spread 0.75x in doubles, screens 1/2 (singles) or 2/3 (doubles), fields 1.3x for their type.
- **Stats:** `battleStat` in rules.js, Pokémon style. Without training every copy has IV 31 and no EVs or natures.
- **Vitality multiplier (`hpScale`):** multiplies Vitality to make battles last longer. Page default is x1. Singles tests used x2. **Competitive balance runs use x3**, which gives about 10-11 turn battles and lets support moves matter (see history).
- **Status effects** (type-linked, one at a time; Confuse stacks): Burn (Fire: halves physical damage, 1/16 chip), Freeze (Ice: can't act, 25% thaw a turn, max 3 turns), Stun (Lightning: 25% lose a turn, half Speed), Bleed (Blood: 1/16, 2/16, 3/16... growing), Curse (Spirit/Dark: Energy x0.5, Will x0.75), Sleep (1-3 turns), Confuse (Time/Wind: 2-5 turns, 1/3 self-hit). Own-type status immunity is on (Fire can't be Burned, etc).
- **Fields** last 5 turns (8 with Field Anchor). Turn cap 100 (a draw) outside the competitive format.
- **Choices Claude made that r hasn't confirmed:** the damage formula, IV 31, own-type status immunity, Curse strength, 5-turn fields. Ask r before treating them as final.

## 4. The competitive format

This is the format balance is aimed at. Defined by `COMPETITIVE` in rules.js and `withFormat` in sim/batch.js (format id `comp`).

- **Bring 8 (default) or 10, pick 6, doubles using all 6.** Open team sheets show characters only; builds are hidden and the AI has to guess them.
- **Legendary / mythical caps:** at most 1 in the picked 6 (0 is fine). In the bring, at most `min(5, bring - 5)`: 3 when bringing 8, 5 when bringing 10. Mythicals share the legendary slot (r has not opted for a separate mythical slot).
- **Level 50,** with any move learned up to Lv100 allowed. Moves, abilities and forms are not changed by the scaling.
- **Builds:** 66 EV points, max 32 per stat, each point = +1 at Lv50. Natures +10% / -10% (never Vitality). IVs 0-31 per stat, default 31. One held item each, one of each item per team (a typed item of each type counts separately). One copy per character.
- **Order:** the 6 are picked at once in order; the first two open.
- **50-turn cap, then a draw that counts as a non-win for both sides** (`drawScore: 0`), so stalling gains nothing.
- **18 held items** in rules.js `ITEMS`, placeholder names with the Pokémon item in `like` (Last Thread = Focus Sash, Iron Gauntlet = Choice Band, etc).

## 5. Simulator architecture (sim/)

Plain ES modules, no build step, no dependencies. Everything except page.js and play.js runs in both Node and a browser Web Worker. Data flows like this:

```
data/*.json ─▶ battle.prepare() ─▶ entrants + compiled moves (compile.js)
                                     │
batch.runBatch(opts) ─ for each battle:
   pick teams (entrantPool / ladderTeams) ─▶ makeBuild() per character (moves + ability)
   ─▶ builds.trainTeam() (EVs, nature, IVs, item)        [comp / "AI-trained"]
   ─▶ draft.draftSide() for each side (pick 6, openers)  [comp with team preview]
   ─▶ battle.runBattle() ─ each turn ai.chooseAction() for each character
   ─▶ record() running totals into stats S
```

| File | What it does |
|---|---|
| `rules.js` | Type chart, every tunable number, competitive format constants, training limits, natures, the 18 items, `battleStat`. Start here for rule changes. |
| `compile.js` | Reads move `effect` and ability `text` sentences into rule objects. `compileMove`, `compileAbility`, `moveFlags` (contact, punch, slice, sound... worked out from names). Unread sentences go to `unsupported`. |
| `battle.js` | The engine. `rng(seed)` (seeded, so any battle can be replayed), `prepare(chars, moves)` (forms to entrants), `runBattle(data, teams, opts)` (one battle, turn by turn, with `calc`, speed, statuses, fields, items, ability hooks). Exposes an `api` object to the AI. `opts.decide` lets the Battle vs AI page inject player choices. |
| `ai.js` | The battle AI: `chooseAction` (pick a move/target or a switch each turn), `chooseReplacement` (who comes in after a faint), `estDamage`. See section 6. |
| `builds.js` | AI training and items: EV `PRESETS`, `kit` (what a moveset says about its job), `autoTraining`, `trainTeam` (greedy item handout, one of each per team), `cleanStat`. |
| `draft.js` | The draft AI for team preview: `guessBuilds`, quick damage-race `matchups`, `synergy`/cores, two-level prediction, `draftSide`, the readable `reasoning` log, `predictionHit`. See section 7. |
| `archetypes.js` | The 11 forced team archetypes (setters, abusers, plan moves) and helpers `roster`, `fits`, `forced`. See section 9. |
| `batch.js` | Runs many battles keeping only running totals. `makeBuild` (moveset picking, "smart" weighted by `rateMove` or random), `entrantPool` (tier / form / gag filters, bans), `ladderTeams` (team search generations: keep, swap, cross, fresh), `runBatch`, `watchBattle` (one battle with a full log), `withFormat`. |
| `meta.js` | `metaSummary`: the Meta tab and its Markdown download (cores by kind, general / specific supports, answers, legendaries, openers, builds). |
| `worker.js` | Web Worker wrapper: `init`, `run` (posts progress chunks), `watch`. |
| `search.js` | **Team search** (Strongest teams, Meta chain, bans, archetype rounds; population meta, CLI only), shared by the page and the CLI. Runs battles through a `ctx.send` it is given and keeps its progress on `ctx`. |
| `page.js` | The Simulator page `#sim` (classic script using app.js globals): settings, splitting runs across workers, all the report tabs. Loads search.js for team searches. |
| `play.js` | The Battle vs AI page `#play`: a human plays one side, including Competitive doubles with team preview. It replays the battle from its seed up to each player choice, using `runBattle`'s `opts.decide` hook. |
| `cli.mjs` | Terminal runner (see section 10): plain batches, team searches and meta chains, split across every core with `node-worker.mjs` (runs worker.js in a Node worker thread). |
| `bench.mjs` | AI test bench (see section 10): strength against fixed opponents, and how far saved meta chains agree. |
| `tune.mjs` | Searches for better AI weights (`W` in ai.js) on every core (see section 10). |
| `mcts.js` | The **search AI** (see section 6): slow but much stronger, for measuring and later teaching the fast AI, not for big batches. `playSearch` plays one battle, `replay` checks it. |
| `bots/baselines.js` | The fixed opponents (random, greedy, frozen v1, mirror = current AI) shared by the bench, the tuner and the search AI. |
| `bots/ai-v1.js` | Frozen copy of ai.js from 2026-10-29, a fixed opponent for the bench. Never edit it; freeze a new copy (ai-v2.js) when a version is worth keeping. |
| `test/mechanics.mjs` | 63 rule checks. Run after every engine, AI, draft or data change. |

**engine/** is a Rust port of the sim (battle.js, ai.js, builds.js, draft.js, batch.js, search.js and the cli) for big runs, about 15x faster. It gives the same results as the JS sim for the same seed (checked battle by battle by `engine/tests/parity.mjs`, which CI runs on every change to `sim/`, `engine/` or `data/`). The JS sim stays the source of truth and the only one on the page: **a change to how the JS sim plays must be made in engine/ too**, or CI fails. Data changes need nothing: `node sim/export.mjs` writes `engine/data.json` (moves compiled, entrants, archetype rosters) from `data/`. The search AI (mcts.js) and `--recheck` are ported too (`--ai=search --iters=128` plays both sides with it). Not ported: `--search=pop`, `watch`, the bench and the tuner.


## 6. How the battle AI chooses moves

`sim/ai.js`. Both sides use the same AI with full knowledge of both teams, so differences in results should come from the characters, not from information.

Each turn the AI scores every usable move against every target, adds a little noise (`W.noise`), then considers switching. In doubles the first character asked plans the whole side: it takes each character's 4 best options and picks the best pair, scored together by `pairValue` (no doubled Tailwind, field or screen, no Helping Hand next to a partner that isn't attacking, a small cut for two hits on a foe one of them already knocks out, a bonus for two hits that only knock out together).

**Every number below lives in `W` at the top of ai.js** and was tuned by `sim/tune.mjs` on 2026-10-29 (see section 10). The numbers quoted here are the original hand-set ones, which the frozen `sim/bots/ai-v1.js` still uses. Tuning raised Protect when the foes can knock the user out (40 to 310), setup (x0.8 to x1.78), Tailwind and Trick Room, and every status move's total (x1.47), and lowered noise (0.3 to 0.17).

- **Attacks** (`attackValue`): expected damage as a share of the target's max Vitality (`estDamage`: real `calc` with average roll, multi-hit average, accuracy, immunities), capped at what's left, x100. **+55 for a knockout**, +30 more if priority lets a slower user land it. Side effects add a bit (status chance x18, flinch if faster, boosts), drawbacks subtract (recoil, self damage, recharge, self-confuse). Charge moves x0.55-0.7, delayed x0.6, sucker-type x0.65. Spread moves in doubles: sum over foes x0.75, minus damage to an ally hit by an "all" move.
- **Doubles targeting** (`duosTargets`): bonus toward the foe that threatens this side most (up to +14) and +15 when the ally can finish a knockout this turn.
- **Status moves** (`statusValue`): a hand-tuned score per effect. Examples: sleep/freeze 45 per open foe, Burn 38 on a physical attacker, hazards 12 + 6 per foe left, screens 20, Tailwind up to 34 when slower, Trick Room up to 38 when slower (and negative when faster), Protect 6 plus situational bonuses, healing by missing Vitality.
- **Setup moves:** scored as the extra damage the boost adds over the turns the user is likely to survive (`setupTurns`: from the foes' best hits, capped at 3; +1 turn with a Follow Me ally or screens, +0.5 when faster than both foes). Secondary stats are scored per stage and cut when the user is under threat.
- **Doubles support** (`duosSupportValue`, added on top): Helping Hand (ally's extra damage, +45 if it turns a hit into a knockout), Tailwind / Trick Room (+18 per speed matchup they flip in our favour), Protect (+40 when the foes can knock it out this turn, more if the ally gets a free knockout), Wide Guard (half the spread damage it would stop), Follow Me (+35 if the ally can set up, +45 if the ally is in knockout range and the user isn't).
- **Archetype plan bonus** (`planBonus`): +45 for the move that puts a forced archetype's plan up (see section 9).
- **Switching:** only after at least one turn in. Uses `matchup` (best hit dealt minus best hit taken, ±Speed). Switches if doomed by a countdown, or if the current matchup is bad (< -0.45) and a bench member is 0.5 better (70% of the time), or if Choice-locked into a weak move.
- **Replacement after a faint:** the bench member with the best worst-case matchup against the foes on the field.

**The search AI** (`sim/mcts.js`) is a second, slow AI built on top of this one. Each turn it takes each of its characters' 4 best options from the scoring above (plus a switch) and, for each pair, plays the rest of the battle out with new luck, 128 times a turn in all, choosing which pair to try next by UCB1. It keeps the pair it tried most. In those playouts the opponent plays as the current AI, the frozen v1 or the greedy bot, picked per playout, so the search doesn't count on the foe playing like itself. A battle can't be copied mid-way, so each playout replays the battle from its seed with every recorded choice (both sides' choices are made outside the engine, with their own random numbers, so the replay is exact). It takes a few seconds a battle, so it's for the bench and for checking top teams, not 200k meta chains. It can run both sides of a battle (`playSearch(..., [0, 1])`, or `opts.ai = 'search'` in a batch): `cli.mjs --recheck=meta.json` uses that to replay a saved meta chain's final round robin and print each team's win rate under the fast AI and under the search AI, so a meta can be checked under strong play.

**What the fast AI doesn't do:** it looks one turn ahead (with both characters planned together in doubles). It doesn't predict the opponent's move (no "they'll Protect, so I'll target the other"), doesn't plan multi-turn lines beyond the setup estimate, and doesn't scout hidden builds in battle (it sees everything). See the checks in section 11.

## 7. How the draft AI picks its 6

`sim/draft.js`, `draftSide(data, mine, theirSeen, opts, r)`. Used when Competitive doubles has team preview on (bring 8/10).

1. **Guess their builds.** It sees only their characters, so `guessBuilds` gives each one a standard "smart" build (same guess every time for the same character, seeded by its key), then AI training and items for the whole bring.
2. **Quick matchups.** `matchups` scores every one of mine against every one of theirs with a damage race: turns to knock out each way (from the best hit, with STAB, type, accuracy, items), plus Speed, squashed with tanh to -1..1. **It ignores abilities except type immunities.** It does no battle.
3. **Cores.** `synergy` scores each pair: Tailwind + mid-speed attacker, Trick Room + slow attacker, redirection + setup, Helping Hand + attacker, field + same-type attacker, screens + setup, and type cover (each resists the other's weaknesses).
4. **Prediction, two levels.** Level 1: their best 6 against my whole bring. Level 2: their best 6 against my likely level-1 picks. Blended 40% / 60% (`softmax` with `TEMP = 0.06`, keeps 24 teams).
5. **Pick.** Every legal 6 (at most 1 legendary/mythical) scored by expected result across the predictions, minus `RISK = 0.35` x the worst of the likely ones. A random choice among picks within 0.03 of the best, so the same bring doesn't always draft the same 6. Team score = coverage (best answer per foe) + 0.4 x worst-case exposure + 0.4 x average strength + 0.12 x synergy.
6. **Openers.** The pair that fits the openers it expects from them, plus a lead bonus for Fake Out, Tailwind / Trick Room, Intimidate, redirection. A forced archetype opens with its setter.
7. **Reasoning log.** Written from the same numbers: reading their bring, prediction, my 6 with one reason each, who's left out and why, risk. Shown in Watch a battle and on `#play`.

## 8. Builds: EVs, natures, IVs, items

`sim/builds.js`. With Training / Held items on "AI picks" (always on in Competitive doubles):

- `kit` reads a moveset: physical vs energy attacker, status count, setup, heal, Protect, Tailwind, Trick Room, redirection, screens, fields, STAB types.
- `autoTraining` picks an EV preset: Support (2+ status moves with team tools, or 1 or fewer attacks), Physical / Energy wall, Trick Room attacker (Trick Room team and Speed ≤ 70: 0 Speed IV, -Speed nature), Bulky attacker (Tailwind team or Speed < 75), otherwise Fast attacker. Nature raises what the preset invests in and lowers the unused attack stat. IVs 31, except 0 Speed on Trick Room attackers and 0 in an unused attack stat.
- `trainTeam` hands out items greedily from per-build `itemScores` (Choice items for pure attackers, Last Thread for frail ones and setters, Bento Box for walls and supports, Ward Charm against the worst weakness...), with a little noise, one of each per team.
- The Simulator's **Builds** tab overrides any character's build and reports how each item and nature did.
- **Build search (Rust sim only):** `familiar-sim --optimize=meta.json` finds each character's best build against a saved meta chain's teams and writes a *build book*; `--builds=book.json` then makes every batch, search and meta chain play those builds instead of random movesets and abilities (archetype-forced moves and abilities still win). For each character it tries one choice at a time: ability, the 6 movesets makeBuild draws most, the 6 EV presets, "outspeeds X" Speed spreads (the fewest Speed EVs that beat each meta character's usual Speed, attack stat at the cap, the rest in Vitality), then every item. The candidate joins each non-archetype meta team in turn (replacing a random member, or itself) and plays a random field team; every option of one character plays the same battles, and options are cut by successive halving so the leaders play all `--per` battles (default 200; use 2000, below that the picks are noise). Each entry in the book keeps the win rate of every option tried and `gain`, best minus plain build on fresh battles. Builds from the book keep their item unless a teammate's book build already holds it.

## 9. Archetypes

`sim/archetypes.js`. The search on its own mostly finds damage-race teams, so 11 team plans can be **forced** in a meta chain ("Archetype rounds" setting) to test whether they hold up:

Tailwind offense, Trick Room, Fire field, Water field, Lightning field, Snow, Redirection + setup, Screens + setup, Gravity, Intimidate + Fake Out balance, Spread offense.

- Each archetype has a `setter(data, e)` and `abuser(data, e)` test that works from the data, so new characters join the archetypes they fit, and a `plan(fx, B, side)` test for the move that sets it up.
- A forced team must **bring** at least 1 setter and 3 abusers (`BRING`), its draft must **pick** at least 1 setter and 2 abusers (`PICK`), the setter opens, and the battle AI gets +45 for the plan move.
- The setter always carries the move or ability that sets the plan up, and an abuser carries the move it abuses it with (`forced`).

## 10. Running batches

### On the site

`#sim` (open locally with `py serve.py` or `start.bat`, then http://localhost:8000/#sim). Pick format, battles, tiers, forms, movesets, level, Vitality multiplier, Training / Held items, Team preview (bring 8 / 10 / off), Team search (Off, Strongest teams, Meta chain), Bans in counter rounds, Archetype rounds. Runs in Web Workers, a few thousand battles a second; Competitive doubles with the draft is about 15-20 ms per battle. Every table sorts and downloads as CSV; the Meta tab downloads as Markdown. **Watch a battle** shows one battle with its draft reasoning.

Settings used for the competitive balance runs: Competitive doubles, bring 8, every form, smart movesets, Vitality x3, 200k battles, Meta chain, Archetype rounds on.

`#play` lets a person fight the AI, which is the only way to test whether a combo plan works when played well.

### From the terminal

Node 18+, no install needed.

```sh
node sim/test/mechanics.mjs                    # rule checks, exits non-zero on failure
node sim/cli.mjs 5000 duel                     # 5,000 one on one battles: top and bottom 12 by win rate
node sim/cli.mjs 5000 team --trained --level=50 --size=6
node sim/cli.mjs 20000 comp 1 --draft          # competitive doubles, bring 8, seed 1
node sim/cli.mjs 20000 comp 1 --draft --bring=10
node sim/cli.mjs 1 comp 5 watch --draft        # one battle's draft reasoning and full log
# the balance-run setting: a 200k meta chain with archetype rounds, Vitality x3, saved for the bench
node sim/cli.mjs 200000 comp 1 --draft --hp=3 --forms=all --search=meta --arch --json=run1.json
node sim/bench.mjs strength 1000               # the AI against random, greedy, frozen v1 and itself
node sim/bench.mjs search 100 1 128             # the search AI vs the current AI, v1 and greedy, on every core (about 20 min)
node sim/cli.mjs 800 comp 5 --draft --hp=3 --forms=all --recheck=run1.json --iters=64   # replay run1's final round robin with the search AI on both sides (about 40 min)
node sim/bench.mjs stability run1.json run2.json run3.json   # how far meta chains (or population metas) with different seeds agree
# population meta: a pool of teams, its Nash mix and the best counter each round (about 8 min); --pool merges saved runs' teams
node sim/cli.mjs 200000 comp 1 --draft --hp=3 --forms=all --search=pop --arch --json=pop1.json
node sim/cli.mjs 100000 comp 11 --draft --hp=3 --forms=all --search=pop --arch --pool=pop1.json,pop2.json,pop3.json
node sim/tune.mjs 80 300 1                     # tune the AI's weights (W) against v1 + greedy, about 15 minutes on 4 cores
```

Arguments are `count format seed [watch]`; formats are `duel`, `team`, `duos`, `comp`. Flags: `--hp=3` (Vitality multiplier), `--forms=all`, `--search=best|meta|pop` (Strongest teams / Meta chain, the same code as the page; pop = population meta), `--pool=a.json,b.json` (pop only), `--arch` (archetype rounds), `--ban=3`, `--json=file`, `--workers=N` (default: every core). Results repeat exactly for the same seed and worker count. A 200k meta chain takes about 13 minutes on 4 cores.

### Fast runs with the Rust sim (engine/)

Same arguments and flags as `cli.mjs` (except `--search=pop` and `watch`), same results, and the `--json` file opens on the Simulator page with **Load results**. A 200k meta chain with archetype rounds takes about 40 seconds on 4 cores (the JS sim: about 11 minutes), so 1M battles is about 3-4 minutes and several seeds are cheap. With several workers, Rust runs repeat exactly for the same seed and worker count; JS runs on several workers can differ slightly because worker results arrive in varying order (on `--workers=1` the two match exactly).

```sh
node sim/export.mjs                         # after any data change: writes engine/data.json
cd engine && cargo build --release          # needs Rust (rustup.rs)
./target/release/familiar-sim 200000 comp 1 --draft --hp=3 --forms=all --search=meta --arch --json=run1.json
./target/release/familiar-sim 2000 comp 5 --draft --hp=3 --forms=all --recheck=run1.json   # run1's final round robin with the search AI on both sides (about 4 min on 4 cores)
./target/release/familiar-sim 0 comp 1 --draft --hp=3 --forms=all --optimize=run1.json --per=2000 --json=book1.json   # build book for the whole roster against run1's teams (about 32 min on 4 cores)
./target/release/familiar-sim 200000 comp 1 --draft --hp=3 --forms=all --search=meta --arch --builds=book1.json --json=run2.json   # a meta chain with those builds
node engine/tests/parity.mjs 200 comp 3 --draft --hp=3   # JS and Rust on the same single-thread batch: must say identical
```

**Windows, no install:** every push to main that touches `sim/`, `engine/` or `data/` publishes `familiar-sim-windows.zip` on the repo's [sim release](https://github.com/zpivill/familiar-db/releases/tag/sim) (familiar-sim.exe, data.json from that commit, run-sim.bat). Unzip and double-click `run-sim.bat`: it asks for a seed and runs the 200k balance setting into `results-seedN.json`. Or pass arguments: `run-sim.bat 1000000 comp 2 --draft --hp=3 --forms=all --search=meta --arch --json=big.json`. Download a fresh zip after data changes, since data.json is baked in at build time.

**Tuning:** `tune.mjs` writes `sim/tuned-weights.json` (don't commit it). It only plays seeds 1000 and up, so check the result with `bench.mjs strength` on seeds 1 and 2 before copying the weights into `W`. If the tuned weights beat the current ones there, freeze the old ai.js as the next `bots/ai-vN.js` first.

**Before and after any AI change,** run `bench.mjs strength` on 2 seeds and 3 meta chains with `bench.mjs stability`, and add both to balance-history.md. The strength ladder plays mirror matches (the same 6 on both sides) in pairs with the same luck and sides swapped, so only the AI differs. For scripts, `runBatch` in batch.js does a plain batch in-process:

```js
import fs from 'fs';
import { prepare } from './sim/battle.js';
import { runBatch } from './sim/batch.js';
import { RULES } from './sim/rules.js';
RULES.hpScale = 3;
const data = prepare(JSON.parse(fs.readFileSync('data/characters.json')), JSON.parse(fs.readFileSync('data/moves.json')).moves);
const S = runBatch(data, { count: 20000, format: 'comp', seed: 1, draft: true, bring: 8, forms: 'all', movesets: 'smart' });
// S.ent[key] = { g, w } per character, S.bring[key] = { b, p, pw, lead } draft picks, S.move, S.abil, S.item, S.core ...
```

Keep one-off scripts out of the repo (or in a scratch folder) unless they're worth turning into a tool.

## 11. Reading results: trust only what repeats

Checks done on 2026-10-29 at Vitality x3, bring 8 (full numbers in [balance-history.md](balance-history.md#sim-checks-2026-10-29)):

- **No side bias:** mirror matches 47.7% / 47.3% / 5% draws.
- **The AI beats random play 93%, but beats a greedy "always hit hardest" bot only 60 / 39.** So the sim shows what's strong *when played simply*. Combo plans (Trick Room, setup, redirection) are probably under-rated.
- **Two identical 200k meta chains disagreed.** Devil Union Asta took 6/6 meta spots in one run and 1/6 in the other; Denji 1 vs 6. Archetype win rates swung by up to 16 points. A meta chain follows whichever team its first search happens to find.

So:

- **Trust only results that repeat across 2 or more runs** (different seeds). A single run's meta teams are one possible meta, not *the* meta.
- **Treat archetype gaps under about 15 points as noise.**
- Small samples are noisy: use 5k+ battles for character win rates, and check the ± margin shown next to win rates on the page.
- "Picked a lot" is not "good": the draft has overrated Whitebeard, Saitama and Black Frieza (picked often, low win rate when picked). Look at win rate **when picked**, not pick rate alone.
- Hand-play combo teams on `#play` before concluding a plan is weak.

What has repeated so far: Intimidate + Fake Out balance and Snow are the best archetypes; Levi, Denji, Tsuna, Asta and Pain keep appearing in meta teams.

## 12. Known weaknesses and open questions

AI and draft:

- **Battle AI is shallow** (one turn ahead, no prediction of the foe's move). Biggest lever for making combo plans testable.
- **Draft quick matchup ignores abilities** (only type immunities count). It can't see Kaido's damage reduction, Intimidate's effect on the race, etc. It overrates raw-stat bruisers.
- **Benched members:** search 10s keep 1-3 members that are picked 0-14% of the time; the swap rule replaces them over generations, but short counter rounds leave a few.
- **Runs disagree on which teams are strongest** (step 5, 2026-10-30): with 8-of-~200 teams there are many near-equal strong teams, and a 200k search finds a different handful each seed. Within a run the result is clear (the population meta's Nash mix beats the rest of its pool by 4-16 points, and the search AI agrees with the fast AI's ranking), but neither the meta chain nor the population meta repeats across seeds at the team or character level. Read single characters that repeat (Devil Union Asta, Ultra Instinct Goku, Six Paths Sage Naruto) rather than whole teams.
- **Meta summary small samples:** best opening pair and specific supports can still come from small samples; a 1-in-1,000 floor like the cores would help.

Balance (bring these to r, don't fix alone):

- **Trick Room is structurally weak:** its setters are fast (Shinra 150, Homura 140, Dio 120...), four of six are legendary/mythical, and there are few strong slow characters.
- **Protect-ignoring signatures one-shot setters:** Devil Union Asta's Black Divider (140 power, ignores Protect) knocks setters out on turn 1.
- **Fields are weak:** 1.3x on one type doesn't pay for the turn spent setting it.
- **Mythicals** (~600 stats) share the slot with 660 legendaries and almost never get picked. A separate mythical slot was offered; r hasn't chosen it.
- **Mid tier** (~505) loses the race to pseudos (~600) even with the new canon team tools.
- **Long tail of legendaries:** two or three take most of the legendary slot.
- **Open from singles balancing:** dropping Sailor Moon's Moon Healing Escalation power 120 to 100 was proposed (trial 59.1% one-by-one) and never answered.
- **Unconfirmed defaults** (section 3) and no Rain exists, so Loch Dweller never fires.

r paused balancing on 2026-10-29 after the sim checks. Suggested way back in: (1) run each setting 2-3 times and compare, (2) look at Protect-ignoring signatures that one-shot setters, (3) hand-play combo teams on `#play`.

## 13. Making a change, step by step

1. **Find the lever.** Stats / moves / abilities are in `data/`. Rule numbers are in `sim/rules.js`. AI behaviour is `sim/ai.js` (battle) or `sim/draft.js` (draft). Builds are `sim/builds.js`.
2. **Measure before.** Run the same setting at least twice with different seeds and note what repeats.
3. **Make the change.** For data, write move / ability text in the same style as existing entries, then check the Rules tab (or `compileMove(m).unsupported`) for unread sentences. For a character change, have the canon source ready.
4. **Run the tests:** `node sim/test/mechanics.mjs`. Add a check for any new mechanic or AI rule.
5. **Measure after** with the same settings and seeds, again at least twice.
6. **Write it up** for r: what changed, before / after numbers, what repeated and what didn't, and the options with your lean. Keep game changes in one PR per decision so r can approve each.
7. **Add the result to [balance-history.md](balance-history.md)** so the next person doesn't redo it.
