# TMs and HMs for Familiar (proposal)

**Status: proposal, 2026-11-15. Nothing here is decided and nothing in `data/` has changed.** r decides; this doc brings options with a lean and numbers. The move lists live in [tm-hm-proposal.json](tm-hm-proposal.json) and are checked by `node sim/tm-check.mjs`.

Familiar's Gameplay page already says "a fixed list of moves learned at set levels, plus TMs. No daycare and no breeding." This doc proposes what "plus TMs" means: the rules, the names, the move list, who can learn what, and what the sim says it does to balance.

## Contents

1. [The short version](#1-the-short-version)
2. [How Pokémon did it, and the lean for Familiar](#2-how-pokémon-did-it-and-the-lean-for-familiar)
3. [The system proposed for Familiar](#3-the-system-proposed-for-familiar)
4. [The three tests every character-move pair must pass](#4-the-three-tests-every-character-move-pair-must-pass)
5. [The Pattern list](#5-the-pattern-list)
6. [Moves that should stay off Patterns](#6-moves-that-should-stay-off-patterns)
7. [Compatibility: who can and cannot learn each Pattern](#7-compatibility-who-can-and-cannot-learn-each-pattern)
8. [Field techniques (the HM replacement)](#8-field-techniques-the-hm-replacement)
9. [Test results](#9-test-results)
10. [Open questions for r](#10-open-questions-for-r)

---

## 2. How Pokémon did it, and the lean for Familiar

Each rule below says what the games did, what it does for balance and for the story, and the lean for Familiar. Facts were checked against Bulbapedia's TM, TR, HM and Field move pages.

### 2.1 Single-use or reusable TMs

| Games | Rule |
|---|---|
| Gen 1 to 4 (Red to Platinum) | Single-use. The best TMs exist once per save file. |
| Gen 5 to 7 (Black to Ultra Moon) | Reusable, forever. |
| Gen 8 (Sword and Shield) | TMs reusable; a second class, TRs, single-use (see 2.2). |
| Brilliant Diamond / Shining Pearl | Single-use again, but most can be bought or found again. |
| Gen 9 (Scarlet and Violet) | Single-use, but you craft more at a TM Machine from League Points and materials that wild Pokémon drop. |

- **Balance:** single-use doesn't make a strong move rarer in competitive play, it only makes it slower to get. In the story it does limit power: one Earthquake per run. Reusable TMs make trying a build free.
- **Story:** a single-use TM feels like treasure and is often never used ("too good to spend"). A reusable one is used at once.
- **Lean for Familiar: reusable, one copy of each.** Pillar 4 (depth to discover) needs cheap experiments, ranked play is planned, and the hard rule (no pay to win) means scarcity must never be something to sell. Getting each Pattern once, as a story reward, keeps the treasure feeling. The Scarlet and Violet model (craft from stray drops) is the runner-up: it feeds the Fray loop but adds grind.

### 2.2 TRs

Sword and Shield split the list in two: 100 reusable TMs with ordinary moves, and 100 single-use TRs with the strong ones (Earthquake, Swords Dance, Close Combat), farmed from raids. A TR move could be relearned for free afterwards.

- **Balance:** a soft gate on strong moves in the story, a grind tax in competitive play.
- **Lean: no second class.** Familiar's strong Patterns are gated by *where* they are (the summit road, band 4 below), not by being used up.

### 2.3 Move tutors and egg moves

- **Tutors** teach moves that are not TMs, at one place, for a price (shards, Battle Points, Armorite Ore). They hold the moves the designers want rare: the starters' ultimate moves, Draco Meteor (Dragon types only, high friendship), elemental punches, and in older games many doubles tools.
- **Egg moves** come only from breeding with the right parent. They are where most hidden, strong options lived (Fake Out on many Pokémon is an egg move).
- **Balance:** both are a second, narrower compatibility list. Their real job is to keep a move off the wide TM list while still giving it to a chosen few.
- **Lean: no egg moves** (r already ruled out breeding). **No tutors at launch.** A character who should get a rare tool gets it in its own learnset, decided with r like any balance change. If tutors are wanted later, the anime training spots (Cape Town's Attunement spots) are the natural home.

### 2.4 HMs and what replaced them

| Games | Rule |
|---|---|
| Gen 1 to 6 | HMs: Cut, Surf, Fly, Strength, Flash and more. Used in the field to pass obstacles, each one unlocked by a badge. They take a move slot and **can't be forgotten** (so a Pokémon can't strand you by forgetting Surf mid-lake) until you find the Move Deleter. |
| Gen 7 (Sun and Moon) | No HMs. **Poké Ride:** you call a ride Pokémon that is not in your party. |
| Let's Go | **Secret Techniques:** your partner learns them without using a move slot. |
| Sword and Shield | Flying Taxi and a bike that crosses water. |
| Brilliant Diamond / Shining Pearl | A phone app calls a wild Pokémon to do the HM. |
| Gen 9 | Your ride legendary gains abilities (dash, swim, glide, climb) as you beat the Titans. |

- **Balance:** HMs were mostly weak moves stuck in a slot forever, so players carried an "HM slave" instead of a sixth fighter. Every game since Gen 7 removed that cost.
- **Story:** the good part of HMs was never the move. It was the gate: a badge opens new places, and old places have doors you come back to.
- **Lean: keep the gate, drop the slot.** Six field techniques, one per Warden badge, used by any familiar in your party of the right type, with no move slot and nothing to forget (section 8). It is the Let's Go rule with Pokémon's old badge gating, and "anime made real" (pillar 3): your Water character really carries you across the canal.

### 2.5 How compatibility is decided

Pokémon uses four overlapping lists:

1. **Near-universal TMs** almost everything learns: Protect, Rest, Substitute, Facade, and for many years Toxic and Double Team. Only joke Pokémon (Magikarp, Ditto) are left out.
2. **By type:** almost every Water type learns Surf and Ice Beam; Normal types get very wide coverage.
3. **By body:** punches need fists, Fly needs wings, Cut needs claws or blades, Iron Tail needs a tail.
4. **By theme:** ghosts get Shadow Ball, psychics get Trick Room.

- **Balance:** the wide lists are where counters disappear. Ice Beam on every Water type means Water has an answer to Grass and Dragon everywhere. Gen 8 and 9 pulled back (Toxic went from near-universal to a short list).
- **Lean:** Familiar already has a stricter rule than Pokémon: off-type moves need a written canon reason and "coverage stays rare and lore-backed". So: **one universal Pattern (Protect), one near-universal (Rest), and every other Pattern is a hand-made canon list**, each pair passing the three tests in section 4. There is no "every Water type learns it" list.

### 2.6 Where TMs come from, and pacing

- **Gym leaders** hand over the TM of the move they just used on you. It teaches their lesson.
- **Shops** sell basics; the big department store sells mid-power moves mid-game.
- **Pickups and side areas** hold the rest. Strong moves (Earthquake, Ice Beam, Thunderbolt) sit late, behind HMs, or in the Game Corner and post-game shops.
- Scarlet and Violet: recipes unlock with badges, and the materials for strong TMs only drop from late-area Pokémon.

- **Balance and story:** TM placement is the main way the games pace power. Early TMs are 40 to 60 power or plain status; 90 power arrives mid-game; 100 and up arrives late.
- **Lean:** four bands tied to the six cities (section 5). **Band 1 holds no move over 60 power**, so an early Pattern can't hand a first-route character late-game power. Each Warden gives one Pattern that fits their city. Nothing is sold for real money.

### 2.7 Relearning moves

- Gen 2: none. Gen 3 to 7: a Move Reminder NPC, one Heart Scale per move, level-up moves only.
- Sword and Shield: free, in every Pokémon Center, and TR moves count once learned.
- Legends Arceus, Scarlet and Violet: from the menu, anywhere, free. TM moves count once learned.

- **Balance:** free relearning plus reusable TMs means a team can be rebuilt between any two battles. That is what competitive players want and it removes a "trap" (deleting a move by mistake).
- **Lean: free, from the device, anywhere outside battle.** Every level-up move and every Pattern the familiar has used before. In-world: the move is in the copy's data; the device only chooses which four threads are pulled tight. Re-threading (Akihabara) stays about stat spreads and abilities.

## 3. The system proposed for Familiar

Everything in this section is tagged `proposal`.

### 3.1 Names and the in-world reason

The world's central image is thread and fabric, so:

- **TMs are Patterns.** A sewing pattern is the template a piece is cut from, and you can cut from it again and again. Options: **Pattern** (lean), Spool, Swatch.
- **HMs are field techniques,** working name **Seam skills** (they let you travel the seams between cities). Options: Seam skills (lean), Shuttles (the tool that carries thread across a loom), Crossings.

**Why a Pattern works on some characters and not others:** Kith's tech rebuilds a character "from everything that exists about them". A Pattern is a clean cut of move data. The device can only stitch it into a copy whose own source already holds something like it. So a Pattern never teaches a familiar anything new: it surfaces something the character already did in its anime. That is the same rule as r's canon rule for moves, given a reason inside the world (pillar 3), and it is why compatibility lists are short.

**Why a learned Pattern keeps the character's own name:** the Pattern is the generic move ("Pattern 02: Flip Turn"). Once stitched in, it shows as the character's version with the generic name in brackets, like every other renamed move: "Third Form: Flowing Dance (Flip Turn)". Basic moves (Protect, Rest, Helping Hand, Swords Dance, Close Combat) keep their plain name.

### 3.2 Which rows of the two readings table it touches

Patterns touch **Evolution** and **Wardens and the League**. Field techniques touch **The device (Familiar)**. Both serve the hook: every reward quietly runs the machine.

| System | First reading | The truth | What the player does |
|---|---|---|---|
| Patterns | A Warden's reward: a technique their city is known for. "It will make your familiar more itself." | Every line is true. A Pattern fills in more of the copy from its source data, and a more complete copy is a stronger anchor. Wardens are told to give one to every Keeper strong enough to matter. | Stitch a Pattern into any familiar whose source holds that move. Reusable. |
| Field techniques | Device updates from the Ward after each badge, so your familiars can help you travel. | Each update opens the next stretch of seam to Keepers, in the order the pressure needs binding. The update notes say so, truthfully: "Keepers can now reach the Northern Plateau Fray." | Use a party familiar of the right type to cross water, melt rock, fly, power doors, light the dark, slip through mist. |

Clue planted (pillar 2): the Warden's line "it will make your familiar more itself" rereads as "it will tie it down harder".

### 3.3 The rules, in one list

1. **Reusable.** One copy of each Pattern per save, unlimited uses.
2. **No second class** (no TRs), **no egg moves, no tutors at launch.**
3. **Free relearning** from the device, anywhere outside battle: level-up moves and Patterns already used.
4. **A Pattern is one more option for the four open slots.** The signature stays fixed.
5. **Compatibility is by character and form,** hand-made, and passes the three tests in section 4. A later form keeps what an earlier form could learn.
6. **Four bands** pace power: band 1 (Reykjavík, Hawaii) has nothing over 60 power; band 2 (Cape Town, Akihabara) up to 90; band 3 (Kyoto, Prague) tools and setup; band 4 (the summit road) Time moves and the 120-power move.
7. **Never sold for money.** Rewards, pickups and in-game shops only.
8. **Field techniques use no move slot,** are unlocked by badges, and work with any party familiar of the right type. Each city's Frays hold that city's types, so the player can always find one.

## 4. The three tests every character-move pair must pass

1. **Not a copy.** The character must not have the move in any form, as a learnset move or signature, and must not have a near-copy: for attacks, same type and category, same role (single target or spread, priority, switches out, guaranteed stat drop) and power within 10; for status moves, the same job (raises the same stats, heals, the same status, the same screen or field). `node sim/tm-check.mjs` checks every pair and fails on the first two; it caught 15 pairs in the first draft (Killua's signature Narukami is Thunderbolt in all but name; Mr. Satan's Double-Edge already is a 120-power Neutral hit).
2. **Canon fit.** Name the scene or trait. No generic filler. Gags are the only exception, and are marked (gag).
3. **Not too strong.** Measured in section 9. In short: the top quarter of each tier gets nothing but Protect and Rest; a Pattern that lifts a character must lift one that is weak for its tier; and the doubles tools in section 6 stay off Patterns entirely.
