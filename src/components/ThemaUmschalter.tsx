import { useThema } from "../lib/thema";

/** System · Hell · Dunkel — wie in der Datenzentrale (Filmstudio Stage). */
export function ThemaUmschalter() {
  const [thema, setThema] = useThema();
  return (
    <div role="radiogroup" aria-label="Darstellung" className="inline-flex h-8 rounded-md border border-[var(--sm-linie)] overflow-hidden text-[13px]">
      {(
        [
          ["system", "System"],
          ["hell", "Hell"],
          ["dunkel", "Dunkel"],
        ] as const
      ).map(([w, t]) => (
        <button
          key={w}
          role="radio"
          aria-checked={thema === w}
          onClick={() => setThema(w)}
          className={`px-3 border-r last:border-r-0 border-[var(--sm-linie)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sm-blau)] ${
            thema === w ? "bg-[var(--sm-text)] text-[var(--sm-grund)] font-semibold" : "hover:bg-[var(--sm-flaeche)]"
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
