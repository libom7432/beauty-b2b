import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { localizedPath } from "@/lib/site/paths";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

export function PrivateLabelSection({ locale }: { locale: Locale }) {
  const copy = getDictionary(locale).home.privateLabel;
  return <section className="section-space" aria-labelledby="private-label-title"><Container className="editorial-split"><div className="private-label-art" aria-hidden="true"><div className="private-label-ring" /><span>B.</span><small>PRIVATE LABEL / NAIL STUDIO</small></div><div className="editorial-copy"><SectionHeading id="private-label-title" eyebrow={copy.eyebrow} title={copy.title} description={copy.body} /><ul className="editorial-list">{copy.items.map((item) => <li key={item}>{item}</li>)}</ul><Button href={localizedPath(locale, "/private-label")}>{copy.action}</Button></div></Container></section>;
}

export function SolutionsSection({ locale }: { locale: Locale }) {
  const copy = getDictionary(locale).home.solutions;
  return <section className="section-space solutions-section" aria-labelledby="solutions-title"><Container><div className="section-intro-v3"><SectionHeading id="solutions-title" eyebrow={copy.eyebrow} title={copy.title} description={copy.body} /></div><div className="solutions-grid">{copy.audiences.map((audience, index) => <article key={audience.title}><span>0{index + 1}</span><h3>{audience.title}</h3><p>{audience.body}</p></article>)}</div><Button href={localizedPath(locale, "/solutions")} variant="text">{getDictionary(locale).common.learnMore}</Button></Container></section>;
}

export function WhySection({ locale }: { locale: Locale }) {
  const copy = getDictionary(locale).home.why;
  return <section className="section-space why-section" aria-labelledby="why-title"><Container className="why-grid"><SectionHeading id="why-title" eyebrow={copy.eyebrow} title={copy.title} description={copy.body} /><div className="why-list">{copy.items.map((item, index) => <article key={item.title}><span>0{index + 1}</span><div><h3>{item.title}</h3><p>{item.body}</p></div></article>)}</div></Container></section>;
}

export function QualitySection({ locale }: { locale: Locale }) {
  const copy = getDictionary(locale).home.quality;
  return <section className="section-space" aria-labelledby="quality-title"><Container className="quality-grid"><div><SectionHeading id="quality-title" eyebrow={copy.eyebrow} title={copy.title} description={copy.body} /><div className="quality-steps">{copy.items.map((item, index) => <span key={item}><b>0{index + 1}</b>{item}</span>)}</div></div><div className="quality-art" aria-hidden="true"><div className="quality-art-frame"><span>QUALITY<br />IS IN THE<br />DETAILS.</span></div></div></Container></section>;
}
