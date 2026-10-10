import { InquiryList } from "@/components/inquiry-list";
import { Container } from "@/components/ui/container";
import { getDictionary } from "@/i18n/dictionaries";
import { pageMetadata } from "@/lib/site/seo";

const copy = getDictionary("en").inquiry;
export const metadata = pageMetadata({ locale: "en", path: "/inquiry", title: copy.title, description: copy.description, indexable: false });
export default function Page() { return <main><Container><div className="route-intro"><p className="eyebrow">{copy.eyebrow}</p><h1>{copy.title}</h1><p>{copy.description}</p></div><InquiryList locale="en" /></Container></main>; }
