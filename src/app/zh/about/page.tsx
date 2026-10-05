import { StaticLandingPage } from "@/features/pages/content-pages";
import { getDictionary } from "@/i18n/dictionaries";
import { pageMetadata } from "@/lib/site/seo";

const copy = getDictionary("zh").pages.about;
export const metadata = pageMetadata({ locale: "zh", path: "/about", title: copy.title, description: copy.body });
export default function Page() { return <StaticLandingPage locale="zh" page="about" />; }
