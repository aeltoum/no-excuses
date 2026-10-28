// One-time notice for members present when posts started counting on submit. The server keeps
// the dismissal per Account, so it stays gone on every device.
export function CountNotice({
  failed,
  onDismiss,
}: {
  failed: boolean;
  onDismiss: () => void;
}) {
  return (
    <aside className="install-prompt" aria-label="What changed">
      <div>
        <p>
          Posts now count right away. You can still question one for 24 hours.
        </p>
        {failed && (
          <p className="result error" role="alert">
            Couldn’t dismiss the notice. Try again.
          </p>
        )}
      </div>
      <button
        type="button"
        className="install-dismiss"
        aria-label="Dismiss notice"
        onClick={onDismiss}
      >
        ×
      </button>
    </aside>
  );
}
