import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Accordly | Clear agreements. Shared confidence.", template: "%s | Accordly" },
  description: "Secure agreement preparation and review by BE WISE INNOVATION. Local demonstration.",
  robots: { index: false, follow: false },
};

const inter = localFont({ src: "./fonts/Inter.ttf", variable: "--font-ui", weight: "100 900", display: "swap" });
const jakarta = localFont({ src: "./fonts/PlusJakartaSans.ttf", variable: "--font-heading", weight: "200 800", display: "swap" });
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${inter.variable} ${jakarta.variable}`}><body><a href="#main" className="skip-link">Skip to content</a>{children}</body></html>;
}
