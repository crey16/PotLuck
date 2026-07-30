/**
 * Route-level pending UI. Every page here is dynamically rendered (auth
 * cookie), so without this a click sits on the old page until the server
 * answers — which reads as "the whole site is slow". This paints on the
 * next frame while the server component streams in.
 */
export default function Loading() {
  return (
    <main className="page" aria-busy="true">
      <span className="mono-label accent" style={{ letterSpacing: ".14em" }}>
        Loading…
      </span>
    </main>
  );
}
