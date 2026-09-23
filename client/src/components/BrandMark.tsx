/** The VeraKey mark: a ring around a core (styled by `.brand-mark` in index.css). */
export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span className="brand-mark-ring" />
      <span className="brand-mark-core" />
    </span>
  );
}
