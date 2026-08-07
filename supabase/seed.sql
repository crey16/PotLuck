-- PotLuck M4 authored learning content.
--
-- Ported from the read-only StackSchool reference, then corrected to match
-- PotLuck's evaluator, betting convention, range charts, and product rules.
-- IDs are explicit and stable, so this file is safe to re-run. It never
-- deletes or rewrites user attempts, progress, skill stats, or daily history.

begin;

insert into public.modules (id, title, description, order_index, is_active)
values
  (
    1,
    'Foundations',
    'Core poker concepts every player must know: hand rankings, position, pot odds, and basic terminology.',
    1,
    true
  ),
  (
    2,
    'Preflop Basics',
    'Which hands to play, when to raise, how position affects your preflop strategy, and value vs bluffing.',
    2,
    true
  ),
  (
    3,
    'Flop Fundamentals',
    'Continuation bets, board texture reading, flop decision making, and bet sizing.',
    3,
    true
  ),
  (
    4,
    'Counting Outs',
    'Learn to count your outs, apply the rule of 2 and 4, and make mathematically sound decisions.',
    4,
    true
  ),
  (
    5,
    'Mental Game',
    'Preflop ranges, bankroll management, and discipline — the habits that separate winning players.',
    5,
    true
  )
on conflict (id) do update set
  title = excluded.title,
  description = excluded.description,
  order_index = excluded.order_index,
  is_active = excluded.is_active;

insert into public.lessons
  (id, module_id, lesson_type, title, order_index, content_json,
   estimated_time_seconds, difficulty, version, is_active)
values
  -- lesson 01: Hand Rankings
  (
    1,
    1,
    'concept'::public.lesson_type,
    'Hand Rankings',
    1,
    $json$
    {
      "screens": [
        {
          "type": "info",
          "content": "## Why Hand Rankings Matter\n\nBefore you can make a single decision at the poker table, you need to know one thing: **does my hand beat my opponent's hand?**\n\nHand rankings are the foundation of every poker decision. This lesson takes 7 minutes. Let's build it right."
        },
        {
          "type": "info",
          "content": "## The Top 5 Hands\n\n1. **Royal Flush** — A K Q J T of the same suit. Unbeatable.\n2. **Straight Flush** — Five sequential cards of one suit. (e.g. 9 8 7 6 5 of spades)\n3. **Four of a Kind** — Four cards of the same rank. (e.g. 4 4 4 4)\n4. **Full House** — Three of a kind plus a pair. (e.g. K K K 7 7)\n5. **Flush** — Five cards of the same suit, not in sequence."
        },
        {
          "type": "info",
          "content": "## The Bottom 5 Hands\n\n6. **Straight** — Five sequential cards, any suits. (e.g. 8 7 6 5 4)\n7. **Three of a Kind** — Three cards of the same rank.\n8. **Two Pair** — Two different pairs. (e.g. A A 9 9)\n9. **One Pair** — Two cards of the same rank.\n10. **High Card** — No combination. Best single card wins.\n\nIf no player has at least a pair, the player with the highest card wins."
        },
        {
          "type": "info",
          "content": "## The Tricky Comparisons\n\nTwo rankings trip up beginners every time:\n\n**Flush beats a Straight** — Suits beat sequences. A flush is harder to make because all five cards must share a suit.\n\n**Full House beats a Flush** — You need *both* three-of-a-kind AND a pair, which is rarer than five suited cards.\n\nMemory trick: count the constraints. A full house has more constraints than a flush."
        },
        {
          "type": "info",
          "content": "## Reading the Board\n\nYou always use the best **5-card combination** from your 2 hole cards + 5 community cards.\n\n**Example:** You hold K♠ 7♦. Board: K♥ K♦ 7♠ 2♣ 9♥\n\nYour best hand: **Full House** — K K K 7 7 (three kings + pair of sevens).\n\nYou do NOT use all 7 cards — only the best 5."
        },
        {
          "type": "question",
          "content": "You hold A♠ 2♠ and the board is K♠ Q♠ J♠ T♠ 5♥.\n\nWhat hand do you have?",
          "choices": [
            {
              "id": "a",
              "label": "Straight"
            },
            {
              "id": "b",
              "label": "Flush"
            },
            {
              "id": "c",
              "label": "Royal Flush"
            },
            {
              "id": "d",
              "label": "Straight Flush"
            }
          ],
          "correct_choice_id": "c"
        },
        {
          "type": "question",
          "content": "Which hand wins?\n\n**Player A:** Full House (Q Q Q 3 3)\n**Player B:** Flush (A K J 9 7 of hearts)",
          "choices": [
            {
              "id": "a",
              "label": "Player A — Full House"
            },
            {
              "id": "b",
              "label": "Player B — Flush"
            },
            {
              "id": "c",
              "label": "They tie"
            }
          ],
          "correct_choice_id": "a"
        },
        {
          "type": "recap",
          "content": "## Key Takeaways\n\n- Suit > Sequence: **Flush beats Straight**\n- Full House beats Flush (harder to make)\n- You always use your best 5-card combination\n- Royal Flush is the best possible hand\n\n**Quick ranking:** Royal > Straight Flush > Quads > Full House > Flush > Straight > Trips > Two Pair > Pair > High Card"
        }
      ],
      "skill_tags": [
        "hand_rankings"
      ],
      "xp_reward": 10
    }
        $json$::jsonb,
    420,
    1,
    1,
    true
  ),
  -- lesson 02: Hand Rankings Quiz
  (
    2,
    1,
    'quiz'::public.lesson_type,
    'Hand Rankings Quiz',
    2,
    $json$
    {
      "screens": [
        {
          "type": "question",
          "content": "Which hand beats a flush?",
          "choices": [
            {
              "id": "a",
              "label": "Straight"
            },
            {
              "id": "b",
              "label": "Three of a Kind"
            },
            {
              "id": "c",
              "label": "Full House"
            },
            {
              "id": "d",
              "label": "Two Pair"
            }
          ],
          "correct_choice_id": "c"
        },
        {
          "type": "question",
          "content": "You hold K♠ K♥. Board: K♦ 7♣ 7♠ 2♥ 9♦.\n\nWhat is your best hand?",
          "choices": [
            {
              "id": "a",
              "label": "Three of a Kind (Kings)"
            },
            {
              "id": "b",
              "label": "Full House (Kings full of Sevens)"
            },
            {
              "id": "c",
              "label": "Two Pair (Kings and Sevens)"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "question",
          "content": "Which starting hand is strongest preflop?",
          "choices": [
            {
              "id": "a",
              "label": "A♠ A♥ (pocket Aces)"
            },
            {
              "id": "b",
              "label": "K♠ Q♠ (suited King-Queen)"
            },
            {
              "id": "c",
              "label": "J♠ T♠ (suited connectors)"
            }
          ],
          "correct_choice_id": "a"
        },
        {
          "type": "question",
          "content": "Player A has a pair of Kings. Player B has a pair of Aces. Board: 5 6 7 8 9 (rainbow).\n\nWho wins?",
          "choices": [
            {
              "id": "a",
              "label": "Player A — pair of Kings"
            },
            {
              "id": "b",
              "label": "Player B — pair of Aces"
            },
            {
              "id": "c",
              "label": "Neither — both players use the board straight"
            }
          ],
          "correct_choice_id": "c"
        },
        {
          "type": "question",
          "content": "You hold 9♠ 8♠. Board: 7♠ 6♠ 5♠ K♥ 2♦.\n\nWhat hand do you have?",
          "choices": [
            {
              "id": "a",
              "label": "Flush"
            },
            {
              "id": "b",
              "label": "Straight"
            },
            {
              "id": "c",
              "label": "Straight Flush"
            },
            {
              "id": "d",
              "label": "Full House"
            }
          ],
          "correct_choice_id": "c"
        },
        {
          "type": "recap",
          "content": "## Hand Rankings — Quick Reference\n\nRoyal Flush > Straight Flush > Four of a Kind > Full House > Flush > Straight > Three of a Kind > Two Pair > One Pair > High Card\n\n**Remember:** The board plays for everyone. Always find your best 5-card hand."
        }
      ],
      "skill_tags": [
        "hand_rankings"
      ],
      "xp_reward": 10
    }
        $json$::jsonb,
    300,
    1,
    1,
    true
  ),
  -- lesson 03: Position Basics
  (
    3,
    1,
    'concept'::public.lesson_type,
    'Position Basics',
    3,
    $json$
    {
      "screens": [
        {
          "type": "info",
          "content": "## Position Is Power\n\nIn poker, **position** means where you sit relative to the dealer button. It may be the single most important concept in the game.\n\nActing **last** gives you information — you see what everyone else does before you decide. Acting **first** means you're flying blind."
        },
        {
          "type": "info",
          "content": "## The Positions\n\nIn a typical 6-player game:\n\n- **UTG (Under the Gun)** — First to act preflop. Worst position.\n- **MP (Middle Position)** — Middle of the table.\n- **CO (Cutoff)** — One seat right of the button. Strong position.\n- **BTN (Button)** — Dealer. Acts last on every postflop street. **Best position.**\n- **SB (Small Blind)** — First to act postflop. Worst position after the flop.\n- **BB (Big Blind)** — Last to act preflop. First after preflop."
        },
        {
          "type": "info",
          "content": "## Why Position Wins Money\n\nWhen you act **last** (in position):\n- You see if opponents check, bet, or raise before deciding\n- You can take free cards when checked to\n- You can bluff more effectively\n- You can control pot size\n\nWhen you act **first** (out of position):\n- You must guess what opponents will do\n- Harder to bluff; harder to extract value\n- You face range disadvantage"
        },
        {
          "type": "info",
          "content": "## Positional Hand Selection\n\nPosition changes which hands are profitable:\n\n**Button (BTN):** You can play a wide range — any pair, most aces, suited connectors, suited one-gappers.\n\n**UTG:** You should play a *much tighter* range — only strong hands like big pairs, AK, AQ, KQ.\n\n**Rule of thumb:** The earlier your position, the stronger your hand needs to be."
        },
        {
          "type": "info",
          "content": "## Positional Example\n\nYou hold 7♠ 6♠ (suited connectors).\n\n- **UTG:** Fold. Too early, too speculative.\n- **CO or BTN:** Raise or call. Great hand to play in position — you can set-mine, hit straights/flushes, and bluff effectively.\n\nSame hand. Completely different decision based on position."
        },
        {
          "type": "question",
          "content": "Which position acts LAST postflop (after the flop)?",
          "choices": [
            {
              "id": "a",
              "label": "Small Blind"
            },
            {
              "id": "b",
              "label": "Big Blind"
            },
            {
              "id": "c",
              "label": "Button"
            },
            {
              "id": "d",
              "label": "UTG"
            }
          ],
          "correct_choice_id": "c"
        },
        {
          "type": "question",
          "content": "You're UTG and dealt 6♥ 5♥. What should you do?",
          "choices": [
            {
              "id": "a",
              "label": "Raise — suited connectors are always strong"
            },
            {
              "id": "b",
              "label": "Fold — too speculative from early position"
            },
            {
              "id": "c",
              "label": "Limp in and hope to flop well"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "recap",
          "content": "## Position — The Golden Rules\n\n1. **Button is the best seat** — you act last every postflop street\n2. **Tighten your range from early position** — UTG needs stronger hands\n3. **Loosen your range from late position** — CO/BTN can play more hands\n4. **Position advantage compounds** — information leads to better decisions all the way to the river"
        }
      ],
      "skill_tags": [
        "position"
      ],
      "xp_reward": 10
    }
        $json$::jsonb,
    420,
    1,
    1,
    true
  ),
  -- lesson 04: Position Quiz
  (
    4,
    1,
    'quiz'::public.lesson_type,
    'Position Quiz',
    4,
    $json$
    {
      "screens": [
        {
          "type": "question",
          "content": "Which position acts FIRST preflop (not counting blinds)?",
          "choices": [
            {
              "id": "a",
              "label": "Button"
            },
            {
              "id": "b",
              "label": "UTG"
            },
            {
              "id": "c",
              "label": "Cutoff"
            },
            {
              "id": "d",
              "label": "Small Blind"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "question",
          "content": "You're on the Button. The action folds to you. What should you consider?",
          "choices": [
            {
              "id": "a",
              "label": "Play tight — the Button is risky"
            },
            {
              "id": "b",
              "label": "Raise a wide range — you act last postflop"
            },
            {
              "id": "c",
              "label": "Always limp — don't build big pots out of position"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "question",
          "content": "You're in the Small Blind. The Button raises. Why is the Small Blind a tough spot to call from?",
          "choices": [
            {
              "id": "a",
              "label": "You have to put in extra money"
            },
            {
              "id": "b",
              "label": "You act first on every postflop street"
            },
            {
              "id": "c",
              "label": "You can't re-raise from the Small Blind"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "question",
          "content": "In a 6-max game, which two positions are generally considered 'late position'?",
          "choices": [
            {
              "id": "a",
              "label": "UTG and MP"
            },
            {
              "id": "b",
              "label": "CO and BTN"
            },
            {
              "id": "c",
              "label": "SB and BB"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "question",
          "content": "You hold A♣ 9♦ from UTG. What is the best action?",
          "choices": [
            {
              "id": "a",
              "label": "Raise — Ace-nine suited is a premium hand"
            },
            {
              "id": "b",
              "label": "Fold — too weak from early position"
            },
            {
              "id": "c",
              "label": "Limp and see the flop cheaply"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "recap",
          "content": "## Position Checklist\n\n- Early position (UTG/MP): play only strong hands\n- Late position (CO/BTN): widen your range significantly\n- Small Blind: the worst position postflop — be selective\n- Acting last = more information = better decisions"
        }
      ],
      "skill_tags": [
        "position"
      ],
      "xp_reward": 10
    }
        $json$::jsonb,
    270,
    1,
    1,
    true
  ),
  -- lesson 05: Pot Odds Fundamentals
  (
    5,
    1,
    'concept'::public.lesson_type,
    'Pot Odds Fundamentals',
    5,
    $json$
    {
      "screens": [
        {
          "type": "info",
          "content": "## Why Math Wins\n\nPot odds let you answer the question every poker player faces: *Is this call profitable in the long run?*\n\nYou don't need to be a mathematician. You need one simple ratio and the discipline to use it consistently."
        },
        {
          "type": "info",
          "content": "## What Are Pot Odds?\n\nIn PotLuck, **pot** always means the money already in the middle **after the opponent's bet**. **Call** is the extra amount you must put in.\n\n**Required equity = Call ÷ (Pot + Call)**\n\n**Example:**\n- Pot after the bet: $100\n- Cost to call: $20\n- Final pot after your call: $120\n- Required equity = 20 ÷ 120 = **16.7%**\n\nIf you win more than 16.7% of the time, the call is profitable before future-street costs."
        },
        {
          "type": "info",
          "content": "## Equity: How Often Do You Win?\n\nYour **equity** is your hand's winning probability.\n\nWith a clean 9-out flush draw, one card to come hits about **19.6%** of the time. With two cards to come, the exact chance is about **35.0%**.\n\nThe rule of 2 and 4 estimates those as 18% and 36%. Above 8 outs, the ×4 shortcut needs a correction; that is covered in Counting Outs.\n\nIf your equity exceeds the required equity—and no future call is being ignored—the call is profitable."
        },
        {
          "type": "info",
          "content": "## A Complete Example\n\nThe pot is **$150 after the opponent's bet**, and calling costs **$50**. You have a clean 9-out flush draw.\n\n1. Required equity = 50 ÷ (150 + 50) = **25%**\n2. With one card to come, 9/46 ≈ **19.6%** → fold on direct odds\n3. With two cards guaranteed to come, the exact hit chance is about **35.0%** → the price is sufficient\n\nOnly use the two-card figure when one call really buys both cards, such as an all-in. Otherwise future betting still matters."
        },
        {
          "type": "info",
          "content": "## Implied Odds\n\nPot odds assume you win exactly what's in the pot now. **Implied odds** account for money your opponent may bet on future streets if you hit your draw.\n\nIf you expect to win $200 more when you hit, your implied pot is effectively larger, making a call profitable even when raw pot odds say fold.\n\n**Use implied odds when:** drawing to a hand that is well-disguised (like a flush or straight) and your opponent is likely to call a big bet."
        },
        {
          "type": "question",
          "content": "The pot is $60 after Villain's bet. Calling costs $20. What equity do you need?",
          "choices": [
            {
              "id": "a",
              "label": "20%"
            },
            {
              "id": "b",
              "label": "25%"
            },
            {
              "id": "c",
              "label": "33%"
            },
            {
              "id": "d",
              "label": "50%"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "question",
          "content": "Your pot odds are 25% and your estimated equity is 30%. What should you do?",
          "choices": [
            {
              "id": "a",
              "label": "Fold — you need better odds"
            },
            {
              "id": "b",
              "label": "Call — your equity exceeds the pot odds"
            },
            {
              "id": "c",
              "label": "Raise — always raise with equity"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "recap",
          "content": "## Pot Odds — Core Formula\n\n**Required equity = Call ÷ (Pot after the bet + Call)**\n\nIf your **equity > required equity** → the direct call is profitable\nIf your **equity < required equity** → fold unless realistic implied odds close the gap\n\nUse one-card equity when another bet may come. Use two-card equity only when your call guarantees both remaining cards."
        }
      ],
      "skill_tags": [
        "pot_odds"
      ],
      "xp_reward": 10
    }
        $json$::jsonb,
    480,
    2,
    1,
    true
  ),
  -- lesson 06: Pot Odds Quiz
  (
    6,
    1,
    'quiz'::public.lesson_type,
    'Pot Odds Quiz',
    6,
    $json$
    {
      "screens": [
        {
          "type": "question",
          "content": "The pot is $100 after Villain's bet. Calling costs $100. What equity do you need?",
          "choices": [
            {
              "id": "a",
              "label": "25%"
            },
            {
              "id": "b",
              "label": "33%"
            },
            {
              "id": "c",
              "label": "50%"
            },
            {
              "id": "d",
              "label": "67%"
            }
          ],
          "correct_choice_id": "c"
        },
        {
          "type": "question",
          "content": "Your pot odds are 40%. Your flush draw gives you about 20% equity (one card to come). What's the correct play?",
          "choices": [
            {
              "id": "a",
              "label": "Call — 20% is close enough"
            },
            {
              "id": "b",
              "label": "Fold — 20% equity doesn't meet the 40% required"
            },
            {
              "id": "c",
              "label": "Raise — represent strength"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "question",
          "content": "The pot is $200 after Villain's bet. Calling costs $50. You have an open-ended straight draw (~32% with two cards guaranteed). Should you call?",
          "choices": [
            {
              "id": "a",
              "label": "Yes — pot odds ~20%, equity 32%, so call is profitable"
            },
            {
              "id": "b",
              "label": "No — straight draws are too speculative"
            },
            {
              "id": "c",
              "label": "Only if you have position"
            }
          ],
          "correct_choice_id": "a"
        },
        {
          "type": "question",
          "content": "What are implied odds?",
          "choices": [
            {
              "id": "a",
              "label": "The money in the pot right now"
            },
            {
              "id": "b",
              "label": "Extra money you expect to win on future streets when you hit"
            },
            {
              "id": "c",
              "label": "Your opponent's chip count"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "question",
          "content": "When are implied odds most useful?",
          "choices": [
            {
              "id": "a",
              "label": "When you have top pair"
            },
            {
              "id": "b",
              "label": "When drawing to a disguised hand and villain will call big bets"
            },
            {
              "id": "c",
              "label": "When you're bluffing"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "recap",
          "content": "## Pot Odds Summary\n\n**Required equity = Call ÷ (Pot after the bet + Call)**\n\n**If equity > required equity** → profitable direct call\n**If equity < required equity** → fold unless realistic implied odds justify it\n\nBe explicit about cards to come: one call does not automatically buy both turn and river."
        }
      ],
      "skill_tags": [
        "pot_odds"
      ],
      "xp_reward": 10
    }
        $json$::jsonb,
    270,
    2,
    1,
    true
  ),
  -- lesson 07: Starting Hand Selection
  (
    7,
    2,
    'concept'::public.lesson_type,
    'Starting Hand Selection',
    1,
    $json$
    {
      "screens": [
        {
          "type": "info",
          "content": "## The Most Common Mistake\n\nMost losing players play **too many hands**. They see a hand like K♦ 7♦ and think it looks pretty. It does. But in most situations, it loses money.\n\nStarting hand selection is about playing hands that have a structural edge — not hands that look nice."
        },
        {
          "type": "info",
          "content": "## Premium Hands — Build the Pot\n\nBig pairs and strong Broadway hands anchor every opening range:\n\n- **AA–JJ and AK** — raise from every position and often re-raise\n- **TT, AQ, AJs, KQs** — clear opens in the PotLuck 6-max reference ranges\n- Medium pairs and suited Broadway hands remain playable earlier than many beginners expect\n\nThe exact mix changes with rake, stack depth, and open size. Use the Ranges page as the reference rather than memorizing one slogan."
        },
        {
          "type": "info",
          "content": "## Position Widens the Range\n\nPotLuck's 6-max, 100bb reference opens about **17% from UTG** and **45% from the Button**.\n\n- UTG still opens hands such as JTs, T9s, A9s, and KQo\n- CO and BTN add weaker suited hands, offsuit Broadways, and more mixed opens\n- Marginal hands gain value when fewer players remain and you will act later postflop\n\nThese are solver-shaped reference ranges, not live solver output."
        },
        {
          "type": "info",
          "content": "## Hands to Avoid\n\nSome hands look playable but make expensive second-best pairs:\n\n- **K7o, Q8o, J9o** — weak, offsuit, and often dominated\n- **A2o–A8o** — position-dependent weak aces; many are folds early\n- Disconnected offsuit hands lose the suited and straight-making backup plans\n\nWhen a hand is near the edge, position, sizing, stacks, and rake decide. Check the reference grid instead of treating “suited” as an automatic play."
        },
        {
          "type": "info",
          "content": "## Suited Cards: Why They Matter\n\nA suited hand usually has a few percentage points more equity than its offsuit counterpart because it can make a flush. **A♠ Q♠** is meaningfully stronger than AQ offsuit; **K♠ J♠** is stronger than KJo.\n\nThat bonus helps, but it does not rescue every weak hand. Position and the opponent's range still come first."
        },
        {
          "type": "question",
          "content": "You're UTG in a 6-max game. You're dealt Q♣ 8♦. What's the best action?",
          "choices": [
            {
              "id": "a",
              "label": "Raise — Queen-high hands are strong"
            },
            {
              "id": "b",
              "label": "Fold — too weak from early position"
            },
            {
              "id": "c",
              "label": "Limp in and see a cheap flop"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "question",
          "content": "Which of these is a premium hand you can raise from any position?",
          "choices": [
            {
              "id": "a",
              "label": "A♥ 7♦"
            },
            {
              "id": "b",
              "label": "K♠ J♦"
            },
            {
              "id": "c",
              "label": "A♠ K♣"
            },
            {
              "id": "d",
              "label": "Q♥ 9♥"
            }
          ],
          "correct_choice_id": "c"
        },
        {
          "type": "recap",
          "content": "## Starting-Hand Framework\n\n- Start with position: PotLuck's reference range is about **17% UTG** and **45% BTN**\n- Raise strong pairs and Broadway hands for value\n- Add suited and connected hands as position improves\n- Avoid dominated offsuit hands and habitual limping\n- Use the Ranges page for the actual reference frequencies\n\nReference ranges are approximations, not solver output."
        }
      ],
      "skill_tags": [
        "hand_selection"
      ],
      "xp_reward": 10
    }
        $json$::jsonb,
    420,
    1,
    1,
    true
  ),
  -- lesson 08: Preflop Decision Quiz
  (
    8,
    2,
    'quiz'::public.lesson_type,
    'Preflop Decision Quiz',
    2,
    $json$
    {
      "screens": [
        {
          "type": "question",
          "content": "UTG raises. You're in the BB with K♠ Q♦. Should you call?",
          "choices": [
            {
              "id": "a",
              "label": "Call — PotLuck's BB-vs-UTG reference range defends KQo"
            },
            {
              "id": "b",
              "label": "Fold — KQo is always dominated"
            },
            {
              "id": "c",
              "label": "Re-raise — always 3-bet premium hands"
            }
          ],
          "correct_choice_id": "a"
        },
        {
          "type": "question",
          "content": "You're on the Button with 8♠ 7♠. Everyone folds to you. What do you do?",
          "choices": [
            {
              "id": "a",
              "label": "Fold — suited connectors are weak"
            },
            {
              "id": "b",
              "label": "Raise — suited connectors in position are profitable"
            },
            {
              "id": "c",
              "label": "Limp — don't build a big pot with speculative hands"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "question",
          "content": "You hold A♦ A♣ UTG. The best action is?",
          "choices": [
            {
              "id": "a",
              "label": "Limp — trap your opponents"
            },
            {
              "id": "b",
              "label": "Raise — build the pot with the best hand"
            },
            {
              "id": "c",
              "label": "Fold — too risky to play out of position"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "question",
          "content": "CO raises. You're SB with T♥ 9♥. What's the best play?",
          "choices": [
            {
              "id": "a",
              "label": "Call — suited connectors are good"
            },
            {
              "id": "b",
              "label": "Fold — you'll be out of position the whole hand"
            },
            {
              "id": "c",
              "label": "3-bet — represent strength"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "question",
          "content": "An opponent limps UTG. You're on the BTN with A♠ K♥. What do you do?",
          "choices": [
            {
              "id": "a",
              "label": "Limp behind — match their bet"
            },
            {
              "id": "b",
              "label": "Raise — isolate the limper with a premium hand"
            },
            {
              "id": "c",
              "label": "Fold — AK needs re-raises to be profitable"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "question",
          "content": "Which factor should most influence your hand selection preflop?",
          "choices": [
            {
              "id": "a",
              "label": "The suit of your cards"
            },
            {
              "id": "b",
              "label": "Your position at the table"
            },
            {
              "id": "c",
              "label": "Your chip stack size"
            },
            {
              "id": "d",
              "label": "The time of day"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "recap",
          "content": "## Preflop Decision Framework\n\n1. **Position first** — opener and caller positions define both ranges\n2. **Hand strength second** — compare your hand with that range, not in isolation\n3. **Raise, call, or fold** — calling is normal when closing action or playing in position\n4. **Sizing and stacks matter** — a chart assumes a specific game\n\nUse PotLuck's 6-max, 100bb charts as reference ranges, not universal solver output."
        }
      ],
      "skill_tags": [
        "hand_selection",
        "position"
      ],
      "xp_reward": 10
    }
        $json$::jsonb,
    330,
    2,
    1,
    true
  ),
  -- lesson 09: Open-Raise Drill
  (
    9,
    2,
    'drill'::public.lesson_type,
    'Open-Raise Drill',
    3,
    $json$
    {
      "screens": [
        {
          "type": "info",
          "content": "## Open-Raise Drill\n\nIn each scenario, decide whether to **raise** (open the pot) or **fold**. Everyone has folded to you.\n\nYou're playing 6-max. Focus on **position + hand strength**."
        },
        {
          "type": "drill",
          "content": "You're UTG. Hand: J♦ T♦. Action to you. Fold or raise?",
          "choices": [
            {
              "id": "a",
              "label": "Raise — JTs is a standard UTG open in this reference range"
            },
            {
              "id": "b",
              "label": "Fold — suited Broadway is too weak UTG"
            }
          ],
          "correct_choice_id": "a"
        },
        {
          "type": "drill",
          "content": "You're CO. Hand: A♥ 9♥. Everyone folds to you. Fold or raise?",
          "choices": [
            {
              "id": "a",
              "label": "Raise"
            },
            {
              "id": "b",
              "label": "Fold"
            }
          ],
          "correct_choice_id": "a"
        },
        {
          "type": "drill",
          "content": "You're BTN. Hand: 5♠ 4♠. Everyone folds to you. Fold or raise?",
          "choices": [
            {
              "id": "a",
              "label": "Raise — position makes this playable"
            },
            {
              "id": "b",
              "label": "Fold — too weak to play"
            }
          ],
          "correct_choice_id": "a"
        },
        {
          "type": "drill",
          "content": "You're UTG. Hand: K♣ K♦. Action to you. Fold or raise?",
          "choices": [
            {
              "id": "a",
              "label": "Raise"
            },
            {
              "id": "b",
              "label": "Limp to trap"
            },
            {
              "id": "c",
              "label": "Fold"
            }
          ],
          "correct_choice_id": "a"
        },
        {
          "type": "drill",
          "content": "You're SB (everyone folded). Hand: Q♣ 7♦. Fold or raise?",
          "choices": [
            {
              "id": "a",
              "label": "Raise — heads up against the BB"
            },
            {
              "id": "b",
              "label": "Fold — Q7o out of position loses money"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "recap",
          "content": "## Open-Raise Reference\n\n- UTG: about **17%** in PotLuck's 6-max, 100bb chart; JTs and A9s are opens\n- CO: widen with more aces, Broadways, pairs, and suited connectors\n- BTN: about **45%**; positional advantage supports the widest range\n- SB: raise-or-fold reference, still tighter than the Button\n\nThese ranges assume 100bb and 2.5bb opens. They are approximations, not solver output."
        }
      ],
      "skill_tags": [
        "hand_selection",
        "position"
      ],
      "xp_reward": 10
    }
        $json$::jsonb,
    360,
    2,
    1,
    true
  ),
  -- lesson 10: Value Betting vs Bluffing
  (
    10,
    2,
    'concept'::public.lesson_type,
    'Value Betting vs Bluffing',
    4,
    $json$
    {
      "screens": [
        {
          "type": "info",
          "content": "## Two Reasons to Bet\n\nThere are exactly two good reasons to put chips in the pot:\n\n1. **Value** — You have a strong hand and want worse hands to call.\n2. **Bluff** — You have a weak hand and want better hands to fold.\n\nEvery bet you make should serve one of these purposes. Bets that do neither are **mistakes**."
        },
        {
          "type": "info",
          "content": "## Value Betting\n\nA value bet is profitable when your opponent calls with **worse hands** more often than better hands.\n\n**Example:** You hold A♠ A♦. Board: A♥ 8♣ 3♠. You have top set.\n\nYou bet. What does your opponent call with? Any pair, any draw, maybe two pair. All of them lose to your set. **This is a pure value bet.**"
        },
        {
          "type": "info",
          "content": "## The Value Bet Test\n\nBefore betting for value, ask:\n\n*When my opponent calls, does he usually have a better hand or a worse hand?*\n\n- If mostly worse → bet for value\n- If mostly better or equal → check or consider bluffing\n\nThis test prevents **thin value bets** that lose money because you're called too often by better hands."
        },
        {
          "type": "info",
          "content": "## Bluffing Fundamentals\n\nA bluff is profitable when your opponent **folds** often enough to justify the risk.\n\n**Fold equity formula (simplified):** If you bet 1/2 pot, you need the opponent to fold >33% of the time to profit.\n\n**Good bluff candidates:**\n- Hands with no showdown value\n- Boards that hit your **perceived range** better than your opponent's\n- Opponents who fold too often"
        },
        {
          "type": "info",
          "content": "## Balancing Value and Bluffs\n\nA balanced player bets with **both strong hands AND bluffs** in similar spots. This makes you hard to read.\n\n- If you only bet with strong hands, opponents fold when you bet and call when you check.\n- If you bluff too much, opponents always call.\n\n**Rule of thumb:** For every 2 value bets, have 1 bluff in your range at pot-sized bet sizes."
        },
        {
          "type": "question",
          "content": "You hold T♠ T♦. Board: T♣ 8♥ 3♦. You have top set. Opponent checks to you. What's the best action?",
          "choices": [
            {
              "id": "a",
              "label": "Check — don't scare them away"
            },
            {
              "id": "b",
              "label": "Bet for value — your set beats all draws and pairs"
            },
            {
              "id": "c",
              "label": "Fold — the board is dangerous"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "question",
          "content": "You hold A♦ 2♦ on a board of K♠ Q♣ J♥ (rainbow). You have Ace-high and a gutshot to Broadway. Opponent checks. What do you do?",
          "choices": [
            {
              "id": "a",
              "label": "Bet — this board hits your range"
            },
            {
              "id": "b",
              "label": "Check — preserve your gutshot equity instead of auto-bluffing"
            },
            {
              "id": "c",
              "label": "Raise all-in"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "recap",
          "content": "## Value vs Bluff Checklist\n\n**Value bet when:**\n- You beat most of opponent's calling range\n- The pot needs protection against draws\n\n**Bluff when:**\n- You have no showdown value\n- Opponent folds often enough\n- Board hits your perceived range\n\n**Never bet just because you feel like it.** Every bet needs a reason."
        }
      ],
      "skill_tags": [
        "value_betting",
        "bluffing"
      ],
      "xp_reward": 10
    }
        $json$::jsonb,
    420,
    2,
    1,
    true
  ),
  -- lesson 11: Bet Sizing Basics
  (
    11,
    2,
    'concept'::public.lesson_type,
    'Bet Sizing Basics',
    5,
    $json$
    {
      "screens": [
        {
          "type": "info",
          "content": "## Size Matters\n\nHow much you bet is just as important as whether you bet. The wrong size can cost you value on strong hands and waste chips on bluffs.\n\nThis lesson covers the three core bet sizes and when to use each."
        },
        {
          "type": "info",
          "content": "## Common Bet Sizes\n\nBet sizes are described as a fraction of the pot:\n\n- **1/3 pot** (~33%) — Small. Gets thin calls. Good for dry boards and thin value.\n- **1/2 pot** (~50%) — Standard. Balanced between value and bluff. Most common size.\n- **2/3 to 3/4 pot** (~65–75%) — Large. More pressure. Good for draws and strong value.\n- **Full pot (100%)** — Polarized. You either have a monster or you're bluffing hard."
        },
        {
          "type": "info",
          "content": "## Bet Sizing for Value\n\nFor value bets, size based on **what your opponent will call**.\n\n- **Dry board (A 7 2 rainbow):** Bet small (1/3–1/2 pot). No draws. Opponent's range is mostly pairs and missed hands. Extract thin value.\n- **Wet board (J♠ T♠ 9♣):** Bet large (2/3–full pot). Many draws. You want to charge them to draw and take the pot now."
        },
        {
          "type": "info",
          "content": "## Bet Sizing for Bluffs\n\nFor bluffs, your size must be **large enough** to make opponent fold.\n\n- Small bluffs fail — opponents call getting great odds.\n- Large bluffs work because opponents need more equity to call profitably.\n\n**Match your bluff size to your value size** in the same spot — this keeps your range balanced and harder to exploit."
        },
        {
          "type": "info",
          "content": "## Preflop Raise Sizing\n\nStandard open-raise: **2.5x to 3x the big blind** (e.g., raise to $6 at $1/$2).\n\nAdjust up if:\n- There are limpers already (add 1BB per limper)\n- You're out of position (raise slightly larger)\n\n3-bet sizing: **3x the original raise** in position, **4x out of position**."
        },
        {
          "type": "question",
          "content": "Board: A♠ 7♥ 2♦ (dry). You have A♣ K♣ (top pair, top kicker). Best bet size?",
          "choices": [
            {
              "id": "a",
              "label": "1/3 pot — dry board, extract thin value"
            },
            {
              "id": "b",
              "label": "Full pot — protect your hand"
            },
            {
              "id": "c",
              "label": "Check — disguise your hand strength"
            }
          ],
          "correct_choice_id": "a"
        },
        {
          "type": "question",
          "content": "Board: J♠ T♠ 9♣ (very wet). You have J♣ J♦ (top set). Best bet size?",
          "choices": [
            {
              "id": "a",
              "label": "1/3 pot — you have the best hand, no rush"
            },
            {
              "id": "b",
              "label": "2/3 to full pot — charge draws and protect"
            },
            {
              "id": "c",
              "label": "Check-raise — let them bet first"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "recap",
          "content": "## Bet Sizing Quick Guide\n\n| Situation | Size |\n|---|---|\n| Dry board, thin value | 1/3 pot |\n| Standard continuation bet | 1/2 pot |\n| Wet board or large draws | 2/3–3/4 pot |\n| Polarized bluff or monster | Full pot |\n| Preflop open raise | 2.5x–3x BB |\n\nMatch bluff sizes to value bet sizes. Never bet \"just a little\" to bluff."
        }
      ],
      "skill_tags": [
        "bet_sizing"
      ],
      "xp_reward": 10
    }
        $json$::jsonb,
    420,
    2,
    1,
    true
  ),
  -- lesson 12: Continuation Betting
  (
    12,
    3,
    'concept'::public.lesson_type,
    'Continuation Betting',
    1,
    $json$
    {
      "screens": [
        {
          "type": "info",
          "content": "## What Is a C-Bet?\n\nA **continuation bet** (c-bet) is when the preflop aggressor bets on the flop, regardless of whether the flop helped their hand.\n\nIf you raised preflop and the flop comes, your opponent(s) expect you to bet — because you showed strength before the flop. The c-bet leverages that expectation."
        },
        {
          "type": "info",
          "content": "## Why C-Bets Work\n\nThe math is on your side:\n\n- Any given player misses the flop **~67% of the time**\n- When your opponent misses, they'll fold to a reasonable bet\n- Even if YOU miss the flop, your opponent doesn't know that\n\nA c-bet of 1/2 pot needs the opponent to fold only **33%** of the time to be profitable."
        },
        {
          "type": "info",
          "content": "## When to C-Bet\n\n**C-bet when:**\n- The board is dry (A 7 2 rainbow) — few draws, your range hits it harder\n- You have a strong hand and want to build the pot\n- You have a backdoor draw or overcards to the board\n- You're in position\n\n**Skip the c-bet when:**\n- The board connects well with the caller's range (low connected boards: 8 7 6)\n- Multiple opponents — bluffing is harder in multiway pots\n- You have showdown value and want to see a free card"
        },
        {
          "type": "info",
          "content": "## Board Texture and C-Bets\n\n**Dry board (A♠ 7♦ 2♣):** C-bet almost always. Few draws, your range advantage is highest.\n\n**Semi-wet board (Q♠ J♦ 8♣):** C-bet selectively — with strong hands and good bluffs only.\n\n**Wet/connected board (9♠ 8♠ 7♦):** Check back more often unless you have strong value. This board hits the caller's range hard."
        },
        {
          "type": "info",
          "content": "## C-Bet Sizing\n\n**On dry boards:** bet small — 1/3 pot. You don't need to charge draws because there aren't many.\n\n**On wet boards:** bet large if you do c-bet — 2/3 to 3/4 pot. Charge the draws.\n\n**In multiway pots:** if you c-bet, bet large. Multiple opponents means lower fold frequency — you need a larger size to compensate."
        },
        {
          "type": "question",
          "content": "You raised preflop with A♠ K♠. Flop: A♦ 7♣ 2♥. Opponent checks. Should you c-bet?",
          "choices": [
            {
              "id": "a",
              "label": "Yes — dry board, top pair, build the pot"
            },
            {
              "id": "b",
              "label": "No — check behind to pot control"
            },
            {
              "id": "c",
              "label": "No — the board is too dangerous"
            }
          ],
          "correct_choice_id": "a"
        },
        {
          "type": "question",
          "content": "You raised preflop with K♠ Q♠. Flop: 8♦ 7♣ 6♥. Opponent checks. Should you c-bet?",
          "choices": [
            {
              "id": "a",
              "label": "Yes — always c-bet as the preflop raiser"
            },
            {
              "id": "b",
              "label": "No — this board hits the caller's range hard; check back"
            },
            {
              "id": "c",
              "label": "Yes, but only half pot"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "recap",
          "content": "## C-Bet Rules of Thumb\n\n1. Dry boards = c-bet more often, smaller sizes\n2. Wet/connected boards = c-bet less often, larger sizes when you do\n3. Skip c-bets in multiway pots unless you have strong value\n4. You only need opponent to fold 33% for a 1/2-pot c-bet to profit\n5. C-bet with both strong hands AND bluffs to stay balanced"
        }
      ],
      "skill_tags": [
        "c_betting"
      ],
      "xp_reward": 10
    }
        $json$::jsonb,
    420,
    2,
    1,
    true
  ),
  -- lesson 13: C-Bet Drill
  (
    13,
    3,
    'drill'::public.lesson_type,
    'C-Bet Drill',
    2,
    $json$
    {
      "screens": [
        {
          "type": "info",
          "content": "## C-Bet Decision Drill\n\nYou raised preflop from the BTN. One caller (BB). For each flop, decide: **c-bet or check back?**\n\nFocus on board texture and your hand's connection to the flop."
        },
        {
          "type": "drill",
          "content": "Hand: A♥ K♦. Flop: A♠ 8♣ 3♦ (dry). Opponent checks. C-bet or check?",
          "choices": [
            {
              "id": "a",
              "label": "C-bet — top pair, top kicker on a dry board"
            },
            {
              "id": "b",
              "label": "Check — protect pot control"
            }
          ],
          "correct_choice_id": "a"
        },
        {
          "type": "drill",
          "content": "Hand: K♦ Q♣. Flop: 9♠ 8♠ 7♣. Opponent checks. C-bet or check?",
          "choices": [
            {
              "id": "a",
              "label": "C-bet — you're the preflop aggressor"
            },
            {
              "id": "b",
              "label": "Check — connected board hits caller's range; you have no piece"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "drill",
          "content": "Hand: J♠ T♠. Flop: J♦ 8♣ 3♥. Opponent checks. C-bet or check?",
          "choices": [
            {
              "id": "a",
              "label": "C-bet — top pair on a fairly dry board"
            },
            {
              "id": "b",
              "label": "Check — medium pair, pot control"
            }
          ],
          "correct_choice_id": "a"
        },
        {
          "type": "drill",
          "content": "Hand: A♣ 2♣. Flop: K♦ 7♠ 2♦ (two diamonds). Opponent checks. C-bet or check?",
          "choices": [
            {
              "id": "a",
              "label": "C-bet small — paired bottom, flush draw possible but you have overcards/blocker"
            },
            {
              "id": "b",
              "label": "Check — bottom pair is not good enough to bet"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "drill",
          "content": "Hand: Q♥ Q♦. Flop: K♠ 8♣ 3♥. Opponent checks. C-bet or check?",
          "choices": [
            {
              "id": "a",
              "label": "C-bet — you were the preflop raiser"
            },
            {
              "id": "b",
              "label": "Check — the King is an overcard; preserve showdown value"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "recap",
          "content": "## C-Bet Decision Checklist\n\n- **Top pair or better** on dry board → almost always c-bet\n- **Connected/wet board** with no equity → check back\n- **Overpair** with scary overcard → c-bet to protect and charge\n- **Bottom pair** on two-flush board → often check; limited value, high risk\n- Position is your friend: in-position c-bets succeed more often"
        }
      ],
      "skill_tags": [
        "c_betting",
        "bet_sizing"
      ],
      "xp_reward": 10
    }
        $json$::jsonb,
    360,
    3,
    1,
    true
  ),
  -- lesson 14: Flop Decision Practice
  (
    14,
    3,
    'micro_hand'::public.lesson_type,
    'Flop Decision Practice',
    3,
    $json$
    {
      "screens": [
        {
          "type": "info",
          "content": "## Flop Decision Practice\n\nYou're about to face real postflop scenarios. Apply what you've learned about board texture, hand strength, and betting decisions.\n\nEach hand has one best action. Think before clicking."
        },
        {
          "type": "question",
          "content": "You raised BTN with A♠ Q♠. BB calls. Flop: Q♦ 7♣ 2♠.\n\nBB checks. You have top pair, top kicker on a dry board. Best action?",
          "choices": [
            {
              "id": "a",
              "label": "Bet 1/3 pot for value"
            },
            {
              "id": "b",
              "label": "Bet 2/3 pot — protect against backdoor draws"
            },
            {
              "id": "c",
              "label": "Check behind — no draws to charge"
            },
            {
              "id": "d",
              "label": "Check-raise if he bets"
            }
          ],
          "correct_choice_id": "a"
        },
        {
          "type": "question",
          "content": "You raised CO with K♥ K♣. BB calls. Flop: A♠ 9♦ 4♣.\n\nBB checks. An ace hit the board. Best action?",
          "choices": [
            {
              "id": "a",
              "label": "Bet — you have an overpair"
            },
            {
              "id": "b",
              "label": "Check — the Ace likely hit your opponent; pot control"
            },
            {
              "id": "c",
              "label": "Fold — kings are no good here"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "question",
          "content": "You raised BTN with 8♠ 7♠. BB calls. Flop: 9♠ 6♣ 3♠.\n\nYou have a flush draw AND open-ended straight draw. BB bets 1/2 pot. Best action?",
          "choices": [
            {
              "id": "a",
              "label": "Fold — too speculative"
            },
            {
              "id": "b",
              "label": "Call — massive equity with 15 outs"
            },
            {
              "id": "c",
              "label": "Fold — your draws might not come in"
            },
            {
              "id": "d",
              "label": "Min-raise"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "question",
          "content": "You raised UTG with A♣ K♣. Three callers. Flop: 7♦ 5♠ 2♥.\n\nChecked to you. Multiway pot, total miss. Best action?",
          "choices": [
            {
              "id": "a",
              "label": "C-bet — you're the preflop raiser"
            },
            {
              "id": "b",
              "label": "Check — multiway c-bluffs rarely work with no equity"
            },
            {
              "id": "c",
              "label": "All-in to steal"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "recap",
          "content": "## Postflop Decision Framework\n\n1. **Did the flop hit your hand?** Strong/medium/none?\n2. **Does it hit your opponent's range?** (Low connected = yes; high dry = no)\n3. **How many opponents?** Multiway = less bluffing\n4. **Your position?** In position = more options\n\nBet for value or bluff. Never bet \"just because.\""
        }
      ],
      "skill_tags": [
        "c_betting",
        "postflop",
        "bet_sizing"
      ],
      "xp_reward": 10
    }
        $json$::jsonb,
    300,
    3,
    1,
    true
  ),
  -- lesson 15: Board Texture Reading
  (
    15,
    3,
    'concept'::public.lesson_type,
    'Board Texture Reading',
    4,
    $json$
    {
      "screens": [
        {
          "type": "info",
          "content": "## Reading the Board\n\nBoard texture describes how **connected, wet, or dangerous** the flop is. Every strategic decision after the flop starts here.\n\nA player who reads boards well makes far fewer costly mistakes."
        },
        {
          "type": "info",
          "content": "## Dry Boards\n\nA **dry board** has no flush draws and no straight draws. Example: **A♠ 7♦ 2♣** (rainbow, disconnected).\n\nDry boards favor the **preflop aggressor** because:\n- The caller's range doesn't improve much\n- Few draws threaten your strong hands\n- C-bets work at a high rate\n\n**Strategy:** Bet frequently, sized small (1/3 pot)."
        },
        {
          "type": "info",
          "content": "## Wet Boards\n\nA **wet board** has many draws. Example: **J♠ T♠ 9♦**.\n\n- Flush draws, straight draws, and combo draws are possible\n- Multiple players likely have strong equity\n- The caller's range improves frequently\n\n**Strategy:** C-bet large when you do bet. Check back more often with marginal hands. Protect strong hands aggressively."
        },
        {
          "type": "info",
          "content": "## Semi-Wet Boards\n\nExample: **K♠ Q♦ 8♣** — a Broadway board with some draws.\n\n- One straight draw possible\n- No immediate flush draw\n- Opponent has many pairs and pair+draw combinations\n\n**Strategy:** Bet medium (1/2 pot) with strong hands. Check back marginal holdings. Good for balanced ranges."
        },
        {
          "type": "info",
          "content": "## Paired Boards\n\nExample: **A♠ A♦ 7♣** — paired board.\n\n- A full house or trips are possible\n- Whichever player has the Ace has a massive range advantage\n- Bluffing increases in value for the player with more aces in their range\n\n**If you 3-bet preflop:** you have more aces → continue aggressively.\n**If you cold called:** be cautious when facing aggression on paired boards."
        },
        {
          "type": "question",
          "content": "Board: 2♠ 7♦ 9♣ (rainbow, disconnected). This board is best described as:",
          "choices": [
            {
              "id": "a",
              "label": "Wet — many draws available"
            },
            {
              "id": "b",
              "label": "Dry — rainbow and disconnected, with few immediate draws"
            },
            {
              "id": "c",
              "label": "Semi-wet — moderate texture"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "question",
          "content": "Board: 8♠ 7♠ 6♦. You raised preflop and the caller checks. What's the correct approach?",
          "choices": [
            {
              "id": "a",
              "label": "C-bet any two cards — you're the raiser"
            },
            {
              "id": "b",
              "label": "Bet large with strong hands; check marginal hands — board hits caller's range"
            },
            {
              "id": "c",
              "label": "Always check — connected boards are too dangerous to bet"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "recap",
          "content": "## Board Texture Summary\n\n| Texture | Example | C-bet freq | C-bet size |\n|---|---|---|---|\n| Dry | A 7 2 rainbow | High | Small (1/3) |\n| Semi-wet | K Q 8 | Medium | Medium (1/2) |\n| Wet | J T 9 two-suit | Lower | Large (2/3+) |\n| Paired | A A 7 | Depends on range | Varies |\n\nRead the board before every postflop decision."
        }
      ],
      "skill_tags": [
        "postflop",
        "c_betting"
      ],
      "xp_reward": 10
    }
        $json$::jsonb,
    420,
    3,
    1,
    true
  ),
  -- lesson 16: Bet Sizing Quiz
  (
    16,
    3,
    'quiz'::public.lesson_type,
    'Bet Sizing Quiz',
    5,
    $json$
    {
      "screens": [
        {
          "type": "question",
          "content": "Board: A♦ 7♣ 2♠ (dry, rainbow). You have top pair. Best c-bet size?",
          "choices": [
            {
              "id": "a",
              "label": "1/3 pot"
            },
            {
              "id": "b",
              "label": "1/2 pot"
            },
            {
              "id": "c",
              "label": "Full pot"
            },
            {
              "id": "d",
              "label": "Check"
            }
          ],
          "correct_choice_id": "a"
        },
        {
          "type": "question",
          "content": "Board: K♠ Q♠ J♦ (wet, two-spade). You have top two pair. Best bet size?",
          "choices": [
            {
              "id": "a",
              "label": "1/3 pot — small to keep them in"
            },
            {
              "id": "b",
              "label": "2/3 to full pot — charge draws hard"
            },
            {
              "id": "c",
              "label": "Check-raise line"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "question",
          "content": "Standard preflop open-raise in a 6-max game ($1/$2). Best size?",
          "choices": [
            {
              "id": "a",
              "label": "$2 (1x BB — min raise)"
            },
            {
              "id": "b",
              "label": "$5–$6 (2.5x–3x BB)"
            },
            {
              "id": "c",
              "label": "$20 (10x BB)"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "question",
          "content": "You want to 3-bet in position. Villain raised to $6. Best 3-bet size?",
          "choices": [
            {
              "id": "a",
              "label": "$8 (barely more)"
            },
            {
              "id": "b",
              "label": "$18 (3x the raise)"
            },
            {
              "id": "c",
              "label": "$50 (too large)"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "question",
          "content": "You're bluffing on the river. Villain has checked. Pot is $100. What bluff size makes the most sense?",
          "choices": [
            {
              "id": "a",
              "label": "$10 — small bluff, low risk"
            },
            {
              "id": "b",
              "label": "$50–$75 — give opponent bad odds to call"
            },
            {
              "id": "c",
              "label": "$5 — just enough to bet"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "recap",
          "content": "## Bet Sizing Quick Rules\n\n- Dry board value = 1/3 pot\n- Wet board value/protection = 2/3+ pot\n- Preflop open = 2.5–3x BB\n- 3-bet in position = 3x raise; out of position = 4x\n- Bluffs must be large enough to deny opponent profitable odds"
        }
      ],
      "skill_tags": [
        "bet_sizing",
        "c_betting"
      ],
      "xp_reward": 10
    }
        $json$::jsonb,
    270,
    2,
    1,
    true
  ),
  -- lesson 17: Counting Your Outs
  (
    17,
    4,
    'concept'::public.lesson_type,
    'Counting Your Outs',
    1,
    $json$
    {
      "screens": [
        {
          "type": "info",
          "content": "## What Is an Out?\n\nAn **out** is a card that would improve your hand to likely the best hand.\n\nKnowing your outs is step one of every pot-odds calculation. Once you know your outs, you can estimate your equity (winning probability) and decide if a call is profitable."
        },
        {
          "type": "info",
          "content": "## Common Draw Counts\n\nAgainst an unknown hand, these are useful starting points:\n\n- **Flush draw:** usually 9 candidate outs\n- **Open-ended straight draw:** usually 8 candidate outs\n- **Gutshot:** usually 4 candidate outs\n- **Two overcards:** up to 6 candidate outs\n\nThey are not guarantees. Against a face-up hand, use the evaluator: a card can complete your draw yet also make the opponent a full house or better."
        },
        {
          "type": "info",
          "content": "## Combo Draws\n\nDraws can overlap. A flush draw plus an open-ended straight draw often has **15 distinct candidate outs**, not 17, because two cards complete both draws.\n\nWith two cards to come, 15 clean outs hit about **54%** of the time. That can support aggressive play, but “clean” depends on the opponent's actual hand and redraws—never hand-code the count in a face-up spot."
        },
        {
          "type": "info",
          "content": "## The Rule of 2 and 4\n\nEstimate equity from clean outs:\n\n- **One card to come:** outs × 2\n- **Two cards guaranteed:** outs × 4, accurate to about a point through 8 outs\n\nAbove 8 outs, ×4 double-counts runouts that hit twice. Subtract one point per out above 8:\n\n- 9 outs: 36% shortcut, **35% corrected**\n- 15 outs: 60% shortcut, **53% corrected**, about 54% exact\n\nUse two-card equity only when the current call guarantees both cards."
        },
        {
          "type": "info",
          "content": "## Clean vs Dirty Outs\n\n**Clean outs** make you the winner against the hand you are facing.\n\n**Dirty outs** appear to complete your draw but also improve the opponent to something better.\n\n**Example:** You hold J♠ T♠ on 9♠ 8♣ 2♠ against 9♦ 9♥. The 2♠ completes your flush, but it also pairs the board and gives the opponent a full house. The evaluator removes it from your winning outs."
        },
        {
          "type": "question",
          "content": "You hold K♠ Q♠. Board: A♠ 7♠ 2♣. How many flush outs do you have?",
          "choices": [
            {
              "id": "a",
              "label": "4"
            },
            {
              "id": "b",
              "label": "9"
            },
            {
              "id": "c",
              "label": "13"
            },
            {
              "id": "d",
              "label": "8"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "question",
          "content": "You hold 8♦ 7♦. Board: 9♣ 6♠ 2♥ on the turn (one card to come). Open-ended straight draw. Estimated equity using rule of 2?",
          "choices": [
            {
              "id": "a",
              "label": "32% (8 × 4)"
            },
            {
              "id": "b",
              "label": "16% (8 × 2)"
            },
            {
              "id": "c",
              "label": "8% (4 × 2)"
            },
            {
              "id": "d",
              "label": "36%"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "recap",
          "content": "## Outs and Equity — Quick Reference\n\n| Draw | Candidate outs | Two cards | One card |\n|---|---|---|---|\n| Flush draw | 9 | ~35% corrected | ~20% exact |\n| Open-ended straight | 8 | ~32% | ~17% exact |\n| Gutshot | 4 | ~16% | ~9% exact |\n| Two overcards | up to 6 | ~24% | ~13% exact |\n| Flush + OESD | often 15 | ~54% exact | ~33% exact |\n\n**Rule:** ×4 through 8 outs; above that apply the correction. ×2 is the quick one-card estimate. Against a known hand, let the evaluator remove dirty outs."
        }
      ],
      "skill_tags": [
        "counting_outs",
        "equity_estimation"
      ],
      "xp_reward": 10
    }
        $json$::jsonb,
    480,
    2,
    1,
    true
  ),
  -- lesson 18: Out Counting Quiz
  (
    18,
    4,
    'quiz'::public.lesson_type,
    'Out Counting Quiz',
    2,
    $json$
    {
      "screens": [
        {
          "type": "question",
          "content": "You hold 7♣ 6♣. Board: 8♠ 5♦ K♣. How many outs for the straight?",
          "choices": [
            {
              "id": "a",
              "label": "4 (gutshot)"
            },
            {
              "id": "b",
              "label": "8 (open-ended)"
            },
            {
              "id": "c",
              "label": "9 (flush draw)"
            },
            {
              "id": "d",
              "label": "13"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "question",
          "content": "The pot was $120 before Villain bet $40, so it is now $160. Calling costs $40. You have a gutshot (4 outs, one card to come). Should you call?",
          "choices": [
            {
              "id": "a",
              "label": "Yes — 4 outs is enough"
            },
            {
              "id": "b",
              "label": "No — equity (~9%) is much lower than required equity (20%)"
            },
            {
              "id": "c",
              "label": "Only with implied odds"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "question",
          "content": "You have a flush draw (9 outs) on the flop. Using the rule of 4, your equity is approximately?",
          "choices": [
            {
              "id": "a",
              "label": "18%"
            },
            {
              "id": "b",
              "label": "36%"
            },
            {
              "id": "c",
              "label": "9%"
            },
            {
              "id": "d",
              "label": "50%"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "question",
          "content": "You hold J♠ T♠ on a board of Q♠ 9♦ 3♠. What type of draw do you have?",
          "choices": [
            {
              "id": "a",
              "label": "Flush draw only — 9 outs"
            },
            {
              "id": "b",
              "label": "Open-ended straight draw only — 8 outs"
            },
            {
              "id": "c",
              "label": "Flush draw + gutshot — about 12 outs"
            },
            {
              "id": "d",
              "label": "Flush draw + open-ended straight — about 15 outs"
            }
          ],
          "correct_choice_id": "d"
        },
        {
          "type": "question",
          "content": "What does it mean to have a 'dirty out'?",
          "choices": [
            {
              "id": "a",
              "label": "A card that completes your draw but also helps your opponent"
            },
            {
              "id": "b",
              "label": "A card that's been folded already"
            },
            {
              "id": "c",
              "label": "An out that also gives you a flush"
            }
          ],
          "correct_choice_id": "a"
        },
        {
          "type": "recap",
          "content": "## Out Counting Summary\n\n- Flush draw: usually 9 candidate outs\n- OESD: usually 8\n- Gutshot: usually 4\n- Two overcards: up to 6\n- Combo draws: remove overlapping cards before counting\n\nUse ×2 with one card to come. Use ×4 through 8 outs with two guaranteed cards; above 8, apply the correction. Against a known hand, derive clean outs with the evaluator."
        }
      ],
      "skill_tags": [
        "counting_outs",
        "equity_estimation"
      ],
      "xp_reward": 10
    }
        $json$::jsonb,
    270,
    2,
    1,
    true
  ),
  -- lesson 19: Preflop Ranges Intro
  (
    19,
    5,
    'concept'::public.lesson_type,
    'Preflop Ranges Intro',
    1,
    $json$
    {
      "screens": [
        {
          "type": "info",
          "content": "## Think in Ranges, Not Hands\n\nBeginners ask: *What hand does my opponent have?*\n\nGood players ask: *What range of hands could my opponent have?*\n\nA **range** is the entire set of hands your opponent might hold given their actions. Thinking in ranges makes you a dramatically better player."
        },
        {
          "type": "info",
          "content": "## What Defines a Range?\n\nYour opponent's range is shaped by:\n\n1. **Position** — UTG raises a tighter range than BTN\n2. **Action** — Raise, call, limp, 3-bet all mean different things\n3. **History** — Prior bets narrow their likely hands\n4. **Player type** — Tight/aggressive, loose/passive, etc.\n\nEvery time they act, their range narrows."
        },
        {
          "type": "info",
          "content": "## PotLuck's UTG Reference (6-max)\n\nAt 100bb with a 2.5bb open, PotLuck's chart opens about **17% of combinations** from UTG. It includes big and medium pairs, suited aces, Broadway hands, and selected suited connectors, with a few mixed-frequency edges.\n\nOpen the Ranges page to see all 169 cells and combo-weighted percentages. This is a solver-shaped reference range, not live solver output; rake, stack depth, and sizing move the boundary."
        },
        {
          "type": "info",
          "content": "## PotLuck's BTN Reference (6-max)\n\nUnder the same assumptions, the Button opens about **45% of combinations**:\n\n- all pairs and suited aces\n- many suited kings and queens\n- Broadway hands, suited connectors, and selected offsuit hands\n- mixed frequencies near the weakest edge\n\nPosition supports the wider range because the Button acts last postflop. Treat the chart as a reference, not a promise for every game."
        },
        {
          "type": "info",
          "content": "## 3-Bet Ranges\n\nA **3-bet** is a preflop re-raise. Its shape depends on positions and whether calling is attractive:\n\n- **Linear:** value-heavy top hands plus the next-strongest hands; common when calls are awkward\n- **Polarized:** strong value hands plus bluffs with blockers or playability, while medium hands call\n\nThere is no universal “always polarized” rule. Position, opener range, rake, stacks, and sizing determine the mix."
        },
        {
          "type": "question",
          "content": "UTG raises. What does this tell you about their likely hand range?",
          "choices": [
            {
              "id": "a",
              "label": "They have any two cards — players bluff UTG often"
            },
            {
              "id": "b",
              "label": "They have a strong, tight range — UTG is early position"
            },
            {
              "id": "c",
              "label": "They are probably on a flush draw"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "question",
          "content": "The BTN 3-bets your CO raise. What should you consider about their range?",
          "choices": [
            {
              "id": "a",
              "label": "They always have Aces or Kings"
            },
            {
              "id": "b",
              "label": "Their range may mix strong value with suited/blocker bluffs"
            },
            {
              "id": "c",
              "label": "Their range must always be exactly linear"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "recap",
          "content": "## Range Thinking Summary\n\n- Every player holds a **range**, not one guessed hand\n- Position and each action narrow that range\n- PotLuck's reference opens are about **17% UTG** and **45% BTN**\n- 3-bet ranges can be linear or polarized depending on the spot\n- The charts are approximations, not solver output"
        }
      ],
      "skill_tags": [
        "hand_selection",
        "position"
      ],
      "xp_reward": 10
    }
        $json$::jsonb,
    480,
    3,
    1,
    true
  ),
  -- lesson 20: Discipline and Bankroll
  (
    20,
    5,
    'concept'::public.lesson_type,
    'Discipline and Bankroll',
    2,
    $json$
    {
      "screens": [
        {
          "type": "info",
          "content": "## The Game Off the Table\n\nMost poker losses aren't caused by bad luck — they're caused by bad **discipline**.\n\n- Playing at stakes too high\n- Chasing losses (going on tilt)\n- Playing too long when tired\n- Sitting in bad games\n\nThis lesson is about building the habits that protect your edge."
        },
        {
          "type": "info",
          "content": "## Bankroll Management Basics\n\nYour **bankroll** is money set aside specifically for poker. A starting cash-game guideline is **20–25 full buy-ins**; tournaments often require **50–100 or more** because variance is higher.\n\nAt $1/$2 with a $200 full buy-in, 20–25 buy-ins means roughly **$4,000–$5,000**, not $400–$500. Choose a more conservative cushion if the game is volatile or poker income matters. Never play with money you cannot afford to lose."
        },
        {
          "type": "info",
          "content": "## Move Down, Not Up\n\nSet move-up and move-down thresholds before emotion is involved. If losses take your bankroll below the number of buy-ins required for the current stake, move down and rebuild.\n\nA fixed number of session losses alone does not determine your stake—your remaining bankroll and risk tolerance do. Moving up to chase a loss is never bankroll management."
        },
        {
          "type": "info",
          "content": "## Tilt Recognition\n\nTilt is an emotional state where bad beats or frustration cause you to make poor decisions.\n\nSigns of tilt:\n- Calling raises you'd normally fold\n- Making large bluffs without good reason\n- Feeling angry or frustrated at the table\n- Chasing losses with bigger bets\n\n**The only cure:** Take a break. Leave the table. Return when calm."
        },
        {
          "type": "question",
          "content": "You're playing $1/$2 cash games. What's the minimum bankroll you should have dedicated to this stake?",
          "choices": [
            {
              "id": "a",
              "label": "$40 (2 buy-ins)"
            },
            {
              "id": "b",
              "label": "$4,000–$5,000 (20–25 full $200 buy-ins)"
            },
            {
              "id": "c",
              "label": "$2,000 (100 buy-ins)"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "question",
          "content": "You've lost 4 buy-ins in one session. What's the most disciplined response?",
          "choices": [
            {
              "id": "a",
              "label": "Double your buy-in and try to win it back"
            },
            {
              "id": "b",
              "label": "Stop playing, evaluate what went wrong, consider moving down"
            },
            {
              "id": "c",
              "label": "Keep playing — variance always evens out"
            }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "recap",
          "content": "## Discipline Rules\n\n1. Keep a dedicated bankroll; **20–25 cash buy-ins** is a starting guideline\n2. At $1/$2 with $200 buy-ins, that is about **$4,000–$5,000**\n3. Move down when your bankroll falls below your preset threshold\n4. Quit or pause when tilt changes your decisions\n5. Judge decisions by process, not by one result"
        }
      ],
      "skill_tags": [
        "discipline"
      ],
      "xp_reward": 10
    }
        $json$::jsonb,
    360,
    1,
    1,
    true
  )
on conflict (id) do update set
  module_id = excluded.module_id,
  lesson_type = excluded.lesson_type,
  title = excluded.title,
  order_index = excluded.order_index,
  content_json = excluded.content_json,
  estimated_time_seconds = excluded.estimated_time_seconds,
  difficulty = excluded.difficulty,
  version = excluded.version,
  is_active = excluded.is_active;

insert into public.scenarios
  (id, module_id, skill_tag, difficulty, scenario_json, version, is_active)
values
  -- scenario 01: hand_rankings
  (
    1,
    1,
    'hand_rankings',
    1,
    $json$
    {
      "prompt": "You hold A♠ K♣. Board: A♦ A♥ K♠ 7♣ 2♦. What is your best hand?",
      "game_state": {
        "pot": 100,
        "stack": 400
      },
      "hero_cards": [
        "A♠",
        "K♣"
      ],
      "board": [
        "A♦",
        "A♥",
        "K♠",
        "7♣",
        "2♦"
      ],
      "street": "river",
      "villain_archetype": null,
      "choices": [
        {
          "id": "a",
          "label": "Full House — Aces full of Kings"
        },
        {
          "id": "b",
          "label": "Three of a Kind — Aces"
        },
        {
          "id": "c",
          "label": "Two Pair — Aces and Kings"
        }
      ],
      "evaluation": {
        "correct_choice_id": "a",
        "acceptable_choice_ids": []
      },
      "explanation": "You hold A A A K K — a full house. Aces full of Kings is a monster hand.",
      "rule_of_thumb": "Count your hole cards plus the board to find your best 5-card hand."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 02: hand_rankings
  (
    2,
    1,
    'hand_rankings',
    1,
    $json$
    {
      "prompt": "You hold 8♠ 8♣. Board: 8♦ 8♥ 3♠ 7♣ 2♦. What do you have?",
      "game_state": {
        "pot": 80,
        "stack": 400
      },
      "hero_cards": [
        "8♠",
        "8♣"
      ],
      "board": [
        "8♦",
        "8♥",
        "3♠",
        "7♣",
        "2♦"
      ],
      "street": "river",
      "villain_archetype": null,
      "choices": [
        {
          "id": "a",
          "label": "Full House"
        },
        {
          "id": "b",
          "label": "Four of a Kind"
        },
        {
          "id": "c",
          "label": "Straight Flush"
        }
      ],
      "evaluation": {
        "correct_choice_id": "b",
        "acceptable_choice_ids": []
      },
      "explanation": "You hold 8 8 8 8 — four of a kind. With quad eights you have an extremely strong hand.",
      "rule_of_thumb": "Four of a kind ranks 3rd overall, behind only straight flush and royal flush."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 03: position
  (
    3,
    1,
    'position',
    1,
    $json$
    {
      "prompt": "You're on the Button. The action folds to you. You hold K♦ 9♦. Blinds are 1/2. What do you do?",
      "game_state": {
        "pot": 3,
        "stack": 200,
        "position": "BTN"
      },
      "hero_cards": [
        "K♦",
        "9♦"
      ],
      "board": [],
      "street": "preflop",
      "villain_archetype": null,
      "choices": [
        {
          "id": "a",
          "label": "Fold — K9 is too weak"
        },
        {
          "id": "b",
          "label": "Raise to 6 — good hand in best position"
        },
        {
          "id": "c",
          "label": "Limp to 2 — see a cheap flop"
        }
      ],
      "evaluation": {
        "correct_choice_id": "b",
        "acceptable_choice_ids": []
      },
      "explanation": "K9 suited on the Button is a profitable open. You act last postflop, giving you a major advantage. Raise to build the pot.",
      "rule_of_thumb": "Steal the blinds frequently from the Button. Your positional advantage outweighs a marginal hand."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 04: position
  (
    4,
    1,
    'position',
    1,
    $json$
    {
      "prompt": "You're in the Small Blind. Everyone folds to you. You hold Q♠ 7♦. What do you do?",
      "game_state": {
        "pot": 3,
        "stack": 200,
        "position": "SB"
      },
      "hero_cards": [
        "Q♠",
        "7♦"
      ],
      "board": [],
      "street": "preflop",
      "villain_archetype": null,
      "choices": [
        {
          "id": "a",
          "label": "Raise — heads up against the BB is fine"
        },
        {
          "id": "b",
          "label": "Fold — Q7o is too weak out of position"
        },
        {
          "id": "c",
          "label": "Limp — complete the blind cheaply"
        }
      ],
      "evaluation": {
        "correct_choice_id": "b",
        "acceptable_choice_ids": []
      },
      "explanation": "Q7o from the SB means you'll play the rest of the hand out of position. The hand is too weak to justify the positional disadvantage.",
      "rule_of_thumb": "Fold marginal hands from the SB. The positional penalty is severe."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 05: position
  (
    5,
    1,
    'position',
    2,
    $json$
    {
      "prompt": "UTG raises to 6 ($1/2 game). You're in the BB with J♠ T♠. Should you call?",
      "game_state": {
        "pot": 9,
        "stack": 200,
        "position": "BB"
      },
      "hero_cards": [
        "J♠",
        "T♠"
      ],
      "board": [],
      "street": "preflop",
      "villain_archetype": "Tight player",
      "choices": [
        {
          "id": "a",
          "label": "Call — JTs is a good hand and you only need 4 more to close"
        },
        {
          "id": "b",
          "label": "Fold — UTG's range is too tight"
        },
        {
          "id": "c",
          "label": "3-bet squeeze"
        }
      ],
      "evaluation": {
        "correct_choice_id": "a",
        "acceptable_choice_ids": [
          "c"
        ]
      },
      "explanation": "JTs has great multiway potential — straights, flushes, strong pairs. The price is right and the BB closes the action.",
      "rule_of_thumb": "Suited connectors in the BB against one raiser are a solid call when the price is right."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 06: pot_odds
  (
    6,
    1,
    'pot_odds',
    1,
    $json$
    {
      "prompt": "The pot is $100 after Villain's $20 bet. Calling costs $20. You have a clean 9-out flush draw with one card to come. Do you call?",
      "game_state": {
        "pot": 100,
        "call": 20,
        "stack": 300
      },
      "hero_cards": [
        "K♠",
        "Q♠"
      ],
      "board": [
        "A♠",
        "7♦",
        "3♣",
        "J♥"
      ],
      "street": "turn",
      "villain_archetype": "Passive",
      "choices": [
        {
          "id": "a",
          "label": "Call — ~19.6% equity exceeds the 16.7% required"
        },
        {
          "id": "b",
          "label": "Fold — flush draws never hit"
        },
        {
          "id": "c",
          "label": "Raise — push equity"
        }
      ],
      "evaluation": {
        "correct_choice_id": "a",
        "acceptable_choice_ids": []
      },
      "explanation": "Required equity is 20/(100+20) = 16.7%. Nine clean outs with one card to come hit 9/46 = 19.6%, so the direct price is sufficient.",
      "rule_of_thumb": "Name the current pot after the bet, then divide call by pot plus call."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 07: pot_odds
  (
    7,
    1,
    'pot_odds',
    2,
    $json$
    {
      "prompt": "The pot was $100 before Villain bet $100. It is now $200 and calling costs $100. You have a gutshot with one card to come. Do you call?",
      "game_state": {
        "pot": 200,
        "call": 100,
        "stack": 300
      },
      "hero_cards": [
        "J♥",
        "9♠"
      ],
      "board": [
        "A♦",
        "T♣",
        "3♠",
        "7♥"
      ],
      "street": "turn",
      "villain_archetype": "Aggressive",
      "choices": [
        {
          "id": "a",
          "label": "Call — any draw is worth calling"
        },
        {
          "id": "b",
          "label": "Fold — ~9% equity is far below the 33.3% required"
        },
        {
          "id": "c",
          "label": "Raise all-in"
        }
      ],
      "evaluation": {
        "correct_choice_id": "b",
        "acceptable_choice_ids": []
      },
      "explanation": "Required equity is 100/(200+100) = 33.3%. Four clean outs with one card to come hit 4/46 = 8.7%. This is a clear fold.",
      "rule_of_thumb": "Never call a gutshot for pot-sized bets on the turn without massive implied odds."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 08: pot_odds
  (
    8,
    1,
    'pot_odds',
    2,
    $json$
    {
      "prompt": "The pot was $60 before Villain bet $20. It is now $80 and calling costs $20. With an open-ended straight draw and two cards guaranteed, do you call?",
      "game_state": {
        "pot": 80,
        "call": 20,
        "stack": 250
      },
      "hero_cards": [
        "9♠",
        "8♣"
      ],
      "board": [
        "T♦",
        "7♥",
        "2♠"
      ],
      "street": "flop",
      "villain_archetype": "Passive",
      "choices": [
        {
          "id": "a",
          "label": "Call — ~32% equity exceeds the 20% required"
        },
        {
          "id": "b",
          "label": "Fold — straight draws are unreliable"
        },
        {
          "id": "c",
          "label": "Raise — you have a draw"
        }
      ],
      "evaluation": {
        "correct_choice_id": "a",
        "acceptable_choice_ids": [
          "c"
        ]
      },
      "explanation": "Required equity is 20/(80+20) = 20%. Eight clean outs with two cards guaranteed are about 32%, so the price is sufficient. If another bet can come, evaluate one street at a time.",
      "rule_of_thumb": "Open-ended straight draws on the flop almost always have the equity to call reasonable bets."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 09: hand_selection
  (
    9,
    2,
    'hand_selection',
    1,
    $json$
    {
      "prompt": "You're UTG in a 6-max game. You hold 7♦ 5♦. What should you do?",
      "game_state": {
        "pot": 3,
        "stack": 200,
        "position": "UTG"
      },
      "hero_cards": [
        "7♦",
        "5♦"
      ],
      "board": [],
      "street": "preflop",
      "villain_archetype": null,
      "choices": [
        {
          "id": "a",
          "label": "Fold — too speculative from early position"
        },
        {
          "id": "b",
          "label": "Raise — suited cards are always profitable"
        },
        {
          "id": "c",
          "label": "Limp"
        }
      ],
      "evaluation": {
        "correct_choice_id": "a",
        "acceptable_choice_ids": []
      },
      "explanation": "75 suited is a speculative hand that needs position and multiway pots to profit. UTG is the worst position to play it from.",
      "rule_of_thumb": "Fold speculative hands from UTG. They need position to realize their potential."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 10: hand_selection
  (
    10,
    2,
    'hand_selection',
    1,
    $json$
    {
      "prompt": "You're BTN in a 6-max game. Action folds to you. You hold A♣ 3♣. What do you do?",
      "game_state": {
        "pot": 3,
        "stack": 200,
        "position": "BTN"
      },
      "hero_cards": [
        "A♣",
        "3♣"
      ],
      "board": [],
      "street": "preflop",
      "villain_archetype": null,
      "choices": [
        {
          "id": "a",
          "label": "Fold — weak ace"
        },
        {
          "id": "b",
          "label": "Raise — suited ace with position is profitable"
        },
        {
          "id": "c",
          "label": "Limp"
        }
      ],
      "evaluation": {
        "correct_choice_id": "b",
        "acceptable_choice_ids": []
      },
      "explanation": "A3 suited on the Button plays well in position. You can flop the nut flush draw, a pair with a nut kicker, or make strong nut flush combinations.",
      "rule_of_thumb": "Suited aces from late position are worth raising. The nut flush draw potential is valuable."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 11: hand_selection
  (
    11,
    2,
    'hand_selection',
    2,
    $json$
    {
      "prompt": "CO opens. BTN calls. You're in the SB with A♠ J♠. What do you do?",
      "game_state": {
        "pot": 9,
        "stack": 200,
        "position": "SB"
      },
      "hero_cards": [
        "A♠",
        "J♠"
      ],
      "board": [],
      "street": "preflop",
      "villain_archetype": "Mixed",
      "choices": [
        {
          "id": "a",
          "label": "Call — AJs is too good to fold"
        },
        {
          "id": "b",
          "label": "3-bet — punish multi-way pots with a strong hand"
        },
        {
          "id": "c",
          "label": "Fold — tough spot out of position"
        }
      ],
      "evaluation": {
        "correct_choice_id": "b",
        "acceptable_choice_ids": [
          "c"
        ]
      },
      "explanation": "AJs is a strong 3-bet hand from the SB. Squeezing isolates one player and puts you in a heads-up pot with a strong hand.",
      "rule_of_thumb": "3-bet strong hands from the blinds to avoid playing multiway pots out of position."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 12: c_betting
  (
    12,
    3,
    'c_betting',
    1,
    $json$
    {
      "prompt": "You raised BTN with A♥ K♦. BB called. Flop: A♣ 7♠ 2♦. BB checks. What do you do?",
      "game_state": {
        "pot": 12,
        "stack": 188
      },
      "hero_cards": [
        "A♥",
        "K♦"
      ],
      "board": [
        "A♣",
        "7♠",
        "2♦"
      ],
      "street": "flop",
      "villain_archetype": "Passive",
      "choices": [
        {
          "id": "a",
          "label": "C-bet 1/3 pot — top pair, top kicker on a dry board"
        },
        {
          "id": "b",
          "label": "Check behind — pot control with TPTK"
        },
        {
          "id": "c",
          "label": "C-bet full pot — protect the hand"
        }
      ],
      "evaluation": {
        "correct_choice_id": "a",
        "acceptable_choice_ids": []
      },
      "explanation": "Dry board, top pair top kicker. Small c-bet extracts value from draws and weaker pairs. No need to bet large with no significant draws.",
      "rule_of_thumb": "Bet small on dry boards. Your strong hand dominates, and you don't need to charge draws that don't exist."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 13: c_betting
  (
    13,
    3,
    'c_betting',
    2,
    $json$
    {
      "prompt": "You raised CO with K♠ K♣. BB calls. Flop: A♦ 8♣ 3♥. BB checks to you. What do you do?",
      "game_state": {
        "pot": 14,
        "stack": 186
      },
      "hero_cards": [
        "K♠",
        "K♣"
      ],
      "board": [
        "A♦",
        "8♣",
        "3♥"
      ],
      "street": "flop",
      "villain_archetype": "Loose-passive",
      "choices": [
        {
          "id": "a",
          "label": "C-bet — you're the preflop raiser"
        },
        {
          "id": "b",
          "label": "Check — the Ace hurts your hand; pot control"
        },
        {
          "id": "c",
          "label": "Bet large — protect kings"
        }
      ],
      "evaluation": {
        "correct_choice_id": "b",
        "acceptable_choice_ids": []
      },
      "explanation": "The Ace likely hit the BB's calling range. Your kings are now an underpair to a likely made hand. Checking is the right play to control the pot and see a free card.",
      "rule_of_thumb": "When an overcard hits and you have an overpair, pot control by checking is often correct."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 14: c_betting
  (
    14,
    3,
    'c_betting',
    2,
    $json$
    {
      "prompt": "You raised BTN with Q♥ J♥. BB calls. Flop: 9♠ 8♣ 7♦. BB checks. What do you do?",
      "game_state": {
        "pot": 12,
        "stack": 188
      },
      "hero_cards": [
        "Q♥",
        "J♥"
      ],
      "board": [
        "9♠",
        "8♣",
        "7♦"
      ],
      "street": "flop",
      "villain_archetype": "Passive",
      "choices": [
        {
          "id": "a",
          "label": "C-bet — you have an overpair"
        },
        {
          "id": "b",
          "label": "Check — this board hits the BB's range hard; Q-high has limited equity"
        },
        {
          "id": "c",
          "label": "Bet large to represent a set"
        }
      ],
      "evaluation": {
        "correct_choice_id": "b",
        "acceptable_choice_ids": []
      },
      "explanation": "A 9-8-7 board is one of the worst for the preflop raiser. The caller's range includes many two-pair hands, sets, and straights. Check back with air.",
      "rule_of_thumb": "Don't c-bet connected boards with nothing. The caller's range hits these flops harder."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 15: postflop
  (
    15,
    3,
    'postflop',
    2,
    $json$
    {
      "prompt": "You hold T♠ T♦ on a board of T♣ 5♥ 2♦. Villain bets 3/4 pot. What do you do?",
      "game_state": {
        "pot": 80,
        "stack": 300
      },
      "hero_cards": [
        "T♠",
        "T♦"
      ],
      "board": [
        "T♣",
        "5♥",
        "2♦"
      ],
      "street": "flop",
      "villain_archetype": "Aggressive",
      "choices": [
        {
          "id": "a",
          "label": "Call — slowplay top set"
        },
        {
          "id": "b",
          "label": "Raise — build the pot with top set on a dry board"
        },
        {
          "id": "c",
          "label": "Fold — they might have a set"
        }
      ],
      "evaluation": {
        "correct_choice_id": "b",
        "acceptable_choice_ids": [
          "a"
        ]
      },
      "explanation": "Top set on a dry board. Raising builds the pot and protects against runners. Calling is acceptable but raising extracts more value.",
      "rule_of_thumb": "Top set on dry boards is often a raise/re-raise situation. Get value now."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 16: postflop
  (
    16,
    3,
    'postflop',
    3,
    $json$
    {
      "prompt": "River: You hold A♣ K♣ on A♦ K♠ 8♥ 2♣ 5♦. Villain checks. Pot: $200. What's your action?",
      "game_state": {
        "pot": 200,
        "stack": 300
      },
      "hero_cards": [
        "A♣",
        "K♣"
      ],
      "board": [
        "A♦",
        "K♠",
        "8♥",
        "2♣",
        "5♦"
      ],
      "street": "river",
      "villain_archetype": "Passive-calling",
      "choices": [
        {
          "id": "a",
          "label": "Check — don't risk a check-raise"
        },
        {
          "id": "b",
          "label": "Bet 2/3 pot — value bet top two pair on a blank river"
        },
        {
          "id": "c",
          "label": "Bet full pot"
        }
      ],
      "evaluation": {
        "correct_choice_id": "b",
        "acceptable_choice_ids": []
      },
      "explanation": "Two pair (aces and kings) is an excellent value hand. Against a passive caller, bet 2/3 pot to extract value from worse aces and sets.",
      "rule_of_thumb": "Bet for value on the river with strong hands against calling stations. Don't let them see a free showdown."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 17: value_betting
  (
    17,
    2,
    'value_betting',
    2,
    $json$
    {
      "prompt": "River: Board A♠ K♦ 7♣ 2♥ 9♠. You hold A♥ Q♦ (top pair). Villain checks. Pot: $120. What do you do?",
      "game_state": {
        "pot": 120,
        "stack": 280
      },
      "hero_cards": [
        "A♥",
        "Q♦"
      ],
      "board": [
        "A♠",
        "K♦",
        "7♣",
        "2♥",
        "9♠"
      ],
      "street": "river",
      "villain_archetype": "Passive",
      "choices": [
        {
          "id": "a",
          "label": "Check — scared of a better ace"
        },
        {
          "id": "b",
          "label": "Bet 1/3 pot for thin value — you beat weaker aces and kings"
        },
        {
          "id": "c",
          "label": "Bet full pot"
        }
      ],
      "evaluation": {
        "correct_choice_id": "b",
        "acceptable_choice_ids": []
      },
      "explanation": "Top pair with a Queen kicker is strong on this dry board against a passive player. Bet small to extract value from worse aces, weak kings, and busted draws.",
      "rule_of_thumb": "Thin value bets with top pair on dry boards against passive opponents are profitable long term."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 18: value_betting
  (
    18,
    2,
    'value_betting',
    3,
    $json$
    {
      "prompt": "River: Board K♦ K♠ 7♣ 7♥ Q♦. You hold Q♣ Q♠ (full house, Queens full of Kings). Pot: $200. Villain bets $80. What do you do?",
      "game_state": {
        "pot": 200,
        "stack": 400
      },
      "hero_cards": [
        "Q♣",
        "Q♠"
      ],
      "board": [
        "K♦",
        "K♠",
        "7♣",
        "7♥",
        "Q♦"
      ],
      "street": "river",
      "villain_archetype": "Aggressive",
      "choices": [
        {
          "id": "a",
          "label": "Call — full house is strong"
        },
        {
          "id": "b",
          "label": "Raise for value — Sevens and smaller full houses can pay"
        },
        {
          "id": "c",
          "label": "Fold — the board is paired"
        }
      ],
      "evaluation": {
        "correct_choice_id": "b",
        "acceptable_choice_ids": []
      },
      "explanation": "Queens full is a monster, but any opponent holding a King makes Kings full and beats you. A raise can still extract value from a Seven or a smaller full house; do not mistake the hand for the nuts.",
      "rule_of_thumb": "On double-paired boards, identify every single-card holding that makes a higher full house before raising."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 19: bluffing
  (
    19,
    2,
    'bluffing',
    2,
    $json$
    {
      "prompt": "River: Board A♠ K♦ Q♣ J♠ 2♥. You hold 9♦ 8♦ (missed straight draw). Pot: $160. Villain checks. What do you do?",
      "game_state": {
        "pot": 160,
        "stack": 300
      },
      "hero_cards": [
        "9♦",
        "8♦"
      ],
      "board": [
        "A♠",
        "K♦",
        "Q♣",
        "J♠",
        "2♥"
      ],
      "street": "river",
      "villain_archetype": "Tight",
      "choices": [
        {
          "id": "a",
          "label": "Check — showdown is fine"
        },
        {
          "id": "b",
          "label": "Bet large — the board is scary for their value hands"
        },
        {
          "id": "c",
          "label": "Bet small to try to win"
        }
      ],
      "evaluation": {
        "correct_choice_id": "b",
        "acceptable_choice_ids": []
      },
      "explanation": "This board is terrifying for top pair and two pair hands. A large bet on a four-Broadway board puts maximum pressure. Your opponent's checking range is mostly weak.",
      "rule_of_thumb": "Bluff large on boards that complete terrifying draws. Bet sizing is what makes bluffs profitable."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 20: bluffing
  (
    20,
    2,
    'bluffing',
    3,
    $json$
    {
      "prompt": "You 3-bet preflop. Flop: 7♦ 3♣ 2♥ (completely dry). Villain checks. You hold J♠ T♠. What do you do?",
      "game_state": {
        "pot": 30,
        "stack": 270
      },
      "hero_cards": [
        "J♠",
        "T♠"
      ],
      "board": [
        "7♦",
        "3♣",
        "2♥"
      ],
      "street": "flop",
      "villain_archetype": "Weak-tight",
      "choices": [
        {
          "id": "a",
          "label": "Check — you have no hand"
        },
        {
          "id": "b",
          "label": "Bet 1/3 pot — this board misses calling ranges and you have backdoor equity"
        },
        {
          "id": "c",
          "label": "Give up immediately"
        }
      ],
      "evaluation": {
        "correct_choice_id": "b",
        "acceptable_choice_ids": []
      },
      "explanation": "A 3-bet range crushes a 7-3-2 board. Your opponent's calling range doesn't hit this well. A small c-bet wins the pot often enough to be profitable.",
      "rule_of_thumb": "C-bet dry boards as the 3-bettor. Your perceived range advantage is highest when the board doesn't connect."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 21: bet_sizing
  (
    21,
    3,
    'bet_sizing',
    1,
    $json$
    {
      "prompt": "Flop: K♠ 7♦ 2♣ (dry). You have top pair (AK). Pot: $20. What's the correct bet size?",
      "game_state": {
        "pot": 20,
        "stack": 280
      },
      "hero_cards": [
        "A♠",
        "K♣"
      ],
      "board": [
        "K♠",
        "7♦",
        "2♣"
      ],
      "street": "flop",
      "villain_archetype": "Passive",
      "choices": [
        {
          "id": "a",
          "label": "$5 — about 1/4 pot"
        },
        {
          "id": "b",
          "label": "$7 — about 1/3 pot"
        },
        {
          "id": "c",
          "label": "$20 — full pot"
        }
      ],
      "evaluation": {
        "correct_choice_id": "b",
        "acceptable_choice_ids": [
          "a"
        ]
      },
      "explanation": "On a dry board with top pair, a 1/3 pot bet extracts value efficiently. Larger sizes don't add much because there are few draws to charge.",
      "rule_of_thumb": "On dry boards, bet small. No draws = no need for large protection bets."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 22: bet_sizing
  (
    22,
    3,
    'bet_sizing',
    2,
    $json$
    {
      "prompt": "Flop: Q♠ J♠ T♣ (very wet). You have top set (QQ). Pot: $30. What's the correct bet size?",
      "game_state": {
        "pot": 30,
        "stack": 270
      },
      "hero_cards": [
        "Q♦",
        "Q♣"
      ],
      "board": [
        "Q♠",
        "J♠",
        "T♣"
      ],
      "street": "flop",
      "villain_archetype": "Aggressive",
      "choices": [
        {
          "id": "a",
          "label": "$10 — small, keep them in"
        },
        {
          "id": "b",
          "label": "$20 — 2/3 pot, charge draws hard"
        },
        {
          "id": "c",
          "label": "$30 — full pot protection"
        }
      ],
      "evaluation": {
        "correct_choice_id": "b",
        "acceptable_choice_ids": [
          "c"
        ]
      },
      "explanation": "Top set on a wet board. Many draws threaten your hand. Bet 2/3 pot to charge flush draws and straight draws while extracting value.",
      "rule_of_thumb": "Bet large on wet boards when you have strong value. Protect and extract simultaneously."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 23: bet_sizing
  (
    23,
    3,
    'bet_sizing',
    3,
    $json$
    {
      "prompt": "River: Board J♦ 9♣ 5♠ 2♦ 8♥. You hold K♠ Q♣ (missed straight draw, no pair). Pot: $100. Villain checks. What bluff size makes sense?",
      "game_state": {
        "pot": 100,
        "stack": 300
      },
      "hero_cards": [
        "K♠",
        "Q♣"
      ],
      "board": [
        "J♦",
        "9♣",
        "5♠",
        "2♦",
        "8♥"
      ],
      "street": "river",
      "villain_archetype": "Tight",
      "choices": [
        {
          "id": "a",
          "label": "$15 — small blocker bet"
        },
        {
          "id": "b",
          "label": "$65 — ~2/3 pot to deny profitable calling odds"
        },
        {
          "id": "c",
          "label": "$100 — full pot jam"
        }
      ],
      "evaluation": {
        "correct_choice_id": "b",
        "acceptable_choice_ids": []
      },
      "explanation": "Betting $65 into $100 makes the pot $165 before a call. Villain calls $65 to win $230, so they need about 28% equity—not 33%. The large size puts real pressure on marginal bluff-catchers.",
      "rule_of_thumb": "For the caller's price, use call ÷ (pot after the bet + call). A two-thirds-pot bet asks for about 28.6% equity."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 24: discipline
  (
    24,
    5,
    'discipline',
    1,
    $json$
    {
      "prompt": "You've lost 3 buy-ins in 2 hours. You're frustrated. A new seat opens at a higher-stakes table. What do you do?",
      "game_state": {
        "pot": 0,
        "stack": 0
      },
      "hero_cards": [],
      "board": [],
      "street": null,
      "villain_archetype": null,
      "choices": [
        {
          "id": "a",
          "label": "Move up — win it back faster"
        },
        {
          "id": "b",
          "label": "Stay at your current stake and reset mentally"
        },
        {
          "id": "c",
          "label": "Go home — never play when tilting"
        }
      ],
      "evaluation": {
        "correct_choice_id": "c",
        "acceptable_choice_ids": [
          "b"
        ]
      },
      "explanation": "Chasing losses by moving up is one of the biggest bankroll killers. When tilting, the best play is always to stop playing.",
      "rule_of_thumb": "Tilt costs more than any bad beat. Stopping when you're emotionally compromised is always +EV."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 25: discipline
  (
    25,
    5,
    'discipline',
    2,
    $json$
    {
      "prompt": "You're running well and have doubled your stack. A friend invites you to a game 4 stakes higher than your usual. What do you do?",
      "game_state": {
        "pot": 0,
        "stack": 0
      },
      "hero_cards": [],
      "board": [],
      "street": null,
      "villain_archetype": null,
      "choices": [
        {
          "id": "a",
          "label": "Go — you're hot right now"
        },
        {
          "id": "b",
          "label": "Decline — your bankroll isn't built for that stake"
        },
        {
          "id": "c",
          "label": "Play a few hands and see how it feels"
        }
      ],
      "evaluation": {
        "correct_choice_id": "b",
        "acceptable_choice_ids": []
      },
      "explanation": "A hot streak doesn't change your edge at higher stakes. Your bankroll rules should govern your stake, not recent results.",
      "rule_of_thumb": "Bankroll discipline means sticking to your limits even when running well. Variance works both ways."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 26: hand_selection
  (
    26,
    5,
    'hand_selection',
    3,
    $json$
    {
      "prompt": "You 3-bet from the BTN, the CO calls, and the flop is A♠ K♦ Q♣. CO checks. You hold 7♠ 7♦. What do you do?",
      "game_state": {
        "pot": 45,
        "stack": 255
      },
      "hero_cards": [
        "7♠",
        "7♦"
      ],
      "board": [
        "A♠",
        "K♦",
        "Q♣"
      ],
      "street": "flop",
      "villain_archetype": "Tight",
      "choices": [
        {
          "id": "a",
          "label": "C-bet — represent the top of your range"
        },
        {
          "id": "b",
          "label": "Check — preserve showdown value with no useful blocker"
        },
        {
          "id": "c",
          "label": "Fold — too dangerous"
        }
      ],
      "evaluation": {
        "correct_choice_id": "b",
        "acceptable_choice_ids": []
      },
      "explanation": "The 3-bettor has a strong range on A-K-Q, but pocket Sevens block none of the caller's continues and retain some showdown value. Checking is better than betting automatically just because you have range advantage.",
      "rule_of_thumb": "Range advantage supports betting frequency; it does not mean every individual hand should bet. Consider blockers, equity, and showdown value."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 27: postflop
  (
    27,
    3,
    'postflop',
    2,
    $json$
    {
      "prompt": "You hold 6♠ 5♠. Flop: 8♠ 7♠ 9♦. Villain bets 2/3 pot. You already have a 9-high straight plus a flush redraw. Action?",
      "game_state": {
        "pot": 60,
        "stack": 250
      },
      "hero_cards": [
        "6♠",
        "5♠"
      ],
      "board": [
        "8♠",
        "7♠",
        "9♦"
      ],
      "street": "flop",
      "villain_archetype": "Aggressive",
      "choices": [
        {
          "id": "a",
          "label": "Fold — too many bad cards could come"
        },
        {
          "id": "b",
          "label": "Call — keep bluffs in with a made straight"
        },
        {
          "id": "c",
          "label": "Raise — build value and charge higher-spade draws"
        }
      ],
      "evaluation": {
        "correct_choice_id": "c",
        "acceptable_choice_ids": [
          "b"
        ]
      },
      "explanation": "5-6-7-8-9 is already a made straight. The spades provide a redraw, but the coordinated board also gives Villain strong made hands and higher flush draws. Raising for value/protection is reasonable; calling is also acceptable.",
      "rule_of_thumb": "Read the made hand before counting draws. A redraw is backup equity, not the whole hand."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 28: postflop
  (
    28,
    3,
    'postflop',
    3,
    $json$
    {
      "prompt": "River: You hold A♦ A♣ on A♥ K♠ 5♦ 2♣ J♠. The pot was $200, you bet $150, and Villain shoves to $300 total. Calling costs $150. What do you do?",
      "game_state": {
        "pot_after_raise": 650,
        "call": 150
      },
      "hero_cards": [
        "A♦",
        "A♣"
      ],
      "board": [
        "A♥",
        "K♠",
        "5♦",
        "2♣",
        "J♠"
      ],
      "street": "river",
      "villain_archetype": "Tight-aggressive",
      "choices": [
        {
          "id": "a",
          "label": "Fold — they must have a straight"
        },
        {
          "id": "b",
          "label": "Call — top set needs only 18.75% equity at this price"
        },
        {
          "id": "c",
          "label": "Raise all-in over the top"
        }
      ],
      "evaluation": {
        "correct_choice_id": "b",
        "acceptable_choice_ids": []
      },
      "explanation": "The pot is $650 after the shove and a $150 call makes the final pot $800, so you need 18.75% equity. Q-T makes Broadway, but top set beats worse sets, two pair, and bluffs often enough for this price in the authored spot.",
      "rule_of_thumb": "On the river, enumerate the exact two-card combinations that beat you before making a large bluff-catch."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 29: 3betting
  (
    29,
    2,
    '3betting',
    2,
    $json$
    {
      "prompt": "UTG raises. You're CO with A♠ K♠. What do you do?",
      "game_state": {
        "pot": 6,
        "stack": 200,
        "position": "CO"
      },
      "hero_cards": [
        "A♠",
        "K♠"
      ],
      "board": [],
      "street": "preflop",
      "villain_archetype": "Tight-aggressive",
      "choices": [
        {
          "id": "a",
          "label": "Call — just call with AKs"
        },
        {
          "id": "b",
          "label": "3-bet — AKs is a premium 3-bet hand"
        },
        {
          "id": "c",
          "label": "Fold — UTG is too strong"
        }
      ],
      "evaluation": {
        "correct_choice_id": "b",
        "acceptable_choice_ids": []
      },
      "explanation": "AKs is a top 3-bet hand. You have excellent equity against UTG's range and you want to build a big pot with a premium holding.",
      "rule_of_thumb": "3-bet premium hands like AKs for value. Calling allows players behind to squeeze."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 30: 3betting
  (
    30,
    2,
    '3betting',
    3,
    $json$
    {
      "prompt": "BTN raises. You're in the BB with K♣ Q♦. The BTN is a loose-aggressive player. What do you do?",
      "game_state": {
        "pot": 6,
        "stack": 200,
        "position": "BB"
      },
      "hero_cards": [
        "K♣",
        "Q♦"
      ],
      "board": [],
      "street": "preflop",
      "villain_archetype": "Loose-aggressive",
      "choices": [
        {
          "id": "a",
          "label": "Fold — KQo out of position is tough"
        },
        {
          "id": "b",
          "label": "Call — defend KQo against a wide Button range"
        },
        {
          "id": "c",
          "label": "3-bet — attack the wide Button range with blockers and value"
        }
      ],
      "evaluation": {
        "correct_choice_id": "c",
        "acceptable_choice_ids": [
          "b"
        ]
      },
      "explanation": "Against a LAG BTN, KQo is a solid 3-bet. You widen your 3-bet range vs wide openers. Out of position you'd prefer a tighter range but KQ has good blocking and value.",
      "rule_of_thumb": "Widen your 3-bet range against loose BTN openers. KQo has enough equity to 3-bet profitably."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 31: hand_rankings
  (
    31,
    1,
    'hand_rankings',
    2,
    $json$
    {
      "prompt": "You hold K♥ K♦. Board: K♠ Q♣ J♠ T♠ 9♠. What's your best hand and is it likely the winner?",
      "game_state": {
        "pot": 200,
        "stack": 200
      },
      "hero_cards": [
        "K♥",
        "K♦"
      ],
      "board": [
        "K♠",
        "Q♣",
        "J♠",
        "T♠",
        "9♠"
      ],
      "street": "river",
      "villain_archetype": "Aggressive",
      "choices": [
        {
          "id": "a",
          "label": "Three Kings — your set plays"
        },
        {
          "id": "b",
          "label": "King-high straight on the board — everyone has at least a straight"
        },
        {
          "id": "c",
          "label": "King-high flush — four spades are enough"
        }
      ],
      "evaluation": {
        "correct_choice_id": "b",
        "acceptable_choice_ids": []
      },
      "explanation": "The board itself is 9-T-J-Q-K, a King-high straight. Your three Kings do not play because a straight outranks a set. Any Ace makes a higher straight, and any opponent with a spade makes a flush.",
      "rule_of_thumb": "Build the best five-card hand from all seven cards. Sometimes the board's five cards outrank both of your hole cards."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 32: c_betting
  (
    32,
    3,
    'c_betting',
    3,
    $json$
    {
      "prompt": "You raised BTN with J♦ T♦. BB calls. Flop: J♠ 8♦ 4♦. You have top pair + flush draw. BB leads into you (donk bet, 1/2 pot). What do you do?",
      "game_state": {
        "pot": 12,
        "stack": 188
      },
      "hero_cards": [
        "J♦",
        "T♦"
      ],
      "board": [
        "J♠",
        "8♦",
        "4♦"
      ],
      "street": "flop",
      "villain_archetype": "Aggressive",
      "choices": [
        {
          "id": "a",
          "label": "Call — see what develops"
        },
        {
          "id": "b",
          "label": "Raise — top pair plus a strong (not nut) flush draw"
        },
        {
          "id": "c",
          "label": "Fold — they're representing a strong hand"
        }
      ],
      "evaluation": {
        "correct_choice_id": "b",
        "acceptable_choice_ids": []
      },
      "explanation": "Top pair plus a flush draw has substantial equity and can raise for value and protection, but J♦T♦ is not the nut flush draw while A♦ or K♦ remain possible.",
      "rule_of_thumb": "Name draws precisely: a strong flush draw is not the nut flush draw unless no higher suited holding can exist."
    }
        $json$::jsonb,
    1,
    true
  ),
  -- scenario 33: discipline
  (
    33,
    5,
    'discipline',
    3,
    $json$
    {
      "prompt": "You're in a must-win situation and shove all-in with 30% equity. You lose. What is the correct mental response?",
      "game_state": {
        "pot": 0,
        "stack": 0
      },
      "hero_cards": [],
      "board": [],
      "street": null,
      "villain_archetype": null,
      "choices": [
        {
          "id": "a",
          "label": "Get angry — you deserved to win"
        },
        {
          "id": "b",
          "label": "Evaluate the price and decision process, not this one result"
        },
        {
          "id": "c",
          "label": "Swear off that type of play forever"
        }
      ],
      "evaluation": {
        "correct_choice_id": "b",
        "acceptable_choice_ids": []
      },
      "explanation": "A 30% chance wins only three times in ten. Whether the shove was correct depends on the pot, risk, fold equity, and ranges—not on losing this runout.",
      "rule_of_thumb": "Judge a decision by its expected value with the information available, not by one outcome."
    }
        $json$::jsonb,
    1,
    true
  )
on conflict (id) do update set
  module_id = excluded.module_id,
  skill_tag = excluded.skill_tag,
  difficulty = excluded.difficulty,
  scenario_json = excluded.scenario_json,
  version = excluded.version,
  is_active = excluded.is_active;

insert into public.table_scenarios
  (id, module_id, difficulty, skill_tag, street, prompt_title,
   situation_json, choices_json, correct_choice_id, acceptable_choice_ids,
   explanation, rule_of_thumb, is_active)
values
  -- table scenario 01: Button Open — Should You Raise?
  (
    1,
    2,
    1,
    'position',
    'preflop',
    'Button Open — Should You Raise?',
    $json$
    {
      "blinds": {
        "sb": 0.5,
        "bb": 1
      },
      "effective_stack_bb": 100,
      "hero": {
        "seat": 6,
        "position": "BTN",
        "cards": [
          "Ah",
          "9d"
        ]
      },
      "villains": [
        {
          "seat": 1,
          "position": "SB",
          "label": "Villain",
          "style": "unknown"
        },
        {
          "seat": 2,
          "position": "BB",
          "label": "Villain",
          "style": "unknown"
        }
      ],
      "pre_action": [
        {
          "seat": 3,
          "action": "fold"
        },
        {
          "seat": 4,
          "action": "fold"
        },
        {
          "seat": 5,
          "action": "fold"
        }
      ],
      "pot_bb": 1.5,
      "board": []
    }
        $json$::jsonb,
    $json$
    [
      {
        "id": "a",
        "label": "Fold",
        "action": "fold"
      },
      {
        "id": "b",
        "label": "Raise to 2.5bb",
        "action": "raise",
        "amount_bb": 2.5
      },
      {
        "id": "c",
        "label": "Limp (call 1bb)",
        "action": "call",
        "amount_bb": 1
      }
    ]
        $json$::jsonb,
    'b',
    null,
    'A9o on the button is a clear open raise. You have position on everyone, a solid hand, and folding would waste profitable spots. Limping is weak — it lets the blinds see a cheap flop and gives up initiative.',
    'On the button, raise any hand you''d play. Position is your biggest advantage.',
    true
  ),
  -- table scenario 02: UTG with the Worst Hand in Poker
  (
    2,
    2,
    1,
    'discipline',
    'preflop',
    'UTG with the Worst Hand in Poker',
    $json$
    {
      "blinds": {
        "sb": 0.5,
        "bb": 1
      },
      "effective_stack_bb": 100,
      "hero": {
        "seat": 3,
        "position": "UTG",
        "cards": [
          "7c",
          "2d"
        ]
      },
      "villains": [
        {
          "seat": 6,
          "position": "BTN",
          "label": "Villain",
          "style": "unknown"
        }
      ],
      "pre_action": [],
      "pot_bb": 1.5,
      "board": []
    }
        $json$::jsonb,
    $json$
    [
      {
        "id": "a",
        "label": "Fold",
        "action": "fold"
      },
      {
        "id": "b",
        "label": "Limp (call 1bb)",
        "action": "call",
        "amount_bb": 1
      },
      {
        "id": "c",
        "label": "Raise to 3bb",
        "action": "raise",
        "amount_bb": 3
      }
    ]
        $json$::jsonb,
    'a',
    null,
    '7-2 offsuit is the worst starting hand in Texas Hold''em. From UTG (under the gun), you face five players left to act, all of whom could have strong hands. There is no scenario where playing 7-2o profitably offsets the losses.',
    'Fold junk from early position. The fewer outs your hand has, the earlier you should require position to play it.',
    true
  ),
  -- table scenario 03: Big Blind Defense — Are the Odds Right?
  (
    3,
    1,
    1,
    'pot_odds',
    'preflop',
    'Big Blind Defense — Are the Odds Right?',
    $json$
    {
      "blinds": {
        "sb": 0.5,
        "bb": 1
      },
      "effective_stack_bb": 100,
      "hero": {
        "seat": 2,
        "position": "BB",
        "cards": [
          "Kh",
          "5h"
        ]
      },
      "villains": [
        {
          "seat": 6,
          "position": "BTN",
          "label": "Villain",
          "style": "aggressive"
        }
      ],
      "pre_action": [
        {
          "seat": 3,
          "action": "fold"
        },
        {
          "seat": 4,
          "action": "fold"
        },
        {
          "seat": 5,
          "action": "fold"
        },
        {
          "seat": 6,
          "action": "raise",
          "amount_bb": 3
        },
        {
          "seat": 1,
          "action": "fold"
        }
      ],
      "pot_bb": 4.5,
      "board": []
    }
        $json$::jsonb,
    $json$
    [
      {
        "id": "a",
        "label": "Fold",
        "action": "fold"
      },
      {
        "id": "b",
        "label": "Call (2bb more)",
        "action": "call",
        "amount_bb": 2
      },
      {
        "id": "c",
        "label": "3-bet to 9bb",
        "action": "raise",
        "amount_bb": 9
      }
    ]
        $json$::jsonb,
    'b',
    null,
    'You''re getting 2.25:1 pot odds (pot is 4.5bb, call is 2bb). K5 suited has good playability — a flush draw, top pair equity on many boards, and backdoor straights. Against a BTN steal, calling is correct. 3-betting is too wide with this hand.',
    'In the big blind, you already have 1bb invested. Defend wider than you would from other positions — especially against button steals.',
    true
  ),
  -- table scenario 04: Pocket Aces UTG — Never Slow Play Preflop
  (
    4,
    2,
    1,
    'value_betting',
    'preflop',
    'Pocket Aces UTG — Never Slow Play Preflop',
    $json$
    {
      "blinds": {
        "sb": 0.5,
        "bb": 1
      },
      "effective_stack_bb": 100,
      "hero": {
        "seat": 3,
        "position": "UTG",
        "cards": [
          "As",
          "Ah"
        ]
      },
      "villains": [
        {
          "seat": 6,
          "position": "BTN",
          "label": "Villain",
          "style": "loose"
        }
      ],
      "pre_action": [],
      "pot_bb": 1.5,
      "board": []
    }
        $json$::jsonb,
    $json$
    [
      {
        "id": "a",
        "label": "Limp (call 1bb)",
        "action": "call",
        "amount_bb": 1
      },
      {
        "id": "b",
        "label": "Raise to 2.5bb",
        "action": "raise",
        "amount_bb": 2.5
      },
      {
        "id": "c",
        "label": "Raise to 4bb",
        "action": "raise",
        "amount_bb": 4
      }
    ]
        $json$::jsonb,
    'b',
    $json$
    [
      "c"
    ]
        $json$::jsonb,
    'Aces are the best hand preflop. Always raise — you want to build the pot and charge anyone who wants to see a flop. A standard 2.5bb open is best. Limping lets multiple players in cheaply, which actually hurts Aces (they hate multi-way pots).',
    'Always raise your premium hands. Limping aces is one of the most common beginner mistakes.',
    true
  ),
  -- table scenario 05: 3-Bet Sizing with AK Suited
  (
    5,
    2,
    2,
    'bet_sizing',
    'preflop',
    '3-Bet Sizing with AK Suited',
    $json$
    {
      "blinds": {
        "sb": 0.5,
        "bb": 1
      },
      "effective_stack_bb": 100,
      "hero": {
        "seat": 6,
        "position": "BTN",
        "cards": [
          "Ah",
          "Kh"
        ]
      },
      "villains": [
        {
          "seat": 5,
          "position": "CO",
          "label": "Villain",
          "style": "regular"
        }
      ],
      "pre_action": [
        {
          "seat": 3,
          "action": "fold"
        },
        {
          "seat": 4,
          "action": "fold"
        },
        {
          "seat": 5,
          "action": "raise",
          "amount_bb": 3
        },
        {
          "seat": 1,
          "action": "fold"
        },
        {
          "seat": 2,
          "action": "fold"
        }
      ],
      "pot_bb": 4.5,
      "board": []
    }
        $json$::jsonb,
    $json$
    [
      {
        "id": "a",
        "label": "Call 3bb",
        "action": "call",
        "amount_bb": 3
      },
      {
        "id": "b",
        "label": "3-bet to 9bb",
        "action": "raise",
        "amount_bb": 9
      },
      {
        "id": "c",
        "label": "3-bet to 12bb",
        "action": "raise",
        "amount_bb": 12
      }
    ]
        $json$::jsonb,
    'b',
    $json$
    [
      "c"
    ]
        $json$::jsonb,
    'AKs is a premium 3-bet hand in position. A standard 3-bet is roughly 3x the open (3 x 3bb = 9bb). Calling is technically fine but misses value and lets the CO see a cheap flop. 3-betting isolates the CO and builds the pot with a strong hand.',
    '3-bet to approximately 3x the open raise when in position. 2.5–3.5x is the standard range.',
    true
  ),
  -- table scenario 06: Facing a 3-Bet with JTs in CO
  (
    6,
    2,
    2,
    'range_advantage',
    'preflop',
    'Facing a 3-Bet with JTs in CO',
    $json$
    {
      "blinds": {
        "sb": 0.5,
        "bb": 1
      },
      "effective_stack_bb": 100,
      "hero": {
        "seat": 5,
        "position": "CO",
        "cards": [
          "Jd",
          "Td"
        ]
      },
      "villains": [
        {
          "seat": 6,
          "position": "BTN",
          "label": "Villain",
          "style": "tight"
        }
      ],
      "pre_action": [
        {
          "seat": 3,
          "action": "fold"
        },
        {
          "seat": 4,
          "action": "fold"
        },
        {
          "seat": 5,
          "action": "raise",
          "amount_bb": 3
        },
        {
          "seat": 6,
          "action": "raise",
          "amount_bb": 9
        },
        {
          "seat": 1,
          "action": "fold"
        },
        {
          "seat": 2,
          "action": "fold"
        }
      ],
      "pot_bb": 13.5,
      "board": []
    }
        $json$::jsonb,
    $json$
    [
      {
        "id": "a",
        "label": "Fold",
        "action": "fold"
      },
      {
        "id": "b",
        "label": "Call 6bb more",
        "action": "call",
        "amount_bb": 6
      },
      {
        "id": "c",
        "label": "4-bet to 24bb",
        "action": "raise",
        "amount_bb": 24
      }
    ]
        $json$::jsonb,
    'b',
    $json$
    [
      "a"
    ]
        $json$::jsonb,
    'JTs has useful playability, but from CO against a tight Button 3-bet you will be out of position postflop. Calling can be mixed at 100bb; folding is also reasonable. Do not justify the call by claiming positional advantage.',
    'Track who acts last postflop. CO is out of position against BTN, even though CO opened first.',
    true
  ),
  -- table scenario 07: UTG Garbage — Easy Fold
  (
    7,
    2,
    1,
    'discipline',
    'preflop',
    'UTG Garbage — Easy Fold',
    $json$
    {
      "blinds": {
        "sb": 0.5,
        "bb": 1
      },
      "effective_stack_bb": 100,
      "hero": {
        "seat": 3,
        "position": "UTG",
        "cards": [
          "6c",
          "4d"
        ]
      },
      "villains": [
        {
          "seat": 6,
          "position": "BTN",
          "label": "Villain",
          "style": "unknown"
        }
      ],
      "pre_action": [],
      "pot_bb": 1.5,
      "board": []
    }
        $json$::jsonb,
    $json$
    [
      {
        "id": "a",
        "label": "Fold",
        "action": "fold"
      },
      {
        "id": "b",
        "label": "Limp (call 1bb)",
        "action": "call",
        "amount_bb": 1
      },
      {
        "id": "c",
        "label": "Raise to 3bb",
        "action": "raise",
        "amount_bb": 3
      }
    ]
        $json$::jsonb,
    'a',
    null,
    '6-4 offsuit is too weak and disconnected to play from UTG. You have five players left to act who can easily have you dominated. Even if you hit a pair, it''ll often be dominated by better kickers.',
    'From early position, only open hands that can withstand a lot of pressure: strong pairs, broadways, and high suited connectors.',
    true
  ),
  -- table scenario 08: Q8 Suited on the Button vs CO Open
  (
    8,
    2,
    2,
    'position',
    'preflop',
    'Q8 Suited on the Button vs CO Open',
    $json$
    {
      "blinds": {
        "sb": 0.5,
        "bb": 1
      },
      "effective_stack_bb": 100,
      "hero": {
        "seat": 6,
        "position": "BTN",
        "cards": [
          "Qd",
          "8d"
        ]
      },
      "villains": [
        {
          "seat": 5,
          "position": "CO",
          "label": "Villain",
          "style": "regular"
        }
      ],
      "pre_action": [
        {
          "seat": 3,
          "action": "fold"
        },
        {
          "seat": 4,
          "action": "fold"
        },
        {
          "seat": 5,
          "action": "raise",
          "amount_bb": 3
        },
        {
          "seat": 1,
          "action": "fold"
        },
        {
          "seat": 2,
          "action": "fold"
        }
      ],
      "pot_bb": 4.5,
      "board": []
    }
        $json$::jsonb,
    $json$
    [
      {
        "id": "a",
        "label": "Fold",
        "action": "fold"
      },
      {
        "id": "b",
        "label": "Call 3bb",
        "action": "call",
        "amount_bb": 3
      },
      {
        "id": "c",
        "label": "3-bet to 9bb",
        "action": "raise",
        "amount_bb": 9
      }
    ]
        $json$::jsonb,
    'b',
    null,
    'Q8s in position is a standard call. It''s suited, has decent equity, and you''ll be in position for the entire hand. Folding is too tight; 3-betting is a stretch without stronger blocker or range advantage.',
    'In position, play suited hands with a face card. You win chips by seeing cheap flops in position and outplaying opponents postflop.',
    true
  ),
  -- table scenario 09: Calling Off a Short-Stack Shove with AQ
  (
    9,
    2,
    3,
    'pot_odds',
    'preflop',
    'Calling Off a Short-Stack Shove with AQ',
    $json$
    {
      "blinds": {
        "sb": 0.5,
        "bb": 1
      },
      "effective_stack_bb": 15,
      "hero": {
        "seat": 6,
        "position": "BTN",
        "cards": [
          "Ah",
          "Qc"
        ]
      },
      "villains": [
        {
          "seat": 4,
          "position": "HJ",
          "label": "Short Stack",
          "style": "loose-aggressive"
        }
      ],
      "pre_action": [
        {
          "seat": 3,
          "action": "fold"
        },
        {
          "seat": 4,
          "action": "raise",
          "amount_bb": 15
        },
        {
          "seat": 5,
          "action": "fold"
        },
        {
          "seat": 1,
          "action": "fold"
        },
        {
          "seat": 2,
          "action": "fold"
        }
      ],
      "pot_bb": 16.5,
      "board": []
    }
        $json$::jsonb,
    $json$
    [
      {
        "id": "a",
        "label": "Fold",
        "action": "fold"
      },
      {
        "id": "b",
        "label": "Call 15bb",
        "action": "call",
        "amount_bb": 15
      }
    ]
        $json$::jsonb,
    'b',
    null,
    'The shove makes the pot 16.5bb before your decision and costs 15bb to call. Required equity is 15/(16.5+15) = 47.6%. AQo has enough equity against a genuinely wide 15bb shoving range, but the range assumption is essential.',
    'Against an all-in, calculate call ÷ (pot after the shove + call), then compare with equity versus the actual shoving range.',
    true
  ),
  -- table scenario 10: 3-Bet Bluff with A5 Suited — Blocker Magic
  (
    10,
    2,
    2,
    'bluffing',
    'preflop',
    '3-Bet Bluff with A5 Suited — Blocker Magic',
    $json$
    {
      "blinds": {
        "sb": 0.5,
        "bb": 1
      },
      "effective_stack_bb": 100,
      "hero": {
        "seat": 6,
        "position": "BTN",
        "cards": [
          "Ah",
          "5h"
        ]
      },
      "villains": [
        {
          "seat": 3,
          "position": "UTG",
          "label": "Villain",
          "style": "tight"
        }
      ],
      "pre_action": [
        {
          "seat": 3,
          "action": "raise",
          "amount_bb": 3
        },
        {
          "seat": 4,
          "action": "fold"
        },
        {
          "seat": 5,
          "action": "fold"
        },
        {
          "seat": 1,
          "action": "fold"
        },
        {
          "seat": 2,
          "action": "fold"
        }
      ],
      "pot_bb": 4.5,
      "board": []
    }
        $json$::jsonb,
    $json$
    [
      {
        "id": "a",
        "label": "Fold",
        "action": "fold"
      },
      {
        "id": "b",
        "label": "Call 3bb",
        "action": "call",
        "amount_bb": 3
      },
      {
        "id": "c",
        "label": "3-bet to 9bb",
        "action": "raise",
        "amount_bb": 9
      }
    ]
        $json$::jsonb,
    'c',
    null,
    'A5s is a useful 3-bet bluff candidate: the Ace blocks some strong continues, and the suited wheel card retains equity when called. On the Button you also keep positional advantage postflop.',
    'Suited wheel Aces can mix into polarized 3-bet ranges because they combine blockers, playability, and position.',
    true
  ),
  -- table scenario 11: TPTK on a Dry Board — Bet for Value
  (
    11,
    3,
    1,
    'value_betting',
    'flop',
    'TPTK on a Dry Board — Bet for Value',
    $json$
    {
      "blinds": {
        "sb": 0.5,
        "bb": 1
      },
      "effective_stack_bb": 100,
      "hero": {
        "seat": 6,
        "position": "BTN",
        "cards": [
          "As",
          "Kd"
        ]
      },
      "villains": [
        {
          "seat": 2,
          "position": "BB",
          "label": "Villain",
          "style": "passive"
        }
      ],
      "pre_action": [
        {
          "seat": 3,
          "action": "fold"
        },
        {
          "seat": 4,
          "action": "fold"
        },
        {
          "seat": 5,
          "action": "fold"
        },
        {
          "seat": 6,
          "action": "raise",
          "amount_bb": 2.5
        },
        {
          "seat": 1,
          "action": "fold"
        },
        {
          "seat": 2,
          "action": "call",
          "amount_bb": 2.5
        },
        {
          "seat": 2,
          "action": "check"
        }
      ],
      "pot_bb": 5.5,
      "board": [
        "Ks",
        "7h",
        "2c"
      ]
    }
        $json$::jsonb,
    $json$
    [
      {
        "id": "a",
        "label": "Check",
        "action": "check"
      },
      {
        "id": "b",
        "label": "Bet 2bb (small)",
        "action": "bet",
        "amount_bb": 2
      },
      {
        "id": "c",
        "label": "Bet 5bb (pot)",
        "action": "bet",
        "amount_bb": 5
      }
    ]
        $json$::jsonb,
    'b',
    null,
    'Top pair, top kicker on K-7-2 rainbow wants value, but the dry board has few urgent draws. A small c-bet keeps weaker Kings, Sevens, and pocket pairs in while risking less with the rest of your range.',
    'Use small c-bets on dry boards where your range advantage is strong and protection is not urgent.',
    true
  ),
  -- table scenario 12: Flush Draw on the Flop — Call or Fold?
  (
    12,
    3,
    2,
    'pot_odds',
    'flop',
    'Flush Draw on the Flop — Call or Fold?',
    $json$
    {
      "blinds": {
        "sb": 0.5,
        "bb": 1
      },
      "effective_stack_bb": 100,
      "hero": {
        "seat": 6,
        "position": "BTN",
        "cards": [
          "9h",
          "8h"
        ]
      },
      "villains": [
        {
          "seat": 2,
          "position": "BB",
          "label": "Villain",
          "style": "regular"
        }
      ],
      "pre_action": [
        {
          "seat": 3,
          "action": "fold"
        },
        {
          "seat": 4,
          "action": "fold"
        },
        {
          "seat": 5,
          "action": "fold"
        },
        {
          "seat": 6,
          "action": "raise",
          "amount_bb": 2.5
        },
        {
          "seat": 1,
          "action": "fold"
        },
        {
          "seat": 2,
          "action": "call",
          "amount_bb": 2.5
        },
        {
          "seat": 2,
          "action": "bet",
          "amount_bb": 1.5
        }
      ],
      "pot_bb": 5.5,
      "board": [
        "Ah",
        "5h",
        "2c"
      ]
    }
        $json$::jsonb,
    $json$
    [
      {
        "id": "a",
        "label": "Fold",
        "action": "fold"
      },
      {
        "id": "b",
        "label": "Call 1.5bb",
        "action": "call",
        "amount_bb": 1.5
      },
      {
        "id": "c",
        "label": "Raise to 6bb",
        "action": "raise",
        "amount_bb": 6
      }
    ]
        $json$::jsonb,
    'b',
    null,
    'The pot is 7bb after the 1.5bb bet and calling costs 1.5bb, so required equity is 1.5/8.5 = 17.6%. Nine flush outs hit the next card about 19.6%, making the direct call profitable before implied odds.',
    'A flop call usually buys one card, not both. Compare one-card equity with call ÷ (pot after the bet + call).',
    true
  ),
  -- table scenario 13: C-Bet with Overcards on a Dry Low Board
  (
    13,
    3,
    2,
    'bluffing',
    'flop',
    'C-Bet with Overcards on a Dry Low Board',
    $json$
    {
      "blinds": {
        "sb": 0.5,
        "bb": 1
      },
      "effective_stack_bb": 100,
      "hero": {
        "seat": 5,
        "position": "CO",
        "cards": [
          "Ah",
          "Kd"
        ]
      },
      "villains": [
        {
          "seat": 2,
          "position": "BB",
          "label": "Villain",
          "style": "passive"
        }
      ],
      "pre_action": [
        {
          "seat": 3,
          "action": "fold"
        },
        {
          "seat": 4,
          "action": "fold"
        },
        {
          "seat": 5,
          "action": "raise",
          "amount_bb": 3
        },
        {
          "seat": 6,
          "action": "fold"
        },
        {
          "seat": 1,
          "action": "fold"
        },
        {
          "seat": 2,
          "action": "call",
          "amount_bb": 3
        },
        {
          "seat": 2,
          "action": "check"
        }
      ],
      "pot_bb": 6.5,
      "board": [
        "8c",
        "5h",
        "2s"
      ]
    }
        $json$::jsonb,
    $json$
    [
      {
        "id": "a",
        "label": "Check",
        "action": "check"
      },
      {
        "id": "b",
        "label": "Bet 3bb (half pot)",
        "action": "bet",
        "amount_bb": 3
      },
      {
        "id": "c",
        "label": "Bet 6.5bb (pot)",
        "action": "bet",
        "amount_bb": 6.5
      }
    ]
        $json$::jsonb,
    'b',
    null,
    'CO retains overpairs and two overcards on 8-5-2 rainbow, while BB has more two-pair and low-pair combinations. A half-pot c-bet is a reasonable simplification against a passive range; a pot-sized bet risks too much with Ace-high.',
    'Range advantage and nut advantage are different. On dry low boards, use controlled sizing and do not claim the caller cannot connect.',
    true
  ),
  -- table scenario 14: No Equity — Cut Your Losses
  (
    14,
    3,
    2,
    'discipline',
    'flop',
    'No Equity — Cut Your Losses',
    $json$
    {
      "blinds": {
        "sb": 0.5,
        "bb": 1
      },
      "effective_stack_bb": 100,
      "hero": {
        "seat": 2,
        "position": "BB",
        "cards": [
          "Jh",
          "Th"
        ]
      },
      "villains": [
        {
          "seat": 6,
          "position": "BTN",
          "label": "Villain",
          "style": "regular"
        }
      ],
      "pre_action": [
        {
          "seat": 3,
          "action": "fold"
        },
        {
          "seat": 4,
          "action": "fold"
        },
        {
          "seat": 5,
          "action": "fold"
        },
        {
          "seat": 6,
          "action": "raise",
          "amount_bb": 2.5
        },
        {
          "seat": 1,
          "action": "fold"
        },
        {
          "seat": 2,
          "action": "call",
          "amount_bb": 2.5
        },
        {
          "seat": 2,
          "action": "check"
        },
        {
          "seat": 6,
          "action": "bet",
          "amount_bb": 6
        }
      ],
      "pot_bb": 5.5,
      "board": [
        "Ac",
        "Kd",
        "7s"
      ]
    }
        $json$::jsonb,
    $json$
    [
      {
        "id": "a",
        "label": "Fold",
        "action": "fold"
      },
      {
        "id": "b",
        "label": "Call 6bb",
        "action": "call",
        "amount_bb": 6
      },
      {
        "id": "c",
        "label": "Check-raise to 18bb",
        "action": "raise",
        "amount_bb": 18
      }
    ]
        $json$::jsonb,
    'a',
    null,
    'J-T on A-K-7 has a four-out gutshot to Broadway, but calling 6bb into 11.5bb requires about 34%. The draw and pair outs do not come close, so folding is disciplined.',
    'Having a draw is not enough. Compare its clean equity with the actual price.',
    true
  ),
  -- table scenario 15: Two Pair — Build the Pot Now
  (
    15,
    3,
    2,
    'bet_sizing',
    'flop',
    'Two Pair — Build the Pot Now',
    $json$
    {
      "blinds": {
        "sb": 0.5,
        "bb": 1
      },
      "effective_stack_bb": 100,
      "hero": {
        "seat": 6,
        "position": "BTN",
        "cards": [
          "Ks",
          "Qs"
        ]
      },
      "villains": [
        {
          "seat": 2,
          "position": "BB",
          "label": "Villain",
          "style": "passive"
        }
      ],
      "pre_action": [
        {
          "seat": 3,
          "action": "fold"
        },
        {
          "seat": 4,
          "action": "fold"
        },
        {
          "seat": 5,
          "action": "fold"
        },
        {
          "seat": 6,
          "action": "raise",
          "amount_bb": 2.5
        },
        {
          "seat": 1,
          "action": "fold"
        },
        {
          "seat": 2,
          "action": "call",
          "amount_bb": 2.5
        },
        {
          "seat": 2,
          "action": "check"
        }
      ],
      "pot_bb": 5.5,
      "board": [
        "Kh",
        "Qc",
        "5d"
      ]
    }
        $json$::jsonb,
    $json$
    [
      {
        "id": "a",
        "label": "Check (slow play)",
        "action": "check"
      },
      {
        "id": "b",
        "label": "Bet 3bb (medium)",
        "action": "bet",
        "amount_bb": 3
      },
      {
        "id": "c",
        "label": "Bet 5bb (pot)",
        "action": "bet",
        "amount_bb": 5
      }
    ]
        $json$::jsonb,
    'b',
    $json$
    [
      "c"
    ]
        $json$::jsonb,
    'Top two pair on K-Q-5 should bet for value. A medium size is called by more one-pair hands while still charging gutshots; a larger size can also be reasonable against a calling-heavy range.',
    'Choose value sizing from the hands that can call, not from a blanket rule to pot every strong hand.',
    true
  ),
  -- table scenario 16: Big Draw in Position — Play It Aggressively
  (
    16,
    3,
    2,
    'position',
    'flop',
    'Big Draw in Position — Play It Aggressively',
    $json$
    {
      "blinds": {
        "sb": 0.5,
        "bb": 1
      },
      "effective_stack_bb": 100,
      "hero": {
        "seat": 6,
        "position": "BTN",
        "cards": [
          "7h",
          "6h"
        ]
      },
      "villains": [
        {
          "seat": 5,
          "position": "CO",
          "label": "Villain",
          "style": "regular"
        }
      ],
      "pre_action": [
        {
          "seat": 3,
          "action": "fold"
        },
        {
          "seat": 4,
          "action": "fold"
        },
        {
          "seat": 5,
          "action": "raise",
          "amount_bb": 3
        },
        {
          "seat": 6,
          "action": "call",
          "amount_bb": 3
        },
        {
          "seat": 1,
          "action": "fold"
        },
        {
          "seat": 2,
          "action": "fold"
        },
        {
          "seat": 5,
          "action": "check"
        }
      ],
      "pot_bb": 7.5,
      "board": [
        "9h",
        "8s",
        "2h"
      ]
    }
        $json$::jsonb,
    $json$
    [
      {
        "id": "a",
        "label": "Check",
        "action": "check"
      },
      {
        "id": "b",
        "label": "Bet 3.75bb (half pot)",
        "action": "bet",
        "amount_bb": 3.75
      },
      {
        "id": "c",
        "label": "Bet 7.5bb (pot)",
        "action": "bet",
        "amount_bb": 7.5
      }
    ]
        $json$::jsonb,
    'b',
    null,
    'The flush draw and open-ended straight draw overlap, leaving about 15 distinct candidate outs. With two cards to come, the corrected shortcut is about 53% and the exact clean-hit chance is about 54%. Betting adds fold equity.',
    'For more than 8 outs, correct the ×4 shortcut; remove overlap and dirty outs before estimating.',
    true
  ),
  -- table scenario 17: Nut Flush Draw — Call the Small Bet
  (
    17,
    3,
    1,
    'pot_odds',
    'flop',
    'Nut Flush Draw — Call the Small Bet',
    $json$
    {
      "blinds": {
        "sb": 0.5,
        "bb": 1
      },
      "effective_stack_bb": 100,
      "hero": {
        "seat": 6,
        "position": "BTN",
        "cards": [
          "Ah",
          "7h"
        ]
      },
      "villains": [
        {
          "seat": 2,
          "position": "BB",
          "label": "Villain",
          "style": "passive"
        }
      ],
      "pre_action": [
        {
          "seat": 3,
          "action": "fold"
        },
        {
          "seat": 4,
          "action": "fold"
        },
        {
          "seat": 5,
          "action": "fold"
        },
        {
          "seat": 6,
          "action": "raise",
          "amount_bb": 2.5
        },
        {
          "seat": 1,
          "action": "fold"
        },
        {
          "seat": 2,
          "action": "call",
          "amount_bb": 2.5
        },
        {
          "seat": 2,
          "action": "bet",
          "amount_bb": 3
        }
      ],
      "pot_bb": 5.5,
      "board": [
        "Kh",
        "5h",
        "2c"
      ]
    }
        $json$::jsonb,
    $json$
    [
      {
        "id": "a",
        "label": "Fold",
        "action": "fold"
      },
      {
        "id": "b",
        "label": "Call 3bb",
        "action": "call",
        "amount_bb": 3
      },
      {
        "id": "c",
        "label": "Raise to 10bb",
        "action": "raise",
        "amount_bb": 10
      }
    ]
        $json$::jsonb,
    'b',
    null,
    'The pot is 8.5bb after the 3bb bet and calling costs 3bb, so required equity is 3/11.5 = 26.1%. Nine flush outs hit the next card about 19.6%; possible Ace outs and implied odds make this close, not an automatic equity-only call.',
    'Separate direct pot odds from implied odds, and discount overcard outs that may make a second-best pair.',
    true
  ),
  -- table scenario 18: Ace High on a Paired Board — Preserve Showdown Value
  (
    18,
    3,
    1,
    'discipline',
    'flop',
    'Ace High on a Paired Board — Preserve Showdown Value',
    $json$
    {
      "blinds": {
        "sb": 0.5,
        "bb": 1
      },
      "effective_stack_bb": 100,
      "hero": {
        "seat": 6,
        "position": "BTN",
        "cards": [
          "Ac",
          "Kd"
        ]
      },
      "villains": [
        {
          "seat": 2,
          "position": "BB",
          "label": "Villain",
          "style": "calling-station"
        }
      ],
      "pre_action": [
        {
          "seat": 3,
          "action": "fold"
        },
        {
          "seat": 4,
          "action": "fold"
        },
        {
          "seat": 5,
          "action": "fold"
        },
        {
          "seat": 6,
          "action": "raise",
          "amount_bb": 2.5
        },
        {
          "seat": 1,
          "action": "fold"
        },
        {
          "seat": 2,
          "action": "call",
          "amount_bb": 2.5
        },
        {
          "seat": 2,
          "action": "check"
        }
      ],
      "pot_bb": 5.5,
      "board": [
        "9c",
        "9h",
        "3d"
      ]
    }
        $json$::jsonb,
    $json$
    [
      {
        "id": "a",
        "label": "Check (give up)",
        "action": "check"
      },
      {
        "id": "b",
        "label": "Bet 3bb",
        "action": "bet",
        "amount_bb": 3
      }
    ]
        $json$::jsonb,
    'a',
    null,
    'Ace-high has showdown value and two overcards on 9-9-3; it is not zero-equity air. Checking is still sensible against a calling station because a bet folds few better hands and gets called by many pairs.',
    'Before bluffing, ask what better hands fold and what worse hands call. Preserve showdown value when neither answer helps.',
    true
  ),
  -- table scenario 19: Aces on a Wet Board — Call and Reassess
  (
    19,
    3,
    3,
    'range_advantage',
    'flop',
    'Aces on a Wet Board — Call and Reassess',
    $json$
    {
      "blinds": {
        "sb": 0.5,
        "bb": 1
      },
      "effective_stack_bb": 100,
      "hero": {
        "seat": 6,
        "position": "BTN",
        "cards": [
          "As",
          "Ad"
        ]
      },
      "villains": [
        {
          "seat": 2,
          "position": "BB",
          "label": "Villain",
          "style": "aggressive"
        }
      ],
      "pre_action": [
        {
          "seat": 3,
          "action": "fold"
        },
        {
          "seat": 4,
          "action": "fold"
        },
        {
          "seat": 5,
          "action": "fold"
        },
        {
          "seat": 6,
          "action": "raise",
          "amount_bb": 2.5
        },
        {
          "seat": 1,
          "action": "fold"
        },
        {
          "seat": 2,
          "action": "call",
          "amount_bb": 2.5
        },
        {
          "seat": 2,
          "action": "bet",
          "amount_bb": 7
        }
      ],
      "pot_bb": 5.5,
      "board": [
        "9c",
        "Tc",
        "Jh"
      ]
    }
        $json$::jsonb,
    $json$
    [
      {
        "id": "a",
        "label": "Fold",
        "action": "fold"
      },
      {
        "id": "b",
        "label": "Call 7bb",
        "action": "call",
        "amount_bb": 7
      },
      {
        "id": "c",
        "label": "Raise to 22bb",
        "action": "raise",
        "amount_bb": 22
      }
    ]
        $json$::jsonb,
    'b',
    null,
    'One pair on 9-T-J with a flush draw available is not a hand to raise ''for information.'' Calling controls the pot, keeps bluffs and draws in, and avoids isolating yourself against straights, two pair, and sets.',
    'Do not raise for information. On coordinated boards, one-pair hands often call and reassess the next card.',
    true
  ),
  -- table scenario 20: Thin Value Bet with Second Pair
  (
    20,
    3,
    2,
    'value_betting',
    'flop',
    'Thin Value Bet with Second Pair',
    $json$
    {
      "blinds": {
        "sb": 0.5,
        "bb": 1
      },
      "effective_stack_bb": 100,
      "hero": {
        "seat": 6,
        "position": "BTN",
        "cards": [
          "Kd",
          "7d"
        ]
      },
      "villains": [
        {
          "seat": 2,
          "position": "BB",
          "label": "Villain",
          "style": "passive"
        }
      ],
      "pre_action": [
        {
          "seat": 3,
          "action": "fold"
        },
        {
          "seat": 4,
          "action": "fold"
        },
        {
          "seat": 5,
          "action": "fold"
        },
        {
          "seat": 6,
          "action": "raise",
          "amount_bb": 2.5
        },
        {
          "seat": 1,
          "action": "fold"
        },
        {
          "seat": 2,
          "action": "call",
          "amount_bb": 2.5
        },
        {
          "seat": 2,
          "action": "check"
        }
      ],
      "pot_bb": 5.5,
      "board": [
        "Ac",
        "7h",
        "3c"
      ]
    }
        $json$::jsonb,
    $json$
    [
      {
        "id": "a",
        "label": "Check (give free card)",
        "action": "check"
      },
      {
        "id": "b",
        "label": "Bet 2.5bb (small)",
        "action": "bet",
        "amount_bb": 2.5
      },
      {
        "id": "c",
        "label": "Bet 5bb (large)",
        "action": "bet",
        "amount_bb": 5
      }
    ]
        $json$::jsonb,
    'b',
    null,
    'You have second pair (7s) with a good kicker (King) in position. The villain''s range includes many hands you beat: 3x, 2x, pocket pairs below 7. A small bet extracts value from these while keeping the pot manageable in case the villain has an Ace.',
    'Bet small for thin value in position. Large bets only get called by hands that beat you; small bets get called by a much wider range.',
    true
  )
on conflict (id) do update set
  module_id = excluded.module_id,
  difficulty = excluded.difficulty,
  skill_tag = excluded.skill_tag,
  street = excluded.street,
  prompt_title = excluded.prompt_title,
  situation_json = excluded.situation_json,
  choices_json = excluded.choices_json,
  correct_choice_id = excluded.correct_choice_id,
  acceptable_choice_ids = excluded.acceptable_choice_ids,
  explanation = excluded.explanation,
  rule_of_thumb = excluded.rule_of_thumb,
  is_active = excluded.is_active;

-- ====================================================================
-- M8.6A — Module 06: Bluffing & Aggression
--
-- `bluff` has been a shipped drill kind since M2, but the course taught it
-- in exactly one lesson ("Value Betting vs Bluffing", module 2). A player
-- could be drilled on break-even bluff frequency having never been taught
-- it. This module is that missing prerequisite.
--
-- A dedicated module rather than lessons scattered through the existing
-- five: bluffing is one coherent skill, and keeping it together gives the
-- `bluff` drill a single obvious prerequisite to route to. Appended at the
-- end so no existing module or lesson order changes.
--
-- EVERY NUMBER BELOW IS DERIVED FROM lib/poker/math.ts, not hand arithmetic,
-- per the poker-math correctness rules in CLAUDE.md:
--   breakEvenFoldRate(100, bet):  33 -> 24.8%   50 -> 33.3%
--                                 66 -> 39.8%  100 -> 50.0%
--   minDefenceFrequency(100, bet):33 -> 75.2%   50 -> 66.7%
--                                 66 -> 60.2%  100 -> 50.0%
--   requiredEquity(pot, call):    vs pot-sized bet (200, 100) -> 33.3%
--   evOfCall(equity, 200, 100):   25% -> -25   33.3% -> 0   50% -> +50
--   hitByRiver(9):                35.0%
--
-- The one betting convention is respected throughout and named on screen:
-- `potBefore` when the player is the one betting, `pot` (total after
-- villain's bet) when the player is calling. Mixing them is the single
-- biggest source of confidently wrong answers in this domain.
-- ====================================================================

insert into public.modules (id, title, description, order_index, is_active)
values
  (
    6,
    'Bluffing & Aggression',
    'Semi-bluffs, break-even frequency, minimum defence, bluff-catching, blockers, and knowing when to give up.',
    6,
    true
  )
on conflict (id) do update set
  title = excluded.title,
  description = excluded.description,
  order_index = excluded.order_index,
  is_active = excluded.is_active;

insert into public.lessons
  (id, module_id, lesson_type, title, order_index, content_json,
   estimated_time_seconds, difficulty, version, is_active)
values
  -- lesson 21: Why a Bluff Has to Work
  (
    21,
    6,
    'concept'::public.lesson_type,
    'Why a Bluff Has to Work',
    1,
    $json$
    {
      "screens": [
        {
          "type": "info",
          "content": "## A bluff is a price, not a mood\n\nA bluff is not a feeling about your opponent. It is a bet that risks a known amount to win a known amount, and it only makes money if it works **often enough**.\n\nThat threshold has a name: the **break-even fold rate**. Below it you are lighting money on fire. Above it you are printing."
        },
        {
          "type": "info",
          "content": "## Risk over risk-plus-reward\n\nYou bet into a pot. Two things matter:\n\n- **Risk** — the size of your bet, which you lose when called.\n- **Reward** — the pot as it stood *before* your bet, which you win when they fold.\n\n```\nbreak-even fold rate = bet / (pot before your bet + bet)\n```\n\nNote which pot that is. When **you** are betting, the pot has not yet been raised by your own bet. Getting this backwards is the most common way to produce a confident wrong number."
        },
        {
          "type": "info",
          "content": "## The four sizes worth memorising\n\nBluffing into a pot of 100:\n\n| Bet | Risking | Needs folds |\n|---|---|---|\n| 1/3 pot | 33 | **24.8%** |\n| 1/2 pot | 50 | **33.3%** |\n| 2/3 pot | 66 | **39.8%** |\n| Pot | 100 | **50.0%** |\n\nA third-pot bluff has to work only about a quarter of the time. A pot-sized bluff has to work half the time. That is a big difference in how often you need to be right."
        },
        {
          "type": "info",
          "content": "## The size is the argument\n\nThis table cuts both ways.\n\nBetting bigger wins more when it works, but it has to work more often. Betting smaller is forgiving — it needs fewer folds — but it also gives your opponent a cheap price to continue.\n\nSo the question is never \"should I bluff?\" in the abstract. It is: **is this opponent, on this board, folding more often than my size requires?**"
        },
        {
          "type": "question",
          "content": "The pot is 100. You bet 50 as a pure bluff with a hand that cannot win at showdown.\n\nHow often does your opponent need to fold for this to break even?",
          "choices": [
            { "id": "a", "label": "25.0%" },
            { "id": "b", "label": "33.3%" },
            { "id": "c", "label": "50.0%" },
            { "id": "d", "label": "66.7%" }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "question",
          "content": "You are choosing between a 1/3-pot and a pot-sized bluff against an opponent you think folds about 30% of the time.\n\nWhich is profitable?",
          "choices": [
            { "id": "a", "label": "Only the 1/3-pot bluff — it needs 24.8%" },
            { "id": "b", "label": "Only the pot-sized bluff — bigger bets fold more hands" },
            { "id": "c", "label": "Both — 30% clears every threshold" },
            { "id": "d", "label": "Neither — 30% is never enough to bluff" }
          ],
          "correct_choice_id": "a"
        },
        {
          "type": "recap",
          "content": "## Key takeaways\n\n- A bluff breaks even at `bet / (pot before + bet)`.\n- 1/3 pot needs **24.8%** folds · 1/2 pot **33.3%** · 2/3 pot **39.8%** · pot **50.0%**.\n- Bigger bluffs win more but must work more often.\n- The pot in that formula is the pot **before** your bet. When you are calling instead, the convention flips — that is the next few lessons."
        }
      ],
      "skill_tags": ["bluffing", "bet_sizing"],
      "xp_reward": 10
    }
    $json$::jsonb,
    420,
    2,
    1,
    true
  ),
  -- lesson 22: Semi-Bluffs
  (
    22,
    6,
    'concept'::public.lesson_type,
    'Semi-Bluffs: Betting With Outs',
    2,
    $json$
    {
      "screens": [
        {
          "type": "info",
          "content": "## Two ways to win\n\nA **pure bluff** wins exactly one way: they fold.\n\nA **semi-bluff** wins two ways: they fold, or they call and you improve. That second path is why semi-bluffs are the most reliably profitable aggression in poker."
        },
        {
          "type": "info",
          "content": "## Equity when called\n\nThe previous lesson said a 2/3-pot bet must work **39.8%** of the time. That is true for a hand with no equity.\n\nNow hold a flush draw on the flop. Nine outs wins **35.0%** of the time by the river. So when your bet gets called, you are not dead — you are a 35% underdog with two cards to come.\n\nThe fold equity and the hand equity add together. Your bet no longer needs anywhere near 39.8% folds to show a profit."
        },
        {
          "type": "info",
          "content": "## Why this changes which hands you bet\n\nGiven a choice of bluffing candidates, prefer the one that can still win.\n\n- **Flush draw** — 9 outs, 35.0% by the river. Excellent semi-bluff.\n- **Open-ended straight draw** — 8 outs, around 31%. Excellent.\n- **Gutshot** — 4 outs, around 17%. Thin, but real.\n- **Ace-high, no draw** — near zero when called. This is a pure bluff, and needs the full fold rate.\n\nDeriving the count from the actual board matters here: a flush draw is not always nine clean outs. A card that pairs the board can complete a full house for your opponent — those outs are dead."
        },
        {
          "type": "info",
          "content": "## The trap: drawing is not a licence\n\nA semi-bluff is still a bet. If your opponent never folds, you are simply building a pot as an underdog, and a 35% hand putting in money against a range that always continues is losing money on the bet itself.\n\nSemi-bluffing is strongest when **both** halves are live: they fold sometimes, and you improve sometimes."
        },
        {
          "type": "question",
          "content": "You hold a flush draw on the flop and bet two-thirds of the pot.\n\nWhy does this need fewer folds than the 39.8% a pure bluff would need?",
          "choices": [
            { "id": "a", "label": "Because you still win about 35% of the time when called" },
            { "id": "b", "label": "Because flush draws make opponents fold more often" },
            { "id": "c", "label": "Because the pot odds change when you have a draw" },
            { "id": "d", "label": "It does not — the break-even fold rate is the same for every hand" }
          ],
          "correct_choice_id": "a"
        },
        {
          "type": "question",
          "content": "You can bluff the flop with exactly one of these. Which is the best semi-bluff?",
          "choices": [
            { "id": "a", "label": "King-high with no draw" },
            { "id": "b", "label": "An open-ended straight draw" },
            { "id": "c", "label": "Bottom pair, no draw" },
            { "id": "d", "label": "A hand already beating everything — bet it as a bluff" }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "recap",
          "content": "## Key takeaways\n\n- Semi-bluffs win two ways: folds now, or improvement later.\n- Nine outs is **35.0%** by the river — that equity offsets the fold rate your size demands.\n- Prefer bluffing hands that can improve over hands that cannot.\n- Count outs from the actual board. Board-pairing cards can kill outs you assumed were clean.\n- Fold equity plus hand equity — a semi-bluff needs both to be live."
        }
      ],
      "skill_tags": ["bluffing", "equity_estimation"],
      "xp_reward": 10
    }
    $json$::jsonb,
    420,
    2,
    1,
    true
  ),
  -- lesson 23: Minimum Defence Frequency
  (
    23,
    6,
    'concept'::public.lesson_type,
    'Minimum Defence Frequency',
    3,
    $json$
    {
      "screens": [
        {
          "type": "info",
          "content": "## Now you are the one being bluffed\n\nEvery previous lesson had you betting. Turn it around.\n\nIf you fold too often, your opponent can bet **any two cards** at a profit. Minimum defence frequency (MDF) is the share of your range you must continue with to stop that."
        },
        {
          "type": "info",
          "content": "## The mirror of the break-even fold rate\n\n```\nMDF = pot before their bet / (pot before their bet + bet)\n```\n\nIt is exactly the complement of the fold rate their bluff needs. Facing a bet into a pot of 100:\n\n| Their bet | Their bluff needs | You must defend |\n|---|---|---|\n| 1/3 pot | 24.8% folds | **75.2%** |\n| 1/2 pot | 33.3% folds | **66.7%** |\n| 2/3 pot | 39.8% folds | **60.2%** |\n| Pot | 50.0% folds | **50.0%** |\n\nThe two columns add to 100%. That is the whole idea: defend enough that their bluff is exactly break-even."
        },
        {
          "type": "info",
          "content": "## Small bets demand more defence\n\nRead that table again, because the intuition runs backwards.\n\nA **small** bet is the one you must defend most widely — 75.2% against a third-pot bet. It is cheap, so folding to it hands over the pot far too easily.\n\nA **pot-sized** bet lets you fold half your range. It is expensive, so you are entitled to give up more often."
        },
        {
          "type": "info",
          "content": "## What MDF is not\n\nMDF is a defence against **exploitation**, not a rule for every hand.\n\nIt assumes your opponent could be betting any two cards. Against someone who has never bluffed a river in their life, folding far more than MDF is correct — you are not obliged to defend against bluffs that do not exist.\n\nUse MDF as the floor that stops a thinking opponent from running you over. Deviate from it deliberately, not by accident."
        },
        {
          "type": "question",
          "content": "Your opponent bets one-third of the pot on the river.\n\nWhat share of your range must you continue with so that betting any two cards is not automatically profitable for them?",
          "choices": [
            { "id": "a", "label": "24.8%" },
            { "id": "b", "label": "50.0%" },
            { "id": "c", "label": "66.7%" },
            { "id": "d", "label": "75.2%" }
          ],
          "correct_choice_id": "d"
        },
        {
          "type": "question",
          "content": "Against which bet size are you allowed to fold the most?",
          "choices": [
            { "id": "a", "label": "1/3 pot — small bets are usually value" },
            { "id": "b", "label": "Pot — you only need to defend 50.0%" },
            { "id": "c", "label": "The size makes no difference to how often you fold" },
            { "id": "d", "label": "1/2 pot — it is the middle, so it is the safest to fold" }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "recap",
          "content": "## Key takeaways\n\n- MDF = `pot before their bet / (pot before + bet)`.\n- 1/3 pot → defend **75.2%** · 1/2 pot → **66.7%** · 2/3 pot → **60.2%** · pot → **50.0%**.\n- Small bets demand **more** defence, not less.\n- MDF and the break-even fold rate are complements of each other.\n- It is a floor against exploitation, not a law. Against a player who never bluffs, over-folding is correct."
        }
      ],
      "skill_tags": ["bluffing", "pot_odds"],
      "xp_reward": 10
    }
    $json$::jsonb,
    420,
    2,
    1,
    true
  ),
  -- lesson 24: Bluff-Catching
  (
    24,
    6,
    'concept'::public.lesson_type,
    'Bluff-Catching',
    4,
    $json$
    {
      "screens": [
        {
          "type": "info",
          "content": "## The hand that only beats bluffs\n\nA **bluff-catcher** is a hand that loses to every value hand your opponent could have, and beats every bluff.\n\nMiddle pair on a river where they have bet three streets is a bluff-catcher. It is not calling because it is strong. It is calling because they might have nothing."
        },
        {
          "type": "info",
          "content": "## The convention flips here\n\nYou are calling now, not betting. So:\n\n- **pot** = the total pot **after** their bet — what you win.\n- **call** = what it costs you.\n\n```\nrequired equity = call / (pot + call)\n```\n\nThey bet 100 into 100. The pot is now 200 and it costs you 100. You need **33.3%** equity.\n\nWatch the difference from lesson 1: there, a pot-sized bet needed 50% folds. Here, calling one needs 33.3% equity. Different question, different pot, different number."
        },
        {
          "type": "info",
          "content": "## Your equity is their bluff frequency\n\nHere is the step that makes bluff-catching click.\n\nYour hand beats their bluffs and loses to their value. So your equity **is** the share of their betting range that is bluffs.\n\nNeeding 33.3% equity means: *call if at least a third of the hands they bet here are bluffs.*\n\nYou are no longer estimating your hand. You are estimating their range."
        },
        {
          "type": "info",
          "content": "## What that costs when you are wrong\n\nFacing a pot-sized river bet (pot 200, call 100):\n\n| Their bluffs | EV of calling |\n|---|---|\n| 25% of bets | **−25 chips** |\n| 33.3% of bets | **0 — break-even** |\n| 50% of bets | **+50 chips** |\n\nThe gap between a bad call and a good one is not subtle, and it is entirely decided by a read on their range rather than by how much you like your pair."
        },
        {
          "type": "question",
          "content": "The pot is 100. Your opponent bets 100 on the river, so the pot is 200 and it costs you 100 to call. You hold a hand that beats all of their bluffs and none of their value hands.\n\nHow often must they be bluffing for the call to break even?",
          "choices": [
            { "id": "a", "label": "25.0%" },
            { "id": "b", "label": "33.3%" },
            { "id": "c", "label": "50.0%" },
            { "id": "d", "label": "66.7%" }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "question",
          "content": "Facing that same pot-sized river bet, you judge your opponent is bluffing about a quarter of the time.\n\nWhat is the call worth?",
          "choices": [
            { "id": "a", "label": "About −25 chips — a losing call" },
            { "id": "b", "label": "Exactly break-even" },
            { "id": "c", "label": "About +50 chips — a clear call" },
            { "id": "d", "label": "It cannot be calculated without knowing your exact hand" }
          ],
          "correct_choice_id": "a"
        },
        {
          "type": "recap",
          "content": "## Key takeaways\n\n- A bluff-catcher beats their bluffs and loses to their value — nothing in between.\n- When calling, `pot` is the total **after** their bet. Required equity = `call / (pot + call)`.\n- A pot-sized river bet needs **33.3%** — so call if a third or more of their bets are bluffs.\n- Your equity is their bluff frequency. Estimate their range, not your hand.\n- At 25% bluffs that call is worth about **−25 chips**; at 50% it is worth **+50**."
        }
      ],
      "skill_tags": ["bluffing", "pot_odds"],
      "xp_reward": 10
    }
    $json$::jsonb,
    480,
    3,
    1,
    true
  ),
  -- lesson 25: Blockers and Unblockers
  (
    25,
    6,
    'concept'::public.lesson_type,
    'Blockers and Unblockers',
    5,
    $json$
    {
      "screens": [
        {
          "type": "info",
          "content": "## The cards you hold are missing from their range\n\nEvery card in your hand is a card your opponent cannot have. That is all a **blocker** is — and on the river it is often the tiebreaker between two hands that are otherwise identical bluffs."
        },
        {
          "type": "info",
          "content": "## Blocking their value\n\nThe board is K♠ 9♠ 4♦ 2♣ 7♠ — the flush came in. You have nothing and are deciding whether to bluff.\n\nHold the **A♠** and you block every nut-flush combination. They cannot hold it, because you do. The strongest part of their calling range just shrank, so they must fold more often.\n\nThat is the good blocker: it removes hands that would have **called** you."
        },
        {
          "type": "info",
          "content": "## Unblocking their folds\n\nThe mirror matters just as much, and it is the half people forget.\n\nYou want them to hold hands they will **fold**. If you are bluffing, holding cards that make up their missed draws is bad — every busted draw you hold is one they do not, and busted draws are exactly the hands that fold.\n\nSo the ideal river bluff **blocks their calls** and **unblocks their folds**."
        },
        {
          "type": "info",
          "content": "## For calling, invert it\n\nBluff-catching flips the logic. Now you want to hold cards that block their **value** hands, because that shifts their range toward bluffs — and lesson 4 showed your equity *is* their bluff frequency.\n\nAn ace that blocks their strongest value combinations makes a marginal call better. The same card that makes a bluff good can make a call good, for the same underlying reason: it changes what they are allowed to have."
        },
        {
          "type": "question",
          "content": "The river completes a spade flush. You have a busted hand and are deciding whether to bluff.\n\nWhich holding makes the better bluff?",
          "choices": [
            { "id": "a", "label": "A♠ x — it blocks the nut flush they would call with" },
            { "id": "b", "label": "Two red cards — no spades at all" },
            { "id": "c", "label": "A busted spade draw with two small spades" },
            { "id": "d", "label": "It makes no difference which two cards you hold" }
          ],
          "correct_choice_id": "a"
        },
        {
          "type": "question",
          "content": "You are bluffing the river. Why is it *bad* to hold cards that make up your opponent's missed draws?",
          "choices": [
            { "id": "a", "label": "Because missed draws are the hands that would have folded to you" },
            { "id": "b", "label": "Because missed draws beat your hand at showdown" },
            { "id": "c", "label": "Because it means the board is too dry to bluff" },
            { "id": "d", "label": "It is not bad — blocking anything is always good" }
          ],
          "correct_choice_id": "a"
        },
        {
          "type": "recap",
          "content": "## Key takeaways\n\n- A card you hold is a card they cannot have.\n- Bluff well: **block their calls**, **unblock their folds**.\n- Holding their busted draws is a reason not to bluff — those were your folds.\n- Bluff-catch well: block their **value**, which shifts their range toward bluffs.\n- Blockers break ties. They do not turn a bad spot into a good one."
        }
      ],
      "skill_tags": ["bluffing", "hand_selection"],
      "xp_reward": 10
    }
    $json$::jsonb,
    420,
    3,
    1,
    true
  ),
  -- lesson 26: Choosing Your Bluffs, and Giving Up
  (
    26,
    6,
    'quiz'::public.lesson_type,
    'Choosing Your Bluffs, and Giving Up',
    6,
    $json$
    {
      "screens": [
        {
          "type": "info",
          "content": "## Not every hand that missed is a bluff\n\nBy the river you will have far more missed hands than you can profitably bet. Choosing between them is a real skill, and the default is not \"bet them all\"."
        },
        {
          "type": "info",
          "content": "## Selection, street by street\n\n**Flop** — bluff with equity. Draws, backdoors, overcards. You have two more streets to improve, so semi-bluffs are cheap and win two ways.\n\n**Turn** — narrow. The good turn bluffs are draws that picked up more equity, plus hands whose story the board now supports. Barrelling every flop bluff is the single most expensive habit in low-stakes poker.\n\n**River** — no equity left, so it is pure. Now selection is entirely about blockers and about which hands can no longer win at showdown."
        },
        {
          "type": "info",
          "content": "## Bluff the hands that cannot win\n\nA hand that might win at showdown has value you destroy by bluffing with it.\n\nAce-high on the river can beat a missed draw. Bet it and every worse hand folds while every better hand calls — you turned a hand with *some* equity into a hand with none.\n\nBluff the hands at the very bottom. Check the ones that can still win."
        },
        {
          "type": "info",
          "content": "## Giving up is a line\n\nChecking and folding is not weakness or a failure of nerve. It is the correct play with most of your range most of the time.\n\nIf the board favours their range, if they have shown no capacity to fold, if your hand blocks nothing useful — give up. The money you do not lose on a doomed third barrel spends exactly the same as the money you win.\n\nThe players who lose most to bluffing are not the ones who never bluff. They are the ones who cannot stop."
        },
        {
          "type": "question",
          "content": "It is the river. You hold ace-high, which can still beat your opponent's missed draws. You have no pair and no draw.\n\nWhat is usually best?",
          "choices": [
            { "id": "a", "label": "Bet — you cannot win without betting" },
            { "id": "b", "label": "Check — ace-high can win at showdown, and betting folds out only worse" },
            { "id": "c", "label": "Bet small so worse aces call" },
            { "id": "d", "label": "Bet pot — maximum pressure with a blocker" }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "question",
          "content": "You bluffed the flop with a gutshot. The turn bricks and your opponent calls again, showing no sign of folding.\n\nWhat is the disciplined line?",
          "choices": [
            { "id": "a", "label": "Barrel the river — you have to follow through on the story" },
            { "id": "b", "label": "Give up unless the river gives you a reason to bet" },
            { "id": "c", "label": "Always barrel: stopping makes your flop bluff wasted money" },
            { "id": "d", "label": "Bet small on the river to save money while still bluffing" }
          ],
          "correct_choice_id": "b"
        },
        {
          "type": "question",
          "content": "Which is the strongest reason to pick one busted hand over another as a river bluff?",
          "choices": [
            { "id": "a", "label": "It blocks their calling hands and unblocks their folding hands" },
            { "id": "b", "label": "It was the prettiest draw on the flop" },
            { "id": "c", "label": "It has the highest card, so it is the strongest bluff" },
            { "id": "d", "label": "You have already invested the most money with it" }
          ],
          "correct_choice_id": "a"
        },
        {
          "type": "recap",
          "content": "## Key takeaways\n\n- Flop bluffs want equity; river bluffs want blockers.\n- Barrelling every flop bluff is the most expensive habit in low-stakes poker.\n- Bluff the hands that cannot win at showdown. Check the ones that can.\n- **Giving up is a line.** Money not lost counts exactly as much as money won.\n- You now have the whole picture: what a bluff must earn, what defends against one, and which hands to pick. The `bluff` drill is where it becomes automatic."
        }
      ],
      "skill_tags": ["bluffing", "discipline"],
      "xp_reward": 15
    }
    $json$::jsonb,
    480,
    3,
    1,
    true
  )
on conflict (id) do update set
  module_id = excluded.module_id,
  lesson_type = excluded.lesson_type,
  title = excluded.title,
  order_index = excluded.order_index,
  content_json = excluded.content_json,
  estimated_time_seconds = excluded.estimated_time_seconds,
  difficulty = excluded.difficulty,
  version = excluded.version,
  is_active = excluded.is_active;

-- Authored practice for module 06, so the module ends in a decision.
insert into public.scenarios
  (id, module_id, skill_tag, difficulty, scenario_json, version, is_active)
values
  (
    34,
    6,
    'bluffing',
    2,
    $json$
    {
      "street": "flop",
      "board": ["J♠", "7♠", "3♦"],
      "hero_cards": ["A♠", "5♠"],
      "prompt": "Flop: J♠ 7♠ 3♦. You hold A♠ 5♠ — the nut flush draw. Pot: $100. Villain checks to you. What is the best line?",
      "game_state": { "pot": 100, "stack": 400 },
      "villain_archetype": "Straightforward",
      "choices": [
        { "id": "a", "label": "Check — keep the pot small with a draw" },
        { "id": "b", "label": "Bet $66 — semi-bluff with two ways to win" },
        { "id": "c", "label": "Bet $250 — maximum fold equity" }
      ],
      "evaluation": { "correct_choice_id": "b", "acceptable_choice_ids": [] },
      "explanation": "As a pure bluff, betting 66 into 100 would need folds 39.8% of the time. But nine flush outs win 35.0% of the time by the river, so the bet wins two ways and needs far fewer folds than that to profit. Checking gives up the fold equity entirely; the huge overbet risks 250 to win 100 and needs folds far too often for a hand that is happy to see cards.",
      "rule_of_thumb": "Semi-bluff when both halves are live: they fold sometimes, and you improve sometimes."
    }
    $json$::jsonb,
    1,
    true
  ),
  (
    35,
    6,
    'bluffing',
    3,
    $json$
    {
      "street": "river",
      "board": ["K♦", "9♣", "4♥", "2♠", "8♦"],
      "hero_cards": ["A♥", "Q♣"],
      "prompt": "River: K♦ 9♣ 4♥ 2♠ 8♦. You hold A♥ Q♣ — ace-high, no pair, no draw. Pot: $100. Villain checks. Every draw missed. What do you do?",
      "game_state": { "pot": 100, "stack": 300 },
      "villain_archetype": "Calling station",
      "choices": [
        { "id": "a", "label": "Check — ace-high can still win at showdown" },
        { "id": "b", "label": "Bet $100 — represent the king" },
        { "id": "c", "label": "Bet $33 — a cheap stab at the pot" }
      ],
      "evaluation": { "correct_choice_id": "a", "acceptable_choice_ids": [] },
      "explanation": "Ace-high beats every missed draw and every worse high card in their checking range. Betting it turns a hand with real showdown value into a pure bluff: worse hands fold, better hands call. Against a calling station the fold equity a bluff needs — 50.0% for the pot-sized bet, 24.8% even for the small one — is not there. Checking wins the pot outright often enough to beat both bets.",
      "rule_of_thumb": "Bluff the hands that cannot win at showdown. Check the ones that can."
    }
    $json$::jsonb,
    1,
    true
  ),
  (
    36,
    6,
    'bluffing',
    3,
    $json$
    {
      "street": "river",
      "board": ["Q♠", "8♠", "5♦", "J♣", "3♠"],
      "hero_cards": ["A♠", "7♥"],
      "prompt": "River: Q♠ 8♠ 5♦ J♣ 3♠ — the flush completed. You hold A♠ 7♥: no pair, but the ace of spades. Pot: $120. Villain checks. What is the best line?",
      "game_state": { "pot": 120, "stack": 400 },
      "villain_archetype": "Thinking regular",
      "choices": [
        { "id": "a", "label": "Check — you have no pair" },
        { "id": "b", "label": "Bet $120 — you block the nut flush" },
        { "id": "c", "label": "Bet $40 — a small probe" }
      ],
      "evaluation": { "correct_choice_id": "b", "acceptable_choice_ids": [] },
      "explanation": "The A♠ blocks every nut-flush combination, so the strongest part of their calling range cannot exist — they must fold more often than usual. Your own hand cannot win at showdown, which makes it the right hand to bluff with rather than a hand you are throwing away. A pot-sized bet needs 50.0% folds; blocking the nuts against a thinking opponent is exactly the condition that gets you there. The small bet gives a price that defeats the point.",
      "rule_of_thumb": "The best river bluff blocks their calls and unblocks their folds."
    }
    $json$::jsonb,
    1,
    true
  )
on conflict (id) do update set
  module_id = excluded.module_id,
  skill_tag = excluded.skill_tag,
  difficulty = excluded.difficulty,
  scenario_json = excluded.scenario_json,
  version = excluded.version,
  is_active = excluded.is_active;

insert into public.table_scenarios
  (id, module_id, difficulty, skill_tag, street, prompt_title, situation_json,
   choices_json, correct_choice_id, acceptable_choice_ids, explanation,
   rule_of_thumb, is_active)
values
  (
    21,
    6,
    2,
    'bluffing',
    'flop',
    'Two ways to win',
    $json$
    {
      "hero": { "seat": 5, "position": "CO", "cards": ["Ts", "9s"] },
      "villains": [
        { "seat": 2, "position": "BB", "label": "Villain", "style": "straightforward" }
      ],
      "board": ["8s", "6h", "2c"],
      "blinds": { "sb": 0.5, "bb": 1 },
      "pot_bb": 6.5,
      "effective_stack_bb": 100,
      "pre_action": [
        { "seat": 3, "action": "fold" },
        { "seat": 4, "action": "fold" },
        { "seat": 5, "action": "raise", "amount_bb": 3 },
        { "seat": 6, "action": "fold" },
        { "seat": 1, "action": "fold" },
        { "seat": 2, "action": "call", "amount_bb": 3 },
        { "seat": 2, "action": "check" }
      ]
    }
    $json$::jsonb,
    $json$
    [
      { "id": "a", "label": "Check", "action": "check" },
      { "id": "b", "label": "Bet 4.3bb (two-thirds pot)", "action": "bet", "amount_bb": 4.3 },
      { "id": "c", "label": "Bet 13bb (two times pot)", "action": "bet", "amount_bb": 13 }
    ]
    $json$::jsonb,
    'b',
    null,
    'You hold a flush draw plus a gutshot — a hand that wins two ways. As a pure bluff, betting two-thirds of the pot would need folds 39.8% of the time, but this hand still wins a large share of the pot when called, so the bet clears that bar comfortably. Checking surrenders the fold equity with a hand that wants to build a pot it will often win. The double-pot overbet risks far more than the situation requires and folds out exactly the weak hands you want to keep in.',
    'Semi-bluff with equity: folds now, or a winning hand later.',
    true
  ),
  (
    22,
    6,
    3,
    'bluffing',
    'river',
    'The third barrel that should not come',
    $json$
    {
      "hero": { "seat": 5, "position": "BTN", "cards": ["Qh", "Jh"] },
      "villains": [
        { "seat": 2, "position": "BB", "label": "Villain", "style": "passive" }
      ],
      "board": ["9c", "7d", "3s", "4h", "2c"],
      "blinds": { "sb": 0.5, "bb": 1 },
      "pot_bb": 30,
      "effective_stack_bb": 70,
      "pre_action": [
        { "seat": 5, "action": "raise", "amount_bb": 3 },
        { "seat": 2, "action": "call", "amount_bb": 3 },
        { "seat": 2, "action": "check" },
        { "seat": 5, "action": "bet", "amount_bb": 4 },
        { "seat": 2, "action": "call", "amount_bb": 4 },
        { "seat": 2, "action": "check" },
        { "seat": 5, "action": "bet", "amount_bb": 9 },
        { "seat": 2, "action": "call", "amount_bb": 9 },
        { "seat": 2, "action": "check" }
      ]
    }
    $json$::jsonb,
    $json$
    [
      { "id": "a", "label": "Check back", "action": "check" },
      { "id": "b", "label": "Bet 30bb (pot)", "action": "bet", "amount_bb": 30 },
      { "id": "c", "label": "Bet 10bb (one-third pot)", "action": "bet", "amount_bb": 10 }
    ]
    $json$::jsonb,
    'a',
    null,
    'Your straight draw missed and queen-high cannot win a called pot. A passive opponent who has called two barrels on a board where nothing got there is not folding a third time: the pot-sized bet needs folds 50.0% of the time and the small one still needs 24.8%, and neither is available against this player. Queen-high also beats the occasional missed draw at showdown, so checking wins some pots outright. Giving up here is the line — the money you do not lose on a doomed third barrel counts the same as money won.',
    'Giving up is a line. Barrelling every flop bluff is the most expensive habit in low-stakes poker.',
    true
  )
on conflict (id) do update set
  module_id = excluded.module_id,
  difficulty = excluded.difficulty,
  skill_tag = excluded.skill_tag,
  street = excluded.street,
  prompt_title = excluded.prompt_title,
  situation_json = excluded.situation_json,
  choices_json = excluded.choices_json,
  correct_choice_id = excluded.correct_choice_id,
  acceptable_choice_ids = excluded.acceptable_choice_ids,
  explanation = excluded.explanation,
  rule_of_thumb = excluded.rule_of_thumb,
  is_active = excluded.is_active;


-- ---------------------------------------------------------------------
-- Module 07 — Short Stacks & Push/Fold (M8.7E)
--
-- Every number in this prose is derived from lib/poker/math.ts and the solved
-- pack in lib/pushfold, and pinned by lib/learn/pushfoldModuleNumbers.test.ts.
-- A lesson is the one place in the product where a wrong number is never
-- recomputed at runtime, so it is the one place it can rot unnoticed.
-- ---------------------------------------------------------------------

insert into public.modules (id, title, description, order_index, is_active)
values
  (
    7,
    'Short Stacks & Push/Fold',
    'Jam-or-fold play from 5 to 20 big blinds: fold equity, calling prices, antes, and a solved equilibrium instead of a copied chart.',
    7,
    true
  )
on conflict (id) do update set
  title = excluded.title,
  description = excluded.description,
  order_index = excluded.order_index,
  is_active = excluded.is_active;

insert into public.lessons
  (id, module_id, lesson_type, title, order_index, content_json,
   estimated_time_seconds, difficulty, version, is_active)
values
  -- lesson 27: When the Tree Collapses
  (
    27,
    7,
    'quiz'::public.lesson_type,
    'When the Tree Collapses',
    1,
    $json$
{
  "screens": [
    {
      "type": "info",
      "content": "## Under twenty blind, there is no small raise\n\nWith 100 big blinds you can open to 2.5, get raised, and fold. The raise cost you a fraction of your stack, so folding it is cheap.\n\nAt 10 big blinds that plan is gone. Open to 2.5 and you have put a quarter of your stack in \u2014 you are not folding to a raise, and everyone knows it. So the raise-then-fold branch of the tree disappears, and what is left is **jam or fold**."
    },
    {
      "type": "info",
      "content": "## Why that is good news\n\nA collapsed tree is a solvable tree.\n\nEvery hand ends one of two ways: everyone folds, or two players are all-in and the cards run out. There are no turn decisions, no river bluffs, no bet sizes to choose. The value of an all-in pot is just **equity**, and equity is something we can compute exactly.\n\nSo unlike 100bb play, where the answer is an approximation of a solve, short-stack play has a real answer. PotLuck computes it rather than copying a chart."
    },
    {
      "type": "info",
      "content": "## The two numbers behind every jam\n\nA jam wins in two different ways, and they are worth separating:\n\n1. **Everyone folds** and you take the blinds. No cards are shown.\n2. **Someone calls** and you win your share of a big pot.\n\nThe first is fold equity. The second is raw equity. A short stack jams wide because the first number stays the same size while your stack shrinks."
    },
    {
      "type": "info",
      "content": "## The dead money does not shrink with you\n\nThis is the whole idea, so it is worth saying slowly.\n\nThe blinds are 1.5bb whether you have 30 big blinds or 6. But at 6bb, picking up 1.5bb uncontested grows your stack by a quarter. At 30bb it is a rounding error.\n\nSo the shorter you get, the more a fold-out is worth relative to what you are risking \u2014 and the wider you should jam. On the button with no ante the solved range goes 19.2% at 20bb, 31.8% at 10bb, 38.8% at 5bb."
    },
    {
      "type": "question",
      "content": "Why does jam-or-fold replace raising at short stacks?",
      "choices": [
        {
          "id": "a",
          "label": "Because a raise commits so much of your stack that you can no longer fold to a re-raise"
        },
        {
          "id": "b",
          "label": "Because the rules forbid small raises below 20bb"
        },
        {
          "id": "c",
          "label": "Because short stacks are always dealt stronger hands"
        },
        {
          "id": "d",
          "label": "Because the blinds go up when your stack goes down"
        }
      ],
      "correct_choice_id": "a"
    },
    {
      "type": "question",
      "content": "A button jam is 19.2% of hands at 20bb and 38.8% at 5bb. What drives the change?",
      "choices": [
        {
          "id": "a",
          "label": "The blinds you win uncontested are the same size, but they are worth far more relative to a shorter stack"
        },
        {
          "id": "b",
          "label": "Short stacks get called less often by everyone"
        },
        {
          "id": "c",
          "label": "Hand values change when stacks are short"
        },
        {
          "id": "d",
          "label": "It is a convention, not a calculation"
        }
      ],
      "correct_choice_id": "a"
    },
    {
      "type": "recap",
      "content": "## Key takeaways\n\n- Below ~20bb the only real actions are **jam** and **fold**.\n- Every hand ends in a fold-out or an all-in, and an all-in is worth its equity \u2014 so this game can be **solved exactly**.\n- A jam earns from fold equity plus raw equity.\n- The dead money is fixed, your stack is not: **shorter stacks jam wider**, always."
    }
  ],
  "skill_tags": [
    "short_stack",
    "hand_selection"
  ],
  "xp_reward": 10
}
    $json$::jsonb,
    300,
    1,
    1,
    true
  ),
  -- lesson 28: How Often Does a Jam Need to Work?
  (
    28,
    7,
    'quiz'::public.lesson_type,
    'How Often Does a Jam Need to Work?',
    2,
    $json$
{
  "screens": [
    {
      "type": "info",
      "content": "## The break-even question\n\nSuppose your hand were worthless \u2014 say you somehow knew you would lose every time you got called. How often would everyone have to fold for the jam still to break even?\n\nThat is the same **break-even bluff frequency** from the bluffing module, with the whole stack as the bet:\n\n`folds needed = risk \u00f7 (risk + reward)`"
    },
    {
      "type": "info",
      "content": "## Run the number\n\nOn the button at 10bb with no ante, you are risking 10bb to pick up the 1.5bb in the middle.\n\n`10 \u00f7 (10 + 1.5) = 87.0%`\n\nEveryone would have to fold **87.0%** of the time. At 20bb it is worse: `20 \u00f7 21.5 = 93.0%`.\n\nThose look impossible, and they are \u2014 which is exactly the point of the next screen."
    },
    {
      "type": "info",
      "content": "## You are never actually bluffing\n\nThe 87.0% figure assumes your hand is worth nothing when called. No hand is. Even 72-offsuit wins about a third of the time against a calling range.\n\nSo the real threshold is far lower, and the solved button range at 10bb is **31.8%** of hands rather than the tiny sliver a pure bluff would justify. The break-even number is not the answer \u2014 it is the **floor** you would need if you had no equity at all.\n\nUse it the other way round: if a jam needs 93% folds before its equity is counted, you are probably too deep to be jamming at all."
    },
    {
      "type": "info",
      "content": "## The other side of the same equation\n\nCalling is the mirror, and it is simpler because a call has **no fold equity whatsoever**. You cannot win by making them go away \u2014 they are already all-in.\n\nSo a call is pure pot odds:\n\n`equity needed = what you still have to put in \u00f7 the pot you would win`"
    },
    {
      "type": "question",
      "content": "On the button at 10bb, jamming risks 10bb to win 1.5bb. If your hand had zero equity when called, how often would everyone need to fold?",
      "choices": [
        {
          "id": "a",
          "label": "87.0%"
        },
        {
          "id": "b",
          "label": "50.0%"
        },
        {
          "id": "c",
          "label": "31.8%"
        },
        {
          "id": "d",
          "label": "15.0%"
        }
      ],
      "correct_choice_id": "a"
    },
    {
      "type": "question",
      "content": "The solved button jamming range at 10bb is 31.8% of hands, far wider than the break-even bluff number suggests. Why?",
      "choices": [
        {
          "id": "a",
          "label": "Because you still have equity in the pot on the times you get called"
        },
        {
          "id": "b",
          "label": "Because the break-even formula does not apply to all-ins"
        },
        {
          "id": "c",
          "label": "Because players call short stacks too rarely"
        },
        {
          "id": "d",
          "label": "Because the button is the last seat to act"
        }
      ],
      "correct_choice_id": "a"
    },
    {
      "type": "recap",
      "content": "## Key takeaways\n\n- Break-even folds for a jam: `risk \u00f7 (risk + reward)`. At 10bb on the button that is **87.0%**.\n- That number assumes zero equity when called, so it is a **floor**, not a target.\n- Real equity is why the solved range is **31.8%** and not a sliver.\n- A call has no fold equity, so it is priced purely by pot odds."
    }
  ],
  "skill_tags": [
    "short_stack",
    "bluffing"
  ],
  "xp_reward": 10
}
    $json$::jsonb,
    330,
    2,
    1,
    true
  ),
  -- lesson 29: Calling Off Is a Different Question
  (
    29,
    7,
    'quiz'::public.lesson_type,
    'Calling Off Is a Different Question',
    3,
    $json$
{
  "screens": [
    {
      "type": "info",
      "content": "## Most of the mistakes are on this side\n\nPlayers study shoving ranges and then guess at calling ranges. It is the wrong way round \u2014 calling off your stack is where the expensive errors live, because the instinct is to compare your hand to their range instead of to the **price**."
    },
    {
      "type": "info",
      "content": "## What you are actually risking\n\nIn the big blind you have already posted. That money is gone whichever way you decide, so it is not part of what the call costs you.\n\nAt 10bb with no ante, facing a button jam:\n\n- You have 1bb in already, so calling costs **9bb** more.\n- The pot you would win is 10 + 10 + the small blind's abandoned 0.5 = **20.5bb**.\n- `9 \u00f7 20.5 = 43.9%` equity needed.\n\nThe solved big-blind calling range is **22.5%** of hands."
    },
    {
      "type": "info",
      "content": "## Now do it from an empty seat\n\nSuppose instead you are in the cutoff and under the gun jams 10bb. Nothing of yours is in the pot.\n\n- The call costs the full **10bb**.\n- The pot is 10 + 10 + 1.5 = **21.5bb**.\n- `10 \u00f7 21.5 = 46.5%` \u2014 a worse price than the big blind was getting.\n\nAnd the range you face is tighter, because under the gun jams only **13.1%** of hands with four players still to act. Both effects point the same way: the solved cutoff calling range is **7.5%**."
    },
    {
      "type": "info",
      "content": "## The rule to carry away\n\nA jam can profit with hands that are behind, because it wins the pot outright whenever everyone folds. A call never can.\n\nSo from a seat with nothing invested, your calling range is **much tighter** than the range jamming into you \u2014 7.5% against 13.1% in the example above.\n\nFrom the blinds it can be the other way round, and that is not a contradiction: you are getting a far better price because part of your stack is already in the middle."
    },
    {
      "type": "question",
      "content": "You are in the big blind at 10bb with no ante. The button jams. What equity does calling need?",
      "choices": [
        {
          "id": "a",
          "label": "43.9% \u2014 you are risking 9bb to win a 20.5bb pot"
        },
        {
          "id": "b",
          "label": "50% \u2014 an all-in is a coin flip by definition"
        },
        {
          "id": "c",
          "label": "22.5% \u2014 the size of the calling range"
        },
        {
          "id": "d",
          "label": "87.0% \u2014 the same as the jam needs"
        }
      ],
      "correct_choice_id": "a"
    },
    {
      "type": "question",
      "content": "Under the gun jams 13.1% of hands at 10bb; the cutoff calls with only 7.5%. Why is the caller so much tighter?",
      "choices": [
        {
          "id": "a",
          "label": "A call has no fold equity, and from the cutoff none of your stack is in the pot yet"
        },
        {
          "id": "b",
          "label": "The cutoff acts before the blinds"
        },
        {
          "id": "c",
          "label": "Under the gun is bluffing most of the time"
        },
        {
          "id": "d",
          "label": "Calling ranges are always half of shoving ranges"
        }
      ],
      "correct_choice_id": "a"
    },
    {
      "type": "recap",
      "content": "## Key takeaways\n\n- The call costs what you still have to put in, not your whole stack \u2014 subtract the blind you already posted.\n- Big blind vs a 10bb button jam: risk 9 to win 20.5, needing **43.9%**; the solved range is **22.5%**.\n- Cutoff vs a 10bb UTG jam: risk 10 to win 21.5, needing **46.5%**; the solved range is **7.5%**.\n- A jam profits from folds. A call cannot. From an uninvested seat, **call tighter than they jam**."
    }
  ],
  "skill_tags": [
    "short_stack",
    "pot_odds"
  ],
  "xp_reward": 10
}
    $json$::jsonb,
    330,
    2,
    1,
    true
  ),
  -- lesson 30: Antes, and a Rule That Is Not Quite True
  (
    30,
    7,
    'quiz'::public.lesson_type,
    'Antes, and a Rule That Is Not Quite True',
    4,
    $json$
{
  "screens": [
    {
      "type": "info",
      "content": "## Adding dead money\n\nA big-blind ante puts an extra blind in the middle before anyone acts. Nobody has to call it, and it does not change what a jam risks.\n\nSo the reward side of `risk \u00f7 (risk + reward)` grows while the risk side stays put, and every threshold loosens. Under the gun at 10bb goes from **13.1%** to **20.7%** of hands \u2014 a jam that was marginal is now clear."
    },
    {
      "type": "info",
      "content": "## The rule everyone repeats\n\n\"Antes widen every shoving range.\"\n\nIt is in every training video, and it is **not quite true**. Here is what it misses: somebody has to post that ante, and it is the big blind. Their money is in the pot too \u2014 which improves the price *they* are getting to call."
    },
    {
      "type": "info",
      "content": "## Where it breaks\n\nBlind versus blind, there is nobody to fold out except the one player whose odds just improved.\n\nAt 5bb with a 1bb ante, the big blind has 2 of their 5 in already and is calling 3 to win 10 \u2014 under 30% equity needed, so they call most hands. The small blind's jam has almost no fold equity left to buy, and the solved range **tightens** from 69.8% to 65.3%.\n\nDeeper, the effect flips back: at 20bb the small blind's jam widens from 38.5% to 45.1%, because now there is real fold equity for the extra dead money to buy."
    },
    {
      "type": "info",
      "content": "## What to actually remember\n\nAn ante does two things at once:\n\n- It adds dead money, which **widens** jams \u2014 this dominates when there are players behind you to fold out.\n- It improves the big blind's price, which **widens their calls** \u2014 and blind versus blind at very short stacks, that is the larger effect.\n\nSo: with a full table behind you, jam wider with an ante. Blind versus blind and very short, expect to be called far more often, and expect your own big-blind defence to get much wider \u2014 22.5% up to 38.8% at 10bb."
    },
    {
      "type": "question",
      "content": "Under the gun at 10bb jams 13.1% with no ante and 20.7% with a big-blind ante. What changed?",
      "choices": [
        {
          "id": "a",
          "label": "There is more dead money to win uncontested, and the jam risks no more than before"
        },
        {
          "id": "b",
          "label": "The ante makes everyone behind fold more often"
        },
        {
          "id": "c",
          "label": "The effective stack got deeper"
        },
        {
          "id": "d",
          "label": "Hand equities improve when there is an ante"
        }
      ],
      "correct_choice_id": "a"
    },
    {
      "type": "question",
      "content": "At 5bb the small blind's jam gets *tighter* with an ante \u2014 69.8% down to 65.3%. Why does the usual rule fail here?",
      "choices": [
        {
          "id": "a",
          "label": "The ante is posted by the big blind, so it improves their calling price, and blind versus blind there is nobody else to fold out"
        },
        {
          "id": "b",
          "label": "The small blind has less money at 5bb with an ante"
        },
        {
          "id": "c",
          "label": "It is a rounding error in the solve"
        },
        {
          "id": "d",
          "label": "Antes never widen anything; the rule is simply wrong"
        }
      ],
      "correct_choice_id": "a"
    },
    {
      "type": "recap",
      "content": "## Key takeaways\n\n- An ante is dead money that a jam risks nothing extra to win, so it widens jams: UTG at 10bb goes **13.1% \u2192 20.7%**.\n- But the big blind posts it, so it also improves *their* price to call: **22.5% \u2192 38.8%** at 10bb.\n- Blind versus blind and very short, the second effect wins and the small blind's jam **tightens** \u2014 69.8% \u2192 65.3% at 5bb.\n- Every one of these numbers is chip EV. On a tournament bubble, ICM tightens calling ranges sharply and none of it holds."
    }
  ],
  "skill_tags": [
    "short_stack",
    "hand_selection"
  ],
  "xp_reward": 10
}
    $json$::jsonb,
    330,
    3,
    1,
    true
  )

on conflict (id) do update set
  module_id = excluded.module_id,
  lesson_type = excluded.lesson_type,
  title = excluded.title,
  order_index = excluded.order_index,
  content_json = excluded.content_json,
  estimated_time_seconds = excluded.estimated_time_seconds,
  difficulty = excluded.difficulty,
  version = excluded.version,
  is_active = excluded.is_active;

select setval(pg_get_serial_sequence('public.modules', 'id'),
              greatest((select max(id) from public.modules), 1), true);
select setval(pg_get_serial_sequence('public.lessons', 'id'),
              greatest((select max(id) from public.lessons), 1), true);
select setval(pg_get_serial_sequence('public.scenarios', 'id'),
              greatest((select max(id) from public.scenarios), 1), true);
select setval(pg_get_serial_sequence('public.table_scenarios', 'id'),
              greatest((select max(id) from public.table_scenarios), 1), true);

commit;
