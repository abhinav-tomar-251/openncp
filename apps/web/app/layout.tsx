import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "OpenNPC Migration Platform",
  description: "Migrate Salesforce NPSP into Nonprofit Cloud (NPC).",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
