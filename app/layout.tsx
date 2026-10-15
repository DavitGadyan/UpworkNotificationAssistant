import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Space_Grotesk as DisplayFont, Inter as BodyFont } from "next/font/google";
import { tokens } from "@/lib/tokens";
import { RegisterSW } from "@/components/pwa/RegisterSW";
import { themeBootScript } from "@/components/theme/boot";
import "./globals.css";

const displayFont = DisplayFont({ subsets: ["latin"], variable: "--font-display-loaded", display: "swap" });
const bodyFont = BodyFont({ subsets: ["latin"], variable: "--font-body-loaded", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Up Assistant", template: "%s · Up Assistant" },
  applicationName: "Up Assistant",
  description: "Personal job alert and proposal assistant: ranks new jobs, watches competition, drafts proposals for review and coaches client replies.",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }, { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }], apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Up Assistant", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  other: { "mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: tokens.color.ground },
    { media: "(prefers-color-scheme: dark)", color: tokens.dark.ground },
  ],
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/*
 * The "upwork" look is opt-in and local only: it is ignored whenever the public base URL is https,
 * so the deployed site (the one Upwork's reviewers can see) always uses the neutral theme.
 */
function brand() {
  const wanted = process.env.NEXT_PUBLIC_THEME === "upwork";
  const isPublic = (process.env.PUBLIC_BASE_URL ?? "").startsWith("https://");
  return wanted && !isPublic ? "upwork" : "neutral";
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Light/dark/system preference: the cookie lets the server render the right scheme; the boot script
  // re-checks localStorage before paint (so a stale cookie never flashes the wrong theme).
  const saved = (await cookies()).get("theme")?.value;
  const scheme = saved === "light" || saved === "dark" ? saved : "system";
  return (
    <html lang="en" data-brand={brand()} data-theme={scheme} suppressHydrationWarning className={`${displayFont.variable} ${bodyFont.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>{children}<RegisterSW /></body>
    </html>
  );
}
