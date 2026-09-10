import type { RefObject } from "react";
import type { EditKind } from "../types";

type ClipPlayerProps = {
  vodId: string;
  editKind: EditKind;
  videoSrc: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  start: number;
  clipOriginRef: RefObject<number>;
  onDurationLoaded: (duration: number) => void;
};

export function ClipPlayer({
  vodId,
  editKind,
  videoSrc,
  videoRef,
  start,
  clipOriginRef,
  onDurationLoaded,
}: ClipPlayerProps) {
  if (!vodId || !editKind || !videoSrc) return null;

  return (
    <div className="space-y-1">
      <video
        key={videoSrc}
        ref={videoRef}
        src={videoSrc}
        controls
        className="w-full max-h-[480px] rounded bg-black"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration || 0;
          onDurationLoaded(d);
          if (editKind === "clip_segment") {
            e.currentTarget.currentTime = Math.max(
              0,
              start - clipOriginRef.current
            );
          } else {
            e.currentTarget.currentTime = start;
          }
        }}
      />
    </div>
  );
}
