import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import "../globals.css";

export default function EnglishLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><SiteHeader locale="en" />{children}<SiteFooter locale="en" /></body></html>;
}
