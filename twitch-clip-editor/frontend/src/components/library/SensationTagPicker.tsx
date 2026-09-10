"use client";

import { SENSATION_TAGS } from "../../lib/sensationTags";

type Props = {
  selected: string[];
  onToggle: (tag: string) => void;
  disabled?: boolean;
};

export function SensationTagPicker({ selected, onToggle, disabled }: Props) {
  return (
    <div
      className="flex flex-wrap gap-1.5"
      data-testid="sensation-tag-picker"
      role="group"
      aria-label="Tags de sensação"
    >
      {SENSATION_TAGS.map((tag) => {
        const on = selected.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            disabled={disabled}
            data-testid={`sensation-tag-${tag}`}
            aria-pressed={on}
            onClick={() => onToggle(tag)}
            className={`min-h-8 rounded border px-2.5 py-1.5 text-xs leading-tight transition-colors ${
              on
                ? "border-amber-500 bg-amber-950/60 text-amber-100"
                : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            } disabled:opacity-50`}
          >
            {tag}
          </button>
        );
      })}
    </div>
  );
}
