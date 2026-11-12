import type { ReactNode } from "react";
import { GuardedAdminLink } from "./admin-unsaved-changes";

export function AdminBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warning" | "positive" }) {
  return <span className={`admin-badge admin-badge-${tone}`}>{children}</span>;
}

export function AdminCard({ title, description, href, children, className = "" }: {
  title: string; description?: string; href?: string; children?: ReactNode; className?: string;
}) {
  return <section className={`admin-card ${className}`}>
    <div className="admin-card-heading"><h2>{title}</h2>{href && <GuardedAdminLink href={href} className="admin-card-link">Open <span aria-hidden="true">↗</span></GuardedAdminLink>}</div>
    {description && <p>{description}</p>}{children}
  </section>;
}

export function AdminPageHeader({ eyebrow, title, description, children }: {
  eyebrow: string; title: string; description: string; children?: ReactNode;
}) {
  return <div className="admin-page-header"><div><p className="admin-eyebrow">{eyebrow}</p><h1>{title}</h1><p className="admin-page-description">{description}</p></div>{children && <div className="admin-page-header-actions">{children}</div>}</div>;
}

export function AdminTable({ caption, headings, children }: { caption: string; headings: readonly string[]; children: ReactNode }) {
  return <div className="admin-table-scroll"><table className="admin-table"><caption className="sr-only">{caption}</caption><thead><tr>{headings.map((heading) => <th scope="col" key={heading}>{heading}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}

function StateFrame({ icon, title, description, role }: { icon: string; title: string; description: string; role?: "status" | "alert" }) {
  return <div className="admin-state" role={role}><span className="admin-state-icon" aria-hidden="true">{icon}</span><strong>{title}</strong><p>{description}</p></div>;
}

export function AdminEmptyState({ title = "No records available", description = "Product data is not connected to this Admin interface." }: { title?: string; description?: string }) {
  return <StateFrame icon="—" title={title} description={description} role="status" />;
}
export function AdminLoadingState() {
  return <StateFrame icon="…" title="Loading products" description="Waiting for the product source." role="status" />;
}
export function AdminErrorState() {
  return <StateFrame icon="!" title="Products unavailable" description="The product source could not be read. No changes were made." role="alert" />;
}
