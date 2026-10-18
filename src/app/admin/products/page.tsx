import Link from "next/link";
import { requireAdminPage } from "@/lib/admin/server-access";

export const dynamic = "force-dynamic";
export default async function AdminProductsPage() {
  await requireAdminPage("catalog.read");
  return <main className="mx-auto max-w-4xl space-y-6 p-8">
    <h1 className="text-3xl font-semibold">Products</h1>
    <p>Read-only placeholder. Product management is not enabled.</p>
    <Link href="/admin" className="underline">Back to Admin</Link>
  </main>;
}
