import { X } from "lucide-react";
import { tagColor } from "../lib/tags";

export function TagChip({
  tag,
  onClick,
  onRemove,
  active,
  size = "md",
}: {
  tag: string;
  onClick?: () => void;
  onRemove?: () => void;
  active?: boolean;
  size?: "sm" | "md";
}) {
  const color = tagColor(tag);
  const interactive = !!onClick;
  const padding = size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]";
  return (
    <span
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md ${padding} ${color.bg} ${color.text} ${interactive ? "cursor-pointer hover:ring-1 " + color.ring : ""} ${active ? "ring-1 " + color.ring : ""} select-none font-medium`}
    >
      <span className="truncate max-w-[120px]">{tag}</span>
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="hover:bg-black/10 dark:hover:bg-white/10 rounded-sm -mr-0.5"
          aria-label={`Tag „${tag}" entfernen`}
        >
          <X className="size-2.5" />
        </button>
      )}
    </span>
  );
}
