export const metadata = { title: "System — PotLuck" };

/** The design-system page: tokens and components, straight from the spec.
 *  Static by design — it documents the look, it doesn't compute anything. */
export default function SystemPage() {
  return (
    <main className="page">
      <div style={{ borderBottom: "1px solid var(--color-divider)", paddingBottom: "var(--space-4)", marginBottom: "var(--space-8)" }}>
        <div className="mono-label accent" style={{ letterSpacing: ".14em", marginBottom: 6 }}>
          Industry tokens · one accent · light and dark
        </div>
        <h1 style={{ fontSize: 44, lineHeight: 1, margin: 0 }}>Tokens &amp; components</h1>
        <p style={{ fontSize: 14, color: "color-mix(in srgb, var(--color-text) 68%, transparent)", maxWidth: "70ch", margin: "var(--space-3) 0 0" }}>
          Light is the default; dark is a token remap of the same ramp (toggle in the header).
          Correct and incorrect never rely on hue alone — each carries a glyph, a wordmark and a
          border weight.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "var(--space-8)" }}>
        <section>
          <h2 style={{ fontSize: 22, letterSpacing: ".03em", textTransform: "uppercase", margin: "0 0 var(--space-4)" }}>Colour</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4, marginBottom: "var(--space-3)" }}>
            {[
              ["var(--color-accent-200)", "200"],
              ["var(--color-accent-300)", "300"],
              ["var(--color-accent)", "accent"],
              ["var(--color-accent-700)", "700"],
              ["var(--color-accent-900)", "900"],
            ].map(([bg, label]) => (
              <div key={label}>
                <div style={{ height: 44, background: bg, border: "1px solid var(--color-divider)" }} />
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, marginTop: 3 }}>{label}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 }}>
            <div>
              <div style={{ height: 44, background: "var(--good-fill)", border: "1px solid var(--good)" }} />
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, marginTop: 3, color: "var(--good)" }}>CORRECT ✓</div>
            </div>
            <div>
              <div style={{ height: 44, background: "var(--crit-fill)", border: "1px solid var(--crit)" }} />
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, marginTop: 3, color: "var(--crit)" }}>WRONG ✗</div>
            </div>
            <div>
              <div style={{ height: 44, background: "var(--warn-fill)", border: "1px solid var(--warn)" }} />
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, marginTop: 3, color: "var(--warn)" }}>CAUTION ⚑</div>
            </div>
          </div>
        </section>

        <section>
          <h2 style={{ fontSize: 22, letterSpacing: ".03em", textTransform: "uppercase", margin: "0 0 var(--space-4)" }}>Type</h2>
          <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 34, lineHeight: 1.05 }}>
            Barlow Condensed 34 — prompts
          </div>
          <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 21, letterSpacing: ".03em", textTransform: "uppercase", marginTop: 6 }}>
            Condensed 21 caps — titles
          </div>
          <div style={{ fontSize: 15, marginTop: 8 }}>
            Barlow 15 — body copy and derivations. This is the teaching voice; it never shrinks
            below 13px.
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", marginTop: 8, color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
            Mono 11 caps — labels, keys, money
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontVariantNumeric: "tabular-nums", marginTop: 6 }}>
            $85 ÷ $280 = 30.4%
          </div>
        </section>

        <section>
          <h2 style={{ fontSize: 22, letterSpacing: ".03em", textTransform: "uppercase", margin: "0 0 var(--space-4)" }}>Controls</h2>
          <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", alignItems: "center", marginBottom: "var(--space-4)" }}>
            <button className="btn btn-primary blueprint btn-caps">Primary</button>
            <button className="btn btn-secondary btn-caps">Secondary</button>
            <button className="btn btn-ghost btn-caps">Ghost</button>
            <span className="tag tag-accent">tag accent</span>
            <span className="tag tag-neutral">tag neutral</span>
            <span className="tag tag-outline">tag outline</span>
          </div>
          <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", alignItems: "center" }}>
            <div className="seg">
              <label className="seg-opt">
                <input type="radio" name="d" defaultChecked />
                Unknown
              </label>
              <label className="seg-opt">
                <input type="radio" name="d" />
                Face-up
              </label>
            </div>
            <span className="keycap" style={{ padding: "3px 7px" }}>N</span>
            <span className="pips wide">
              <span className="on" />
              <span className="on" />
              <span />
            </span>
          </div>
        </section>

        <section>
          <h2 style={{ fontSize: 22, letterSpacing: ".03em", textTransform: "uppercase", margin: "0 0 var(--space-4)" }}>Answer states</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <div className="opt correct" style={{ cursor: "default" }}>
              <span className="key">1</span>30.4%
              <span className="mark">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
                correct
              </span>
            </div>
            <div className="opt wrong" style={{ cursor: "default" }}>
              <span className="key">2</span>43.6%
              <span className="mark">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                your pick
              </span>
            </div>
            <div className="opt faded" style={{ cursor: "default" }}>
              <span className="key">3</span>24.6%
              <span className="mark">unpicked</span>
            </div>
          </div>
        </section>

        <section>
          <h2 style={{ fontSize: 22, letterSpacing: ".03em", textTransform: "uppercase", margin: "0 0 var(--space-4)" }}>Vocabulary</h2>
          <table className="table">
            <thead>
              <tr><th>Word</th><th>Means</th><th>Where</th></tr>
            </thead>
            <tbody>
              <tr><td><b>Day streak</b></td><td>Days played in a row</td><td>Header, home</td></tr>
              <tr><td><b>Run</b></td><td>Correct answers in a row</td><td>Session panel</td></tr>
              <tr><td><b>Session</b></td><td>Since this page loaded</td><td>Accent-headed panel</td></tr>
              <tr><td><b>All time</b></td><td>Every attempt on record</td><td>Home, footer lines</td></tr>
              <tr><td><b>Level</b></td><td>XP rank (100 XP each)</td><td>Header, home</td></tr>
              <tr><td><b>L1–L3</b></td><td>Per-drill difficulty</td><td>Drill cards, rail</td></tr>
            </tbody>
          </table>
        </section>

        <section>
          <h2 style={{ fontSize: 22, letterSpacing: ".03em", textTransform: "uppercase", margin: "0 0 var(--space-4)" }}>Spacing &amp; frame</h2>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, marginBottom: "var(--space-4)" }}>
            {["--space-1", "--space-2", "--space-3", "--space-4", "--space-6", "--space-8"].map((s) => (
              <span key={s} style={{ width: `var(${s})`, height: `var(${s})`, background: "var(--color-accent)" }} />
            ))}
          </div>
          <div className="blueprint" style={{ padding: "var(--space-4)", fontSize: 13, color: "color-mix(in srgb, var(--color-text) 70%, transparent)" }}>
            Square corners, hairline border, registration marks, transparent fill. Every panel in
            the app is this object; only the primary button is solid.
          </div>
        </section>
      </div>
    </main>
  );
}
