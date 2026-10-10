import Link from "next/link";
import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getTopCategories } from "@/lib/catalog/taxonomy";
import { localizedPath } from "@/lib/site/paths";
import { emailUrl, siteConfig, whatsappUrl } from "@/lib/site/config";
import { Button } from "./ui/button";
import { Container } from "./ui/container";
import { LanguageSwitcher } from "./language-switcher";
import { ProductsMegaMenu } from "./products-mega-menu";
import { HeaderSearch } from "./header-search";

export function SiteHeader({ locale }: { locale: Locale }) {
  const { brand, nav, topBar, search } = getDictionary(locale);
  const topCategories = getTopCategories();
  const links = [
    ["new-arrivals", nav.newArrivals], ["collections", nav.collections],
    ["private-label", nav.privateLabel], ["solutions", nav.solutions],
    ["about", nav.about], ["insights", nav.insights],
  ] as const;

  return <header className="site-header">
    <div className="top-contact-bar"><Container className="top-contact-inner">
      <div className="top-contact-links">
        <a href={whatsappUrl()} target="_blank" rel="noopener noreferrer"><span className="top-contact-label">{topBar.whatsapp}</span><span className="top-contact-detail">{siteConfig.contact.whatsapp.display}</span></a>
        <a href={emailUrl()}><span className="top-contact-label">{topBar.email}</span><span className="top-contact-detail">{siteConfig.contact.email}</span></a>
      </div>
      <span className="top-contact-note">{topBar.note}</span>
    </Container></div>
    <Container className="header-inner">
      <Link className="brand-mark" href={localizedPath(locale)}>{brand}</Link>
      <nav className="desktop-navigation" aria-label={nav.primary}>
        <ProductsMegaMenu href={localizedPath(locale, "/products")} label={nav.products} toggleLabel={nav.productsMenuToggle}>
          <div className="products-menu-heading"><span className="eyebrow">{nav.products}</span><Link href={localizedPath(locale, "/products")}>{nav.allProducts} ↗</Link></div>
          <div className="products-menu-grid">{topCategories.map((category) => <Link key={category.id} href={localizedPath(locale, `/products/${category.slug}`)}><strong>{category.name[locale]}</strong><small>{category.shortDescription[locale]}</small></Link>)}</div>
        </ProductsMegaMenu>
        {links.map(([path, label]) => <Link key={path} href={localizedPath(locale, `/${path}`)}>{label}</Link>)}
      </nav>
      <div className="header-actions"><HeaderSearch locale={locale} /><LanguageSwitcher locale={locale} label={nav.language} /><Button href={localizedPath(locale, "/rfq")} className="header-quote">{nav.quote}</Button>
        <details className="mobile-navigation"><summary aria-label={nav.menu}><span /><span /></summary><nav className="mobile-navigation-panel" aria-label={nav.menu}>
          <Link href={localizedPath(locale, "/search")}>{search.action}</Link>
          <Link href={localizedPath(locale, "/products")}>{nav.allProducts}</Link>
          {topCategories.map((category) => <Link className="mobile-category-link" key={category.id} href={localizedPath(locale, `/products/${category.slug}`)}>{category.name[locale]}</Link>)}
          {links.map(([path, label]) => <Link key={path} href={localizedPath(locale, `/${path}`)}>{label}</Link>)}
          <Button href={localizedPath(locale, "/rfq")}>{nav.quote}</Button>
        </nav></details>
      </div>
    </Container>
  </header>;
}
