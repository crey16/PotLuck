//! Export per-hand root EVs for one flop — the terminal payoffs a preflop
//! solve needs.
//!
//!     root-ev <flop> <out_dir> <ranges.json>
//!
//! `main.rs` exports the hands a player plays. This exports what each hand is
//! WORTH at the start of that postflop game, which is what prices the preflop
//! call that created it. Both build the tree through `potluck_solver::build_game`
//! so they cannot describe different games.
//!
//! Output is per (flop, player, hand): the EV in chips at the root, and the
//! normalized weight of that hand in the player's range. Averaging across
//! flops happens later, in the preflop solver, because the flop weighting is a
//! statistical decision that does not belong in a solve.
//!
//! Units: 10 chips = 1bb (pot 55 = 5.5bb, stack 975 = 97.5bb).

use postflop_solver::*;
use serde::Serialize;
use std::fs::File;
use std::io::Write;

#[derive(Serialize)]
struct PlayerEv {
    /// "AhKs" style, index-aligned with `ev` and `weight`.
    hands: Vec<String>,
    /// EV in chips at the root of the postflop game.
    ev: Vec<f32>,
    /// Normalized weight of this hand within the player's range.
    weight: Vec<f32>,
}

#[derive(Serialize)]
struct RootEv {
    flop: String,
    pot: i32,
    stack: i32,
    exploitability: f32,
    /// Index 0 = OOP (the BB caller), index 1 = IP (the BTN opener).
    players: Vec<PlayerEv>,
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 4 {
        eprintln!("usage: root-ev <flop> <out_dir> <ranges.json>");
        std::process::exit(2);
    }
    let flop_str = &args[1];
    let out_dir = &args[2];
    let ranges: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&args[3]).expect("read ranges.json"))
            .expect("parse ranges.json");

    let oop = ranges["oop"].as_str().expect("oop range");
    let ip = ranges["ip"].as_str().expect("ip range");
    let pot = ranges["pot"].as_i64().expect("pot") as i32;
    let stack = ranges["stack"].as_i64().expect("stack") as i32;

    let mut game = potluck_solver::build_game(flop_str, oop, ip, pot, stack);
    game.allocate_memory(true);

    // Same convergence target as the hand exporter: 0.3% of pot.
    let target = pot as f32 * 0.003;
    let t0 = std::time::Instant::now();
    let exploitability = solve(&mut game, 1000, target, false);
    eprintln!(
        "[{}] solved: exploitability {:.3} ({:.2}% pot) in {:.0}s",
        flop_str,
        exploitability,
        100.0 * exploitability / pot as f32,
        t0.elapsed().as_secs_f64()
    );

    // Root, with weights cached — `expected_values` requires both.
    game.back_to_root();
    game.cache_normalized_weights();

    let mut players = Vec::new();
    for player in 0..2 {
        let ev = game.expected_values(player);
        let weight = game.normalized_weights(player).to_vec();
        let hands: Vec<String> = game
            .private_cards(player)
            .iter()
            .map(|&h| hole_to_string(h).expect("hole_to_string"))
            .collect();
        assert_eq!(hands.len(), ev.len(), "hand/ev length mismatch");
        assert_eq!(hands.len(), weight.len(), "hand/weight length mismatch");
        players.push(PlayerEv { hands, ev, weight });
    }

    let out = RootEv {
        flop: flop_str.clone(),
        pot,
        stack,
        exploitability,
        players,
    };

    std::fs::create_dir_all(out_dir).expect("create out dir");
    let path = format!("{out_dir}/{flop_str}.ev.json");
    let mut f = File::create(&path).expect("create output");
    f.write_all(serde_json::to_string(&out).expect("serialize").as_bytes())
        .expect("write output");
    eprintln!(
        "[{}] wrote {} ({} OOP hands, {} IP hands)",
        flop_str,
        path,
        out.players[0].hands.len(),
        out.players[1].hands.len()
    );
}
