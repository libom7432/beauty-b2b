import type { Locale } from "@/i18n/config";
import { HeroSection } from "./hero-section";
import { CategoriesSection, NewArrivalsSection, CollectionsSection, InsightsSection } from "./catalog-sections";
import { PrivateLabelSection, SolutionsSection, HowWeWorkSection } from "./business-sections";
import { CtaSection } from "@/components/cta-section";

export function HomePage({ locale }: { locale: Locale }) {
  return <main>
    <HeroSection locale={locale} />
    <CategoriesSection locale={locale} />
    <NewArrivalsSection locale={locale} />
    <CollectionsSection locale={locale} />
    <PrivateLabelSection locale={locale} />
    <SolutionsSection locale={locale} />
    <HowWeWorkSection locale={locale} />
    <InsightsSection locale={locale} />
    <CtaSection locale={locale} />
  </main>;
}
