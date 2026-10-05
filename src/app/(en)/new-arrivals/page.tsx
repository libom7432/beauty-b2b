import { NewArrivalsPage } from "@/features/pages/catalog-pages";
import { getDictionary } from "@/i18n/dictionaries";
import { pageMetadata } from "@/lib/site/seo";

const copy = getDictionary("en").pages.newArrivals;
export const metadata = pageMetadata({ locale: "en", path: "/new-arrivals", title: copy.title, description: copy.body, indexable: false });
export default function Page() { return <NewArrivalsPage locale="en" />; }
