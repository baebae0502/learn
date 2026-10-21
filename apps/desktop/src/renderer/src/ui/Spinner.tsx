/** 16 px ring, --meter arc (design-spec 6 진행 표시). Decorative unless labelled. */
export function Spinner({ label }: { label?: string }) {
  return <span className="spinner" role={label ? 'progressbar' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}
