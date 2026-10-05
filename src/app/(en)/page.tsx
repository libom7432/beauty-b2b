import { HomePage } from "@/components/home/homepage";
import { getDictionary } from "@/i18n/dictionaries";
import { pageMetadata } from "@/lib/site/seo";

const copy = getDictionary("en");
export const metadata = pageMetadata({ locale: "en", path: "/", title: "Professional Nail Products & Private Label Solutions", description: copy.home.hero.body, indexable: true });

export default function Page() { return <HomePage locale="en" />; }
