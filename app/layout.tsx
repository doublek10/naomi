import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dana's Residency",
  description: "Rental management — rooms, tenants, rent, water billing, and invoicing.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
