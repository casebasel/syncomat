import { useState, type KeyboardEvent } from "react";
import { Plus } from "lucide-react";
import { TagChip } from "./TagChip";
import { normalizeTag } from "../lib/tags";

export function TagEditor({
  tags,
  onChange,
  suggestions = [],
}: {
  tags: string[];
  onChange: (next: string[]) => void;
  /** Tags die bereits anderswo verwendet werden (für Autocomplete) */
  suggestions?: string[];
}) {
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const t = normalizeTag(raw);
    if (!t) return;
    if (tags.includes(t)) {
      setDraft("");
      return;
    }
    onChange([...tags, t]);
    setDraft("");
  };
  const remove = (t: string) => onChange(tags.filter((x) => x !== t));

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && draft.length === 0 && tags.length > 0) {
      remove(tags[tags.length - 1]!);
    }
  };

  const filteredSuggestions = suggestions.filter(
    (s) => !tags.includes(s) && (draft === "" || s.toLowerCase().includes(draft.toLowerCase())),
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 p-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 focus-within:border-blue-500">
        {tags.map((t) => (
          <TagChip key={t} tag={t} onRemove={() => remove(t)} />
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => add(draft)}
          placeholder={tags.length === 0 ? "Tag eingeben (Enter zum Übernehmen)…" : "+ Tag"}
          className="flex-1 min-w-[80px] outline-none bg-transparent text-xs text-neutral-900 dark:text-neutral-100"
        />
      </div>
      {filteredSuggestions.length > 0 && (
        <div className="mt-1.5">
          <div className="text-[10px] text-neutral-500 dark:text-neutral-500 mb-1">
            Bereits verwendet:
          </div>
          <div className="flex flex-wrap gap-1.5">
            {filteredSuggestions.slice(0, 12).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => add(t)}
                className="inline-flex items-center gap-1 text-[10px] text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                <Plus className="size-2.5" />
                <TagChip tag={t} size="sm" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
