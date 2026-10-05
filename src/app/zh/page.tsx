import { HomePage } from "@/components/home/homepage";
import { getDictionary } from "@/i18n/dictionaries";
import { pageMetadata } from "@/lib/site/seo";

const copy = getDictionary("zh");
export const metadata = pageMetadata({ locale: "zh", path: "/", title: "专业美甲产品与自有品牌解决方案", description: copy.home.hero.body, indexable: true });

export default function Page() { return <HomePage locale="zh" />; }
