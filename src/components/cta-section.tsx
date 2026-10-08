import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { localizedPath } from "@/lib/site/paths";
import { whatsappUrl } from "@/lib/site/config";
import { Button } from "./ui/button";
import { Container } from "./ui/container";

export function CtaSection({ locale }: { locale: Locale }) {
  const copy = getDictionary(locale).home.cta;
  return <section className="cta-section-v3" aria-labelledby="rfq-cta-title"><Container className="cta-content-v3"><p className="eyebrow">{copy.eyebrow}</p><h2 id="rfq-cta-title">{copy.title}</h2><p>{copy.body}</p><div className="button-row cta-actions"><Button href={localizedPath(locale, "/rfq")} variant="light">{copy.action}</Button><Button href={whatsappUrl()} variant="outline" className="cta-secondary">{copy.whatsapp}</Button></div></Container></section>;
}
