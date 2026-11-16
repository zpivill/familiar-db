# TMs and HMs for Familiar (proposal)

**Status: proposal, 2026-11-15, re-checked on the refreshed books 2026-11-16. Nothing here is decided and nothing in `data/` has changed.** r decides; this doc brings options with a lean and numbers. The move lists live in [tm-hm-proposal.json](tm-hm-proposal.json) and are checked by `node sim/tm-check.mjs`.

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

## 1. The short version

- **Names:** TMs are **Patterns** (a sewing pattern: a template you cut from again and again). HMs become **Seam skills**: field techniques that use no move slot.
- **In-world reason:** a Pattern can only be stitched into a copy whose source data already holds that move. So a Pattern never teaches anything new, it surfaces something the character did in its anime. That is r's canon rule, with a reason inside the world.
- **Two readings:** a Pattern is a Warden's gift that "makes your familiar more itself". True: a more complete copy is a stronger anchor. Touches the Evolution and Wardens rows. Seam skills touch the device row.
- **Rules (lean):** reusable, one copy each; no TRs, no egg moves, no tutors at launch; free relearning from the device; four bands that pace power by city; never sold for money.
- **List:** 16 Patterns, all existing generic moves. Short on purpose: learnsets already hold almost every move that fits, so Thunderbolt, Flamethrower, Psychic and seven more had too few characters left to teach.
- **Who gets what:** Protect for everyone (see the open question). Every other Pattern is a hand-made canon list of 2 to 20 characters. The top quarter of each tier gets nothing else. 109 character-move pairs, plus Protect for the 133 characters who lack it.
- **Kept off Patterns for good:** Recover and other healing, Calm Mind and Nasty Plot, priority moves, strong spread moves, Tailwind, Fake Out, Follow Me, Protect-ignoring moves.
- **What the sim says:** every pair was screened on two seeds (they agree, correlation 0.81). The lists lift only weak-for-tier characters (Shinji, Nanami, Arima, Giyu, Vegeta) and no strong one; this held on the refreshed books (2026-11-16), after three pairs that no longer fit the rule were removed. The "kept off" moves do lift strong ones (Recover: +3.9 on Whitebeard). **The one risk found is universal Protect, which mostly helps bulky legendaries.**
- **Decisions needed from r:** section 10, one at a time.

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
- **Lean:** Familiar already has a stricter rule than Pokémon: off-type moves need a written canon reason and "coverage stays rare and lore-backed". So: **one universal Pattern (Protect), and every other Pattern is a hand-made canon list**, each pair passing the three tests in section 4. There is no "every Water type learns it" list.

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
3. **Not too strong.** Measured in section 9. In short: the top quarter of each tier gets nothing but Protect; a Pattern that lifts a character must lift one that is weak for its tier; and the doubles tools in section 6 stay off Patterns entirely.

## 5. The Pattern list

16 Patterns. All are generic moves already in `data/moves.json`; no new move was needed. Five are basic moves (no rename). "Learners" counts characters, not forms.

| # | Pattern | Type | What it is | Band | Where it comes from | Learners |
|---|---|---|---|---|---|---|
| P01 | Protect (basic) | Neutral | Blocks every move aimed at the user this turn. Likely to fail if used twice in a row. | 1 | Hawaii: handed over by the Swordsmith Village Keeper before your first duo battle. | everyone |
| P02 | Flip Turn | Water | Physical 60. The user switches out after hitting. | 1 | Reykjavík: the harbour-master's reward. 'Hit, then go out with the tide.' | 6 |
| P03 | Work Up | Neutral | Raises the user's Power and Energy by 1. | 1 | Reykjavík: sold at the Krusty Krab counter (gag). | 8 |
| P04 | Will-O-Wisp | Fire | Burns the target. | 1 | Hawaii: the forge master's reward. 'A blade is tested by the fire, not by the hammer.' | 6 |
| P05 | Rock Tomb | Earth | Physical 60. Lowers the target's Speed by 1. | 1 | Hawaii: found in Megumin's craters on the route. | 5 |
| P06 | Helping Hand (basic) | Neutral | Duos: the ally's move this turn does 1.5x damage. | 2 | Cape Town: the Biotope head keeper's reward. 'Nothing in here hunts alone.' | 20 |
| P07 | Substitute | Neutral | Spends 1/4 of max Vitality on a decoy that takes hits for the user. | 2 | Akihabara: Kith's old terminals. A decoy render: a copy of a copy. | 9 |
| P08 | Iron Head | Tech | Physical 80. 30% chance to make the target flinch. | 2 | Akihabara: the streamer Warden's reward, handed over live on stream. | 4 |
| P09 | Ice Beam | Ice | Energy 90. 10% chance to Freeze. | 2 | Reykjavík: the far side of the Northern Plateau, reached once you can cross water. | 3 |
| P10 | Light Screen | Light | Halves Energy damage to the user's team for 5 turns. | 3 | Kyoto: the shrine priestess's reward. A ward, in the old sense of the word. | 5 |
| P11 | Shadow Ball | Spirit | Energy 80. 20% chance to lower the target's Will by 1. | 3 | Kyoto: a job reward at Spirits and Such on the route. | 4 |
| P12 | Swords Dance (basic) | Neutral | Raises the user's Power by 2. | 3 | Kyoto: taught on the Seireitei training grounds. | 10 |
| P13 | Taunt | Dark | The target can only use attacking moves for 3 turns. | 3 | Prague: the aristocrat Warden's reward. 'Every Warden before you was a guard.' | 10 |
| P14 | Rest (basic) | Neutral | Fully heals the user and cures its status, then it Sleeps for 2 turns. | 3 | Prague: with a coffee at Anteiku. | 7 |
| P15 | Trick Room | Time | Field for 5 turns: slower characters move first. | 4 | The summit road, near the core. | 5 |
| P16 | Close Combat (basic) | Neutral | Physical 120. Lowers the user's Guard and Will by 1. | 4 | The summit road: a prize from the Circle's sparring hall. | 7 |

**Why so few.** Pokémon has 50 to 229 TMs. Familiar's learnsets were written move by move from canon, so almost every character already has the type moves that fit it. A 100-move list would be 90% empty. Thunderbolt and Flamethrower were dropped for that reason: only two characters each passed all three tests. Psychic was dropped after testing left it with one (Pucci). Seven more (Surf, Waterfall, Air Slash, Dark Pulse, Night Slash, X-Scissor, Earth Power) had nobody left to teach. What Patterns can add is narrow and worth having: Protect for everyone, a few tools and setup moves where canon backs them, and one missing move for characters who are weak for their tier.

**Wind, Beast, Blood, Cosmic and (apart from Trick Room) Time have no attack Pattern.** Their characters are covered. Cosmic is meant to be rare and strong, so leaving it out is on purpose.

**Pacing check.** Band 1 is Protect, a 60-power pivot, a 60-power Speed drop, Burn and +1/+1 setup. No first-route character gets more than that before City 3. The only 120-power Pattern arrives on the summit road.

## 6. Moves that should stay off Patterns

These are the moves Pokémon keeps off its wide TM lists, or learned to. Each was put on a few strong and weak characters in a scratch copy and screened (section 9.2 explains the number: team win-rate points, same battles with and without the move, two seeds).

| Move | Kind of risk | What the sim showed | Verdict |
|---|---|---|---|
| Recover (and Slack Off, Roost, Shore Up, Moonlight, Morning Sun) | Recovery | **All 9 testers gained** (mean +1.7): Whitebeard +3.9, Madara +2.5, Kaido +2.1, Frieza +1.8, Gyomei +1.1. The biggest effect of anything tested. | Never a Pattern |
| Rest, given to everyone without a heal | Recovery | Mean +0.5 over 188 forms; 23 repeat gains, led by Whitebeard +3.2, Giyu +2.3, Kaido +1.7, Vergil +1.7, Muzan +1.7, Asta (form 3) +1.3, Zero +1.2. | Not universal: a 7-character canon list |
| Calm Mind, Nasty Plot | Setup | Frieza +1.4, Tatsumaki +1.1 on both seeds. Removing Calm Mind was also the only thing that moved Pain and Aizen (2026-10-30). | Never a Pattern |
| Extreme Speed (and other priority) | Priority | Mean +1.1 over 8. Saitama +2.2 on both seeds; Kenpachi +1.6 and Gon (form 3) +1.3 on average. | Never a Pattern |
| Earthquake (strong spread moves) | Spread | Saitama +2.1, Kaido +1.1. | Never a Pattern |
| Tailwind | Speed control | All Might +1.7 on both seeds (the best post-mid getting better). The other six lost value: the fast AI spends the turn badly. | Never a Pattern |
| Fake Out | Doubles tool | Small: Zebra +1.0, All Might +0.8, Mahito +0.7. | Never a Pattern (judgment, see below) |
| Follow Me | Redirection | Nobody gained (mean -1.1). | Never a Pattern (judgment) |
| Hyperspace Fury (hits through Protect) | Protect-ignoring | Gon (form 3) +1.1, others flat. | Never a Pattern |
| Helping Hand, given to everyone | Doubles tool | Mean -2.6 over 169 forms: under this AI nobody is better off carrying it. | Not universal: a canon list (identity, not balance) |
| Trick Room, Wide Guard, Encore, sleep moves, Blood Pact / Shift Gear / Belly Drum, hazards, field setters | Tools that define a character's job | Not screened (Trick Room is the exception: see the Trick Room Pattern and 9.5). | Stay in learnsets |

**Where the sim backs the rule and where it is judgment.** Recovery, setup, priority and strong spread moves show up clearly, on both seeds, and help strong characters most. Fake Out, Follow Me and Helping Hand do not show a risk in this sim. BALANCE.md section 11 says why: the fast AI plays combo plans poorly, and Redirection scores 8 to 20 points worse under the search AI. So the sim can't clear them. They stay off Patterns because every Pokémon generation kept Fake Out and Follow Me off TMs (they are level-up or egg moves), and because here they are what gives Sanemi, Takemichi, Mumen Rider, Gintoki, Spike and Kazuma their jobs.

## 7. Compatibility: who can and cannot learn each Pattern

Generated from [tm-hm-proposal.json](tm-hm-proposal.json) by `node sim/tm-check.mjs --md`. "Can" names the scene or trait (test 2). "Cannot" lists the characters a player would expect to see, with the reason: **Canon** (the anime says no), **Near-copy** or **Already built in** (test 1), or **Balance** (test 3, section 9). A character on no list simply has nothing in its anime that fits. A later form keeps what an earlier form could learn.

#### P01 Protect (Neutral, status), band 1

Basic move (no rename needed). Doubles is built around it, and only 40 of 175 characters have it today. *Source:* Hawaii: handed over by the Swordsmith Village Keeper before your first duo battle.

**Can:** everyone who does not already have it (133 characters).


#### P02 Flip Turn (Water, physical 60), band 1

Water, 60 power, the user switches out. No character has it yet. Teaches switching in City 1. *Source:* Reykjavík: the harbour-master's reward. 'Hit, then go out with the tide.'

| Can | Why |
|---|---|
| Giyu | Ninth Form: Splashing Water Flow, Turbulent: footwork that never stays where it lands. (Third Form is already his Aqua Step.) |
| Tanjiro | Ninth Form: Splashing Water Flow, Turbulent, used in the drum house against Kyogai. |
| Murata | Survives every mission by striking once and falling back. |
| Catch the rainbow | Steps away across the raindrops held in the air (Rain Walker). |
| SpongeBob | Jellyfishing hit-and-run (gag). |
| Nessie | Surfaces, strikes and is gone before the photo is taken (Blurry Photo). |

| Cannot | Why |
|---|---|
| Poseidon | Canon: never takes a step back from Sasaki. Balance: already a top legendary. |
| Patrick | Canon: does not move. |

#### P03 Work Up (Neutral, status), band 1

Neutral, raises Power and Energy by 1. The classic first setup move. *Source:* Reykjavík: sold at the Krusty Krab counter (gag).

| Can | Why |
|---|---|
| Natsu | 'I'm all fired up!' before every fight. |
| Bakugo | Builds up sweat and temper as a fight goes on. |
| Yamcha | Psyches himself up before the Wolf Fang Fist. |
| Konohamaru | Will of Fire speeches before he charges in. |
| Mr. Satan | Plays to the crowd until he believes it himself. |
| Axel Blaze | Hot-blooded striker firing himself up (gag). |
| Koby | Shouts down his own fear at Marineford. |
| Mark Evans | Tyre training and a shout to the team (gag). |

| Cannot | Why |
|---|---|
| Megumin | Canon: every skill point goes into Explosion. She learns no Pattern except Protect. |
| Mob | Balance: on the refreshed books (2026-11-16) Mob ???% is in the top quarter of mid tier. |

#### P04 Will-O-Wisp (Fire, status), band 1

Fire, burns the target (halves its physical damage). A tool, not power. *Source:* Hawaii: the forge master's reward. 'A blade is tested by the fire, not by the hammer.'

| Can | Why |
|---|---|
| Natsu | Fire Dragon's flames cling and keep burning. |
| Todoroki | His left side sets whatever he touches alight. |
| Akainu | Magma that keeps burning through what it hits (Ace, Whitebeard). |
| Hanako-kun | Off-type (Fire): his Hakujoudai are hitodama, ghost fires. |
| Jiraiya | Toad Oil Flame Bullet sticks and burns. |
| Soma | Flambé at the stove (cooking flames). |

| Cannot | Why |
|---|---|
| Tanjiro | Canon: Breathing-style flames are an image, not real fire. |
| Rengoku | Canon: same, his flames don't burn. |
| Megumin | Canon: Explosion only. |
| Escanor | Balance: top of his tier; Cruel Sun already burns. |
| Tsuna | Balance: top pseudo. His Sky flames harmonise, they don't burn. |

#### P05 Rock Tomb (Earth, physical 60), band 1

Earth, 60 power, lowers the target's Speed by 1. Only Mineta has it. *Source:* Hawaii: found in Megumin's craters on the route.

| Can | Why |
|---|---|
| Hashirama | Wood Style binds and pins his target in place. |
| Patrick | Drops his rock on you (gag). |
| Onoki | Earth Style: Added-Weight Rock makes the target heavy and slow. |
| Gilgamesh | Enkidu, the Chains of Heaven, pin the target down. |
| Rudo | Buries the target under animated scrap. |

| Cannot | Why |
|---|---|
| Hanami | Near-copy: Hanami already has Bulldoze. |
| Whitebeard | Near-copy: already has Bulldoze. Balance: top legendary. |
| Nijika | Near-copy: already has Bulldoze. |
| Gyomei | Balance: top quarter of his tier. |

#### P06 Helping Hand (Neutral, status), band 2

Basic doubles support (ally's move does 1.5x). Team players only, not everyone: see the tests. *Source:* Cape Town: the Biotope head keeper's reward. 'Nothing in here hunts alone.'

| Can | Why |
|---|---|
| Tanjiro | Carries Zenitsu and Inosuke through every fight and calls their openings. |
| Deku | Calls plays for Class 1-A; a hero who reaches out a hand. |
| Nami | The navigator calling the crew's moves. |
| Senku | Fights by powering up the Kingdom of Science's fighters, never himself. |
| Mark Evans | The captain: lifts the whole team (gag). |
| Axel Blaze | Fire Tornado off a teammate's pass (gag). |
| Shawn Frost | The defender who feeds the strikers (gag). |
| Cole Palmer | Assists (gag). |
| Ryo Yamada | The bassist holds the band's rhythm (gag). |
| Asuna | 'Switch!' Calls swaps for Kirito and leads the raid as vice-commander. |
| Emilia | Backs her allies with spirit arts while Puck does the hitting. |
| Koby | His shout stops the Marineford war and steadies the men around him. |
| Hinata | The ultimate decoy: draws the blockers so the ace scores. |
| Kazuma | A party leader who wins through his party's skills. |
| Rengoku | 'Set your heart ablaze': fires up the juniors on the Mugen Train. |
| Nanami | The mentor who sets up Itadori's hits. |
| Jiraiya | Teacher of Minato, Nagato and Naruto. |
| Darkness | A crusader who takes the hits so the party can act. |
| Mikasa | Covers Eren and the squad. |
| Kakashi | The bell test: teamwork above all. |

| Cannot | Why |
|---|---|
| All Might | Balance: best post-mid, and the ally boost on I Am Here! is already his edge (2026-11-07). |
| Lelouch | Balance: the top character in the game. |
| Tsuna | Balance: top pseudo; Sky Harmony already protects allies. |
| Sailor Moon | Balance: top legendary support. |
| Zenitsu | Canon: runs and cries; he only fights asleep and alone. |
| Megumin | Canon: Explosion only. |

#### P07 Substitute (Neutral, status), band 2

Neutral, spends 1/4 Vitality on a decoy. Clone, proxy and stand-in users only. *Source:* Akihabara: Kith's old terminals. A decoy render: a copy of a copy.

| Can | Why |
|---|---|
| Kon | A mod soul in a plushie: the body is the decoy. |
| Minato | Shadow clones and marked kunai left behind. |
| Jiraiya | Substitution jutsu, and his toads take hits for him. |
| Light Yagami | Mikami and Misa act as Kira in his place. |
| Johan | Never acts himself: others do it for him. |
| Makima | Her contract passes her wounds on to someone else. |
| Conan | Sleeping Kogoro is his stand-in for every deduction. |
| Doraemon | Decoy gadgets from the 4D pocket (gag). |
| Rimuru | Replication: a clone of himself (used against the Orc Lord). |

| Cannot | Why |
|---|---|
| Itachi | Already built in: Crow Clone is his ability. |
| Kurumi | Already built in: Past Selves is her ability. |
| Sasuke | Balance: top quarter of his tier. |
| Goku | Balance: Ultra Instinct Goku is the 4th best character (the afterimage would fit). |
| Lelouch | Balance: top character (Sayoko as his double would fit). |
| Aizen | Balance: top legendary (Kyoka Suigetsu would fit). |

#### P08 Iron Head (Tech, physical 80), band 2

Tech, physical, 80 power, 30% flinch. A plain physical Tech hit for Tech characters who only have beams. *Source:* Akihabara: the streamer Warden's reward, handed over live on stream.

| Can | Why |
|---|---|
| Homura | Swings a golf club before she has her guns (tested as an option 2026-10-30). |
| Shinji | Unit-01's Progressive Knife. |
| Doraemon | His famous stone-hard head (gag). |
| Guts | Off-type (Tech): the Dragonslayer, 'a heap of raw iron'. |

| Cannot | Why |
|---|---|
| Luffy | Balance: Gear 5 is a strong pseudo (Armament hardening would fit). |
| Misaka | Balance: best mid; her Tech is magnetism, not blows. |

#### P09 Ice Beam (Ice, energy 90), band 2

Ice, energy, 90 power. Ice coverage is the classic way counters disappear, so the list is short. *Source:* Reykjavík: the far side of the Northern Plateau, reached once you can cross water.

| Can | Why |
|---|---|
| Brook | Soul Solid's chill from the underworld: Song of Scratches, Blizzard Slice. |
| Rudeus (from form 2) | Off-type (Ice): Ice Smash and Frost Nova, his everyday spells. |
| Kazuma | Off-type (Ice): Freeze, usually after Create Water. |

| Cannot | Why |
|---|---|
| Tsuna | Balance: top pseudo, and he has Freeze-Dry. |
| Shawn Frost | Canon: his ice is one shot, his signature. |
| Aqua | Canon: holy water only. |
| Juvia | Canon: Juvia only makes ice together with Gray. |
| Fern | Canon: she fights with the one basic attack spell, fast. |
| Rimuru | Balance: on the refreshed books Demon Lord Rimuru is above the middle of his tier and gained +1.1 on both seeds (Icicle Lance would fit). |

#### P10 Light Screen (Light, status), band 3

Light, cuts Energy damage to the team for 5 turns. Barrier casters only. *Source:* Kyoto: the shrine priestess's reward. A ward, in the old sense of the word.

| Can | Why |
|---|---|
| Fern | Standard defensive magic, the hexagon barrier every mage learns. |
| Shinji | The A.T. Field. |
| Aqua | Her blessings and holy barriers. |
| Doraemon | Barrier Point gadget (gag). |
| Homura | Her weapon is a shield. |

| Cannot | Why |
|---|---|
| Rukia | Balance: Bankai Rukia is a top pseudo (Bakudo #81 Danku would fit). |
| Itachi | Balance: top quarter of his tier (the Yata Mirror would fit). |
| Misaka | Balance: best mid (her iron-sand shield would fit). |
| Gojo | Already built in: Infinity is his ability. Balance: top legendary. |
| Tatsumaki | Already built in: Esper Barrier is her ability. |
| Mob | Balance: on the refreshed books (2026-11-16) Mob ???% is in the top quarter of mid tier. |

#### P11 Shadow Ball (Spirit, energy 80), band 3

Spirit, energy, 80 power. For Spirit casters who only have Hex. *Source:* Kyoto: a job reward at Spirits and Such on the route.

| Can | Why |
|---|---|
| Yuta | Yuta pours Rika's cursed energy into a blast. |
| Shinji | Unit-01's cross-shaped blast. |
| Brook | Soul fire thrown from his blade. |
| Emilia | Lesser spirits gathered into a shot (with Puck). |

| Cannot | Why |
|---|---|
| Yamamoto | Balance: above the middle of his tier; his Spirit side is a blade. |
| Mahito | Balance: best mythical. |
| Ichigo | Near-copy of his signature Getsuga Tensho. |

#### P12 Swords Dance (Neutral, status), band 3

Basic move, raises Power by 2. Setup is the strongest thing in the sim, so only blade users who are not already top picks. *Source:* Kyoto: taught on the Seireitei training grounds.

| Can | Why |
|---|---|
| Murata | Water Breathing drills, like every Corps swordsman. |
| Inosuke | Beast Breathing with two chipped blades. |
| Brook | A fencer: Three-Verse Humming, Arrow-Notch Slash. |
| Sunraku | Dual-blade builds and buff stacking are his whole game. |
| Guts | Swinging a too-big sword since he was a child. |
| Toga | Knife fighter. |
| Sanemi | Wind Hashira swordsmanship. |
| Arima | IXA and Narukami: the CCG's undefeated quinque swordsman. |
| Shirou (from form 2) | Trace On: projects the blade and the skill of whoever wielded it. |
| Inuyasha (from form 2) | Tessaiga. |

| Cannot | Why |
|---|---|
| Levi | Balance: a meta regular (Speed 140) who would get setup on top. |
| Mikasa | Balance: top of mid tier. |
| Kizaru | Balance: second-best mythical (his light sword would fit). |
| Darkness | Balance: best first-router by 12 points. Canon: can't hit a thing anyway. |
| Dante | Balance: top quarter of his tier. |
| Rukia | Canon: Sode no Shirayuki's dances are Ice techniques, not swordplay. |

#### P13 Taunt (Dark, status), band 3

Dark, the target can only attack for 3 turns. Shuts down supports, so trash-talkers who are not top picks. *Source:* Prague: the aristocrat Warden's reward. 'Every Warden before you was a guard.'

| Can | Why |
|---|---|
| Bakugo | 'DIE!' at friend and foe alike. |
| Inosuke | Challenges everything he meets to a fight. |
| Hisoka | Goads strong opponents so they ripen. |
| Vegeta | Saiyan pride: mocks every opponent before the fight. |
| Jinx | Graffiti, laughter and 'Boo!'. |
| Frieza | Polite, vicious mockery on Namek. |
| Gold Ship | Trolls everyone (gag). |
| Aqua | Provokes the undead and Kazuma alike. |
| Sukuna | 'Know your place, fool.' |
| Kon | A plushie with a big mouth. |

| Cannot | Why |
|---|---|
| Dio | Balance: top third of legendaries ('You approach me?' would fit). |
| Mahito | Balance: best mythical. |
| Escanor | Balance: top of his tier ('Who decided that?' would fit). |
| Kenpachi | Balance: top of his tier. |
| Gintoki | Balance: top pseudo. |

#### P14 Rest (Neutral, status), band 3

Basic move: full heal, then 2 turns asleep. Tested as a near-universal Pattern first: it gave recovery to top legendaries (Whitebeard +3.2, Kaido +1.7 team points, both seeds), so it is a short canon list of weak-for-tier sleepers instead. *Source:* Prague: with a coffee at Anteiku.

| Can | Why |
|---|---|
| Ace | Narcolepsy: falls asleep mid-meal and mid-sentence. |
| Sunthorn Phu | Wine and Verse: sleeps it off (gag). |
| Shinji | Lies on his bed with the SDAT player until it passes. |
| Aqua | Sleeps in after every night out. |
| Kazuma | A shut-in who sleeps all day when he can. |
| Gold Ship | Naps wherever she likes (gag). |
| Nanami | 'I hate overtime.' Clocks off. |

| Cannot | Why |
|---|---|
| Whitebeard | Balance: top legendary, and Rest was his biggest gain in the tests. |
| Kaido | Balance: +1.7 in the tests (sleeping off the drink would fit). |
| Frieren | Balance: top quarter of her tier (sleeping until noon would fit). |
| Nessie | Near-copy: already has Slack Off. |
| Doraemon | Near-copy: already has Recover (naps in the closet would fit). |
| Luffy | Near-copy: already has Recover. |
| Megumin | Canon: Explosion only (she collapses instead). |
| Ainz Ooal Gown | Canon: the undead don't sleep. |

#### P15 Trick Room (Time, status), band 4

Time, slower characters move first for 5 turns. Trick Room is weak because its setters are fast legendaries; these are slower ones. *Source:* The summit road, near the core.

| Can | Why |
|---|---|
| Takemichi | Leaps back to change the order of events. |
| Jotaro | Star Platinum: The World. He moves while nobody else can. |
| Kurumi | Zafkiel's Second Bullet slows time for whoever it hits. |
| Adam Smasher | A military Sandevistan: everyone else stands still. |
| Yhwach | The Almighty rewrites what happens next. |

| Cannot | Why |
|---|---|
| Pucci | Canon: Made in Heaven speeds time up, the opposite. |
| Minato | Canon: he is simply the fastest. |
| David Martinez | Canon: his Sandevistan speeds only him up, which is his signature. |

#### P16 Close Combat (Neutral, physical 120), band 4

Basic move: Neutral, 120 power, lowers the user's Guard and Will. For martial artists stuck on Mega Punch. *Source:* The summit road: a prize from the Circle's sparring hall.

| Can | Why |
|---|---|
| Vegeta | A martial artist first: the brawls with Goku and Jiren. |
| Yuta | Yuta's hand-to-hand, trained by Maki. |
| Nezuko | Her frenzied kicks against Daki. |
| Sanji | Black Leg Style, kicks only. |
| Yoruichi (from form 2) | Hakuda master. |
| Natsu | Fairy Tail's brawler. |
| David Martinez | Gorilla Arms. |

| Cannot | Why |
|---|---|
| All Might | Balance: best post-mid. |
| Seiya | Near-copy: already has Double-Edge (Neutral, physical, 120). |
| Toriko | Balance: top of mid tier. |
| Killua | Canon: an assassin's single strikes, not brawling. |
| Mr. Satan | Near-copy: the World Champion already has Double-Edge (Neutral, physical, 120). |

## 8. Field techniques (the HM replacement)

Working name: **Seam skills.** Six of them, one per Warden badge, each tied to that city's two types. They are **not battle moves**, take **no move slot**, and can't be forgotten because there is nothing to forget. Any familiar in your party of the right type can do it, so the player picks who, and sees their own character do it (pillar 3).

| # | Seam skill | Like | Unlocked by | Who can do it | What it does | What it opens |
|---|---|---|---|---|---|---|
| 1 | Crossing | Surf | Reykjavík badge | Water or Ice | A Water familiar carries you over water; an Ice one freezes a path | The canals of Water 7, the lagoon, the far side of the Northern Plateau |
| 2 | Smelt | Rock Smash / Cut | Hawaii badge | Fire or Earth | Fire melts cooled lava crust; Earth breaks or moves boulders | Fire Mountain's upper paths, the sealed forges, shortcuts on the crater route |
| 3 | Updraft | Fly | Cape Town badge | Wind familiars that fly in canon, or Beast familiars big enough to ride | Fast travel between arenas you have beaten; rides the updrafts on Table Mountain | Skypiea, fast travel |
| 4 | Jack-in | Flash, as a key | Akihabara badge | Lightning or Tech | Powers dead terminals, doors and lifts | Kith's old server floors, the GeoFront, powered doors in earlier cities |
| 5 | Lantern | Flash | Kyoto badge | Light or Spirit | Lights dark places; shows hidden paths, spirits and seams | The Bone-Eater's Well, hidden shrine paths, dark caves on earlier routes |
| 6 | Slip | Dive / Strength | Prague badge | Dark or Blood | Passes shadowed seams and the red mist that turns others back | The Infinity Castle's shifting rooms, the way down toward each city's Knot (sealed until the post-game) |

**Compatibility is by type, with canon exceptions.** A character of the right type can do it unless its anime says otherwise:

| Seam skill | Cannot | Why |
|---|---|---|
| Crossing | Hanako-kun | Bound to his toilet (gag) |
| Crossing | Patrick | Does not move (gag) |
| Crossing | Catch the Rainbow | Only walks on rain while it is raining |
| Smelt | Megumin | She can clear the rock, the path and the mountain; the Ward forbids it (gag) |
| Smelt | Sun Breathing Tanjiro, Rengoku | Breathing-style flames are an image, not real fire |
| Smelt | Darkness | Can't hit a thing |
| Updraft | Recruit Deku | Can't fly until Dark Deku (Float) |
| Updraft | Kita, Sunthorn Phu, Konohamaru | Wind types who don't fly |
| Updraft | Nami | Not until Zeus (form 2) |
| Updraft | Levi, Mikasa | ODM gear needs something to hook on to |
| Updraft | Usagi, Kon | Beast types too small to ride |
| Jack-in | Zenitsu | Faints first |
| Jack-in | Melting Bocchi | Melts first |
| Lantern | Darkness | Light type by faith only; she gives off no light |
| Lantern | Light Yagami | Light in name only (gag) |
| Slip | Hinata | Blood type for stamina only; afraid of the dark (gag) |
| Slip | Soma | A cook |

**What Pokémon's HM problems teach, and how this avoids them:**

- *The HM slave.* Solved: no slot is used.
- *Getting stranded.* The reason HMs couldn't be forgotten. Solved: each city's Frays hold that city's two types (decided 2026-11-04 for City 1), so a familiar who can do the city's Seam skill is always catchable right there.
- *Type variety.* A soft push to keep a mixed party: a mono-type team will meet doors it can't open yet. Lean: only optional areas need a type the player may lack; the main path needs only the skill of the city you are in.
- *Battle balance.* None: they are not moves. Surf stays a normal learnset move for the seven characters who have it.

**Order matters for one thing:** Updraft is fast travel, and it arrives at City 3 of 6, about where Pokémon gives Fly.

## 9. Test results

Nothing in `data/` changed. Every test ran on a scratch copy of `data/`, `sim/` and `engine/src` outside the repo (`node sim/tm-check.mjs --patch=<dir>` writes the patched `characters.json`).

### 9.1 Setting and baseline

Rust sim, `comp --draft --hp=3 --forms=all`, bring 8, the 4 averaged books (`engine/books/book-fit1..4.json`). Baseline: plain 300k batches on seeds 1 and 2, and six 200k meta chains with archetype rounds (seeds 51 to 56) as the field for build searches. "Picked" is win rate when the draft picked the character, pooled over the two plain seeds.

Baseline picked win rate, by tier (best and worst final forms), used for test 3:

| Tier | Strong for tier (get only Protect) | Weak for tier (where Patterns go) |
|---|---|---|
| Legendary | Pain 78, Aizen 74, Sailor Moon 66, Gojo 65, Poseidon 64, Whitebeard 63 | Blackbeard 39, Pucci 39, Homura 39, Arima 40.5, Frieza 43 |
| Mythical | Mahito 58, Kizaru 52 | Vergil chair 37, Toga 38, Hanako-kun 39, Reborn 41, Doraemon 41, Akainu 42 |
| Pseudo (final forms) | Demon Emperor Lelouch 86, UI Goku 70, Gintoki 67, Jin-woo 64, Asta 64 | Shinra 52 |
| Post-mid | All Might 62, Tatsumaki 60, Kenpachi 60, Escanor 59, Shanks 58.5 | Shinji 45, Megumin 48, Vegeta 48, Jiraiya 49, Yuta 49.5 |
| Mid | Misaka 56, Toriko 54, Yami 54, Mikasa 53 | Takemichi 41, Nanami 42.5, Shirou 43, Giyu 44, Jinx 45 |
| Pre-mid | Metro Man 52, Juvia 50 | Kita 39, Conan 39, Sunthorn Phu 40, Sunny 41 |
| First-route | Darkness 55 (next best 43) | Mineta 33.5, Konohamaru 37, Soma 37.5 |

### 9.2 Screening every pair (the main evidence)

**Method.** A book fixes a character's 4 moves, so an added move is never used unless something puts it in the build. For each character-move pair, the screen takes the character's book build and makes four variants, each with one move swapped for the new one. The character joins the meta teams of three chains and plays 1,000 battles per variant, **the same battles** (same teammates, opponents and luck) as the unchanged build. The number reported is *best variant minus unchanged build*, in team win-rate points, averaged over two book builds. It ran twice: seed 1 against chains 51 to 53, seed 2 against chains 54 to 56.

- 722 pairs (every proposed pair in every form, the "stay off" demo pairs, and Helping Hand on everyone).
- **The two seeds agree: correlation 0.81 over all pairs.**
- The scale is small on purpose: the character is one of eight in the team and is not always picked. A build's worst move swapped for nothing useful costs 2 to 7 points; the best single addition found anywhere was +3.9 (Recover on Whitebeard). Read +1 on both seeds as "real but small", +2 as "clear".
- Picking the best of four variants adds about +0.5 to +1 of upward bias, so a pair under +1 is "no measurable effect".
- This mode is a small addition to the scratch engine only (`--tmscreen`). It is not in the repo.

**What repeated on both seeds, proposed Patterns only:**

| Pattern | Pairs screened (forms) | Mean | Gains of +1 or more on both seeds |
|---|---|---|---|
| Protect, everyone | 189 | -0.1 | Ainz +2.9, Saitama +2.4, Whitebeard +2.4, Kaido +1.7, Vergil +1.6, Muzan +1.5, Yhwach +1.4, Deku (form 2) +1.4. **Seven of eight are legendaries.** |
| All the other 16 Patterns | 149 | -0.4 | Shinji +2.2 (Shadow Ball), +2.1 (Iron Head), +1.5 (Rest); Giyu +1.9 (Flip Turn); Frieza +1.7 (Taunt); Mob (form 2) +1.3 (Psychic); Nanami +1.3 (Rest) |

Read this as: **the hand-made lists do what they were built to do.** The only characters they lift measurably are weak for their tier (Shinji, Giyu, Frieza, Nanami), plus Mob, who is mid-table. No strong character gains from any list. Most pairs are flat: for most characters a Pattern is flavour and an option, not power.

By Pattern, the rest: Flip Turn mean +0.6 (8 forms), Will-O-Wisp +0.8 (Todoroki +1.9 and Natsu +1.3 on average, not on both seeds), Rock Tomb +0.8 (Hashirama form 2 +1.6 average), Substitute +0.5, Iron Head +0.9, Ice Beam +0.2, Light Screen -0.3 (Aqua +1.3 average), Shadow Ball +0.8, Swords Dance -0.5 (Shirou form 2 +1.6, Arima and Sanemi +0.9; Guts form 1 and Inuyasha lose 2 if they take it), Taunt +0.5, Work Up -0.5, Psychic +1.0, Trick Room +0.2, Close Combat +0.4, Helping Hand (the 20 listed) -3: nobody is better off for carrying it under this AI.

**Changes made to the proposal because of the screen:**

- **Rest** started as "everyone without a healing move". It gave recovery to top legendaries (Whitebeard +3.2), so it is now a 7-character canon list.
- **Ainz** was on Psychic. He sits at the legendary median and gained +1.8 on both seeds, so he is off.
- The "stay off" list in section 6 is these numbers.

### 9.3 Universal Protect

The biggest single choice in the proposal, and the first balance session challenged it ("it changes the whole format; lacking Protect is part of how frail supports are kept in check").

- Screen, by tier (mean gain): legendary **+0.9**, starter +0.4, mythical +0.2, first-route -0.1, pre-mid, mid, post-mid and pseudo all about -0.3. Only 8 of 189 forms gain +1 on both seeds, 7 of them legendaries. Juvia (the Water field setter) -0.3: no gain.
- In the re-fit (9.4), both fits chose Protect for Ainz, Yhwach, Boros, Whitebeard, Frieza, Kizaru, Enel, Blackbeard and Muzan, one fit each for Saitama, Kaido and Poseidon.
- So in this sim universal Protect is **not** a format-wide shift for the story cast. It is a buff to bulky legendaries, who have a spare move slot and enough Vitality to use the free turn.
- Caveat: the fast AI may under-use Protect on frail characters, and the full test (every book re-fitted with Protect, then meta chains under the search AI) was not run. It costs about 2 hours and should wait for the refreshed books.

Options for r are in section 10.

### 9.4 Confirmation: re-fit against a control, then plain batches

**Method.** All 17 Patterns applied to a scratch copy. 49 characters re-fitted (every screen gain of +0.8 or more, plus the characters the proposal hopes to help): 2 fits, `--optimize --only=... --per=2000`, each against 3 chains, with the book's movesets and their one-swap Pattern variants added to the build search's candidates (scratch engine only; without that, the search only tries the 6 movesets it draws most and rarely sees a Pattern). A **control** re-fit of the same characters on unchanged data, same seeds, same extra candidates minus the Patterns. Then plain 300k batches on seeds 1 and 2 for each.

**What it showed first: this method is too noisy for single characters, above all legendaries.**

- The 208 characters that were not re-fitted moved 0.55 points (rms) between the two runs, 1.8 at most. That is the floor.
- But re-fitted characters moved a lot **with no Pattern in their build**: Vergil +4.2, Adam Smasher +3.3, Emilia +2.5, Dio -4.3.
- The control alone moved legendaries far from the 4-book baseline with nothing changed: Ainz 53.7 to 44.6, Frieza 42.6 to 53.7, Kaido 53.6 to 61.9, Poseidon 64.3 to 71.7. BALANCE.md says a re-fit moves a character about 3 points; with 2 fits instead of 4, and for legendaries (one slot per team, so they compete with each other), it is 5 to 13.
- So: **differences under about 4 points for ordinary characters and 10 for legendaries are noise here.** Both seeds agree with each other almost exactly in every row, because both replay the same two fits; that agreement is not evidence.

**What is big enough to read:**

| Character | Tier | Control | With Patterns | Change | Took |
|---|---|---|---|---|---|
| Shirou (form 2) | mid | 47.6 (rank 120) | 54.0 (rank 55) | **+6.4** | Swords Dance, both fits (screen +1.6) |
| Arima | legendary | 40.3 (rank 215) | 51.2 (rank 83) | **+10.9** | Swords Dance, both fits (screen +0.9) |
| Ainz | legendary | 44.6 | 57.6 | +13.0 (+3.9 against the 4-book baseline) | Protect, both fits (screen +2.9) |
| Yhwach | legendary | 50.4 | 57.3 | +6.9 | Protect, both fits (screen +1.4) |
| Boros | legendary | 53.6 | 59.3 | +5.7 | Protect, both fits (screen +0.9) |
| Nanami | mid | 47.3 | 50.2 | +2.9 | Rest / Helping Hand (screen +1.3) |
| Giyu | mid | 44.4 | 46.9 | +2.4 | Flip Turn, both fits (screen +1.9) |
| Whitebeard | legendary | 62.8 (rank 11) | 65.2 (rank 7) | +2.3 | Protect, both fits (screen +2.4) |

- **Swords Dance on Shirou and Arima is the one clear "Pattern helps a weak character" result.** Arima goes from a bottom-five legendary to the middle. Shirou goes from below the mid median to the top quarter of mid, which is further than test 3 wants: see section 10.
- **Protect on legendaries is real** (screen and re-fit agree for Ainz, Yhwach, Whitebeard), and is the one place the proposal makes strong characters stronger.
- Giyu and Nanami: small, in the right direction, agree with the screen.
- Everything else is inside the noise, including the drops (Kaido, Poseidon, Dio, Natsu, Tanjiro): their fits simply landed on different builds. Shinji, the screen's best case, came out at -0.9: not confirmed, not refuted.

### 9.5 Trick Room and the other archetypes

Trick Room is "structurally weak: its setters are fast, four of six are legendary or mythical" (BALANCE.md section 12). The Trick Room Pattern adds Takemichi (mid, Speed 65) and Jotaro (mid, Speed 85) as setters, plus Kurumi, Adam Smasher and Yhwach. Archetype teams' win rate in each chain's final round robin, fast AI, six chains (seeds 51 to 56), baseline against all 17 Patterns applied:

| Archetype | Baseline (6 chains) | With Patterns (6 chains) |
|---|---|---|
| Trick Room | 21.1 (14 to 31) | 28.3 (21 to 49) |
| Water field | 23.1 (17 to 33) | 31.8 (23 to 45) |
| Intimidate + Fake Out balance | 37.5 (33 to 42) | 43.5 (30 to 53) |
| Lightning field | 18.0 | 22.5 |
| Tailwind offense | 35.3 | 38.0 |
| Fire field | 24.6 | 27.0 |
| Snow | 25.4 | 26.2 |
| Spread offense | 17.6 | 18.6 |
| Screens + setup | 29.2 | 28.8 |
| Redirection + setup | 23.6 | 22.6 |
| Gravity | 21.4 | 20.5 |
| All archetypes | 25.2 | 28.0 |

- **Nothing here passes the 15-point line**, and one archetype's chains swing 8 to 12 points on their own, so this is "no archetype was hurt", not "Trick Room is fixed".
- Trick Room's +7 leans on one chain at 49. Of the new setters only Yhwach made a Trick Room team (once); the teams still used Doraemon, Obito, Ainz and Homura. So the gain can't be put down to P16. Takemichi and Jotaro did not make a team: they are too weak to be picked as setters whatever they carry.
- Fast AI only. The first balance session's advice stands: judge Trick Room with `--check=2000` (search AI) on 4 or more seeds, on the new books.
- Light Screen added Fern, Shinji, Aqua, Doraemon, Homura and Mob to the Screens setters; Screens did not move.

### 9.6 "Stay off" moves under the full method

Recover, Calm Mind, Fake Out, Tailwind, Extreme Speed, Earthquake and Hyperspace Fury were put on 8 characters (Whitebeard, Kaido, Tatsumaki, Frieza, All Might, Levi, Saitama, Gon form 3), re-fitted the same way and played against the same control:

| Character | Control | With the moves | Change | Took (fit A / fit B) |
|---|---|---|---|---|
| Frieza | 53.7 | 59.5 | +5.7 | Calm Mind / Calm Mind |
| Tatsumaki | 59.9 (rank 20) | 64.3 (rank 10) | +4.4 | Calm Mind / Calm Mind |
| Kaido | 61.9 | 66.1 | +4.2 | Recover / Recover |
| All Might | 62.6 (rank 13) | 64.2 (rank 11) | +1.6 | Extreme Speed / Fake Out |
| Gon (form 3) | 57.8 | 59.0 | +1.2 | Hyperspace Fury and Extreme Speed / the same |
| Levi | 54.8 | 55.4 | +0.6 | Fake Out / none |
| Whitebeard | 62.8 | 58.5 | -4.3 | Recover / Recover |
| Saitama | 61.1 | 55.2 | -5.9 | Extreme Speed / Extreme Speed and Earthquake |

- **Every fit took the new move when offered** (15 of 16 builds). The build search wants these moves.
- The plain-batch changes are inside this method's noise for legendaries (9.4), in both directions, so they neither add to nor take from the screen. Tatsumaki, who is not a legendary, is the cleanest row: the second-best post-mid gains 4.4 from Calm Mind and enters the top 10.
- Tailwind was never chosen, though the screen gave All Might +1.7 for it: Extreme Speed and Fake Out were better still.

### 9.7 Re-check on the refreshed books (2026-11-16)

The first balance session refreshed the 4 build books (r approved; branch `claude/brave-hopper-8k4ufi`, commit 75edf16). The ranking moved: Frieza 42.6 to 53.2, Kaido 53.6 to 59.5, Shirou (form 2) 43.0 to 49.9, Pain 78.3 to 73.0, Sailor Moon 65.5 to 59.9. So the baseline and the screen were run again on the new books: plain 300k batches on seeds 1 and 2, six new chains (seeds 61 to 66), and the paired screen on 193 pairs (every non-Protect pair, and Protect on legendaries, mythicals and Juvia).

- **The screen holds up.** The two seeds agree at 0.78, and old books against new agree at 0.86 over the same pairs.
- **Still lifting weak-for-tier characters, +1 or more on both seeds:** Nanami +2.5 (Rest), Arima +1.7 (Swords Dance), Vegeta form 3 +1.7 (Taunt), Shinji +1.6 (Iron Head) and +1.4 (Shadow Ball), Soma +1.6 and Natsu +1.1 (Will-O-Wisp), Hisoka +1.2 (Taunt).
- **No longer repeating:** Giyu's Flip Turn (+1.2 / +0.5), Frieza's Taunt (+0.7 / +0.2; he is no longer weak), Shirou's Swords Dance (+1.0 / -0.4).
- **Protect on legendaries is smaller but still there:** mean +0.2 over 44 legendaries and mythicals. Ainz +1.9 and Kaido +1.6 repeat (Kaido is now rank 22); Whitebeard's and Saitama's gains do not. Juvia still gains nothing.
- **Three pairs broke the rule on the new ranking and were removed:** Mob ???% is now 5th in mid tier, so Mob came off Work Up, Light Screen and Psychic; Demon Lord Rimuru is now above the middle of post-mid and gained +1.1 from Ice Beam on both seeds, so he came off Ice Beam. That left Psychic with one learner, so **Psychic is no longer a Pattern** (17 became 16). Sections 9.2 to 9.6 describe the 17-Pattern draft as it was tested.
- This is the rule working as intended: the principle stays, the lists follow the ranking.

### 9.8 What these tests can't say

- **The screen is a lower bound.** It swaps one move into a build that was fitted without it, so it answers "is this move better than the build's fourth move", not "what is the best build now". Setup, Substitute, Rest and Trick Room can pay off more once the spread, item or partner change with them. "No strong character gains" is therefore safest for attacks and weakest for those four. Before any list is final, re-fit its 3 to 5 strongest learners against several control fits (the first balance session's challenge).
- **Which number carries each claim:** the paired screen. Giyu's Flip Turn is "+1.9 on both seeds"; his +2.4 after a re-fit is inside that method's noise and proves nothing on its own. Only Shirou and Arima are large enough to read from the re-fit.
- **The Trick Room Pattern is untested in practice,** not shown to help: Takemichi and Jotaro never made a Trick Room team.
- **Universal Protect was measured in a world built without it.** The AI's weights, its guess at when a foe will Protect, the draft and the books were all tuned while 191 of 257 forms had no Protect. With everything re-fitted the effect could be larger than the screen shows.
- **The lists follow the ranking, and the ranking will move** with the new books and with any nerf r accepts (Lelouch, Pain). The rule is the principle (top quarter of a tier gets nothing extra; a lift must go to a weak-for-tier character). The "Balance" rows in section 7 should be re-derived after each balance patch.
- **The fast AI under-rates pivots and combo plans.** It scores a switch-out move's switch at +4, or +18 under threat, so Flip Turn is under-rated; Helping Hand, Follow Me, Fake Out and Trick Room are played simply (BALANCE.md section 11). No search-AI run was done here.
- **Only the screen was re-run on the refreshed books** (9.7). The re-fit table in 9.4, the demo in 9.6 and the archetype chains in 9.5 are on the old books.
- **The second balance session's roster scan did not reach this doc.** My message to it was blocked by a permission rule and its results had not arrived when this was written. The strong and weak lists in 9.1 are from my own two batches; if the scan disagrees, the "Balance" rows in section 7 are the ones to revisit.
- **Story balance is untested.** The sim plays level-50 doubles. Whether a 60-power Pattern is right for City 1 is a design judgment taken from how Pokémon paces TMs.

## 10. Open questions for r

One at a time, in this order. Each has options and a lean.

**Q1. Who gets Protect?**
- A. Everyone (the Pokémon rule).
- B. Everyone except legendaries and mythicals. **(lean)** In the tests Protect did nothing measurable for the story cast and lifted bulky legendaries (Ainz, Saitama, Whitebeard, Kaido, Yhwach). In-world it fits: the story already says your Threads "can't hold that much data" for a legendary.
- C. Only characters with a guard or barrier in canon who are weak for their tier (the first balance session's suggestion). Safest, but doubles without Protect on most of the cast stays as it is today.
- The first balance session argues for C: the tests ran with an AI and books tuned in a world without Protect, so the real effect of A or B may be larger than measured.
- Either way: re-check on the refreshed books, with every book re-fitted and under the search AI, before it is final.

**Q2. Reusable Patterns, one copy each?** Lean yes. The other option is Scarlet and Violet's: single-use, crafted from stray drops.

**Q3. Seam skills with no move slot, usable by any party familiar of the right type?** Lean yes. The other option is Pokémon's old HMs (a move in a slot that can't be forgotten).

**Q4. The names.** Pattern (lean), Spool or Swatch. Seam skills (lean), Shuttles or Crossings.

**Q5. Is 16 Patterns the right size?** Lean yes: more would be lists of two. If r wants more, the honest way is new generic moves, which is a bigger job than this proposal.

**Q6. Swords Dance on Shirou.** On the old books a re-fit took him from below the middle of mid tier to its top quarter (+6.4). On the refreshed books he already sits mid-table (49.9) and the paired gain no longer repeats (+1.0 / -0.4). Lean: keep him on the list.

**Q7. Free relearning from the device anywhere, or only at Akihabara's terminals as part of Re-threading?** Lean anywhere: locking it until City 4 punishes experimenting in the first half of the game.

**Q8. Where each Pattern comes from** (section 5, last column) is a first sketch written to fit each city's Warden. It belongs to the city pages when each city is built; nothing depends on it yet.

**Not asked, but flagged:** Megumin learns nothing but Protect (canon: every skill point goes into Explosion). If r dislikes a character being shut out, she is the one to change.
