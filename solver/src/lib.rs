//! Shared game construction for every solver binary.
//!
//! ONE definition of the betting tree, used by every tool in this crate.
//!
//! This matters more than it looks. `main.rs` exports the hands a player
//! actually plays; `root-ev` computes the postflop EVs that the preflop solve
//! uses as its terminal payoffs. If those two built even slightly different
//! trees, the preflop ranges would be an equilibrium of a game nobody plays,
//! and nothing would fail — the numbers would simply be wrong, confidently.
//! That is the same failure mode CLAUDE.md's poker-math rules exist to
//! prevent, so the tree lives here and nowhere else.

use postflop_solver::*;

/// The one betting tree.
///
/// A deliberately small tree: one bet size per street, one raise size, all-in
/// where the threshold forces it. The trainer teaches lines, not exhaustive
/// sizing menus, and every extra size multiplies solve time, artifact size and
/// UI clutter. Labelled a simplified tree in the UI.
pub fn tree_config(pot: i32, stack: i32) -> TreeConfig {
    let flop_sizes = BetSizeOptions::try_from(("33%", "2.5x")).unwrap();
    let turn_sizes = BetSizeOptions::try_from(("66%", "2.5x")).unwrap();
    let river_sizes = BetSizeOptions::try_from(("66%", "2.5x")).unwrap();

    TreeConfig {
        initial_state: BoardState::Flop,
        starting_pot: pot,
        effective_stack: stack,
        rake_rate: 0.0,
        rake_cap: 0.0,
        flop_bet_sizes: [flop_sizes.clone(), flop_sizes.clone()],
        turn_bet_sizes: [turn_sizes.clone(), turn_sizes.clone()],
        river_bet_sizes: [river_sizes.clone(), river_sizes],
        turn_donk_sizes: None,
        river_donk_sizes: None,
        add_allin_threshold: 1.5,
        force_allin_threshold: 0.15,
        merging_threshold: 0.1,
    }
}

/// The two ranges and the board, for one flop.
pub fn card_config(flop: &str, oop: &str, ip: &str) -> CardConfig {
    CardConfig {
        range: [oop.parse().unwrap(), ip.parse().unwrap()],
        flop: flop_from_str(flop).unwrap(),
        turn: NOT_DEALT,
        river: NOT_DEALT,
    }
}

/// Build the postflop game every tool in this crate solves.
pub fn build_game(flop: &str, oop: &str, ip: &str, pot: i32, stack: i32) -> PostFlopGame {
    let action_tree = ActionTree::new(tree_config(pot, stack)).unwrap();
    PostFlopGame::with_config(card_config(flop, oop, ip), action_tree).unwrap()
}
