import { notFound } from "next/navigation";
import AdminProductDetail from "../../[productCode]/page";
import { decodeProductCodeSegment } from "@/lib/admin/product-code-route";
import { requireAdminPage } from "@/lib/admin/server-access";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ encodedCode: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function EncodedAdminProductDetail({ params, searchParams }: Props) {
  await requireAdminPage("catalog.read");
  const code = decodeProductCodeSegment((await params).encodedCode);
  if (code === null) notFound();
  return AdminProductDetail({ params: Promise.resolve({ productCode: code }), searchParams });
}
