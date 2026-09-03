import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import { toast as toastMetrics } from '@/theme';

export interface ToastState {
  /** Changes on every show, so an identical repeat message replays the entry animation. */
  id: number;
  text: string;
}

interface ToastApi {
  toast: ToastState | null;
  show: (text: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const show = useCallback((text: string) => {
    if (timer.current) clearTimeout(timer.current);
    seq.current += 1;
    setToast({ id: seq.current, text });
    timer.current = setTimeout(() => setToast(null), toastMetrics.durationMs);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return <ToastContext.Provider value={{ toast, show }}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastApi {
  const v = useContext(ToastContext);
  if (!v) throw new Error('useToast must be used inside <ToastProvider>');
  return v;
}
