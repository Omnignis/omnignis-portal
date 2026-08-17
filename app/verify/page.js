'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import Brand from '../../components/Brand';

export default function Verify() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [emailFromLink, setEmailFromLink] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromLink = params.get('email') || '';
    setEmail(fromLink);
    setEmailFromLink(!!fromLink);
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
    if (error) {
      // The most common failure here is an expired code, not a mistyped one.
      // Telling someone to re-check correct digits sends them in a loop.
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('expired')) {
        setError('That code has expired. Send a fresh one and enter it within the hour.');
      } else if (code.length < 6) {
        setError('That code looks too short. Enter every digit from the email.');
      } else {
        setError('That code was not accepted. Check you copied all of it, or send a fresh one.');
      }
      return;
    }
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
      <Brand />
      <div className="card reveal d2">
        <h1>Check your <span className="em">email</span></h1>
        <p className="sub">We sent a code to <b style={{ color: 'var(--cream)' }}>{email || 'your email'}</b>. Enter the whole code below to activate your account.</p>
        {error && <div className="error" role="alert">{error}</div>}
        {notice && <div className="notice" role="status">{notice}</div>}
        <form onSubmit={submit}>
          {!emailFromLink && (
            <div className="field">
              <label htmlFor="em">Email</label>
              <input id="em" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
          )}
          <div className="field">
            <label htmlFor="code">Verification code</label>
            {/* Supabase's GOTRUE_MAILER_OTP_LENGTH is per-project and is 6 on some
                projects and 8 on others. maxLength={6} silently truncated an
                8-digit code, so it could never verify. Accept 6 to 10 and let
                verifyOtp be the authority on validity. */}
            <input id="code" className="code-input" inputMode="numeric" pattern="[0-9]*"
                   autoComplete="one-time-code" maxLength={10} minLength={6}
                   value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
                   placeholder="Enter your code" required />
          </div>
          <button className="btn btn-ember" disabled={loading || code.length < 6}>
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
