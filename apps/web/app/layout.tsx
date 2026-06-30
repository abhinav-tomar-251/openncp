import type { ReactNode } from "react";

export const metadata = {
  title: "OpenNPC Migration Platform",
  description: "Migrate Salesforce NPSP into Nonprofit Cloud (NPC).",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          margin: 0,
          background: "#0b1020",
          color: "#e6e9f2",
        }}
      >
        {children}
      </body>
    </html>
  );
}
