import Link from "next/link";
import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { Button } from "./ui/button";
import { LanguageSwitcher } from "./language-switcher";

export function SiteHeader({ locale }: { locale: Locale }) {
  const { brand, nav } = getDictionary(locale);
  const links = [
    { href: "products", label: nav.products },
    { href: "wholesale", label: nav.wholesale },
    { href: "private-label", label: nav.privateLabel },
    { href: "about", label: nav.about },
    { href: "contact", label: nav.contact },
  ];

  return (
    <header className="site-header">
      <div className="site-container header-inner">
        <Link className="brand-mark" href={`/${locale}`} aria-label={`${brand} home`}>{brand}</Link>
        <nav className="desktop-navigation" aria-label={nav.primary}>
          {links.map((link) => <Link key={link.href} href={`/${locale}/${link.href}`}>{link.label}</Link>)}
        </nav>
        <div className="header-actions">
          <LanguageSwitcher locale={locale} label={nav.language} />
          <Button href={`/${locale}/rfq`} variant="dark" className="header-quote">{nav.quote}</Button>
          <details className="mobile-navigation">
            <summary aria-label={nav.menu}><span /><span /></summary>
            <nav aria-label={nav.menu} className="mobile-navigation-panel">
              {links.map((link) => <Link key={link.href} href={`/${locale}/${link.href}`}>{link.label}</Link>)}
              <Button href={`/${locale}/rfq`} variant="dark">{nav.quote}</Button>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
