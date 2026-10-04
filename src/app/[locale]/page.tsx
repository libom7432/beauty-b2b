import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { ProductVisual } from "@/components/product-visual";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/section-heading";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const copy = getDictionary(locale);

  return (
    <main>
      <section className="hero-section" aria-labelledby="hero-title">
        <div className="site-container hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">{copy.hero.eyebrow}</p>
            <h1 id="hero-title" className="hero-title">
              <span>{copy.hero.first}</span>
              <em>{copy.hero.second}</em>
            </h1>
            <p className="hero-description">{copy.hero.body}</p>
            <div className="button-row">
              <Button href={`/${locale}/products`}>{copy.hero.explore}</Button>
              <Button href={`/${locale}/rfq`} variant="outline">{copy.hero.quote}</Button>
            </div>
          </div>
          <div className="hero-visual" aria-hidden="true">
            <div className="hero-visual-backdrop" />
            <ProductVisual kind="nails" className="hero-nails" />
            <ProductVisual kind="lashes" className="hero-lashes" />
            <span className="hero-visual-caption">{copy.hero.visualCaption}</span>
          </div>
        </div>
      </section>

      <section className="section-space" aria-labelledby="categories-title">
        <div className="site-container">
          <div className="section-intro">
            <SectionHeading id="categories-title" eyebrow={copy.categories.eyebrow} title={copy.categories.title} />
            <p className="section-description">{copy.categories.body}</p>
          </div>
          <div className="category-grid">
            {copy.categories.items.map((item, index) => (
              <article className="category-card" key={item.path}>
                <div className="category-image">
                  <ProductVisual kind={index === 0 ? "nails" : "lashes"} />
                  <span className="category-image-label">{item.label}</span>
                </div>
                <div className="category-content">
                  <div>
                    <h3>{item.name}</h3>
                    <p>{item.body}</p>
                  </div>
                  <Button href={`/${locale}/${item.path}`} variant="text">{copy.categories.explore}</Button>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section-space value-section" aria-labelledby="value-title">
        <div className="site-container value-grid">
          <div className="value-intro">
            <SectionHeading id="value-title" eyebrow={copy.value.eyebrow} title={copy.value.title} description={copy.value.body} />
          </div>
          <div className="value-list">
            {copy.value.items.map((item, index) => (
              <article className="value-item" key={item.title}>
                <span className="value-number">0{index + 1}</span>
                <div><h3>{item.title}</h3><p>{item.body}</p></div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section-space" aria-labelledby="private-label-title">
        <div className="site-container private-label-grid">
          <div className="private-label-visual" aria-hidden="true">
            <div className="private-label-shape private-label-shape-one" />
            <div className="private-label-shape private-label-shape-two" />
            <div className="private-label-monogram">B<span>.</span></div>
            <span>{copy.privateLabel.visualLabel}</span>
          </div>
          <div className="private-label-copy">
            <SectionHeading id="private-label-title" eyebrow={copy.privateLabel.eyebrow} title={copy.privateLabel.title} description={copy.privateLabel.body} />
            <ul className="private-label-list">
              {copy.privateLabel.items.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <Button href={`/${locale}/private-label`}>{copy.privateLabel.action}</Button>
          </div>
        </div>
      </section>

      <section className="section-space process-section" aria-labelledby="process-title">
        <div className="site-container">
          <SectionHeading id="process-title" eyebrow={copy.process.eyebrow} title={copy.process.title} />
          <div className="process-grid">
            {copy.process.steps.map((step, index) => (
              <article className="process-step" key={step.title}>
                <span>0{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="final-cta" aria-labelledby="cta-title">
        <div className="site-container final-cta-inner">
          <p className="eyebrow">{copy.cta.eyebrow}</p>
          <h2 id="cta-title">{copy.cta.title}</h2>
          <p>{copy.cta.body}</p>
          <div className="button-row">
            <Button href={`/${locale}/rfq`} variant="light">{copy.cta.quote}</Button>
            <Button href={`/${locale}/contact`} variant="outline">{copy.cta.contact}</Button>
          </div>
        </div>
      </section>
    </main>
  );
}
