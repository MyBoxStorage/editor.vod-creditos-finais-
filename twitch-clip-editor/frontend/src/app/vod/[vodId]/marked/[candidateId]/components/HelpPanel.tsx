"use client";

import { useEffect, useRef } from "react";

type HelpPanelProps = {
  open: boolean;
  onClose: () => void;
};

const SHORTCUTS: { key: string; action: string }[] = [
  { key: "espaço", action: "reproduzir / pausar" },
  { key: "I", action: "marcar início no playhead" },
  { key: "O", action: "marcar fim no playhead" },
  { key: "← →", action: "1 quadro" },
  { key: "shift + ← →", action: "1 segundo" },
  { key: "J / K / L", action: "rebobinar / pausar / avançar" },
  { key: "1 a 6", action: "aplicar preset de momento no playhead" },
  { key: "ctrl + Z", action: "desfazer" },
];

export function HelpPanel({ open, onClose }: HelpPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onPointer(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-16">
      <div
        ref={panelRef}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-5 shadow-xl"
        role="dialog"
        aria-label="Ajuda do editor"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-100">Ajuda</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            fechar
          </button>
        </div>

        <section className="mb-5">
          <h3 className="mb-2 text-sm font-medium text-zinc-300">Atalhos</h3>
          <table className="w-full text-sm">
            <tbody>
              {SHORTCUTS.map((row) => (
                <tr key={row.key} className="border-b border-zinc-800/80">
                  <td className="py-1.5 pr-3 font-mono text-xs text-amber-200/90 whitespace-nowrap">
                    {row.key}
                  </td>
                  <td className="py-1.5 text-zinc-300">{row.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mb-5 space-y-2">
          <h3 className="text-sm font-medium text-zinc-300">
            Parte do efeito × momento do clipe
          </h3>
          <div
            className="rounded-lg p-3 text-xs"
            style={{
              background: "var(--bg-accent)",
              color: "var(--text-accent)",
            }}
          >
            <p className="font-medium">✂ parte do efeito</p>
            <p className="opacity-90">qual pedaço do arquivo da biblioteca</p>
          </div>
          <div
            className="rounded-lg p-3 text-xs"
            style={{
              background: "var(--bg-warning)",
              color: "var(--text-warning)",
            }}
          >
            <p className="font-medium">📍 momento do clipe</p>
            <p className="opacity-90">onde ele entra no trecho</p>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-medium text-zinc-300">
            Zonas seguras
          </h3>
          <p className="text-xs leading-relaxed text-zinc-400">
            As linhas tracejadas no preview mostram o que a plataforma cobre:
            topo (0–14%) e base (76–100%). Mantenha rostos e texto importantes
            na zona garantida (20–80% largura, 14–76% altura). Legendas ficam
            perto de 68% da altura — nada abaixo de 76%.
          </p>
        </section>
      </div>
    </div>
  );
}
