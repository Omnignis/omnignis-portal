'use client';
import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

export default function Forgot() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/reset',
    });
    setLoading(false);
    if (error) { setError(error.message); return; }
    setSent(true);
  }

  return (
    <div className="wrap">
      <div className="brand reveal"><span className="dot" /><span className="name">OMNIGNIS</span></div>
      <div className="card reveal d2">
        <h1>Reset your <span className="em">password</span></h1>
        {sent ? (
          <>
            <p className="sub" style={{ marginBottom: 0 }}>
              If an account exists for <b style={{ color: 'var(--cream)' }}>{email}</b>, a reset link is on its way.
              Open it on this device and you&rsquo;ll be brought straight back here to choose a new password.
            </p>
          </>
        ) : (
          <>
            <p className="sub">Enter your sign-in email and we&rsquo;ll send you a reset link.</p>
            {error && <div className="error">{error}</div>}
            <form onSubmit={submit}>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required />
              </div>
              <button className="btn btn-ember" disabled={loading}>
                {loading ? <span className="spinner" /> : 'Send reset link'}
              </button>
            </form>
          </>
        )}
      </div>
      <p className="foot-link reveal d3"><a href="/login">Back to sign in</a></p>
    </div>
  );
}
