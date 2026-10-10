import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { InquiryProvider } from "@/components/inquiry-provider";
import "../globals.css";

export default function ChineseLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh"><body><InquiryProvider><SiteHeader locale="zh" />{children}<SiteFooter locale="zh" /></InquiryProvider></body></html>;
}
