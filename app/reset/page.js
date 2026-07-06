'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

export default function Reset() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // The recovery link signs the user in via the URL hash; supabase-js picks it up.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => { if (data.session) setReady(true); });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function submit(e) {
    e.preventDefault();
    if (password !== confirm) { setError('Those passwords don\u2019t match.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setError(''); setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) { setError(error.message); return; }
    router.replace('/dashboard');
  }

  return (
    <div className="wrap">
      <div className="brand reveal"><span className="dot" /><span className="name">OMNIGNIS</span></div>
      <div className="card reveal d2">
        <h1>Choose a new <span className="em">password</span></h1>
        {!ready ? (
          <p className="sub" style={{ marginBottom: 0 }}>
            Waiting for your reset link&hellip; If you landed here directly, open the link from your reset email first.
            {' '}<a href="/forgot">Request a new link</a>.
          </p>
        ) : (
          <>
            <p className="sub">You&rsquo;re verified — set a new password for your account.</p>
            {error && <div className="error">{error}</div>}
            <form onSubmit={submit}>
              <div className="field">
                <label htmlFor="pw">New password</label>
                <input id="pw" type="password" autoComplete="new-password" minLength={8} value={password} onChange={e => setPassword(e.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="pw2">Confirm new password</label>
                <input id="pw2" type="password" autoComplete="new-password" minLength={8} value={confirm} onChange={e => setConfirm(e.target.value)} required />
              </div>
              <button className="btn btn-ember" disabled={loading}>
                {loading ? <span className="spinner" /> : 'Save new password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
