"use client";

// Edit panel shown on your own profile: display name, bio, and the
// is_public switch. Saves through PATCH /api/profile; errors render inline.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SocialApiError, updateProfile } from "@/lib/social/api";

export interface ProfileEditInitial {
  display_name: string | null;
  bio: string | null;
  is_public: boolean;
}

export function ProfileEditPanel({ initial }: { initial: ProfileEditInitial }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState(initial.display_name ?? "");
  const [bio, setBio] = useState(initial.bio ?? "");
  const [isPublic, setIsPublic] = useState(initial.is_public);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateProfile({
        // Blank display name falls back to the username server-side is not a
        // thing — keep the current one instead of sending a blank.
        ...(displayName.trim() ? { display_name: displayName.trim() } : {}),
        bio: bio.trim(),
        is_public: isPublic,
      });
      setSaved(true);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof SocialApiError ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div style={{ marginTop: "var(--space-4)", display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <button className="btn btn-secondary btn-caps" onClick={() => { setOpen(true); setSaved(false); }}>
          Edit profile
        </button>
        {saved && (
          <span className="mono-label" style={{ color: "var(--color-accent-700)" }}>Saved</span>
        )}
      </div>
    );
  }

  const labelStyle = {
    display: "block",
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    letterSpacing: ".1em",
    textTransform: "uppercase",
    color: "color-mix(in srgb, var(--color-text) 60%, transparent)",
    marginBottom: 4,
  } as const;
  return (
    <div
      style={{
        marginTop: "var(--space-4)", paddingTop: "var(--space-4)",
        borderTop: "1px solid var(--color-divider)",
        display: "grid", gap: "var(--space-4)", maxWidth: 480,
      }}
    >
      <div>
        <label htmlFor="profile-display-name" style={labelStyle}>Display name</label>
        <input
          id="profile-display-name"
          className="input"
          value={displayName}
          maxLength={40}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Shown on your profile and leaderboards"
        />
      </div>
      <div>
        <label htmlFor="profile-bio" style={labelStyle}>Bio</label>
        <textarea
          id="profile-bio"
          className="input"
          style={{ resize: "vertical", minHeight: 64 }}
          value={bio}
          maxLength={280}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Up to 280 characters"
        />
      </div>
      <label
        style={{
          display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer",
          fontSize: 13, color: "var(--color-text)",
        }}
      >
        <input
          type="checkbox"
          checked={isPublic}
          onChange={(e) => setIsPublic(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>
          Public profile
          <span
            style={{
              display: "block", fontSize: 12,
              color: "color-mix(in srgb, var(--color-text) 60%, transparent)",
            }}
          >
            Public profiles appear in search and on the global leaderboard.
            Turned off, only friends can find you or see this page.
          </span>
        </span>
      </label>
      {error && (
        <p style={{ color: "var(--warn)", fontSize: 13, margin: 0 }}>{error}</p>
      )}
      <div style={{ display: "flex", gap: "var(--space-3)" }}>
        <button className="btn btn-primary btn-caps" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          className="btn btn-secondary btn-caps"
          disabled={saving}
          onClick={() => {
            setOpen(false);
            setDisplayName(initial.display_name ?? "");
            setBio(initial.bio ?? "");
            setIsPublic(initial.is_public);
            setError(null);
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
