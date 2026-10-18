import Link from "next/link";
import { requireAdminPage } from "@/lib/admin/server-access";
import { LogoutForm } from "./logout-form";

export const dynamic = "force-dynamic";
export default async function AdminPage() {
  await requireAdminPage();
  return <main className="mx-auto max-w-4xl space-y-6 p-8">
    <h1 className="text-3xl font-semibold">Admin</h1>
    <p>Read-only administration foundation. No business statistics are available.</p>
    <Link href="/admin/products" className="underline">Products</Link>
    <LogoutForm />
  </main>;
}
