import { Modal } from "./Modal";

export function CodeShowModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Einladungscode erstellen" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="text-neutral-700 dark:text-neutral-300">
          Funktioniert in <strong>Schritt 5</strong>: Codes mit Optionen
          (einmalig / Zeitlimit, read-only / read-write) und Copy-Button.
        </p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Bis dahin kannst du Geräte manuell pairen, indem auf Gerät 2 deine
          Device-ID eingetragen wird — die Pending-Geräte-Liste oben zeigt
          das dann an.
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
