import { Modal } from "./Modal";

export function CodeRedeemModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Einladungscode einlösen" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="text-neutral-700 dark:text-neutral-300">
          Funktioniert in <strong>Schritt 5</strong>: Code-Feld → automatisches
          Pairing + Übernahme aller angebotenen Ordner.
        </p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Bis dahin kannst du das Pairing manuell anstoßen — siehe Syncthing-Doku
          oder warte auf Schritt 5.
        </p>
        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
          >
            OK
          </button>
        </div>
      </div>
    </Modal>
  );
}
