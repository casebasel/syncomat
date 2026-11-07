import { Activity, FolderSync, LayoutGrid, Settings } from "lucide-react";

export type Ansicht = "uebersicht" | "ordner" | "aktivitaet" | "einstellungen";

/** Schmale Leiste links: drei Bereiche, mehr nicht. 80 px statt 56 px: das
 * längste Wort („Einstellungen“) muss unter dem Symbol ganz lesbar sein. */
export function Leiste({
  ansicht,
  onAnsicht,
  stoerungen,
  update,
  angebote = 0,
}: {
  ansicht: Ansicht;
  onAnsicht: (a: Ansicht) => void;
  stoerungen: number;
  update: boolean;
  /** offene Angebote anderer Rechner */
  angebote?: number;
}) {
  const eintrag = (a: Ansicht, label: string, Icon: typeof LayoutGrid, marke?: string | null, info = false) => (
    <button
      onClick={() => onAnsicht(a)}
      aria-current={ansicht === a ? "page" : undefined}
      title={label}
      className={`relative w-full flex flex-col items-center gap-1 py-2.5 px-1 text-[9.5px] font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sm-blau)] ${
        ansicht === a
          ? "text-[var(--sm-kopf-text)] bg-white/15 font-bold"
          : "text-[var(--sm-kopf-text2)] hover:text-[var(--sm-kopf-text)]"
      }`}
    >
      <Icon className="size-[18px]" strokeWidth={1.75} />
      {label}
      {marke && (
        <span className={`sm-zahl absolute top-1.5 right-2.5 min-w-4 h-4 px-1 rounded-full text-[9px] leading-4 font-bold ${info ? "bg-[var(--sm-blau)] text-white" : "bg-[var(--sm-ocker)] text-black"}`}>
          {marke}
        </span>
      )}
    </button>
  );
  return (
    <nav aria-label="Bereiche" className="w-[80px] shrink-0 flex flex-col bg-[var(--sm-kopf)] border-r border-black">
      <div className="h-12 flex items-center justify-center">
        <div title="syncomat" className="size-7 rounded-md bg-[var(--sm-blau)] flex items-center justify-center text-white">
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
            <path d="M16 16h5v5" />
          </svg>
        </div>
      </div>
      {eintrag("uebersicht", "Übersicht", LayoutGrid, stoerungen > 0 ? String(stoerungen) : null)}
      {eintrag("ordner", "Ordner", FolderSync, angebote > 0 ? String(angebote) : null, true)}
      {eintrag("aktivitaet", "Aktivität", Activity)}
      <div className="mt-auto" />
      {eintrag("einstellungen", "Einstellungen", Settings, update ? "1" : null)}
    </nav>
  );
}
