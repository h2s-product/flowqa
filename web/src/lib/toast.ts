/**
 * Bus toast kecil: bisa dipanggil dari komponen (useToast) maupun dari luar
 * React (mis. penanganan error global React Query di main.tsx).
 */
type Listener = (message: string) => void;
const listeners = new Set<Listener>();

export function showToast(message: string): void {
  listeners.forEach((listener) => listener(message));
}

export function subscribeToast(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
