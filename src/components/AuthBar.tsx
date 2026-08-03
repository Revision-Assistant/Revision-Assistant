import { useEffect, useId, useRef, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from '../lib/supabase/client';

interface Props {
  onSession: (user: User | null, session: Session | null) => void;
}

export function AuthBar({ onSession }: Props) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!supabase) {
      onSession(null, null);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      onSession(data.session?.user ?? null, data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      onSession(session?.user ?? null, session);
    });
    return () => sub.subscription.unsubscribe();
  }, [onSession]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!supabaseConfigured || !supabase) {
    return null;
  }

  const signIn = async () => {
    if (!supabase) return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setSent(true);
  };

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setOpen(false);
  };

  if (user) {
    return (
      <div className="auth-bar signed-in">
        <span className="auth-chip" title={user.email ?? undefined}>
          <span className="auth-chip-dot" aria-hidden />
          <span className="auth-chip-email">{user.email}</span>
        </span>
        <button type="button" className="ghost auth-quiet" onClick={signOut}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="auth-bar" ref={wrapRef}>
      <button
        type="button"
        className={`auth-trigger${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        Sign in
      </button>
      {open && (
        <div className="auth-panel" id={panelId} role="dialog" aria-label="Sign in">
          <p className="auth-panel-title">Optional cloud save</p>
          {sent ? (
            <p className="auth-panel-copy">
              Check <strong>{email}</strong> for a magic link. You can close this panel.
            </p>
          ) : (
            <>
              <p className="auth-panel-copy">
                Save findings JSON to the cloud. Your manuscript files stay on this device.
              </p>
              <label className="auth-field" htmlFor={`${panelId}-email`}>
                University email
                <input
                  id={`${panelId}-email`}
                  type="email"
                  autoComplete="email"
                  autoFocus
                  placeholder="you@university.edu"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && email && !busy) void signIn();
                  }}
                />
              </label>
              <button
                type="button"
                className="primary auth-submit"
                disabled={busy || !email.includes('@')}
                onClick={() => void signIn()}
              >
                {busy ? 'Sending link…' : 'Email magic link'}
              </button>
            </>
          )}
          {err && <p className="auth-err">{err}</p>}
        </div>
      )}
    </div>
  );
}
