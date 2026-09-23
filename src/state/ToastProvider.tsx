import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import { toast as toastMetrics } from '@/theme';

export interface ToastState {
  /** Changes on every show, so an identical repeat message replays the entry animation. */
  id: number;
  text: string;
}

interface ToastApi {
  show: (text: string) => void;
}

/**
 * TWO CONTEXTS, NOT ONE. `show` is stable for the life of the provider; `toast` changes on
 * every show and every dismiss. One context carrying both meant every `useToast()` consumer
 * -- which is every `use*Actions` hook, so every screen, sheet and queue row -- re-rendered
 * twice per toast to read a value none of them use. `<Toast>` is the only reader of the
 * state and gets its own context; the compiler cannot split a context value for you.
 */
const ShowContext = createContext<ToastApi | null>(null);
const StateContext = createContext<ToastState | null>(null);

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
  const [api] = useState<ToastApi>(() => ({ show }));

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <ShowContext.Provider value={api}>
      <StateContext.Provider value={toast}>{children}</StateContext.Provider>
    </ShowContext.Provider>
  );
}

export function useToast(): ToastApi {
  const v = useContext(ShowContext);
  if (!v) throw new Error('useToast must be used inside <ToastProvider>');
  return v;
}

/** The current toast, or null. Read by `<Toast>` and nothing else. */
export function useToastState(): ToastState | null {
  return useContext(StateContext);
}
