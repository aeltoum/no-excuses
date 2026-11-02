import { type CSSProperties, useRef, useState } from "react";

// One frame of a loaded clip as a JPEG data URL; null if the frame can't be read.
export function grabFrame(video: HTMLVideoElement, width: number) {
  const height = Math.round((width * video.videoHeight) / video.videoWidth);
  if (!height) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  try {
    canvas.getContext("2d")?.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    // A cross-origin frame without CORS taints the canvas.
    return null;
  }
}

// A JPEG poster from a just-recorded clip, read on the device; null on failure.
export function posterFromClip(blob: Blob): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    const done = (result: Blob | null) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      resolve(result);
    };
    const timer = setTimeout(() => done(null), 5000);
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onloadeddata = () => {
      video.currentTime = 0.1;
    };
    video.onseeked = () => {
      const frame = grabFrame(video, 480);
      if (!frame) return done(null);
      void fetch(frame)
        .then((response) => response.blob())
        .then(done, () => done(null));
    };
    video.onerror = () => done(null);
    video.src = url;
  });
}

// A proof clip with only two controls: tap the frame to play or pause, drag
// the bar to seek. It opens on a frame from the clip instead of a black box.
export function ClipPlayer({
  url,
  poster,
  label,
}: {
  url?: string | null;
  poster?: string | null;
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
        poster={poster ?? undefined}
        playsInline
        preload="auto"
        aria-label={label}
        onClick={toggle}
        // Seeking past the blank first frame paints the thumbnail.
        onLoadedMetadata={(event) => {
          const clip = event.currentTarget;
          setDuration(clip.duration);
          if (clip.currentTime === 0) clip.currentTime = 0.1;
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
