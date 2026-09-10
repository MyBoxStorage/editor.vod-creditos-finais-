type StatusBannersProps = {
  error: string;
  status: string;
};

export function StatusBanners({ error, status }: StatusBannersProps) {
  return (
    <>
      {error && (
        <p className="rounded border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}
      {status && (
        <p className="rounded border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200">
          {status}
        </p>
      )}
    </>
  );
}
