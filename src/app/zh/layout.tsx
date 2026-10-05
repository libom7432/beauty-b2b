import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import "../globals.css";

export default function ChineseLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh"><body><SiteHeader locale="zh" />{children}<SiteFooter locale="zh" /></body></html>;
}
