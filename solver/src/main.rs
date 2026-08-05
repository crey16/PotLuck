//! PotLuck offline solve-and-export: scripted play-mode hand instances.
//!
//! Usage:
//!   potluck-solver <flop e.g. Ts9s5h> <out_dir> <ranges.json> [n_instances] [seed]
//!
//! ranges.json: {"oop": "<range>", "ip": "<range>", "pot": 55, "stack": 975}
//! (chips are tenths of a big blind).
//!
//! Why instances and not the full tree: a full-tree export of this spot is
//! ~740 MB gzipped PER FLOP (measured 2026-07-30: 1.1M decision nodes × ~700
//! combos × freq+EV). The play mode only ever needs one hero hand at a time,
//! so instead we pre-generate N self-contained "scripted hands": hero hand +
//! bot hand sampled from the solved ranges, then the full tree of HERO
//! choices only — bot responses sampled from its solver strategy, turn/river
//! cards sampled per branch — storing hero's action frequencies and EV losses
//! for hero's specific hand. A few KB per playable hand.
//!
//! Frequencies are u8 (0..=255 → 0..=1). EV losses are u8 in 0.05bb steps
//! (ev_unit 0.5 chips at 10 chips/bb), clamped at 12.75bb — the unit contract
//! mirrored by EV_STEP_BB in lib/play/verdict.ts; change both together.

use flate2::write::GzEncoder;
use flate2::Compression;
use postflop_solver::*;
use serde::Serialize;
use std::collections::BTreeMap;
use std::fs::File;
use std::io::Write;

/// One scripted step between hero decisions: a bot action or a dealt card.
#[derive(Serialize, Clone)]
struct Step {
    /// "a" = bot action (label), "c" = dealt card (e.g. "Qd")
    t: char,
    v: String,
}

#[derive(Serialize)]
struct HeroNode {
    /// Script since the previous hero decision (bot actions, dealt cards).
    pre: Vec<Step>,
    /// Action labels, e.g. ["X", "B18"] / ["F", "C", "R45"].
    a: Vec<String>,
    /// Solver frequency per action for the hero hand, u8.
    f: Vec<u8>,
    /// EV loss vs the best action, u8, 0.05bb steps (see file header).
    l: Vec<u8>,
    /// Total chips wagered so far by [OOP, IP] (excluding the starting pot).
    tb: [i32; 2],
    /// Street: 0 flop, 1 turn, 2 river.
    st: u8,
    /// Hero equity vs the bot's full range at this node, u8 (0..=255 → 0..=1).
    eq: u8,
}

#[derive(Serialize)]
struct EndNode {
    /// Script after hero's last action (bot actions, dealt cards) to the end.
    pre: Vec<Step>,
    /// Final wagered chips per player.
    tb: [i32; 2],
    /// "f" hero folded, "bf" bot folded, "sd" showdown.
    k: String,
}

#[derive(Serialize)]
struct Instance {
    /// 0 = hero is OOP (BB), 1 = hero is IP (BTN).
    hero: u8,
    hand: String,
    bot: String,
    /// Hero decision nodes keyed by hero action path, e.g. "" / "1" / "1.0".
    nodes: BTreeMap<String, HeroNode>,
    /// Terminal script keyed by the hero action path that ends the hand.
    ends: BTreeMap<String, EndNode>,
}

#[derive(Serialize)]
struct Export {
    spot: String,
    flop: String,
    pot: i32,
    stack: i32,
    instances: Vec<Instance>,
}

fn action_label(a: &Action) -> String {
    match a {
        Action::Fold => "F".to_string(),
        Action::Check => "X".to_string(),
        Action::Call => "C".to_string(),
        Action::Bet(n) => format!("B{}", n),
        Action::Raise(n) => format!("R{}", n),
        Action::AllIn(n) => format!("A{}", n),
        _ => panic!("unexpected action {:?}", a),
    }
}

/// xorshift64* — deterministic, dependency-free.
struct Rng(u64);
impl Rng {
    fn next_f64(&mut self) -> f64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0.wrapping_mul(0x2545F4914F6CDD1D) >> 11) as f64 / (1u64 << 53) as f64
    }
    fn pick_weighted(&mut self, weights: &[f64]) -> usize {
        let total: f64 = weights.iter().sum();
        let mut x = self.next_f64() * total;
        for (i, w) in weights.iter().enumerate() {
            x -= w;
            if x <= 0.0 {
                return i;
            }
        }
        weights.len() - 1
    }
}

fn card_mask(pair: (u8, u8)) -> u64 {
    (1u64 << pair.0) | (1u64 << pair.1)
}

struct Ctx<'a> {
    game: &'a mut PostFlopGame,
    hero: usize,
    hero_idx: usize,
    bot_idx: usize,
    blocked: u64,
    /// Chips per EV-loss step (0.05bb at 10 chips/bb).
    ev_unit: f32,
    rng: &'a mut Rng,
}

fn street_of(board_len: usize) -> u8 {
    match board_len {
        3 => 0,
        4 => 1,
        _ => 2,
    }
}

fn walk(
    ctx: &mut Ctx,
    history: &mut Vec<usize>,
    hero_path: &mut Vec<usize>,
    pre: Vec<Step>,
    nodes: &mut BTreeMap<String, HeroNode>,
    ends: &mut BTreeMap<String, EndNode>,
    hero_folded: bool,
) {
    let key = || {
        hero_path
            .iter()
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join(".")
    };

    if ctx.game.is_terminal_node() || hero_folded {
        let tb = ctx.game.total_bet_amount();
        let last_was_hero_fold = hero_folded;
        // Whose fold ended it? If the script's last step is a bot "F", the bot
        // folded; if hero's path ends in a fold we flagged it before descending.
        let k = if last_was_hero_fold {
            "f"
        } else if pre.last().map(|s| s.t == 'a' && s.v == "F").unwrap_or(false) {
            "bf"
        } else {
            "sd"
        };
        let mut pre = pre;
        if k == "sd" {
            // All-in showdowns terminate the solver's tree WITHOUT explicit
            // chance nodes (payoffs are equity-averaged), but the play mode
            // needs a concrete runout to show and score — deal it here.
            let board = ctx.game.current_board();
            let mut dead: u64 = ctx.blocked;
            for c in &board {
                dead |= 1u64 << c;
            }
            for _ in board.len()..5 {
                let cards: Vec<u8> = (0..52).filter(|c| dead & (1u64 << c) == 0).collect();
                let card = cards[(ctx.rng.next_f64() * cards.len() as f64) as usize];
                dead |= 1u64 << card;
                pre.push(Step { t: 'c', v: card_to_string(card).unwrap() });
            }
        }
        ends.insert(key(), EndNode { pre, tb, k: k.to_string() });
        return;
    }

    if ctx.game.is_chance_node() {
        let possible = ctx.game.possible_cards() & !ctx.blocked;
        let cards: Vec<u8> = (0..52).filter(|c| possible & (1u64 << c) != 0).collect();
        let weights = vec![1.0; cards.len()];
        let card = cards[ctx.rng.pick_weighted(&weights)];
        let mut pre = pre;
        pre.push(Step { t: 'c', v: card_to_string(card).unwrap() });
        history.push(card as usize);
        ctx.game.play(card as usize);
        walk(ctx, history, hero_path, pre, nodes, ends, false);
        history.pop();
        let h = history.clone();
        ctx.game.apply_history(&h);
        return;
    }

    let player = ctx.game.current_player();
    let actions = ctx.game.available_actions();
    let n_actions = actions.len();
    let n_hands = ctx.game.private_cards(player).len();
    let strategy = ctx.game.strategy();

    if player != ctx.hero {
        // Bot: sample one action from its strategy for its hand.
        let w: Vec<f64> = (0..n_actions)
            .map(|a| strategy[a * n_hands + ctx.bot_idx].max(0.0) as f64)
            .collect();
        let a = if w.iter().sum::<f64>() > 1e-9 {
            ctx.rng.pick_weighted(&w)
        } else {
            // Unreachable-for-bot node (hero forced it): play the first action.
            0
        };
        let mut pre = pre;
        pre.push(Step { t: 'a', v: action_label(&actions[a]) });
        history.push(a);
        ctx.game.play(a);
        walk(ctx, history, hero_path, pre, nodes, ends, false);
        history.pop();
        let h = history.clone();
        ctx.game.apply_history(&h);
        return;
    }

    // Hero decision node. expected_values_detail gives the EV of every action
    // for every hero hand AT THIS NODE, in one consistent payoff convention —
    // this is what CFR itself compares, so EV losses derived from it are
    // valid. (Descending into each child and calling expected_values there is
    // NOT valid: the child's normalization reference differs per action.)
    ctx.game.cache_normalized_weights();
    let detail = ctx.game.expected_values_detail(player);
    let equity = ctx.game.equity(player);

    let mut best = f32::NEG_INFINITY;
    for a in 0..n_actions {
        best = best.max(detail[a * n_hands + ctx.hero_idx]);
    }
    let f: Vec<u8> = (0..n_actions)
        .map(|a| (strategy[a * n_hands + ctx.hero_idx] * 255.0).round().clamp(0.0, 255.0) as u8)
        .collect();
    let l: Vec<u8> = (0..n_actions)
        .map(|a| {
            let loss = ((best - detail[a * n_hands + ctx.hero_idx]) / ctx.ev_unit)
                .round()
                .clamp(0.0, 255.0) as u8;
            // Coherence repair: at rarely-reached nodes CFR's per-action EVs
            // are noisy, and an action the solver plays ~always can carry a
            // phantom half-bb "loss". If the solved strategy takes an action
            // at >=78%, it cannot be a mistake — clamp into the correct band.
            if f[a] >= 200 { loss.min(2) } else { loss }
        })
        .collect();

    nodes.insert(
        key(),
        HeroNode {
            pre,
            a: actions.iter().map(action_label).collect(),
            f,
            l,
            tb: ctx.game.total_bet_amount(),
            st: street_of(ctx.game.current_board().len()),
            eq: (equity[ctx.hero_idx] * 255.0).round().clamp(0.0, 255.0) as u8,
        },
    );

    for a in 0..n_actions {
        let folded = matches!(actions[a], Action::Fold);
        history.push(a);
        hero_path.push(a);
        ctx.game.play(a);
        walk(ctx, history, hero_path, Vec::new(), nodes, ends, folded);
        history.pop();
        hero_path.pop();
        let h = history.clone();
        ctx.game.apply_history(&h);
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 4 {
        eprintln!("usage: potluck-solver <flop> <out_dir> <ranges.json> [n_instances] [seed]");
        std::process::exit(2);
    }
    let flop_str = &args[1];
    let out_dir = &args[2];
    let ranges_json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&args[3]).expect("read ranges.json"))
            .expect("parse ranges.json");
    let n_instances: usize = args.get(4).map(|s| s.parse().unwrap()).unwrap_or(200);
    let seed: u64 = args.get(5).map(|s| s.parse().unwrap()).unwrap_or(1);

    let oop_str = ranges_json["oop"].as_str().expect("oop range");
    let ip_str = ranges_json["ip"].as_str().expect("ip range");
    let pot = ranges_json["pot"].as_i64().expect("pot") as i32;
    let stack = ranges_json["stack"].as_i64().expect("stack") as i32;

    // The tree lives in lib.rs so this exporter and `root-ev` cannot drift.
    // An EV computed against a different tree than the one played describes a
    // different game, and nothing would fail — see the note there.
    let mut game = potluck_solver::build_game(flop_str, oop_str, ip_str, pot, stack);

    let (mem_raw, mem_comp) = game.memory_usage();
    eprintln!(
        "[{}] memory: {:.1} GB raw / {:.1} GB compressed",
        flop_str,
        mem_raw as f64 / 1e9,
        mem_comp as f64 / 1e9
    );
    game.allocate_memory(true);

    let target = pot as f32 * 0.003;
    let t0 = std::time::Instant::now();
    let exploitability = solve(&mut game, 1000, target, false);
    eprintln!(
        "[{}] solved: exploitability {:.3} ({:.2}% pot) in {:.0}s",
        flop_str,
        exploitability,
        exploitability / pot as f32 * 100.0,
        t0.elapsed().as_secs_f64()
    );

    let hands = [
        game.private_cards(0).to_vec(),
        game.private_cards(1).to_vec(),
    ];
    let hand_strs = [
        holes_to_strings(game.private_cards(0)).unwrap(),
        holes_to_strings(game.private_cards(1)).unwrap(),
    ];
    game.back_to_root();
    let root_weights = [game.weights(0).to_vec(), game.weights(1).to_vec()];

    let mut rng = Rng(seed.wrapping_mul(0x9E3779B97F4A7C15) ^ 0xDEADBEEF ^ {
        // Mix the flop into the seed so every flop gets distinct instances.
        flop_str.bytes().fold(0u64, |a, b| a.wrapping_mul(131).wrapping_add(b as u64))
    });

    let mut instances = Vec::with_capacity(n_instances);
    let t0 = std::time::Instant::now();

    for k in 0..n_instances {
        let hero = k % 2; // alternate OOP / IP
        let bot = hero ^ 1;

        // Sample compatible (hero, bot) hands from the root range weights.
        let (hero_idx, bot_idx) = loop {
            let hw: Vec<f64> = root_weights[hero].iter().map(|w| *w as f64).collect();
            let hi = rng.pick_weighted(&hw);
            let h_mask = card_mask(hands[hero][hi]);
            let bw: Vec<f64> = hands[bot]
                .iter()
                .zip(root_weights[bot].iter())
                .map(|(pair, w)| {
                    if card_mask(*pair) & h_mask != 0 { 0.0 } else { *w as f64 }
                })
                .collect();
            if bw.iter().sum::<f64>() <= 1e-9 {
                continue;
            }
            break (hi, rng.pick_weighted(&bw));
        };

        let blocked = card_mask(hands[hero][hero_idx]) | card_mask(hands[bot][bot_idx]);
        let mut nodes = BTreeMap::new();
        let mut ends = BTreeMap::new();
        {
            let mut ctx = Ctx {
                game: &mut game,
                hero,
                hero_idx,
                bot_idx,
                blocked,
                ev_unit: 0.5, // 0.05bb per step at 10 chips/bb → cap 12.75bb
                rng: &mut rng,
            };
            ctx.game.back_to_root();
            walk(
                &mut ctx,
                &mut Vec::new(),
                &mut Vec::new(),
                Vec::new(),
                &mut nodes,
                &mut ends,
                false,
            );
        }
        instances.push(Instance {
            hero: hero as u8,
            hand: hand_strs[hero][hero_idx].clone(),
            bot: hand_strs[bot][bot_idx].clone(),
            nodes,
            ends,
        });
        if (k + 1) % 50 == 0 {
            eprintln!(
                "[{}] {} instances in {:.0}s",
                flop_str,
                k + 1,
                t0.elapsed().as_secs_f64()
            );
        }
    }

    let export = Export {
        spot: "srp-btn-bb".to_string(),
        flop: flop_str.to_string(),
        pot,
        stack,
        instances,
    };

    std::fs::create_dir_all(out_dir).unwrap();
    let path = format!("{}/{}.json.gz", out_dir, flop_str);
    let file = File::create(&path).unwrap();
    let mut enc = GzEncoder::new(file, Compression::best());
    enc.write_all(serde_json::to_string(&export).unwrap().as_bytes())
        .unwrap();
    enc.finish().unwrap();
    let size = std::fs::metadata(&path).unwrap().len();
    eprintln!(
        "[{}] wrote {} ({:.2} MB, {} instances)",
        flop_str,
        path,
        size as f64 / 1e6,
        n_instances
    );
}
