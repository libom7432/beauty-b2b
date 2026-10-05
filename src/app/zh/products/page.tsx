import { ProductsIndexPage } from "@/features/pages/catalog-pages";
import { getDictionary } from "@/i18n/dictionaries";
import { pageMetadata } from "@/lib/site/seo";

const copy = getDictionary("zh").pages.products;
export const metadata = pageMetadata({ locale: "zh", path: "/products", title: copy.title, description: copy.body, indexable: true });
export default function Page() { return <ProductsIndexPage locale="zh" />; }
