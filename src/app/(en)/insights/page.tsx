import { InsightsIndexPage } from "@/features/pages/content-pages";
import { getDictionary } from "@/i18n/dictionaries";
import { pageMetadata } from "@/lib/site/seo";

const copy = getDictionary("en").pages.insights;
export const metadata = pageMetadata({ locale: "en", path: "/insights", title: copy.title, description: copy.body, indexable: false });
export default function Page() { return <InsightsIndexPage locale="en" />; }
