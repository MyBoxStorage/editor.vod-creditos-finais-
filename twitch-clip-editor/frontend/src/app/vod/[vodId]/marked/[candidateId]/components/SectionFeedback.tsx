type SectionFeedbackProps = {
  status?: string;
  error?: string;
};

export function SectionFeedback({ status, error }: SectionFeedbackProps) {
  const showStatus = Boolean(status);
  const showError = Boolean(error) && !showStatus;
  if (!showStatus && !showError) return null;
  return (
    <div className="space-y-1.5">
      {showError && (
        <p className="rounded border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}
      {showStatus && (
        <p className="rounded border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-300">
          {status}
        </p>
      )}
    </div>
  );
}
