import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://orbit-choir.jagaimo0511.chatgpt.site"),
  title: "Orbit Choir",
  description: "Orbiting objects compose an endless, gentle piece by striking resonant gates.",
  openGraph: {
    title: "Orbit Choir",
    description: "Motion becomes music at the point of contact.",
    type: "website",
    images: [{ url: "/og.png", width: 1568, height: 1003, alt: "Orbit Choir — A clockwork garden of sound" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Orbit Choir",
    description: "Motion becomes music at the point of contact.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
