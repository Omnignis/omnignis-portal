'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      if (/confirm/i.test(error.message)) {
        router.push('/verify?email=' + encodeURIComponent(email));
        return;
      }
      setError(error.message === 'Invalid login credentials'
        ? 'That email and password don\u2019t match. Try again, or reset your password below.'
        : error.message);
      return;
    }
    router.replace('/dashboard');
  }

  return (
    <div className="wrap">
      <div className="brand reveal"><span className="dot" /><span className="name">OMNIGNIS</span></div>
      <div className="card reveal d2">
        <h1>Welcome <span className="em">back</span></h1>
        <p className="sub">Sign in to your church&rsquo;s reporting dashboard.</p>
        {error && <div className="error">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="pw">Password</label>
            <input id="pw" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          <button className="btn btn-ember" disabled={loading}>
            {loading ? <span className="spinner" /> : 'Sign in'}
          </button>
        </form>
        <p className="muted" style={{ marginTop: 16, textAlign: 'center' }}>
          <a href="/forgot">Forgot your password?</a>
        </p>
      </div>
      <p className="foot-link reveal d3">New here? <a href="/signup">Create your church&rsquo;s account</a></p>
    </div>
  );
}
