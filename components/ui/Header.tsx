export interface HeaderProps {
  username?: string;
  xp?: number;
  level?: number;
  streak?: number;
}

/**
 * The app shell header: brand block plus a right-aligned slot for user
 * stats. Stats are optional — later tasks wire in a signed-in user; until
 * then nothing user-specific renders.
 */
export function Header({ username, xp, level, streak }: HeaderProps) {
  const hasUserStats =
    username !== undefined || xp !== undefined || level !== undefined || streak !== undefined;

  return (
    <header>
      <div className="brand">
        <h1>HCWK Wizard</h1>
        <p>Lessons &middot; range charts &middot; math drills</p>
      </div>
      <div className="spacer" />
      {hasUserStats && (
        <div className="potbar">
          {username !== undefined && (
            <div className="pill">
              <div className="k">Player</div>
              <div className="v">{username}</div>
            </div>
          )}
          {level !== undefined && (
            <div className="pill">
              <div className="k">Level</div>
              <div className="v">{level}</div>
            </div>
          )}
          {xp !== undefined && (
            <div className="pill">
              <div className="k">XP</div>
              <div className="v">{xp}</div>
            </div>
          )}
          {streak !== undefined && (
            <div className="pill">
              <div className="k">Streak</div>
              <div className="v">{streak}</div>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
