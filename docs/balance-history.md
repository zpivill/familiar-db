# Balance history

What has been tried and found so far, oldest first, so nobody redoes it. How the system works is in [BALANCE.md](BALANCE.md). Add new runs at the end.

Remember the rule from the sim checks below: **trust only results that repeat across 2 or more runs**, and treat archetype gaps under about 15 points as noise. Several single-run results here (especially which exact characters made the meta teams) did not repeat.

## Singles era (2026-10-28)

Format: team singles, 6v6, Lv100, Vitality x2, every form, smart movesets, 100k battles. This was before the competitive format existed; it's here for context.

- **First findings (PR #11):** one on one fights lasted about 1.7 turns (47% ended on turn 1), signature moves dealt about 45% of all damage, the faster side won 66% of 1v1s, and dual types beat mono types.
- **Aizen (PR #14, r approved):** Kyoka Suigetsu now confuses foes only on Aizen's first entry, not every switch-in.
- **Sailor Moon and Alucard (PR #15, r approved):** Moon Healing Escalation heals 1/4 of the damage (was 1/2) and Sailor Moon's Energy went 140 to 120 (r's pick). Alucard's Undead keeps its 1/8 heal a turn and lost the survive-with-1. Sailor Moon went 66.9% to about 62% one-by-one (next: Aizen 58%, Pain and Sukuna 58%). Making "In the Name of the Moon" trigger only on first entry did nothing (63.3%), so it isn't what makes her strong. **Still open:** dropping Moon Healing Escalation power 120 to 100 (trial 59.1%); r never answered.
- **Bans in counter rounds** were added to the meta chain so niche counters get a chance.
- Top singles teams were built around legendaries: Sailor Moon, Aizen, Pain, Alucard, Saitama, Six Paths Madara, with Hero of Hell Chainsaw Man and Adult Gon the top pseudos.

## Competitive doubles built (2026-10-29, PRs #17-#20)

Builds (EVs, natures, IVs, items), the `comp` format, the draft AI and the meta summary. See BALANCE.md sections 4, 7, 8.

## Run 1: the doubles AI only attacked (2026-10-29)

Bring 10, 200k battles, Vitality x2, meta chain.

- Battles were a narrow 6-9 turn damage race: mean 7.4 turns, std 1.9, about 1.25 knockouts a turn.
- **99.8% of moves used were attacks.** Per carrier per battle: Protect 0.01, Tailwind 0.03, Helping Hand 0.06, Trick Room 0.06, Swords Dance / Bulk Up 0.003. Support moves scored 6-38 while an attack scored "share of Vitality x100, +55 for a knockout".
- Trials: AI support value x3 and Vitality x3 together gave 11.3 ± 6.2 turns and real support use.
- Spread moves were only 11% of damage and 7% of KOs, so spread wasn't what dominated.
- **Kaido was real:** in 56% of all 6s, 56% win rate, from Strongest Creature (0.75x damage taken *and* survives any hit at full Vitality) on 150/140/120 stats. His KOs came from single-target Ragnaraku (Outrage) and Flame Clouds (Flare Blitz).
- **Whitebeard was overrated by the draft:** picked 77% when brought, 27% win rate when picked.
- Devil Union Asta (Black Divider: 140 power, ignores Protect) was in all 6 meta teams.
- The meta summary's top cores were tiny lucky samples from the random early generations, not cores the meta teams played.
- Each meta 10 had 2-4 members almost never picked: they never fight, so the search never replaces them.

## PR #21: AI values support moves (2026-10-29)

`duosSupportValue` in ai.js, turn histogram, brought-vs-picked table, Vitality x3 option, a games floor on meta-summary cores, and a swap rule that replaces rarely-picked members first.

Run 2, same settings:

| | Mean turns | Std | Protect | Tailwind | Helping Hand | Trick Room | Follow Me |
|---|---|---|---|---|---|---|---|
| Run 1 (old AI, x2) | 7.4 | 1.9 | 0.01 | 0.03 | 0.06 | 0.05 | 0.15 |
| New AI, x2 | 7.7 | 2.7 | 0.44 | 0.52 | 1.07 | 0.19 | 0.37 |
| New AI, x3 | 10.3 | 3.6 | 0.64 | 0.74 | 1.29 | 0.82 | 0.73 |

- Meta teams still spent 96% of turns attacking, and **setup moves were almost never used (0.6% of turns)**.
- At x3 the pick spread widened: Tsuna in 48% of 6s, Kaido 34% (58% when picked), Naruto 33%. Whitebeard went from 27% to 51% when picked.
- Top core became Founding Titan Eren + Bankai Rukia (Screens + setup, 3,406 games, 58%), a core the meta teams really played.

**From here on, competitive runs use Vitality x3.**

## Variety analysis (2026-10-29)

Why no setup, and why legendaries, mythicals and mids don't get picked (x3 run after PR #21).

- Setup was scored +16 per stage with a one-turn view, so Swords Dance scored 8-19 against 30-90 for attacking. Fix: score it over the turns the user will survive (done in PR #22).
- Tier picture (final forms):

| Tier | Median stat total | Picked when brought | Win % when picked | In 2%+ of 6s |
|---|---|---|---|---|
| Legendary | 660 | 63% | 52% | 5 of 28 |
| Mythical | 600 | 18% | 33% | 0 of 16 |
| Pseudo | 600 | 89% | 54% | 10 of 16 |
| Post-mid | 550 | 73% | 51% | 9 of 34 |
| Starter | 535 | 52% | 49% | 1 of 3 |
| Mid | 505 | 60% | 41% | 4 of 33 |
| Pre-mid | 410 | 23% | 33% | 0 of 27 |
| First route | 325 | 22% | 30% | 0 of 18 |

- At Lv50 stat totals decide most of it. Mythicals (~600) cost the slot a 660 legendary could fill. Kaido (34% of 6s) and Six Paths Madara (23%) take most of the legendary slot; Saitama and Black Frieza are picked a lot but win 37-41%.
- Options given to r: trim the top legendaries, a separate mythical slot (r: not yet), lift weak legendaries by their canon gimmick, give selected mids canon team tools (done in PR #22), a tier points budget (bigger change, less VGC-like), or raise mid stats (blunt).

## PR #22: setup scoring, Kaido trim, Wide Guard, mid team tools (2026-10-29)

- Setup scored over expected turns (`setupTurns`).
- **Kaido:** Strongest Creature's 0.75x now only at full Vitality.
- **New move Wide Guard.** Canon team tools for mids: Todoroki, Giyu and Mob get Wide Guard; Takemichi and Sanemi get Follow Me; Kazuma gets Fake Out.

Run 3 (200k, x3):

- Mean 11.0 turns, std 4.4. Meta teams: 93.9% attacks, setup 1.4%, heal 1.8%, Protect 1.0%.
- Per carrier: Protect 0.68, Tailwind 0.81, Helping Hand 1.20, Trick Room 0.62, Follow Me 0.43, Wide Guard 0.16, Fake Out 0.46, Swords Dance 0.20, Nasty Plot 0.25.
- Kaido fell to 55% when picked but rose to 43% of all 6s: **the draft's quick matchup ignores abilities**, so the trim changed how well he does, not how often he's picked.
- Mids with new tools get picked more (Todoroki 82%, Sanemi 86%, Mob 89% when brought) but still lose (24-41% when picked). Mids as a tier: 39% when picked. Tools gave them a job, not enough to win the race at ~505 stats.
- Top core: Final Arc Gintoki + Vongola X Tsuna (Redirection + setup, 4,388 games, 59%).
- Top picks: Six Paths Sage Naruto 51% of 6s, Ultra Instinct Goku 46%, Hero of Hell Chainsaw Man 43%, Kaido 43%, Devil Union Asta 43%, Lightning Flame Natsu 36%.

## PR #23: bring 8 default (2026-10-29)

Bring 8 is the default; the bring legendary cap is `min(5, bring - 5)` (3 for bring 8). Fixed bring-8 drafts crashing.

## Archetypes (PR #24, 2026-10-29)

Why archetypes: Trick Room never appeared because its 6 setters are all fast (Dio 120, Homura 140, Shinra 150, Ainz 90, Conan 80, Ten-Tails Obito 95; four are legendary/mythical) and almost no strong character is slow (slowest 480+ totals: Bankai Yamamoto and Gyomei 60; Hashirama, Hanami, Jiraiya 65; Founding Titan Eren, Whitebeard, Makima 70). So 11 archetypes can now be forced in a meta chain (r: "Build with all 11").

Archetype run 1 (200k, x3, bring 8, archetype rounds). Mean 10.1 turns. Plan moves per carrier: Helping Hand 1.21, Follow Me 1.17, Tailwind 0.91, Trick Room 0.55, Reflect 0.52, Fake Out 0.41.

- Devil Union Asta in all 6 meta teams, Tsuna in 5 (this did **not** repeat in run 2, below).
- Archetypes vs meta: Balance 53%, Snow 41%, Screens 37%, Water 33%, Redirection 31%, Gravity 30%, Spread 28%, Trick Room 26%, Fire 25%, Tailwind 23%, Lightning 19%.
- Read: fields lose because 1.3x on one type doesn't repay the setup turn; Trick Room can't fill a full slow six.

## Sim checks (2026-10-29)

Checks of the tool, not the characters. Competitive doubles, x3, bring 8, every form.

1. **Side bias:** 1,000 mirror matches, side 1 47.7%, side 2 47.3%, draws 5%. None.
2. **AI strength** (1,000 battles each, same team both sides):

| Opponent | AI wins | Opponent wins | Draws |
|---|---|---|---|
| Random moves | 92.8% | 5.3% | 1.9% |
| Greedy bot (hardest hit into best target) | 59.6% | 38.6% | 1.8% |

   Most of the AI's edge is targeting and support, not planning. A good human would likely beat it. The sim shows what's strong when played simply; combo plans suffer most.

3. **Do two runs agree?** Same 200k meta chain with archetype rounds, twice. Meta-team spots out of 6 (run 1 / run 2): Devil Union Asta 6/1, Tsuna 5/1, Denji 1/6, Toshiro 0/4, Pain 1/4, Levi 3/5, Naruto 2/3, Goku 1/3, Gon / Escanor / Itadori / Jin-woo 3/0.

| Archetype vs meta | Run 1 | Run 2 |
|---|---|---|
| Intimidate + Fake Out balance | 53% | 56% |
| Snow | 41% | 53% |
| Trick Room | 26% | 42% |
| Spread | 28% | 40% |
| Fire field | 25% | 36% |
| Redirection + setup | 31% | 36% |
| Lightning field | 19% | 35% |
| Tailwind | 23% | 29% |
| Screens + setup | 37% | 22% |
| Water field | 33% | 21% |
| Gravity | 30% | 17% |

   **They don't agree.** A meta chain follows whichever team its first search finds. What repeats: Balance and Snow are the best archetypes; Levi, Denji, Tsuna, Asta and Pain keep appearing.

4. **Battle log:** a Trick Room team vs meta team 1. Asta's Black Divider (140, ignores Protect) knocked Shinra out from full on turn 1, before Trick Room went up. A balance point, not a bug.

Conclusion: the engine isn't broken; results need repeating. **r paused balancing here (2026-10-29).** Suggested next steps: repeat each setting 2-3 times and compare; look at Protect-ignoring signatures that one-shot setters; hand-play Trick Room and setup teams on `#play`.

## PR #25: competitive doubles on Battle vs AI (2026-10-29)

`#play` can now play Competitive doubles with editable brings (presets: random, random archetype, any of the 11), per-character builds and team preview against the draft AI. Use it to hand-test combo plans.

## AI research and step 1: test bench (2026-10-29)

Research on making the AI stronger and faster: [doc](https://claude.ai/artifact/4F8hsLn4janqXy3a7fVdFv). A rough Monte Carlo search prototype (4 playouts per option, replaying from the seed) beat the current AI 131 of 160 (82%, every seed 77-85%), but the greedy bot only 67% (the current AI gets 58%): most of its edge came from knowing how its opponent plays. The plan: (1) test bench, (2) joint side actions + automatic weight tuning, (3) a search AI, (4) distil it into the fast AI, (5) find the meta as a population of teams.

Step 1 (this PR): team search moved to sim/search.js, meta chains from the terminal on every core, `sim/bench.mjs`, frozen `sim/bots/ai-v1.js`, and caches that make a drafted battle 1.5x faster with the same results for the same seed (12.6 to 8.4 ms single-core). A 200k meta chain at Vitality x3 now takes about 10 minutes on 4 cores.

**Baseline strength** (`bench.mjs strength 1000`, seeds 1 / 2), the numbers the next AI has to beat:

| Opponent | AI won | AI lost | Drew |
|---|---|---|---|
| Random | 92.0% / 90.9% | 6.9% / 7.7% | 1.1% / 1.4% |
| Greedy hardest-hit bot | 60.3% / 54.9% | 37.2% / 41.8% | 2.5% / 3.3% |
| Frozen v1 (same AI) | 48.2% / 46.4% | 48.2% / 46.4% | 3.6% / 7.2% |

**Baseline stability** (`bench.mjs stability`, three 200k meta chains with archetype rounds, seeds 1-3, Vitality x3, bring 8, every form):

- Top-12 meta characters shared between two runs: 4.3 of 12 on average.
- Rank correlation of win rate when picked (characters with 200+ picks): 0.48.
- Archetype win rate across the three runs. Only Snow (46 / 46 / 49%), Screens + setup (51 / 52 / 54%) and Spread (40 / 39 / 35%) held within 6 points. Trick Room (26 / 54 / 35%), Redirection + setup (47 / 21 / 39%), Fire field (32 / 56 / 40%) and Tailwind (43 / 28 / 49%) swung 20+ points. Largest spread 28 points.
- What repeated in all three: Devil Union Asta was in 16 of the 18 meta teams and Six Paths Sage Naruto in 15. Next came Final Arc Gintoki (11), Hero of Hell Chainsaw Man (9, none in run 1) and Pain (8, 6 of them in run 3).

Targets for later steps: overlap 9 of 12, correlation 0.8, archetype spread under 6 points.

## AI step 2: joint side actions and tuned weights (2026-10-29)

The AI now plans both characters on a side together in doubles, and its 29 scoring weights (`W` in ai.js) were tuned by `sim/tune.mjs` (80 generations against frozen v1 + greedy, seeds 1000+ only). A second tuning round gave no further gain and drifted toward almost never switching, so the round-1 weights were kept.

**Strength** (`bench.mjs strength 1000`, seeds 1 / 2, unseen by the tuner):

| Opponent | Step 1 AI won | Step 2 AI won | Step 2 AI lost |
|---|---|---|---|
| Random | 92.0% / 90.9% | 94.0% / 94.4% | 4.4% / 4.4% |
| Greedy hardest-hit bot | 60.3% / 54.9% | 64.7% / 67.0% | 32.0% / 29.7% |
| Frozen v1 | 48.2% / 46.4% | 55.7% / 54.8% | 38.3% / 40.4% |

Joint actions alone made no measurable difference (46-48% vs v1); the gain came from the weights. The tuned AI uses status moves much more (12% to 22% of moves in a 6k drafted batch): Protect 0.7 to 1.3 uses a battle, Swords Dance 0.21 to 0.77.

**Stability** (three 200k meta chains, seeds 1-3, same settings as step 1): top-12 overlap 4.7 of 12 (was 4.3), rank correlation 0.49 (was 0.48), largest archetype spread 31 points (was 28). **A stronger AI didn't make runs agree**, as expected: that is step 5's job (population meta).

**Archetypes vs meta, step 1 AI → step 2 AI** (average of 3 runs, each run's value in brackets):

| Archetype | Step 1 | Step 2 |
|---|---|---|
| Intimidate + Fake Out balance | 48% | 61% (55 / 56 / 71) |
| Redirection + setup | 36% | 54% (53 / 54 / 56) |
| Screens + setup | 52% | 54% (59 / 54 / 50) |
| Snow | 47% | 48% (59 / 39 / 45) |
| Gravity | 54% | 45% (27 / 57 / 51) |
| Trick Room | 38% | 42% (42 / 48 / 35) |
| Tailwind offense | 40% | 41% (30 / 44 / 50) |
| Fire field | 43% | 39% (46 / 29 / 43) |
| Water field | 26% | 37% (40 / 47 / 23) |
| Lightning field | 31% | 37% (37 / 38 / 35) |
| Spread offense | 38% | 32% (25 / 39 / 33) |

Redirection + setup rose 18 points and now holds steady across runs (53-56%), so it was under-rated by the simpler AI, as suspected. Balance rose too. Most other gaps are within the noise. Devil Union Asta was in 17 of the 18 meta teams, the most repeated result so far.

## AI step 3: the search AI (2026-10-30)

`sim/mcts.js` is a slow, strong second AI for measuring and (in step 4) teaching the fast one. Each turn it takes each character's 4 best options from the fast AI (plus a switch), plays the rest of the battle out for each pair with new luck, picks which pair to try next by UCB1, and keeps the pair it tried most. Opponents in its playouts are a random mix of the current AI, frozen v1 and greedy. Each playout replays the battle from its seed (a new check confirms replays are exact).

`bench.mjs search`, mirror matches with paired seeds, against each opponent:

| Playouts a turn | Seed (battles) | vs current AI | vs frozen v1 | vs greedy | Seconds a battle per core |
|---|---|---|---|---|---|
| 16 | 3 (80) | 61% | 60% | 58% | 1.5 |
| 48 | 1 (100) | 74% | 83% | 89% | 3-4 |
| 48 | 2 (100) | 80% | 80% | 88% | 3 |
| 128 | 3 (80) | 90% | 90% | 90% | 5.5 |
| 128 | 4 (60) | 85% | 92% | 90% | 6-7 |

Margins are about ±7-10 points at these sample sizes. 128 playouts is now the default. Caveat: greedy and v1 are among the styles the search assumes for its foe, so part of its edge against them is knowing how they play; the current AI is the fairest test, and it still wins 85-90% at 128 playouts.

At 5-7 seconds a battle, the search AI is for benches and spot checks of top teams (a few hundred battles), not for meta chains. Step 4 is to teach the fast AI to choose like it.

## AI step 4: teaching the fast AI from the search AI (2026-10-30) — no gain yet

Tried to make the fast AI choose like the search AI by tuning its weights to agree with the search's recorded choices. **It didn't work, and the reason is measured:**

- Recorded 300 search battles at 128 playouts a turn (seed 21; the search won 85-90%), 4,033 turns. The fast AI picks the search's top pair on 21% of turns.
- Weights tuned for agreement (`tune.mjs --distill`, 60 generations) only cut the average regret from 0.165 to 0.159, and **lost to the step-2 AI 42.5% to 50.8%** (600 battles). Not adopted.
- Why: each turn the search splits 128 playouts over about 16 pairs, so its best pair beats its second best by 0.03 of a win on average while the noise on that gap is 0.19. Its pick is never clearly best on a single turn (0% of turns past 2 standard errors). The search wins by being slightly better on average across many turns, so its single-turn picks are mostly noise as labels.
- The biggest disagreement looked like the fast AI spending its signature too readily (fast picks the signature in 34% of the different-attack cases, the search in 20%), but a cost for spending scarce moves made the fast AI worse against v2 (0: 47/47, 10: 47.5/47, 25: 43/51, 60: 39/54). Dropped.

Kept as tools: `bench.mjs search ... --record=file` (record the search's choices), `judge()` in mcts.js (how far the fast AI is from them), `tune.mjs --distill=file`, and `bots/ai-v2.js` (the step-2 AI frozen; bench now includes it). Clean labels would need about 2,000 playouts per turn (16x), roughly an hour of compute per 500 turns here.

### Re-checking a meta with the search AI (2026-10-30)

r's pick after step 4: re-check finished metas with the search AI instead. `cli.mjs --recheck=meta.json` replays a saved meta chain's final round robin with the search AI on **both** sides. Run 1 of the step-2 stability runs (6 meta teams + 11 archetype teams) was replayed for 800 battles at 64 playouts a turn (21 minutes on 4 cores, about 90 games per team, ±10 points):

| Team | Fast AI | Search AI |
|---|---|---|
| Meta 1-6 | 64 / 56 / 62 / 66 / 61 / 63% | 67 / 55 / 65 / 61 / 62 / 66% |
| Snow | 59% | 66% |
| Screens + setup | 59% | 62% |
| Intimidate + Fake Out balance | 55% | 50% |
| Redirection + setup | 53% | 49% |
| Fire field | 46% | 43% |
| Trick Room | 42% | 40% |
| Water field | 40% | 38% |
| Lightning field | 37% | 44% |
| Tailwind offense | 30% | 21% |
| Gravity | 27% | 38% |
| Spread offense | 25% | 22% |

**Under strong play the ranking holds:** rank correlation 0.89, average change 4 points, largest 11 (Gravity up, Tailwind down), all within the margins. So with the step-2 AI, one run's results are close to what good play gives. The open problem is that different runs land in different metas, which is step 5's job.

### Step 5: population meta (2026-10-30)

`cli.mjs --search=pop` replaces the chain of counters with a double oracle: start a pool from the 4 best teams of a 40k search, play every pair, find the pool's Nash mix (the mix no pool team beats; regret matching, averaged over 40 resamples of the win table so a few points of noise don't swing it), search for the best counter to the mix, add it if it beats the mix, repeat. Archetype teams are then searched against the mix and scored against it. `--pool=a.json,...` starts the pool from earlier runs' teams instead. About 8 minutes per 200k run on 4 cores.

Stability, Competitive doubles, bring 8, Vitality x3, every form, archetype rounds, 200k battles per run:

| | Top-12 characters shared | Meta share overlap | Picked win rate rank corr. | Largest archetype spread |
|---|---|---|---|---|
| Meta chain, seeds 1-3 (step 2 baseline) | 4.7 / 12 | 46% | 0.49 | 31 |
| Population meta, seeds 1-3 | 2.0 / 12 | 24% | 0.33 | 42 |
| Population meta, seeds 4-6 | 1.7 / 12 | 28% | 0.35 | n/a |
| Merged pools: seeds 1-3 vs seeds 4-6 (100k each on top) | 3.0 / 12 | 34% | 0.37 | 27 |

(Meta share overlap: how much of two runs' character shares match, each meta team counting equally in a chain and by Nash weight in a population meta.)

**It did not make runs agree.** What it showed instead:

- The counter search almost never beats the mix: all 8 runs stopped after 1 or 2 rounds (best counters 29-52% against the mix). Within a run the mix is clear: pool teams outside it lose to it by 4-16 points.
- So the disagreement isn't in judging teams but in finding them: each seed's search lands on a different handful of strong 8s, and the strongest found team takes most of the mix. Merging three runs' pools helps a little (34% overlap) but stays below the chain, whose 6 equal teams spread the shares wider.
- What repeats: Devil Union Asta is in the mix of 6 of 8 runs (100% share in four, 87% and 98% in the merged runs), Ultra Instinct Goku in 7 of 8, Six Paths Sage Naruto often. Matches the earlier Asta findings (Black Divider ignores Protect).
- Archetype scores against the mix still swing 10-42 points between runs; no archetype is clearly above the others.

A first version (Nash on the raw table, archetype teams inside the pool, stop when the counter's 95% lower bound passed 50%) was worse: 2.0 / 12, 26% overlap, and two runs collapsed onto one team. Kept as a CLI tool, not on the page and not the default for balance runs.

## Rust sim (2026-10-30)

**Bigger single runs don't make results agree.** Two meta chains of 400k each (seeds 1 and 2, same setting as step 5) shared 47% of their character shares and 5 of 12 top characters, the same as pairs of 200k runs (39-53%). So the noise is in which teams the search finds, not in too few battles per team. What helps is aggregating characters over several seeds, which needs speed.

**Port:** `engine/` is a Rust port of the whole fast sim (engine, battle AI, builds, draft, batch, team search, meta chain, cli). It matches the JS sim exactly: every format battle by battle (duel, team, duos, comp with and without draft, bring 10, Vitality x3, every form, trained), and full meta chains with archetype rounds and bans on one worker, compared field by field. Speed on 4 cores:

| Run | JS | Rust |
|---|---|---|
| One comp draft battle, one core | ~13 ms | ~1.4 ms |
| 20k meta chain + archetypes, 4 workers | 67 s | 4.5 s |
| 200k meta chain + archetypes, 4 workers | ~11 min | 39 s |

No balance or AI changes: results are the same as the JS sim's for the same seed.

### Search AI in Rust (2026-10-30)

`engine/src/mcts.rs` ports the search AI and its playout opponents (the v1 bot as the current AI's scoring with v1's numbers, and greedy). It matches the JS search AI exactly (parity.mjs with `--ai=search`, and `--recheck` output identical). Speed at 128 playouts a turn, competitive doubles with draft:

| | JS | Rust |
|---|---|---|
| One battle, one core | ~5.6 s | ~0.43 s |
| Per battle on 4 cores | ~1.5 s | ~0.11 s |
| 200k battles on 4 cores | ~3.5 days | ~6 hours |
| Re-check of a 17-team round robin, 2,000 battles | ~50 min | ~4 min |

Every playout still replays the battle from turn 1 (the JS design, kept for exact parity); branching from a copy of the battle instead would roughly halve the time.


## Noise floor before build optimization: 16 worlds (2026-10-30)

Step 1 of the [simulated-meta plan](https://claude.ai/artifact/3B6snowJaAmGMfy82N5SdR): 16 Rust meta chains, seeds 1-16, 200k each, comp, bring 8, Vitality x3, every form, archetype rounds (about 1 minute each on 4 cores). `bench.mjs stability` now also pools the runs: it splits them into two disjoint groups of m runs, averages each group, and checks how far the two groups agree. This is the "before builds" baseline; rerun it the same way once build optimization lands.

**Metric fix:** "meta share overlap" divided by 6 although bring-8 meta teams have 8 members, so every overlap quoted above is 4/3 too high (46% is really about 35%, 47% about 35%). Comparisons between those numbers still hold. Rank correlations now give tied values their average rank, which matters for pooled shares with many zeros.

| Runs pooled per group (m) | Top-12 shared | Share overlap | Share rank corr., top 40 | Picked win rate rank corr. |
|---|---|---|---|---|
| 1 | 5.2 / 12 | 41% | -0.14 | 0.43 |
| 2 | 6.7 / 12 | 47% | -0.06 | 0.54 |
| 4 | 7.7 / 12 | 59% | 0.21 | 0.66 |
| 8 | 8.2 / 12 | 67% | 0.42 | 0.75 |

(30 random splits each.) Pooling helps steadily: two groups of 8 runs agree on 8 of their top 12 characters and on win rate when picked (0.75), where single runs agree on 5. Ranks below the top ~12 are still mostly noise (top-40 share 0.42), so 16 worlds is not enough for a full usage ladder; win rate when picked looks reachable at 0.8 with about 16 runs per group.

Pooled over all 16 runs, share of meta team slots (±95% across runs, runs it appears in): Devil Union Asta 11.6% ±0.7 (16/16), Six Paths Sage Naruto 8.7% ±2.2 (14/16), Ultra Instinct Goku 7.6% ±1.9 (16/16), Tsuna (form 3) 6.1% ±2.0 (14/16), Denji (form 3) 5.3% ±2.4 (10/16), Levi 4.7% ±2.3, Kaido 4.4% ±2.1, Poseidon 3.6% ±1.8; everyone else under 2.5%.

Archetype win rate in the final round robin, mean of 16 runs (±95% across runs): Intimidate + Fake Out balance 55% ±3, Screens + setup 51% ±3, Snow 50% ±4, Redirection + setup 45% ±3, Tailwind offense 41% ±5, Fire field 41% ±4, Spread offense 39% ±4, Water field 38% ±4, Trick Room 38% ±4, Gravity 37% ±4, Lightning field 33% ±4. A single run swings each by 18-44 points, but pooled over 16 the error bars are 3-5 points, so the order Balance > Screens/Snow > Redirection > the rest is a real result under the current AI and rule-based builds.

## Build search (2026-10-30)

`familiar-sim --optimize` (see BALANCE.md section 8). Competitive doubles, bring 8, Vitality x3, every form, 2,000 battles per option with successive halving, about 32 minutes per roster on 4 cores. "Win rate" below is from 300k random-team battles, two seeds averaged (the two seeds agree on every change, corr 0.94-0.97).

- **Picks repeat only with enough battles.** At 400 battles per option, two seeds chose different builds for the same character. At 2,000, the gains repeat (corr 0.83 over the roster, +3.6 points on average over the plain build). Exact picks repeat less (ability 71%, preset 38%, item 42%), because many options are within a point of each other.
- **Builds matter a lot for some characters.** Round 1 (fitted to one meta chain): Demon Emperor Lelouch 61% to 84%, Zero 51% to 68%, Pain 69% to 84%, Ainz 53% to 64%. Some fall as everyone else improves: Sin Devil Trigger Vergil 60% to 46%, Hybrid Kaido 57% to 47%.
- **Fitting to one meta doesn't settle.** Rounds 2 and 3 (each re-fitted to the meta the last builds produced) moved win rates again: mean change 1.9 and 2.2 points, up to 11 and 21 (Pain 84%, then 77%, then 56%).
- **Fitting to 3 metas at once, from a mix of all earlier builds, twice independently (P and Q):** P and Q differ by 2.0 points on average, up to 13 (21 characters by more than 5). Better than single-meta rounds, but not settled.
- **What holds in every round:** Demon Emperor Lelouch (Zero Requiem, fast, Flash Cannon / Dark Pulse / Light Screen / Hex), Hogyoku Aizen and Pain stay the top 3, at 73-84% with their best builds. The character ranking with best builds correlates 0.91-0.94 with the plain-build ranking.

Books P and Q and a readable table are in the project files (`familiar/builds/`). Bulk spreads, averaged fits and a search-AI check follow below.


### Noise floor with build books (2026-10-30)

The 16-seed baseline above, rerun with books (same setting, seeds 1-16), once with `--builds=book-P,book-Q` and once with book P only. Pooled stability from `bench.mjs stability`:

| | top-12 shared | share overlap | picked-wr rank corr |
|---|---|---|---|
| groups of 8, before builds | 8.2 | 67% | 0.75 |
| groups of 8, P+Q | 8.0 | 59% | 0.60 |
| groups of 8, P only | 7.0 | 58% | 0.49 |
| groups of 8, fits 1-4 (with bulk spreads) | 8.3 | 60% | 0.56 |
| single runs, before builds | 5.2 | 41% | 0.43 |
| single runs, P+Q | 3.4 | 30% | 0.32 |
| single runs, P only | 3.4 | 30% | 0.30 |
| single runs, fits 1-4 | 3.7 | 31% | 0.31 |

- **Runs agree less with builds**, and mixing two books isn't the cause (P alone is no better). Likely cause: builds flatten the top. The gap between 1st and 10th character by pooled picked win rate is 6.3 points before and 3.9 with P+Q, so there are more near-equal teams. That guess doesn't hold for fits 1-4: their gap is 6.6 points, as before builds, so the cause is open.
- **Meta shares, pooled:** Demon Emperor Lelouch 12.0% ±0.6, in 16 of 16 runs. Asta was 11.6% in 16 of 16 before and is now outside the top 20. Next are Pain 5.1% and Poseidon 4.8%.
- **Archetypes, pooled (±3-6):** Balance 58%, Tailwind 46%, Redirection 41%, Trick Room 40%, Screens 40%, Snow 39%, the rest 29-38%.
- **With fits 1-4:** Lelouch 12.1% ±0.4 (16 of 16), Pain 5.7% (16 of 16). Archetypes (±3-5): Balance 58%, Tailwind 46%, Screens 40%, Water 39%, Snow 38%, Redirection 37%, the rest 31-34%.

### Bulk spreads, 4 averaged fits and a search-AI check (2026-10-30)

Build search now also tries "survives X" bulk spreads (BALANCE.md section 8). Four independent fits, each against 3 different meta chains (200k, meta + archetype rounds, from the mixed book), seeds 31-34, `--per=2000`, about 42 minutes each. Each book then played 300k random-team battles on 2 seeds. Books and the table are in the project files (`familiar/builds/book-fit1..4.json`, `best-builds-avg.md`).

- **Fits agree about as well as P and Q did.** Pairwise corr 0.93-0.95, mean difference 1.7-1.9 points, max 12-19, 12-19 characters more than 5 points apart. A character's range over the 4 fits: median 2.7 points, 90th percentile 6.3. So one fit's number for a typical character moves about 3 points from fit to fit (6 for the worst tenth), and the mean of 4 fits is about twice as tight.
- **Bulk spreads are mostly near-ties.** 143-155 of 257 characters pick a bulk spread, but the median margin over keeping the spread is 0.25 points, and only 39 characters pick one in all 4 fits (about 27 would by chance). Small real effect at most, with Vitality x3 few hits KO from full.
- **Picks:** the same ability in all 4 fits for 91 characters, the same moves for 29, the same item for only 5. Items stay near-ties.
- **Top of the averaged table:** Demon Emperor Lelouch 85.7% (82.5-87.0), Pain 80.4%, Hogyoku Aizen 76.4%, Zero 69.4%, Ultra Instinct Goku 68.7%, Shinfuku Gojo 66.6%, Final Arc Gintoki 66.2%.
- **Search-AI check:** 8,000 draft battles, both sides fast AI or both search AI, with all 4 books or plain builds, seeds 7 and 8 (about 30 minutes per seed for the two search runs). The win-rate ranking with books holds under the search AI: corr 0.91 fast vs search, while the two seeds agree 0.88-0.91 with each other, so the stronger AI changes nothing beyond noise. The biggest build gains hold or grow (Demon Emperor Lelouch +26 fast, +23 search; Zero +20, +23; Pain +7, +15; Hogyoku Aizen +6, +13). The top 20 fast-AI gains average +8.9 fast and +6.3 search; part of that drop is regression to the mean, since per-character gains at 8,000 battles only repeat across seeds at corr 0.43-0.46.

## Character options tested (2026-10-30), nothing changed in data

Each option was applied to a copy of the data, the changed character re-fitted (2 fits against 3 meta chains each, `--per=2000`), everyone else on the 4 averaged books, then 300k random-team draft battles on 2 seeds. Base: Demon Emperor Lelouch 85.8%, Pain 80.2%, Hogyoku Aizen 76.9%. Re-fitting alone moves a character about 3 points, so smaller changes are noise. Options doc for r: https://claude.ai/artifact/YSWfFQyc2yj3cruogWtddL

| Option | Result |
|---|---|
| Zero Requiem: foes' drop only | Demon Emperor Lelouch 64.6%, Zero 49.9% |
| Zero Requiem: allies' rise only | 80.0%, 61.4% |
| Zero Requiem: only allies on the field rise | 72.7%, 57.7% |
| Pain without Calm Mind / Spacial Rend / Recover | 64.5% / 65.0% / 78.1% |
| Pain Energy 135 to 120 | 78.0% |
| Preta Path half Energy damage / no heal | 78.9% / 79.2% |
| Aizen without Calm Mind / Spacial Rend / Recover | 63.4% / 77.0% / 76.5% |
| Aizen Energy 130 to 115 | 78.6% |
| All According to Plan 1.3x / 1.2x | 76.8% / 77.7% |
| Pucci: Confusion to Psychic | 39.0% to 40.3% |
| Homura: Leer to Iron Head | 39.3% to 40.8% |

- Zero Requiem drives both Lelouch forms, mostly through the team-wide +1 to all stats.
- Pain and Aizen are Calm Mind + Recover walls: their abilities are near-ties, and only removing Calm Mind (or Spacial Rend for Pain) moves them.
- Weak legendaries (Pucci, Homura, Blackbeard, about 39%) gain only 1-2 points from one better move.
- The Zero Requiem variants used a throwaway engine switch that is not in the repo.

## AI gap check #1: does the draft guess foe builds from the book? (2026-10-31)

Gap #1 of the [AI gap list](https://claude.ai/artifact/5uwDQKZMqXFJ3aX8xqh9ut) said the draft AI guesses foe builds from the rule-based builds even with `--builds`. It does not: `guess_builds` calls `make_build`, which returns the book build when one is loaded (checked directly: 7 of 8 guesses equal the book build; the 8th differs only in item, because the item handout dedupes a repeated item). With several books, the guess is one of the character's book builds, the same one every time, while the real team picks one at random. Only the Rust sim reads books, so the JS side has nothing to change.

Prediction hit (`predictionHit`: share of the foe's picked 6 the draft predicted / exact 6), 20k draft battles, comp, bring 8, Vitality x3, every form:

| Builds | overlap, seed 1 / 2 | exact 6, seed 1 / 2 |
|---|---|---|
| rule-based | 91.2% / 91.3% | 51.9% / 52.4% |
| book P only | 96.1% / 96.0% | 77.1% / 76.6% |
| 4 averaged books | 93.6% / 93.5% | 63.5% / 63.3% |

So the draft predicts better with books, not worse; #1's "done when" already holds and no code changed. The 16-seed numbers above therefore stand as they are (rerunning without a change gives the same runs). It also rules #1 out as the cause of #12 (runs agree less with books): book P alone, where the guess is nearly exact, agrees least (0.49). With books the draft effectively sees the foe's exact builds, which belongs to the hidden-information gaps #2 and #3.

## AI gap check #6: scenario tests (2026-10-31)

`node sim/test/scenarios.mjs` sets up 10 doubles positions where one answer is known to be right (comp level 50, Vitality x3, 'None' abilities so only the named moves matter) and asks the AI under test for its choice. Each position's premise (who outspeeds, what KOs, which foe is immune) is checked in code before the AI chooses. The fast AI gives the same answer on every seed; the search AI varies.

| Position (right answer) | Fast AI | Search, 128 playouts (8 seeds) | Search, 1,024 playouts (4 seeds) |
|---|---|---|---|
| Fake Out on turn 1 | right | 8/8 | 4/4 |
| KO with priority when slower (Bullet Punch the 5% foe that would KO either of ours) | **Protect** | 1/8 (Protect) | 4/4 |
| Set Trick Room when much slower | right | 4/8 | 3/4 |
| Don't undo our own Trick Room | right | 5/8 | 4/4 |
| Don't double Tailwind | right | 8/8 | 4/4 |
| Don't Protect twice in a row when an attack KOs | right | 8/8 | 4/4 |
| Take the KO on the 5% threat | right | 7/8 | 4/4 |
| Don't hit an immune foe | right | 8/8 | 4/4 |
| Don't Thunder Wave stunned foes | right | 8/8 | 4/4 |
| Switch out of a lost matchup | **Protect** | 6/8 | 4/4 |
| **Total** | **80%** (bar 90%) | **79%** (bar 95%) | **98%** |

- **Fast AI fails 2 of 10.** In both it Protects when the right move is to act: a priority KO, or a switch to a character that resists both foes. Both are the duos Protect bonus winning over a better option.
- **The search AI at its real setting (128 playouts) is noisier than the fast AI on simple positions**: it undoes its own Trick Room 3 times in 8 and skips setting it 4 times in 8. With 1,024 playouts it gets 98%, so the misses are too few playouts, not a wrong idea. The Rust search AI plays the same way (parity), so this also holds for `--ai=search` and `--recheck` results.
- Dropped from the gap list's examples: "don't attack into Wide Guard" and "Protect when both foes target you" have no known right answer without predicting the foe (forcing an answer turned out wrong in testing: a Protect at 12% and a Fake Out with Helping Hand available were both not clearly best).

## Fixes from the scenario tests (2026-10-31)

**Answers checked by play.** `scenarios.mjs --verify` forces each turn-1 choice of our lead and plays the battle out (fast AI both sides, 400 seeds, score = win rate + 0.1 x Vitality lead). Two scenarios above were wrong: re-using Trick Room here refreshes it rather than ending it (so "don't undo our own Trick Room" was no rule), and the "set Trick Room" position was lost whatever we chose (Close Combat can't touch the Spirit foe). Both replaced: "set Trick Room when slower" with a winnable team, and "don't Trick Room when faster". All 10 now pass `--verify`, several by small margins (priority KO -2.9 vs Protect -3.3; switch 106.6 vs 106.2).

**Fast AI** (`ai.js`, `ai.rs`):
- Protect's "it would be knocked out" bonus (310, the largest weight) no longer counts a foe the user can knock out before that foe moves (priority, or faster; Trick Room reverses Speed).
- New switch rule, "lost matchup": the foes knock it out this turn, its matchup is below the switch threshold and a bench character's matchup is positive. Before, a switch needed a matchup gain of 1.43, which almost never happens.
- Scenarios: 80% to 100%. Strength against the old AI (frozen v2 = the AI before this change), 4,000 mirror battles x 2 seeds: won 46.5% / 46.8%, lost 47.6% / 47.3%, the same as mirror against itself (46.9% / 46.9%). So it fixes the two mistakes without changing overall strength.
- Rust's v1 opponent reuses `options()` with the v1 weights, so the new rules are switched off there (ai-v1.js doesn't have them). The search parity check caught this.

**Search AI** (`mcts.js`, `mcts.rs`): its playouts no longer play 1 in 3 foes as greedy (now the current AI 2 in 3, frozen v1 1 in 3). In "set Trick Room", Protect + Swords Dance wins 100% against greedy and 3% against the current AI, so greedy playouts pulled the search to plays that only beat a foe who never protects or sets up.
- Search vs the fast AI, 240 mirror battles (4 seeds x 60, same battles): 86.7% to 90.4% (±4).
- Scenarios at 128 playouts (12 seeds each, corrected set): 88% to 91%; 1,024 playouts 95%. The rest of the misses are "set Trick Room" (5/12), where Trick Room beats Earth Power by 12.8 to 10.8 in play: too close for 128 playouts to separate. Tried and dropped: common random numbers across pairs (no change in scenarios) and mirror-only playouts (85%).

## AI gaps #2 and #3: hidden builds (2026-10-31)

`--hidden` (CLI and Rust; batch `opts.hidden`): each side's battle AI sees the foes' builds only as its draft guessed them (the same `guessBuilds`; with `--builds`, the book build), not their real moves, stats, item and ability. A move a foe has been seen using replaces a guessed one, and an item it has used up shows as it is. Abilities stay hidden even after they show (shortcut). The search AI's playouts then also play the future out against the guessed builds (`opts.assume`), the usual trick for hidden-information games. Off by default, so earlier numbers are unchanged; JS and Rust identical with and without it (batch, no draft, search).

- **Fast AI, hidden vs full info** (`bench.mjs hidden`, 4,000 mirror battles x 2 seeds, rule-based builds): won 44.6% / 44.3%, lost 49.6% / 50.1%, against an even 46.9 / 46.9. Knowing the foes' exact builds is worth about 5 points to the fast AI.
- **Search AI, hidden vs full info** (both sides search, 128 playouts, 200 mirror battles, rule-based builds): won 32%, lost 66%. Knowing exact builds is worth about 34 points to the search: much of its strength came from playing the future out against the true builds. Check: given the true builds as its "guess", the hidden search plays even (44 won, 54 lost of 100), so the gap is the information, not a bug.
- **Meta with the 4 averaged books, hidden vs full** (Rust, 200k draft battles x 2 seeds): picked win rate rank corr 0.993 (the same as two seeds of either), mean change 0.6 points, same top 10 (Demon Emperor Lelouch, Pain, Hogyoku Aizen, Lelouch, Ultra Instinct Goku first). Biggest moves: Doma +4.8, Makima +3.9, Kizaru +2.9; Gojo -2.1, Meliodas -2.0. Seed-to-seed median difference 0.5.
- **Why the meta barely moves:** with books every character always plays its book build, so the guess is right (exactly with one book, nearly with 4 near-identical fits). Hidden builds will matter where builds vary: in the build search, a candidate build is still fully known to the foes (`--optimize` doesn't use `--hidden`), so surprise builds (Choice items, speed and counter spreads) are still under-rated there. Not checked: the search AI with books under `--hidden`.

## Hidden builds, the two leftovers (2026-10-31)

**Abilities show once they act.** Under `--hidden` a foe's guessed ability is replaced by its real one once it shows: an entry effect, an immunity or absorb, a reaction to a hit (on either side), an end-of-turn, knockout or low-Vitality effect. Silent damage multipliers still don't show. JS and Rust identical (300 draft + 300 no-draft hidden batches, 200 draft, search with hidden). New mechanics test: a Fire absorber is seen as "None" until it absorbs a Fire hit.

**Build search with `--hidden`** (`--optimize ... --hidden`): the foes see each candidate build as the build they'd expect (the book's, or the plain one), so a surprise build can win battles by surprise. 12 top characters, 800 battles per option, 2 passes, 4 books, against the 100k meta field, seeds 5 and 6:

| same pick in both runs (of 12) | ability | training | item |
|---|---|---|---|
| full info, seed 5 vs seed 6 | 8 | 5 | 4 |
| hidden, seed 5 vs seed 6 | 8 | 3 | 3 |
| full vs hidden, same seed | 6 / 9 | 6 / 5 | 3 / 3 |

Full vs hidden differ no more than two seeds of the same mode, so at this size the build search's item and training picks are mostly noise and the hidden-build effect is too small to see. Average gain 6.3 / 5.0 full, 5.6 / 3.6 hidden. Picks that agreed in all 4 runs: Lelouch Zero Requiem + Focus Seal, Pain Preta Path + wallPhys + Clear Amulet. Fixed on the way: the build search crashed in its second pass when the first pass picked a tuned "speed" spread (that spread was then retrained under a preset name that doesn't exist); it now keeps the tuned spread when trying movesets.

## AI gap #4: the draft counts abilities (2026-10-31)

The draft's quick matchups (`draft.js matchups`, `draft.rs`) now count entry stat changes (Intimidate and the like: the user's own entry boosts and the foe's entry drops, as stages) and flat stat multipliers, on top of type immunities. Damage multipliers are still ignored, because they showed no gap (below).

Measure: 100k comp draft battles with the 4 books (so each character has a fixed ability), 2 seeds. For each character, pick rate (made the 6 when brought) against picked win rate; the residual is how much more a character wins when picked than a straight-line fit on its pick rate predicts. A positive residual = under-picked for how well it does.

| group (book-fit1 ability) | before, seeds 1 / 2 | after, seeds 1 / 2 |
|---|---|---|
| Intimidate users (5) | +9.6 / +10.0, picked 79% | +8.5 / +7.9, picked 86% |
| other entry stat changes or stat multipliers (15) | -0.2 / -0.3 | -0.6 / -0.1 |
| context-free damage multipliers (23) | +0.4 / +0.4 | +0.6 / +0.5 |
| no such ability (214) | -0.3 / -0.3 | -0.2 / -0.2 |

- Ainz 60% to 82% picked, Sailor Moon 74% to 82%, Gilgamesh 62% to 67%, on both seeds; their picked win rates held (56-57%, 65-67%, 51-53%), so the extra picks were deserved. All Might and Gear 5 Luffy were already picked about 100%. Overall rank corr of pick rate vs picked win rate unchanged (0.645 / 0.641).
- The Intimidate residual stays positive, but with only 5 characters (2 at a 100% pick rate) the fit can't say how much of it is still the draft.
- Damage multipliers (Kaido's kind) show no gap, so they're left out. Not checked: rule-based builds (without books), where abilities are random per build.

## AI gap #5: item audit (2026-10-31)

What each of the 18 items does in battle, and whether the fast AI (`ai.js` / `ai.rs`) accounted for it before and after. The search AI plays its playouts in the real engine, so it always felt every item (it already got the Last Thread scenario 12/12).

| Item | In battle | Fast AI before | Fast AI now |
|---|---|---|---|
| Last Thread | survives one hit at full Vitality | **counted a KO through it** | KO checks see it hang on (single hits; multi-hit gets through). Sturdy too, same rule |
| Iron Gauntlet, Focus Seal, Swift Sandals | stat x1.5, locked into one move | in damage and Speed; lock respected; switches out of a weak lock | same |
| Overdrive Core | attacks x1.3, 1/10 Vitality per hit | damage only, **cost ignored** | cost counted like recoil |
| Bento Box | heals 1/16 a turn | not scored | not scored (small, steady) |
| Rice Ball | heals 1/4 once below half | not scored | not scored |
| Battle Coat | Will x1.5, no status moves | in damage; status moves blocked | same |
| Ward Charm | halves one super effective hit | in damage | same |
| Type Emblem | its type x1.2 | in damage | same |
| Hooded Cloak | blocks chance effects of foes' moves | **still valued status, flinch, drops into it** | worth nothing into it |
| Clear Amulet | foes can't lower its stats | **still valued drops into it** | worth nothing (attacks and status moves) |
| Calm Incense | cures Taunt or Encore once | **still valued Taunt/Encore into it** | worth the small floor |
| Panacea Leaf | cures a status once | **still valued status into it** | worth nothing until used |
| Counterstrike Policy | +2 Power and Energy when hit super effectively | **ignored** | a super effective hit that doesn't KO costs 16 (the AI's value of giving a foe +4 stages) |
| Spiked Armor | contact attackers lose 1/6 | **ignored** | contact into it costs like recoil |
| Escape Scroll | switches out after a hit | not scored | not scored (rare, needs a guess of who comes in) |
| Field Anchor | own fields and screens last 8 | not scored | not scored (small) |

Hidden builds: with `--hidden` all of this uses the item the side believes the foe holds (the guess, until used up).

Tests:
- New scenario "KO the foe without a Last Thread" (two equal foes, either KO'd by Fire Punch, one holds a Last Thread; `--verify`: Fire Punch the other 28.7 vs 9.2). Fast AI 11/20 before, 20/20 after; search 12/12. All 11 scenarios: fast 100%, search 92% at 128 playouts (misses are the known Trick Room and Protect ones).
- Strength, 4,000 mirror battles x 2 seeds against frozen v2 (the AI before the scenario fixes; run before the small Calm Incense / Encore line was added): won 47.0% / 47.3%, lost 47.2% / 47.1% (before the item changes 46.5 / 46.8 won, 47.6 / 47.3 lost). Mirror 47.1 / 46.9 each way. So no measurable change in overall strength: these are rare situations, fixed one by one.
- JS and Rust identical (200 comp draft; 300 comp with AI-trained items and draft; 300 comp hidden; 6 search battles). The Rust v1 bot keeps the old rules, as ai-v1.js does.

## AI gap #7: the fast AI predicts the foe (2026-10-31)

Each side now works out what each foe will most likely do before scoring its own options (`predict` in ai.js / ai.rs: the foe's best option by the same scoring, without noise or switching, once per side per turn; doubles only). Two uses: an attack into a foe expected to Protect keeps 20% of its score (`W.predictProtect` 0.8, unless the move gets through Protect), and Protect's "would be knocked out" bonus only counts foes expected to attack. The AI before this is frozen as `bots/ai-v3.js`.

**Strength** (`bench.mjs strength`-style mirror matches, 4,000 battles a seed for the weight, 2,000 for the rest):

| new AI vs | seed 1 won / lost | seed 2 won / lost | before (current AI then) |
|---|---|---|---|
| v3 (the AI before), `predictProtect` 0 | 46.8 / 47.5 | 46.8 / 47.2 | (even) |
| v3, 0.5 | 51.2 / 43.2 | 50.5 / 43.5 | |
| v3, **0.8 (kept)** | 53.4 / 41.4 | 52.7 / 41.3 | |
| v3, 1.0 | 53.3 / 41.3 | 53.0 / 41.0 | |
| v3, 0.8 without the Protect-bonus part | 52.9 / 41.8 | 52.2 / 42.1 | |
| v2 | 52.5 / 42.1 | 52.4 / 41.6 | 47.0 / 47.2 |
| greedy | 61.3 / 35.5 | 62.3 / 34.5 | 63.4 / 33.5, 65.3 / 31.6 |

So it beats the AI-like opponents (v2, v3) by about 11 points net on both seeds, and loses about 2.5 points against greedy, which never protects (predicting a Protect that never comes costs a little). Scenarios: new "Hit the foe that won't Protect" (the weak foe at 15% has Protect and is threatened, the healthy one has none; `--verify` ok at 1,600 playouts: Fire Punch the healthy foe 107.1 vs the weak one 102.6): fast 0/20 before, 17/20 after; the other 11 stay 20/20. Search AI (4 seeds, 128 playouts) 4/4 on it, 92% overall (the known Trick Room miss).

**Fast vs search agreement** (the gap's test: archetype results under both AIs within about 8 points). Two 200k meta chains (seeds 1, 2, comp, bring 8, Vitality x3, every form, archetype rounds), each final round robin replayed by the fast AI (40k battles, new `--recheck ... --ai=fast`) and by the search AI (4k battles, 128 playouts, about 450 games a team, so ±5 points per team):

| | archetype mean gap | largest | within 8 of 11 | meta teams mean gap |
|---|---|---|---|---|
| seed 1, before | 6.5 | 18 (Fire field) | 9 | 4.2 |
| seed 1, after | 5.9 | 21 (Fire field) | 10 | 3.8 |
| seed 2, before | 6.5 | 20 (Water field) | 8 | 5.2 |
| seed 2, after | 7.6 | 16 (Snow) | 7 | 6.3 |

**Not passed:** prediction makes the fast AI stronger but doesn't bring it closer to the search AI on archetypes. The big gaps are field teams (Fire field 18-21 points better under search on seed 1, Water field 8-20 worse on both), so the remaining gap looks like how the fast AI plays fields, not Protect.

## AI gap #8: switching scored like a move (2026-10-31)

The fast AI's switch is now one more option on the moves' scale instead of a rule of thumb (BALANCE.md section 6: the damage the incoming character takes instead, a knockout avoided or walked into at 73.7, 100 x its better next-turn hit, minus a cost of 40). It goes through noise and the joint side plan like a move, and the search AI no longer adds a second copy of it. The replacement after a faint is unchanged. JS and Rust identical.

**What tuning showed** (mirror matches against v3, the AI before #7; #7 alone was 53.4 / 41.4 won / lost):

| switching | won / lost, seed 1 | seed 2 |
|---|---|---|
| old rule (#7 alone) | 53.4 / 41.4 | 52.7 / 41.3 |
| scored, Protect-sized knockout save (455), cost 15 | 46.7 / 48.0 | 47.5 / 48.0 |
| scored, knockout save 73.7, cost 40 (**kept**) | 55.0 / 39.1 | 54.7 / 39.7 |
| scored, cost 70 | 55.3 / 38.3 | 54.0 / 40.6 |
| **never switch** | 55.9 / 38.1 | |

So the old rule was costing about 3 points, and the kept version is about as good as never switching. It switches about as often as v3 (6.3 character entries a battle, counting replacements). Against v2 it gets 53.9 / 40.1 and 54.0 / 40.5 (with #7 alone, 52.5 / 42.1). Against greedy it gets 62.6 / 34.5 and 62.0 / 34.5 (with #7 alone, 61.3 / 35.5).

**Scenarios:** "Switch out of a lost matchup" now fails (0/20, it Protects). `--verify` rates switch vs Protect there as a near tie (107.8 vs 107.2 at 1,600 playouts), so the old forced switch wasn't clearly right either. Overall the fast AI gets 11/12.

**Fast vs search** (same two meta round robins as #7): the archetype mean gap is 6.9 on seed 1 and 6.5 on seed 2 (#7: 5.9 and 7.6; before: 6.5 and 6.5). The largest gap is still Fire field (21) on seed 1 and Snow (15) on seed 2. **Not passed:** switching isn't what separates the two AIs. The persistent gap is on field teams (Fire field 18-21 points better under search on seed 1 in all three versions).
