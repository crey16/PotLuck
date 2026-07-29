import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HCWK Wizard",
  description: "Poker training — lessons, range charts, and math drills.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark">
      <body>{children}</body>
    </html>
  );
}
