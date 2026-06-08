import { useEffect, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

/**
 * Inline-Panel-Hülle (Native-Redesign): ersetzt das Overlay-Modal für große
 * Surfaces. Rendert full-height im Hauptbereich mit „Zurück"-Header statt
 * als zentriertes Popup mit Backdrop. Body scrollt, optionaler Sticky-Footer.
 *
 * Drop-in-Ersatz für <Modal>: title bleibt, onClose → onBack, footer bleibt.
 */
export function PanelShell({
  title,
  onBack,
  children,
  footer,
  headerActions,
  width = "form",
  dismissible = true,
}: {
  title: string;
  onBack: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Zusätzliche Buttons rechts im Header (z.B. Pause/Settings beim Folder) */
  headerActions?: ReactNode;
  /** "form" = schmal zentriert (Formulare), "wide" = breiter, "full" = randlos */
  width?: "form" | "wide" | "full";
  /** Esc → onBack (default an). false während laufendem Flow. */
  dismissible?: boolean;
}) {
  useEffect(() => {
    if (!dismissible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBack();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onBack, dismissible]);

  const contentWidth =
    width === "full" ? "" : width === "wide" ? "max-w-2xl" : "max-w-lg";

  return (
    <section className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-neutral-900">
      <header className="px-6 py-4 border-b border-neutral-200/70 dark:border-neutral-800/70 flex items-center gap-3 shrink-0">
        <button
          onClick={onBack}
          title="Zurück"
          className="size-8 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center justify-center text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none shrink-0"
        >
          <ArrowLeft className="size-[18px]" />
        </button>
        <h1 className="text-lg font-bold tracking-tight flex-1 truncate">
          {title}
        </h1>
        {headerActions}
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className={`px-7 py-6 ${contentWidth} mx-auto w-full`}>
          {children}
        </div>
      </div>

      {footer && (
        <div className="border-t border-neutral-200/70 dark:border-neutral-800/70 bg-neutral-50/60 dark:bg-neutral-950/40 px-7 py-3.5 shrink-0">
          <div className={`${contentWidth} mx-auto w-full`}>{footer}</div>
        </div>
      )}
    </section>
  );
}
