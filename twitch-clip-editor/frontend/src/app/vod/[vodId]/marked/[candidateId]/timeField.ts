import { formatTime, parseTime } from "./utils";

/**
 * Campo de tempo: comita ao digitar quando parseTime é válido;
 * reformata só no blur. Texto inválido não altera o valor numérico.
 */
export function onTimeFieldChange(
  raw: string,
  setInput: (v: string) => void,
  setError: (v: boolean) => void,
  commit: (seconds: number) => void
): void {
  setInput(raw);
  const parsed = parseTime(raw);
  if (parsed == null) {
    setError(true);
    return;
  }
  setError(false);
  commit(parsed);
}

export function onTimeFieldBlur(
  raw: string,
  currentSeconds: number,
  setInput: (v: string) => void,
  setError: (v: boolean) => void
): void {
  const parsed = parseTime(raw);
  if (parsed == null) {
    setInput(formatTime(currentSeconds));
    setError(true);
    return;
  }
  setError(false);
  setInput(formatTime(parsed));
}
