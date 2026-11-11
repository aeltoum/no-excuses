import { type CSSProperties, useRef, useState } from "react";

// A proof clip with only two controls: tap the frame to play or pause, drag
// the bar to seek. Nothing downloads until play is tapped.
export function ClipPlayer({
  url,
  label,
}: {
  url?: string | null;
  label: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  if (!url) return null;
  const toggle = () => {
    const clip = video.current;
    if (!clip) return;
    if (clip.paused) void clip.play().catch(() => {});
    else clip.pause();
  };
  // MediaRecorder WebM reports Infinity until the clip has been read once.
  const known = Number.isFinite(duration) && duration > 0;
  return (
    <div className="clip-player">
      {/* biome-ignore lint/a11y/useMediaCaption: member-recorded proof has no captions */}
      <video
        ref={video}
        className="clip-player-video"
        src={url}
        playsInline
        // Clips are the largest files we serve; nothing loads until play.
        preload="none"
        aria-label={label}
        onClick={toggle}
        onLoadedMetadata={(event) => {
          const clip = event.currentTarget;
          setDuration(clip.duration);
        }}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <button
        type="button"
        className="clip-player-toggle"
        data-playing={playing || undefined}
        aria-label={playing ? `Pause ${label}` : `Play ${label}`}
        onClick={toggle}
      >
        {!playing && (
          <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
            <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
          </svg>
        )}
      </button>
      <input
        className="clip-player-seek"
        type="range"
        min={0}
        max={known ? duration : 1}
        step={0.05}
        value={known ? Math.min(time, duration) : 0}
        disabled={!known}
        aria-label={`Seek ${label}`}
        style={
          {
            "--seek": `${known ? (Math.min(time, duration) / duration) * 100 : 0}%`,
          } as CSSProperties
        }
        onChange={(event) => {
          const clip = video.current;
          const next = Number(event.currentTarget.value);
          if (clip) clip.currentTime = next;
          setTime(next);
        }}
      />
    </div>
  );
}
