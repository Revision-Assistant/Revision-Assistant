import { useEffect, useState } from 'react';
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

  if (!supabaseConfigured || !supabase) {
    return (
      <div className="auth-bar muted">
        <span className="auth-pill">No account needed</span>
        <span>Everything runs in your browser — nothing is saved after you close the tab.</span>
      </div>
    );
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
  };

  if (user) {
    return (
      <div className="auth-bar">
        <span className="who">{user.email}</span>
        <button type="button" className="ghost" onClick={signOut}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="auth-bar">
      {sent ? (
        <span>Check your email for the magic link.</span>
      ) : (
        <>
          <input
            type="email"
            placeholder="you@university.edu"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="button" disabled={busy || !email} onClick={signIn}>
            {busy ? 'Sending…' : 'Sign in'}
          </button>
        </>
      )}
      {err && <span className="auth-err">{err}</span>}
    </div>
  );
}
