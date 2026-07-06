'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

export default function Verify() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setEmail(params.get('email') || '');
  }, []);

  useEffect(() => {
    if (!cooldown) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function submit(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    const { error } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: 'signup' });
    setLoading(false);
    if (error) { setError('That code didn\u2019t work. Check the digits and try again, or resend a fresh one.'); return; }
    router.replace('/dashboard');
  }

  async function resend() {
    setError(''); setNotice('');
    const { error } = await supabase.auth.resend({ type: 'signup', email });
    if (error) { setError(error.message); return; }
    setNotice('A new code is on its way to ' + email + '.');
    setCooldown(30);
  }

  return (
    <div className="wrap">
      <div className="brand reveal"><span className="dot" /><span className="name">OMNIGNIS</span></div>
      <div className="card reveal d2">
        <h1>Check your <span className="em">email</span></h1>
        <p className="sub">We sent a 6-digit code to <b style={{ color: 'var(--cream)' }}>{email || 'your email'}</b>. Enter it below to activate your account.</p>
        {error && <div className="error">{error}</div>}
        {notice && <div className="notice">{notice}</div>}
        <form onSubmit={submit}>
          {!email && (
            <div className="field">
              <label htmlFor="em">Email</label>
              <input id="em" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
          )}
          <div className="field">
            <label htmlFor="code">Verification code</label>
            <input id="code" className="code-input" inputMode="numeric" pattern="[0-9]*" maxLength={6}
                   value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="••••••" required />
          </div>
          <button className="btn btn-ember" disabled={loading || code.length !== 6}>
            {loading ? <span className="spinner" /> : 'Verify and continue'}
          </button>
        </form>
        <p className="muted" style={{ marginTop: 16, textAlign: 'center' }}>
          Didn&rsquo;t get it?{' '}
          {cooldown > 0
            ? <span>Resend available in {cooldown}s</span>
            : <a href="#" onClick={e => { e.preventDefault(); resend(); }}>Resend code</a>}
        </p>
      </div>
      <p className="foot-link reveal d3">Wrong email? <a href="/signup">Start over</a></p>
    </div>
  );
}
