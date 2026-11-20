import type { Metadata } from "next";
import "./style.css";
export const metadata: Metadata = {
  title: "Nyaris Popup · Kasir",
  description: "Meja kasir Nyaris Popup",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
