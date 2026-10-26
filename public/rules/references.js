// Quick-reference pages for each ruleset, in Lantern's own words: they summarise how the
// mechanics work at the table and are not taken from any publisher's text. For the full rules
// use your rulebooks — drop the PDFs into the Library and they become searchable.
// Written in Lantern's note format: # headings, **bold**, - lists, | tables |, > read-aloud boxes.

export const REFERENCES = {
  traveller: [
    { id: 'tasks', name: 'Task checks', text: `Roll **2D**, add the characteristic DM, the skill level and any other DMs. Meet or beat the difficulty to succeed.

| Difficulty | Target |
|---|---|
| Simple | 2+ |
| Easy | 4+ |
| Routine | 6+ |
| Average | 8+ |
| Difficult | 10+ |
| Very Difficult | 12+ |
| Formidable | 14+ |

**Effect** is your total minus the target. It tells you *how well* it went:

| Effect | Result |
|---|---|
| −6 or less | Exceptional failure |
| −2 to −5 | Failure |
| −1 | Marginal failure |
| 0 | Marginal success |
| +1 to +5 | Average success |
| +6 or more | Exceptional success |

**Boon:** roll 3D and keep the best two. **Bane:** roll 3D and keep the worst two. A boon and a bane cancel out.

**Untrained:** no level in the skill at all is DM −3. Jack-of-all-Trades reduces that penalty by its level. A level in *any* speciality of a skill counts as level 0 in its other specialities.` },
    { id: 'dms', name: 'Characteristic DMs', text: `| Characteristic | DM |
|---|---|
| 0 | −3 |
| 1–2 | −2 |
| 3–5 | −1 |
| 6–8 | +0 |
| 9–11 | +1 |
| 12–14 | +2 |
| 15+ | +3 |

DMs come from the **current** value, so damage to STR, DEX or END makes those checks harder.` },
    { id: 'combat', name: 'Combat in brief', text: `**Initiative:** 2D + the better of your DEX or INT DM. Highest acts first. (Lantern's combat tracker rolls this for you.)

**Attacking:** 2D + weapon skill + characteristic DM (usually DEX for guns, STR or DEX in melee) + range and situation DMs, against 8+. Lantern rolls attacks from the weapon list on your sheet.

**Damage** is the weapon's dice **plus the attack's Effect**, minus the target's armour.

**Taking damage:** it comes off **END** first. Once END is at 0, further damage reduces STR or DEX.
- END at 0: seriously wounded.
- END and one of STR or DEX at 0: unconscious.
- All three at 0: dead.

Your referee may run reactions, cover, autofire and range bands — check your core rules for the numbers.` },
    { id: 'psionics', name: 'Psionics', text: `Talents (Telepathy, Clairvoyance, Telekinesis, Awareness, Teleportation) are rolled like skills, with the **PSI** DM taken from your *current* PSI score.

- A successful power costs its PSI cost. A failed attempt costs 1 point.
- Spending more PSI than you have turns the excess into damage.
- Reaching further usually costs extra PSI.
- PSI comes back with rest.` },
  ],

  coc7: [
    { id: 'skill-rolls', name: 'Skill rolls & success levels', text: `Roll **percentile dice** (d100). Rolling **equal to or under** the skill or characteristic succeeds.

| Roll | Result |
|---|---|
| 01 | Critical success |
| ≤ one fifth of the value | Extreme success |
| ≤ half the value | Hard success |
| ≤ the value | Regular success |
| Over the value | Failure |
| 100 (or 96–100 if the value is under 50) | Fumble |

The Keeper may ask for a **Hard** or **Extreme** success when a task is especially difficult. Lantern's sheet has a *Needs* setting and shows the half and fifth values on every roll.` },
    { id: 'bonus-penalty', name: 'Bonus & penalty dice', text: `A **bonus die** means rolling an extra tens die and keeping the *better* (lower) result. A **penalty die** means keeping the *worse* (higher) one. One bonus and one penalty cancel out; at most two of either apply.

In Lantern, set the bonus/penalty on the sheet, or roll \`d100b1\` / \`d100p2\` in chat.` },
    { id: 'pushing', name: 'Pushing a roll', text: `After a failed skill roll you may **push** it: describe what extra effort or risk you're taking, then roll once more.

- You can't push combat rolls, Sanity rolls or Luck rolls.
- Failing a pushed roll lets the Keeper bring something genuinely bad down on you.

Lantern shows a **Push roll** button on your failed skill rolls.` },
    { id: 'luck', name: 'Luck', text: `**Luck rolls** are d100 against your Luck score, for things outside anyone's control.

Optionally, you may **spend Luck points** after a roll to lower the result one-for-one. You can't spend Luck on Luck, Sanity or damage rolls, or on a pushed roll. Luck returns slowly between sessions.` },
    { id: 'opposed', name: 'Opposed rolls', text: `Both sides roll and compare **success levels**. The higher level wins. If both get the same level, the side with the higher skill value wins.

In combat:
- **Fighting back:** ties go to the attacker.
- **Dodging:** ties go to the dodger.` },
    { id: 'combat', name: 'Combat in brief', text: `Act in **DEX order**, highest first. A character with a readied firearm counts as having +50 DEX for this. Lantern's tracker uses each combatant's DEX.

- **Melee:** the attacker rolls Fighting. The defender chooses to **Dodge** or **Fight Back**. Compare success levels.
- **Firearms:** you can't dodge bullets. Take cover instead.
- **Extreme success:** deals maximum damage. With an *impaling* weapon (blades, bullets) also roll the weapon's damage again and add it.

**Damage bonus & build** come from STR + SIZ:

| STR + SIZ | Damage bonus | Build |
|---|---|---|
| 2–64 | −2 | −2 |
| 65–84 | −1 | −1 |
| 85–124 | none | 0 |
| 125–164 | +1D4 | 1 |
| 165–204 | +1D6 | 2 |

**Hit points** = (CON + SIZ) ÷ 10, rounded down. Losing half your maximum or more from one wound is a **major wound**: roll CON or fall unconscious.` },
    { id: 'sanity', name: 'Sanity', text: `Starting Sanity equals POW. A **Sanity roll** is d100 against *current* Sanity. Losses are written success/failure, e.g. \`1/1D6\`.

- **Losing 5 or more in one go:** make an INT roll. On a *success* the horror sinks in and the investigator suffers temporary insanity. On a failure the mind protects itself and they carry on.
- **Losing a fifth or more of current Sanity in one day:** indefinite insanity.
- **Becoming insane:** triggers a bout of madness.

**Magic points** = POW ÷ 5.` },
  ],

  tftl: [
    { id: 'rolling', name: 'Rolling dice', text: `Build a **dice pool** of six-sided dice:

> Attribute + Skill + item bonus − 1 for each Condition

Every **6** is a success. One success is usually enough. Tough Trouble may need **two or three**, and extra successes can buy something extra.

In Lantern, the sheet works out the pool and rolls it (\`5d6s6\` in chat counts the 6s for you).` },
    { id: 'pushing', name: 'Pushing', text: `If a roll fails, you may **push** it: re-roll every die that isn't a 6. In exchange your Kid must take a **Condition**. Lantern's **Push roll** button re-rolls just the right dice and reminds you to mark the Condition.` },
    { id: 'conditions', name: 'Conditions', text: `| Condition | |
|---|---|
| Upset | −1 die |
| Scared | −1 die |
| Exhausted | −1 die |
| Injured | −1 die |
| Broken | When a Kid already has the other four and suffers another, they're Broken and can't succeed at anything until they get help. |

Conditions heal when the Kid gets to a safe place, such as their Anchor, or is cared for.` },
    { id: 'help', name: 'Help, items & Luck', text: `- **Help:** another Kid who helps adds a die to the roll.
- **Items:** useful items add bonus dice, as listed on the sheet. Your Iconic Item is the one you always have.
- **Luck:** a Kid has Luck Points equal to 15 minus their age. They let you re-roll a failed roll.
- **Pride:** check your core book for how it's used at your table.` },
    { id: 'trouble', name: 'Trouble', text: `The GM describes the **Trouble**, and the players say how their Kids tackle it. Each Kid rolls the skill that fits, and the GM sets how many successes are needed. Big moments at the end of a Mystery can be **extended Trouble**, where the whole group pools its successes.

Kids can't die in an ordinary Mystery. Failure means complications, Conditions and new problems.` },
  ],

  cpr: [
    { id: 'checks', name: 'Skill checks', text: `Roll **1d10 + STAT + skill** and beat the **DV** (difficulty value).

| Difficulty | DV |
|---|---|
| Simple | 9 |
| Everyday | 13 |
| Difficult | 15 |
| Professional | 17 |
| Heroic | 21 |
| Incredible | 24 |
| Legendary | 29 |

- **Critical success:** a natural 10. Roll another d10 and *add* it.
- **Critical failure:** a natural 1. Roll another d10 and *subtract* it.
- **Luck:** spend points to add to a roll before you make it.` },
    { id: 'combat', name: 'Combat in brief', text: `**Initiative:** 1d10 + REF.

**Seriously wounded** (below half HP): −2 to all actions. Lantern's sheet applies this for you.

**Critical Injury:** two or more 6s on a damage roll. Lantern flags it on the roll card.

**Armour:** damage must beat the armour's SP. When it does, the armour is ablated by 1.` },
  ],

  swade: [
    { id: 'traits', name: 'Trait rolls', text: `Roll the trait die. **Wild Cards** also roll a **Wild Die** (d6) and keep the higher. **4** is a success, and every 4 over that is a **raise**.

- **Aces:** a die showing its highest face is rolled again and added.
- **Snake eyes:** a Wild Card rolling 1 on both dice is a critical failure.
- **Unskilled:** d4 −2.
- **Wounds and Fatigue:** −1 each.

Lantern's sheet and the \`sw8\` chat roll do all of this.` },
    { id: 'combat', name: 'Combat in brief', text: `**Initiative:** dealt from the action deck each round. Highest card goes first, with suits breaking ties (♠ ♥ ♦ ♣). A **Joker** acts whenever they like, gets +2 to rolls and damage that round, and means the deck is reshuffled. Lantern's tracker deals the cards.

**Damage** against Toughness:
- Equal or higher: **Shaken**.
- Each raise: a **Wound**.

**Bennies:** re-roll a trait roll, or soak Wounds.

**Multi-action:** −2 for each extra action in a turn.` },
  ],
};

export const RULESET_INFO = {
  generic: { name: 'Generic', blurb: 'Any game — free-form sheets and named rolls.' },
  dnd5e: { name: 'D&D 5e (SRD)', blurb: 'Fifth edition with the full SRD 5.1 built in: monsters, spells, conditions, items and rules.' },
  traveller: { name: 'Traveller', blurb: '2D task checks with Effect, boon/bane, psionics — Mongoose 2e style.' },
  coc7: { name: 'Call of Cthulhu 7e', blurb: 'Percentile skills with success levels, bonus/penalty dice, pushing and Sanity.' },
  tftl: { name: 'Tales from the Loop', blurb: 'Year Zero dice pools, Conditions, pushing and Trouble.' },
  cpr: { name: 'Cyberpunk RED', blurb: 'd10 + STAT + skill against DV, crits and fumbles, critical injuries.' },
  swade: { name: 'Savage Worlds', blurb: 'Trait and Wild Die, aces, raises, action-deck initiative.' },
};
