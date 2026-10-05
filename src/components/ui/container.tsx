export function Container({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`site-container ${className}`}>{children}</div>;
}
