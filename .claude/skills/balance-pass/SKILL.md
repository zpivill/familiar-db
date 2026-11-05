---
name: balance-pass
description: Run a Familiar balance pass - measure the competitive meta with the Rust sim, find characters that are outliers for their tier in every view, test 2-3 canon-fitting fixes per outlier on a scratch copy, and bring r a table of options with a lean. Use when r asks for a "balance pass", to check the meta after a change, or to find and test fixes for over- or under-powered characters.
---

# Balance pass

One agent, four steps: **measure, find outliers, test options, report.** Nothing about a character is committed until r picks an option.

Read first: `CLAUDE.md`, `docs/BALANCE.md` (sections 1, 2, 8, 10-13) and the latest entries in `docs/balance-history.md`.

## Rules that always hold

- **Never commit a change to a character's stats, moves or abilities without r.** Test on scratch copies (below). After r picks, make that one change in its own PR.
- **Canon.** Every option must fit the character: name the scene or trait. Gags are the only exception.
- **Tiers.** Judge each character against the median of its own tier (`rarity`), never across tiers. First-routers must never be pushed toward pseudo or legendary strength; niche builds are fine.
- **Repeat or ignore.** A result counts only if it repeats on 2+ seeds or fits. Archetype gaps under ~15 points are noise.
- **Abilities (r, 2026-11-05):** a catch rolls one of the two normal abilities, the hidden one is rare, an item can change it. Competitive players end up with the best one, so **judge on the build books**, not on random-build runs.
- **Goal: no outliers** (r, 2026-11-05). Don't flatten the roster; only touch clear outliers.
- Keep r's attention small: one question at a time, options with a lean.

## 1. Measure (about 1 hour on 4 cores)

```sh
node sim/export.mjs
cd engine && cargo build --release
B=books/book-v2-fit1.json,books/book-v2-fit2.json   # current books (2026-11-05); see "Books" below
for s in 1 2 3 4 5; do
  ./target/release/familiar-sim 200000 comp $s --draft --hp=3 --forms=all --search=meta --arch --check=2000 --builds=$B --json=$SCRATCH/meta$s.json
done
```

From the 5 runs collect per character: top-team spots (of the 30 meta teams), win rate when picked, and the search AI's team win rates (`recheck`). Per archetype: search AI win rate per seed.

**Books.** Book fits go stale when the AI or data changes (check `git log` for `sim/`, `engine/src`, `data/` since the books' date). A full re-fit is ~80 min per fit on 4 cores, so run each fit as its own background task (the 2-hour task limit kills chained fits):

```sh
./target/release/familiar-sim 0 comp 1 --draft --hp=3 --forms=all --optimize=$SCRATCH/meta1.json --per=2000 --json=$SCRATCH/book1.json
```

## 2. Find outliers

An outlier must show up in **both**:

1. **Book strength:** its best-build win rate (`best` in each book entry) is **8+ points above its tier's median** in every fit.
2. **Meta:** it holds many top-team spots across the 5 seeds with a strong win rate when picked.

Also flag characters 10+ points **below** their tier median if their tier should be viable (not first-route or gags).

For each outlier, find the lever: compare `tried.ability`, `tried.moves`, `tried.item` in the book. If one ability beats the others by 10+ points, the fix is usually that ability, not stats.

## 3. Test options (minutes each)

Write 2-3 options per outlier. Each must fit canon, and each should be a different kind of fix (smaller number, narrower trigger, one part removed).

Test on scratch copies, never in the repo:

1. **Data:** copy `engine/data.json`, edit the compiled ability ops (`immune`, `def`, `atk`, `allyFaint`, `faint`...) of every entrant with that ability, and save one file per option.
2. **New effects:** if an option needs an effect the engine lacks, copy `engine/` (Cargo.toml, Cargo.lock, src) to scratch, add a test-only op there and build it. Don't touch the repo's engine for a test.
3. **Measure each option** with a single-character fit (about 20 s per character per fit), against 2 different metas:

```sh
familiar-sim 0 comp 1 --draft --hp=3 --forms=all --optimize=$SCRATCH/meta1.json --per=2000 --only=lelouch/3,lelouch/2 --data=$SCRATCH/option.json --json=$SCRATCH/opt-1.json
```

First run it on the unchanged data and check it reproduces the book's `best` (it's deterministic), so you know the tool works.

4. **Confirm the lean** in team play: 3 seeds of the meta run with the option's data file and books re-fit for that character only (`--only`).

Target: the option brings the character within ~8 points of its tier median while keeping its identity (the ability should still be its best or near-best).

## 4. Report to r

One table per outlier: option, canon reason, best-build win rate in each fit, top-team spots before and after, and the lean. Then:

- Add the runs to `docs/balance-history.md`.
- Commit only docs and tooling; push to the session branch.
- After r picks: change the ability text in `data/characters.json` so `sim/compile.js` reads it (add a rule there and in `engine/src` if needed), run the checks below, and open one PR per decision.

## Checks before any push

```sh
node sim/test/mechanics.mjs                               # must print "all passed"
node engine/tests/parity.mjs 200 comp 3 --draft --hp=3    # after any sim/ or engine/ change: must say identical
```
