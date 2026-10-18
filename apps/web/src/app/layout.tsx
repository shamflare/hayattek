import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";

import "./globals.css";
import { Providers, themeScript } from "./providers";

const plex = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-plex-arabic",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "حياة — شبكة صحية رقمية موحدة", template: "%s · حياة" },
  description:
    "منصة حياة تربط العيادات والمجمعات الطبية والمختبرات ومراكز الأشعة بملف صحي موحد وآمن لكل مريض.",
  applicationName: "حياة",
  metadataBase: new URL("https://hayattek.com"),
  openGraph: {
    title: "حياة — ملف صحي واحد، يرافقك أينما ذهبت",
    description: "شبكة صحية رقمية تربط الأطباء والمختبرات والمرضى في سوريا.",
    locale: "ar_SY",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f8f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1514" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={plex.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
