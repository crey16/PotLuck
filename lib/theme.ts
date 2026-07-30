/** Theme cookie shared by the server layout (initial render) and the client
 *  toggle (writes). Neutral module — no "use client" — so both sides import it. */
export const THEME_COOKIE = "hcwk-theme";

export type Theme = "light" | "dark";

export const parseTheme = (value: string | undefined): Theme =>
  value === "dark" ? "dark" : "light";
