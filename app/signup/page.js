'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function Signup() {
  const router = useRouter();
  const [form, setForm] = useState({
    church_name: '', email: '', password: '',
    destination_emails: '', report_frequency: 'weekly',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })); }

  function validate() {
    if (form.password.length < 8) return 'Password must be at least 8 characters.';
    const dests = (form.destination_emails || '').split(',').map(s => s.trim()).filter(Boolean);
    const bad = dests.find(d => !EMAIL_RE.test(d));
    if (bad) return `"${bad}" doesn't look like an email address. Check the report recipients.`;
    return '';
  }

  async function submit(e) {
    e.preventDefault();
    const v = validate();
    if (v) { setError(v); return; }
    setError(''); setLoading(true);
    const cleanDests = (form.destination_emails || '')
      .split(',').map(s => s.trim()).filter(Boolean).join(', ');
    const { error } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        data: {
          church_name: form.church_name.trim(),
          destination_emails: cleanDests || form.email,
          report_frequency: form.report_frequency,
        },
      },
    });
    setLoading(false);
    if (error) { setError(error.message); return; }
    router.push('/verify?email=' + encodeURIComponent(form.email));
  }

  return (
    <div className="wrap">
      <div className="brand reveal"><span className="dot" /><span className="name">OMNIGNIS</span></div>
      <div className="card reveal d2">
        <h1>Create your <span className="em">account</span></h1>
        <p className="sub">Set up automated livestream reports for your church. Takes about two minutes.</p>
        {error && <div className="error">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="church">Church name</label>
            <input id="church" value={form.church_name} onChange={e => set('church_name', e.target.value)} placeholder="St. Mary's Catholic Church" required />
          </div>
          <div className="field">
            <label htmlFor="email">Your email (used to sign in)</label>
            <input id="email" type="email" autoComplete="email" value={form.email} onChange={e => set('email', e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="pw">Password</label>
            <input id="pw" type="password" autoComplete="new-password" minLength={8} value={form.password} onChange={e => set('password', e.target.value)} required />
            <p className="hint">At least 8 characters.</p>
          </div>
          <div className="field">
            <label htmlFor="dest">Where should we email the reports?</label>
            <input id="dest" value={form.destination_emails} onChange={e => set('destination_emails', e.target.value)}
                   placeholder="office@yourchurch.org, pastor@yourchurch.org" />
            <p className="hint">Separate multiple addresses with commas. Leave blank to use your sign-in email.</p>
          </div>
          <div className="field">
            <label htmlFor="freq">How often?</label>
            <select id="freq" value={form.report_frequency} onChange={e => set('report_frequency', e.target.value)}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly (Sundays)</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <button className="btn btn-ember" disabled={loading}>
            {loading ? <span className="spinner" /> : 'Create account'}
          </button>
        </form>
      </div>
      <p className="foot-link reveal d3">Already have an account? <a href="/login">Sign in</a></p>
    </div>
  );
}
