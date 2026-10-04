import Link from "next/link";

type ButtonProps = {
  href: string;
  children: React.ReactNode;
  variant?: "dark" | "outline" | "light" | "text";
  className?: string;
};

export function Button({ href, children, variant = "dark", className = "" }: ButtonProps) {
  return (
    <Link href={href} className={`button button-${variant} ${className}`}>
      <span>{children}</span>
      <span aria-hidden="true" className="button-arrow">↗</span>
    </Link>
  );
}
