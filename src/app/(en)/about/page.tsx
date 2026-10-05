import { StaticLandingPage } from "@/features/pages/content-pages";
import { getDictionary } from "@/i18n/dictionaries";
import { pageMetadata } from "@/lib/site/seo";

const copy = getDictionary("en").pages.about;
export const metadata = pageMetadata({ locale: "en", path: "/about", title: copy.title, description: copy.body });
export default function Page() { return <StaticLandingPage locale="en" page="about" />; }
