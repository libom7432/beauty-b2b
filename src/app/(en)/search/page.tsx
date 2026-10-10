import { SearchResultsPage } from "@/features/pages/search-page";
import { getDictionary } from "@/i18n/dictionaries";
import { pageMetadata } from "@/lib/site/seo";

const copy = getDictionary("en").search;
export const metadata = pageMetadata({ locale: "en", path: "/search", title: copy.title, description: copy.description, indexable: false });

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
export default async function Page({ searchParams }: Props) {
  return <SearchResultsPage locale="en" searchParams={await searchParams} />;
}
