import Link from "next/link";
import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getTopCategories } from "@/lib/catalog/taxonomy";
import { localizedPath } from "@/lib/site/paths";
import { emailUrl, siteConfig, whatsappUrl } from "@/lib/site/config";
import { Container } from "./ui/container";
import { LanguageSwitcher } from "./language-switcher";

export function SiteFooter({ locale }: { locale: Locale }) {
  const { brand, nav, topBar, footer } = getDictionary(locale);
  return <footer className="site-footer"><Container>
    <div className="footer-grid">
      <div className="footer-brand"><Link className="brand-mark" href={localizedPath(locale)}>{brand}</Link><p>{footer.tagline}</p></div>
      <div className="footer-column"><h2>{footer.explore}</h2>{getTopCategories().map((category) => <Link key={category.id} href={localizedPath(locale, `/products/${category.slug}`)}>{category.name[locale]}</Link>)}</div>
      <div className="footer-column"><h2>{footer.business}</h2><Link href={localizedPath(locale, "/private-label")}>{nav.privateLabel}</Link><Link href={localizedPath(locale, "/solutions")}>{nav.solutions}</Link><Link href={localizedPath(locale, "/rfq")}>{nav.quote}</Link></div>
      <div className="footer-column"><h2>{footer.company}</h2><Link href={localizedPath(locale, "/about")}>{nav.about}</Link><Link href={localizedPath(locale, "/insights")}>{nav.insights}</Link><Link href={localizedPath(locale, "/contact")}>{nav.contact}</Link></div>
      <div className="footer-column"><h2>{footer.language}</h2><LanguageSwitcher locale={locale} label={footer.language} /></div>
    </div>
    <div className="footer-bottom"><p>© {new Date().getFullYear()} {brand} {footer.rights}</p><p><a href={whatsappUrl()}>{topBar.whatsapp}: {siteConfig.contact.whatsapp.display}</a> · <a href={emailUrl()}>{topBar.email}: {siteConfig.contact.email}</a> · Instagram · LinkedIn <span className="footer-pending">— {footer.pending}</span></p></div>
  </Container></footer>;
}
