# M8 durable play data contract

M8 makes the normalized play tables the authoritative coaching record while
leaving `attempts` in place as the XP, streak, and generic activity event. The
browser never writes a grade directly: authenticated users may read only their
own play history, and the trusted API writes all play rows.

## Stable identity

The shipped artifact is `potluck:m6:srp-btn-bb:v1`, using solution profile
`cash-6max-chip-ev`, solution version `m6-v1`, catalog format 1, and grading
algorithm `play-grade:v1`. Its catalog records a SHA-256 over the manifest,
referenced solve files, and canonical grading metadata (including preflop
frequencies). A changed solve, export format, reference range, or grading
algorithm must publish a new version rather than mutate this row.
The catalog table is append-only: the API role receives `SELECT`/`INSERT` but
not mutation/truncate privileges, and triggers reject row mutation or truncate
even by an owner role.

Stable source IDs are constructed as follows:

- hand: `{solve_pack_id}/{flop}#{instance_index}`
- preflop node: `{source_hand_id}/preflop`
- postflop node: `{source_hand_id}/{path}`, with `root` for the empty path
- session, hand, and decision writes also carry caller-generated UUIDs. Their
  unique constraints make an identical retry return the existing record.

A repeated hand intentionally gets a new `play_hands.id` and
`client_hand_id`, while retaining the same `source_hand_id`.

## Record boundaries

`play_sessions` freezes the complete configuration twice: queryable columns
and `config_snapshot`. The snapshot includes solution profile/version, table
size, hero and matchup positions, starting spot, action-family filters, stack,
rake/EV model, and advanced settings. The columns support filters without
silently reinterpreting an old JSON shape.

`play_hands` links a session to the immutable source hand. It stores position,
spot, stack, starting node/street, hero and opponent cards, initial board,
runout, action-history, deal, and result snapshots. The JSON snapshots retain
pack-specific reproducibility state; the promoted columns support recent-hand
queries and review without parsing JSON.

`play_decisions` stores the analytics dimensions and grade for one hero node:
position, spot, stack, street, board, board texture, hand class, action context,
chosen action, solve node, grading source/status/version, frequency, EV loss,
verdict, and time. `play_decision_actions` stores every legal alternative as a
separate row, including ordinal, action family/size, frequency, absolute EV
when available, signed EV delta versus best, non-negative EV loss, and whether
it was chosen. `alternatives_complete` is true only after the entire node was
persisted.

## Authoritative write protocol

1. Create or recover a session by `(user_id, client_session_id)` and verify its
   configuration against the immutable solve-pack catalog.
2. Create or recover a hand by `(session_id, client_hand_id)`. The server loads
   the source instance and derives the stable hand and starting-node IDs.
3. Accept only a client decision UUID, node path, and chosen action. The server
   verifies the node exists, the action is legal, and the hand owns the node.
   It derives all frequencies, EV data, verdict, alternatives, and analytics
   fields from the referenced pack in the same transaction as the linked
   `attempts` XP event. A second client UUID cannot duplicate the same node
   because `(hand_id, solve_node_id)` is also unique.
4. Mark a hand or session `completed` only when the terminal state is known.
   Mark an explicitly ended non-terminal record `abandoned`. Otherwise leave
   it `incomplete`; incomplete records deliberately survive reloads.

`completed` and `abandoned` are terminal. Their corresponding timestamp is
required, while an `incomplete` record has neither terminal timestamp.

## EV and grading semantics

`grading_source` distinguishes `solver`, `reference`, and `ungraded`.
`grading_status` distinguishes server `validated`, server
`reference_graded`, imported `legacy_unverified`, and `ungraded` rows.
Weakness analytics must include only the first two statuses.

The M6 postflop files contain frequency and loss versus the best action, but
not absolute action EV. Those rows use `ev_basis = 'relative_to_best'`:
`ev_bb`, `chosen_ev_bb`, and `best_ev_bb` are null, while every action's
`ev_delta_bb` is zero or negative and `ev_loss_bb` is its non-negative inverse.
Future packs that publish absolute EV use `ev_basis = 'absolute'`. Preflop is
graded from `reference-ranges:v1`, uses `ev_basis = 'unknown'`, and leaves all
EV fields null. Null means unknown; zero is a real, known zero loss and must
never be used as a placeholder.

## Legacy M6 attempts

The migration imports only structurally compatible `drill_kind = 'play'`
payloads whose flop and instance index have the shape of the historical M6
bank (the exact 25 flops and indices 0–199). Every imported row uses the
separate immutable archive identity `potluck:legacy-play-attempts:v1`; it never
acquires the authoritative M6 solve-pack identity merely because its
client-controlled payload resembles one. The claimed current pack ID is kept
only as unverified provenance metadata. Because those attempts contain neither
session boundaries nor hand terminal events, they are grouped into one closed
legacy session per user; each preflop row (or source-hand change) starts a hand,
and imported hands stay `incomplete` rather than inventing completion. The
session is `abandoned` so new writes cannot accidentally continue the legacy
stream. Generic attempts had no idempotency key; if two rows claim the same
inferred hand/node, the migration retains the earliest archive row and leaves
the duplicate in `attempts` rather than violating normalized node uniqueness.

Legacy rows retain the chosen action, archive source reference, timestamp, and
raw payload. The old payload was client-controlled, so its claimed cards,
position, path, and action are not treated as proof that it matches a current
solve instance; the entire imported grade remains unverified and is excluded
from coaching aggregates. Postflop quantized frequency/loss is copied with
`grading_status = 'legacy_unverified'`; only the chosen action is available, so
`alternatives_complete` is false. Preflop records use
`grading_source = 'reference'`, `grading_version = 'reference-ranges:v1'`, and
unknown/null EV. Old client correctness is retained only inside
`action_context`; the authoritative verdict remains `ungraded` until a trusted
regrade is run against the catalog.

The backfill is intentionally one-shot. During production rollout, legacy
generic play writes must be stopped before applying `0004`, or the release must
audit and explicitly archive any attempts written between the migration and
the new API cutover. Deploying the new frontend against an unmigrated database
is not a safe substitute.

## Access and indexes

RLS exposes owner-only `SELECT` policies on sessions, hands, decisions, and
actions. Authenticated browser roles receive no insert, update, or delete
grant; solve-pack metadata is authenticated-readable. The service role retains
write access. User/time indexes support recent history, partial indexes find
recoverable incomplete records, hand/order indexes support full review, and
validated decision indexes cover later street/position/spot and texture/hand-
class weakness analysis.
