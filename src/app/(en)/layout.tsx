import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { InquiryProvider } from "@/components/inquiry-provider";
import "../globals.css";

export default function EnglishLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><InquiryProvider><SiteHeader locale="en" />{children}<SiteFooter locale="en" /></InquiryProvider></body></html>;
}
