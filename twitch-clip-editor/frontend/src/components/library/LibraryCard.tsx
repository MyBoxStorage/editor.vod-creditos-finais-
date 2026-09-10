"use client";

import type { EffectLibraryCard } from "../../lib/api";
import { libraryMediaUrl } from "../../lib/api";
import {
  formatLibraryDuration,
  typeLabel,
} from "../../lib/libraryUtils";
import { useLibraryPreview } from "./useLibraryPreview";

type Props = {
  item: EffectLibraryCard;
  variant?: "default" | "compact";
  selected?: boolean;
  checked?: boolean;
  selectable?: boolean;
  showCheckbox?: boolean;
  showEdit?: boolean;
  onSelect?: (item: EffectLibraryCard) => void;
  onToggleCheck?: (item: EffectLibraryCard, checked: boolean) => void;
  onToggleFavorite?: (item: EffectLibraryCard) => void;
  onEdit?: (item: EffectLibraryCard) => void;
  disabled?: boolean;
};

export function LibraryCard({
  item,
  variant = "default",
  selected,
  checked,
  selectable = true,
  showCheckbox = false,
  showEdit = false,
  onSelect,
  onToggleCheck,
  onToggleFavorite,
  onEdit,
  disabled,
}: Props) {
  const { playingId, playAudio, hoverVideoId, setHoverVideoId } =
    useLibraryPreview();

  const isAudio = item.type === "music" || item.type === "sfx";
  const isCompact = variant === "compact";
  const mediaUrl = libraryMediaUrl(item.mediaPath);
  const thumbUrl = item.thumbnailPath
    ? libraryMediaUrl(item.thumbnailPath)
    : null;
  const waveUrl = item.waveformPath
    ? libraryMediaUrl(item.waveformPath)
    : null;
  const videoPlaying = hoverVideoId === item.id;
  const audioPlaying = playingId === item.id;

  return (
    <article
      data-testid={`library-card-${item.id}`}
      data-item-type={item.type}
      onPointerEnter={() =>
        item.type === "video" && setHoverVideoId(item.id)
      }
      onPointerLeave={() =>
        item.type === "video" && setHoverVideoId(null)
      }
      className={`flex flex-col rounded border bg-zinc-900/70 overflow-hidden transition-colors ${
        selected
          ? "border-amber-500 ring-1 ring-amber-500/40"
          : checked
            ? "border-lime-600"
            : "border-zinc-800 hover:border-zinc-600"
      } ${item.status === "archived" ? "opacity-60" : ""}`}
    >
      <div
        className={`relative bg-zinc-950 ${isCompact ? "aspect-[4/3]" : "aspect-video"}`}
        data-testid={`library-media-${item.id}`}
      >
        {item.type === "video" || item.type === "image" ? (
          <>
            {thumbUrl && !videoPlaying && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumbUrl}
                alt=""
                className="h-full w-full object-cover"
                data-testid={`library-thumb-${item.id}`}
              />
            )}
            {(videoPlaying || !thumbUrl) && (
              <video
                src={mediaUrl}
                muted
                loop
                playsInline
                autoPlay={videoPlaying}
                className="h-full w-full object-cover"
                data-testid={`library-video-${item.id}`}
              />
            )}
          </>
        ) : waveUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={waveUrl}
            alt=""
            className="h-full w-full object-contain p-1"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-zinc-600">
            áudio
          </div>
        )}

        {item.type === "video" && (
          <button
            type="button"
            disabled={disabled}
            data-testid={`library-video-play-${item.id}`}
            onClick={(e) => {
              e.stopPropagation();
              setHoverVideoId(videoPlaying ? null : item.id);
            }}
            className="absolute bottom-1 right-1 rounded-full border border-zinc-600 bg-zinc-900/90 px-2 py-1 text-[10px] hover:border-sky-400"
            aria-label={videoPlaying ? "Parar prévia" : "Tocar prévia"}
          >
            {videoPlaying ? "■" : "▶"}
          </button>
        )}

        {isAudio && (
          <button
            type="button"
            disabled={disabled}
            data-testid={`library-play-${item.id}`}
            onClick={(e) => {
              e.stopPropagation();
              playAudio(item.id, mediaUrl);
            }}
            className="absolute bottom-1 right-1 rounded-full border border-zinc-600 bg-zinc-900/90 px-2 py-1 text-[10px] hover:border-sky-400"
            aria-label={audioPlaying ? "Parar" : "Tocar"}
          >
            {audioPlaying ? "■" : "▶"}
          </button>
        )}

        {showCheckbox && (
          <label className="absolute left-1 top-1 flex items-center rounded bg-zinc-900/80 px-1 py-0.5">
            <input
              type="checkbox"
              checked={!!checked}
              disabled={disabled}
              onChange={(e) => {
                e.stopPropagation();
                onToggleCheck?.(item, e.target.checked);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          </label>
        )}

        <div className="absolute right-1 top-1 flex gap-0.5">
          {onToggleFavorite && (
            <button
              type="button"
              disabled={disabled}
              data-testid={`library-favorite-${item.id}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(item);
              }}
              className={`rounded bg-zinc-900/80 px-1 py-0.5 text-xs leading-none ${
                item.isFavorite
                  ? "text-amber-300"
                  : "text-zinc-500 hover:text-amber-200"
              }`}
              aria-label={item.isFavorite ? "Desfixar" : "Fixar"}
            >
              ★
            </button>
          )}
          {showEdit && onEdit && (
            <button
              type="button"
              disabled={disabled}
              data-testid={`library-edit-${item.id}`}
              onClick={(e) => {
                e.stopPropagation();
                onEdit(item);
              }}
              className="rounded bg-zinc-900/80 px-1 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200"
              aria-label="Editar"
            >
              ✎
            </button>
          )}
        </div>
      </div>

      <div className={`min-w-0 ${isCompact ? "p-1.5" : "p-2"}`}>
        <button
          type="button"
          disabled={disabled || !selectable}
          onClick={() => onSelect?.(item)}
          className={`block w-full truncate text-left font-medium text-zinc-100 hover:text-amber-100 disabled:cursor-default ${
            isCompact ? "text-[11px]" : "text-xs"
          }`}
        >
          {item.name}
        </button>

        {!isCompact && (
          <>
            <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-zinc-500">
              <span>{typeLabel(item.type)}</span>
              <span>·</span>
              <span>{formatLibraryDuration(item.durationSeconds)}</span>
              {item.usageCount > 0 && (
                <>
                  <span>·</span>
                  <span>{item.usageCount}×</span>
                </>
              )}
            </div>

            {(item.sensationTags.length > 0 || item.tags.length > 0) && (
              <div className="mt-1 flex flex-wrap gap-0.5">
                {item.sensationTags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded bg-amber-950/50 px-1 py-px text-[9px] text-amber-200/80"
                  >
                    {tag}
                  </span>
                ))}
                {item.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded border border-zinc-700/80 px-1 py-px text-[9px] text-zinc-500"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </article>
  );
}
