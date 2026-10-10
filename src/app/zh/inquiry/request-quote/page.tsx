import { RFQForm } from "@/components/rfq-form";
import { Container } from "@/components/ui/container";
import { getDictionary } from "@/i18n/dictionaries";
import { pageMetadata } from "@/lib/site/seo";
import { getRFQCountryOptions } from "@/lib/rfq/country-options";

const copy = getDictionary("zh").rfqForm;
export const metadata = pageMetadata({ locale: "zh", path: "/inquiry/request-quote", title: copy.title, description: copy.description, indexable: false });

export default function Page() {
  return <main><Container><div className="route-intro"><p className="eyebrow">{copy.eyebrow}</p><h1>{copy.title}</h1><p>{copy.description}</p></div><RFQForm locale="zh" countryOptions={getRFQCountryOptions("zh")} /></Container></main>;
}
