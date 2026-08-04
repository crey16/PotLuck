import type { DrillKind, DrillLevel, ResponseType } from "../drill/contract";
import type { TagScore } from "./blueprint";

export type PlacementStatus = "in_progress" | "completed" | "skipped";

/** A `placement_assessments` row as api/placement.py returns it. */
export interface PlacementAssessment {
  id: number;
  assessment_version: number;
  generator_version: number;
  seed: number;
  status: PlacementStatus;
  question_count: number;
  scores: Record<string, TagScore>;
  levels: Partial<Record<DrillKind, DrillLevel>>;
  entry_module_index: number | null;
  started_at: string;
  completed_at: string | null;
}

export interface PlacementCompleteResult extends PlacementAssessment {
  answered: number;
  accuracy: number;
  lessons_placed_out: number;
  /** Always 0 — placement is not practice and earns nothing (M8.5B). */
  xp_earned: number;
}

export interface PlacementState {
  assessment: PlacementAssessment | null;
  /** True only for a brand-new account with no assessment and no history. */
  needs_placement: boolean;
  assessment_version: number;
  generator_version: number;
  question_count: number;
}

export interface PlacementResponseResult {
  id: number;
  question_index: number;
  drill_kind: DrillKind;
  skill_tag: string;
  is_correct: boolean;
  response_type: ResponseType;
}
