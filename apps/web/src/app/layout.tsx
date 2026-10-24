import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Journey Simulator",
  description: "Cloud-based website user journey testing for sites you own or are authorized to test.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
