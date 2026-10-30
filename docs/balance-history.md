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
