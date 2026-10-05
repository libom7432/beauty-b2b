import Image from "next/image";
import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { localizedPath } from "@/lib/site/paths";
import { homeVisuals } from "@/lib/site/visual-assets";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";

export function HeroSection({ locale }: { locale: Locale }) {
  const copy = getDictionary(locale).home.hero;
  return <section className="hero-v3" aria-labelledby="hero-title"><Container className="hero-v3-grid">
    <div className="hero-v3-copy"><p className="eyebrow">{copy.eyebrow}</p><h1 id="hero-title"><span>{copy.first}</span><em>{copy.second}</em></h1><p className="hero-v3-description">{copy.body}</p><div className="button-row"><Button href={localizedPath(locale, "/products")}>{copy.primary}</Button><Button href={localizedPath(locale, "/private-label")} variant="outline">{copy.secondary}</Button></div></div>
    <div className="hero-v3-media"><Image src={homeVisuals.hero.src} alt={homeVisuals.hero.alt[locale]} fill preload sizes="(max-width: 900px) 100vw, 46vw" className="hero-v3-image" style={{ objectPosition: homeVisuals.hero.position }} /></div>
  </Container></section>;
}
