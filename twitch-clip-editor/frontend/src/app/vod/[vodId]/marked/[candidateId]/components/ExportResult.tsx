type ExportResultProps = {
  exportResultUrl: string;
};

export function ExportResult({ exportResultUrl }: ExportResultProps) {
  return (
    <div className="space-y-2 border-t border-zinc-800 pt-3">
      <a
        href={exportResultUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-block rounded bg-emerald-700 px-3 py-2 text-sm hover:bg-emerald-600"
      >
        Abrir arquivo final
      </a>
      <video
        key={exportResultUrl}
        src={exportResultUrl}
        controls
        className="w-full max-h-72 rounded bg-black"
      />
    </div>
  );
}
