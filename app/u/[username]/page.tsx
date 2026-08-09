import { notFound } from "next/navigation";
import {
  ActivityHeatmap,
  SkillRow,
  buildHeatmapWeeks,
} from "@/components/social/ProfileWidgets";
import { ProfileEditPanel } from "@/components/social/ProfileEditPanel";
import { SKILL_TAG_LABELS, type SkillStat } from "@/lib/drill/serverStats";
import {
  fetchDailyActivity,
  fetchProfileByUsername,
  fetchSkillStats,
} from "@/lib/social/queries";
import { getAuthUserId } from "@/lib/supabase/server";
import { getRequestClient } from "@/lib/supabase/requestContext";
import { supabaseConfigured } from "@/lib/supabase/env";

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  if (!supabaseConfigured()) notFound();

  const supabase = await getRequestClient();
  const myId = await getAuthUserId();
  // Middleware already gates unauthenticated visits; this is belt-and-braces.
  if (!myId) notFound();

  const profile = await fetchProfileByUsername(supabase, username);
  // RLS hides private non-friend profiles entirely — a hidden profile and a
  // missing one are the same 404, so existence is never confirmed.
  if (!profile) notFound();

  const isSelf = profile.id === myId;
  const { data: friendRow } = isSelf
    ? { data: null }
    : await supabase
        .from("friends")
        .select("friend_user_id")
        .eq("user_id", myId)
        .eq("friend_user_id", profile.id)
        .maybeSingle();
  const canSeeStats = isSelf || friendRow !== null;

  let skills: SkillStat[] = [];
  let weeks: ReturnType<typeof buildHeatmapWeeks> = [];
  if (canSeeStats) {
    const [stats, activity] = await Promise.all([
      fetchSkillStats(supabase, profile.id),
      fetchDailyActivity(supabase, profile.id, isoDaysAgo(83), isoDaysAgo(0)),
    ]);
    skills = Object.keys(SKILL_TAG_LABELS)
      .map((tag) => {
        const row = stats.find((s) => s.skill_tag === tag);
        const attempts = row?.total_attempts ?? 0;
        const correct = row?.correct_attempts ?? 0;
        return {
          tag,
          label: SKILL_TAG_LABELS[tag],
          attempts,
          correct,
          accuracy: attempts > 0 ? Math.round((correct / attempts) * 100) : 0,
        };
      })
      .sort((a, b) => b.accuracy - a.accuracy);
    weeks = buildHeatmapWeeks(
      activity.map((a) => ({ date: a.date, xp: a.xp_earned }))
    );
  }

  const shownName = profile.display_name ?? profile.username;

  return (
    <main className="page" style={{ paddingTop: "var(--space-8)" }}>
      {/* — identity plate — */}
      <div className="blueprint" style={{ padding: "var(--space-6)", marginBottom: "var(--space-6)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-4)", flexWrap: "wrap" }}>
          <span
            aria-hidden="true"
            style={{
              width: 64, height: 64, display: "grid", placeItems: "center",
              borderRadius: 999, background: "var(--color-accent)", color: "#fff",
              fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 32,
              textTransform: "uppercase",
            }}
          >
            {profile.username.slice(0, 1)}
          </span>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="mono-label accent" style={{ marginBottom: 4 }}>
              @{profile.username}
              {!profile.is_public && " · private"}
            </div>
            <h1 style={{ fontSize: 40, lineHeight: 1, margin: "0 0 var(--space-2)" }}>{shownName}</h1>
            {profile.bio && (
              <p className="text-dim" style={{ maxWidth: "52ch", margin: "0 0 var(--space-3)" }}>
                {profile.bio}
              </p>
            )}
            <div
              style={{
                display: "flex", gap: "var(--space-4)", flexWrap: "wrap",
                fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: ".08em",
                textTransform: "uppercase",
                color: "color-mix(in srgb, var(--color-text) 65%, transparent)",
              }}
            >
              <span>Level {profile.level}</span>
              <span>{profile.xp.toLocaleString()} XP</span>
              <span>{profile.streak_count}-day streak</span>
            </div>
          </div>
        </div>
        {isSelf && (
          <ProfileEditPanel
            initial={{
              display_name: profile.display_name,
              bio: profile.bio,
              is_public: profile.is_public,
            }}
          />
        )}
      </div>

      {canSeeStats ? (
        <>
          <section style={{ marginBottom: "var(--space-8)" }}>
            <div className="section-head">
              <h2>Skill strengths</h2>
              <span className="lede">Accuracy per skill tag, all time.</span>
            </div>
            {skills.every((s) => s.attempts === 0) ? (
              <p className="text-dim">No answered hands yet.</p>
            ) : (
              <div className="home-skills">
                {skills.map((s) => (
                  <SkillRow key={s.tag} skill={s} weak={false} />
                ))}
              </div>
            )}
          </section>
          <section>
            <div className="section-head">
              <h2>Activity</h2>
              <span className="lede">XP earned per day, last 12 weeks.</span>
            </div>
            <ActivityHeatmap weeks={weeks} />
          </section>
        </>
      ) : (
        <div className="blueprint" style={{ padding: "var(--space-4)" }}>
          <div className="mono-label" style={{ marginBottom: 6 }}>Stats</div>
          <p className="text-dim" style={{ margin: 0 }}>
            Skill strengths and activity are visible to friends.
          </p>
        </div>
      )}
    </main>
  );
}
