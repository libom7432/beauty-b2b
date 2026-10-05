import { StaticLandingPage } from "@/features/pages/content-pages";
import { getDictionary } from "@/i18n/dictionaries";
import { pageMetadata } from "@/lib/site/seo";

const copy = getDictionary("en").pages.solutions;
export const metadata = pageMetadata({ locale: "en", path: "/solutions", title: copy.title, description: copy.body });
export default function Page() { return <StaticLandingPage locale="en" page="solutions" />; }
