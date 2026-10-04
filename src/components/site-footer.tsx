import Link from "next/link";
import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { LanguageSwitcher } from "./language-switcher";

export function SiteFooter({ locale }: { locale: Locale }) {
  const { brand, footer } = getDictionary(locale);
  return (
    <footer className="site-footer">
      <div className="site-container">
        <div className="footer-grid">
          <div className="footer-brand">
            <Link href={`/${locale}`} className="brand-mark">{brand}</Link>
            <p>{footer.tagline}</p>
          </div>
          <div className="footer-column">
            <h2>{footer.products}</h2>
            <Link href={`/${locale}/products/press-on-nails`}>{footer.nails}</Link>
            <Link href={`/${locale}/products/false-eyelashes`}>{footer.lashes}</Link>
          </div>
          <div className="footer-column">
            <h2>{footer.business}</h2>
            <Link href={`/${locale}/wholesale`}>{footer.wholesale}</Link>
            <Link href={`/${locale}/private-label`}>{footer.privateLabel}</Link>
            <Link href={`/${locale}/oem-odm`}>{footer.oem}</Link>
          </div>
          <div className="footer-column">
            <h2>{footer.company}</h2>
            <Link href={`/${locale}/about`}>{footer.about}</Link>
            <Link href={`/${locale}/contact`}>{footer.contact}</Link>
          </div>
          <div className="footer-column">
            <h2>{footer.language}</h2>
            <LanguageSwitcher locale={locale} label={footer.language} />
          </div>
        </div>
        <div className="footer-bottom">
          <p>© {new Date().getFullYear()} {brand} {footer.rights}</p>
          <p>Email · Instagram · LinkedIn <span className="footer-pending">— {footer.pending}</span></p>
        </div>
      </div>
    </footer>
  );
}
