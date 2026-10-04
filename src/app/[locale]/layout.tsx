import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale, locales } from "@/i18n/config";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import "../globals.css";

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return {
    title: locale === "en"
      ? "Private Label Press-on Nails & False Eyelashes | Brand"
      : "自有品牌穿戴甲与假睫毛批发 | Brand",
    description:
      locale === "en"
        ? "Wholesale, private label and custom press-on nail and false eyelash solutions for beauty brands, distributors and professionals."
        : "面向美妆品牌、经销商与专业人士的穿戴甲和假睫毛批发、自有品牌及定制合作方案。",
    alternates: { languages: { en: "/en", zh: "/zh" } },
  };
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <html lang={locale}>
      <body>
        <SiteHeader locale={locale} />
        {children}
        <SiteFooter locale={locale} />
      </body>
    </html>
  );
}
