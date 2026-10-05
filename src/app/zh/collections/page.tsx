import { CollectionsIndexPage } from "@/features/pages/catalog-pages";
import { getDictionary } from "@/i18n/dictionaries";
import { pageMetadata } from "@/lib/site/seo";

const copy = getDictionary("zh").pages.collections;
export const metadata = pageMetadata({ locale: "zh", path: "/collections", title: copy.title, description: copy.body, indexable: false });
export default function Page() { return <CollectionsIndexPage locale="zh" />; }
