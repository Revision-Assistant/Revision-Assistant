import { useCallback, useEffect, useRef, useState } from 'react';

/** Wipe uploads + analysis after this much idle time with sensitive data present. */
export const PRIVACY_WIPE_MS = 10 * 60 * 1000;

export interface PrivacySessionOptions {
  /** True while files or analysis results are in memory */
  hasSensitiveData: boolean;
  onWipe: () => void;
}

/**
 * Clears in-browser paper/reports/findings after 10 minutes without user activity
 * (pointer, keyboard, scroll, or returning to the tab).
 */
export function usePrivacySession({
  hasSensitiveData,
  onWipe,
}: PrivacySessionOptions): {
  secondsRemaining: number | null;
  markActive: () => void;
} {
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const lastActiveRef = useRef(Date.now());
  const wipedRef = useRef(false);
  const onWipeRef = useRef(onWipe);
  onWipeRef.current = onWipe;

  const markActive = useCallback(() => {
    lastActiveRef.current = Date.now();
    wipedRef.current = false;
  }, []);

  useEffect(() => {
    if (!hasSensitiveData) {
      setSecondsRemaining(null);
      wipedRef.current = false;
      return;
    }

    // Fresh idle window whenever sensitive data appears / reappears
    lastActiveRef.current = Date.now();
    wipedRef.current = false;

    const bump = () => {
      lastActiveRef.current = Date.now();
    };

    const events: (keyof WindowEventMap)[] = [
      'pointerdown',
      'keydown',
      'scroll',
      'touchstart',
      'mousemove',
    ];
    for (const ev of events) {
      window.addEventListener(ev, bump, { passive: true });
    }
    const onVis = () => {
      if (document.visibilityState === 'visible') bump();
    };
    document.addEventListener('visibilitychange', onVis);

    const tick = () => {
      if (wipedRef.current) return;
      const now = Date.now();
      const deadline = lastActiveRef.current + PRIVACY_WIPE_MS;
      const left = Math.max(0, Math.ceil((deadline - now) / 1000));
      setSecondsRemaining(left);
      if (now >= deadline) {
        wipedRef.current = true;
        setSecondsRemaining(null);
        onWipeRef.current();
      }
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => {
      window.clearInterval(id);
      for (const ev of events) window.removeEventListener(ev, bump);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [hasSensitiveData]);

  return { secondsRemaining, markActive };
}

export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
