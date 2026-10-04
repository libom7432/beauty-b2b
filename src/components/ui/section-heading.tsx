type SectionHeadingProps = {
  id?: string;
  eyebrow: string;
  title: string;
  description?: string;
  className?: string;
};

export function SectionHeading({ id, eyebrow, title, description, className = "" }: SectionHeadingProps) {
  return (
    <div className={className}>
      <p className="eyebrow mb-5">{eyebrow}</p>
      <h2 id={id} className="section-title">{title}</h2>
      {description && <p className="section-description mt-5">{description}</p>}
    </div>
  );
}
