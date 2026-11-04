import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Ventriva Audit — launch readiness review for solo founders", template: "%s · Ventriva Audit" },
  description: "Connect your repository and find out, with evidence, whether your app is ready to take paying customers.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=Public+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap"
        />
      </head>
      <body className="min-h-screen">
        <SiteHeader />
        <main>{children}</main>
        <footer className="mt-24 border-t border-rule">
          <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-4 px-5 py-8 text-sm text-ink-soft">
            <p>A static engineering review. Not a substitute for a professional penetration test.</p>
            <nav className="flex gap-5">
              <Link href="/security" className="hover:text-ink">Security</Link>
              <Link href="/terms" className="hover:text-ink">Terms</Link>
              <Link href="/privacy" className="hover:text-ink">Privacy</Link>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
