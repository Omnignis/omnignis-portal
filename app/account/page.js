'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function Account() {
  const router = useRouter();
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [pw, setPw] = useState({ next: '', confirm: '' });

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/login'); return; }
      const { data } = await supabase.from('profiles')
        .select('church_name,destination_emails,report_frequency,business_address,phone').single();
      setForm(data || {});
    })();
  }, [router]);

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })); }

  async function saveProfile(e) {
    e.preventDefault();
    setError(''); setNotice('');
    const dests = (form.destination_emails || '').split(',').map(s => s.trim()).filter(Boolean);
    if (dests.length === 0) { setError('Add at least one report recipient email.'); return; }
    const bad = dests.find(d => !EMAIL_RE.test(d));
    if (bad) { setError(`"${bad}" doesn't look like an email address.`); return; }
    setBusy('profile');
    const { error } = await supabase.from('profiles').update({
      church_name: (form.church_name || '').trim(),
      destination_emails: dests.join(', '),
      report_frequency: form.report_frequency,
      business_address: form.business_address || null,
      phone: form.phone || null,
    }).eq('id', (await supabase.auth.getUser()).data.user.id);
    setBusy('');
    if (error) { setError(error.message); return; }
    setNotice('Account details saved.');
  }

  async function changePassword(e) {
    e.preventDefault();
    setError(''); setNotice('');
    if (pw.next.length < 8) { setError('New password must be at least 8 characters.'); return; }
    if (pw.next !== pw.confirm) { setError('Those passwords don\u2019t match.'); return; }
    setBusy('password');
    const { error } = await supabase.auth.updateUser({ password: pw.next });
    setBusy('');
    if (error) { setError(error.message); return; }
    setPw({ next: '', confirm: '' });
    setNotice('Password changed.');
  }

  async function deleteAccount() {
    const phrase = window.prompt(
      'This permanently deletes your account, your Facebook connection, and all stored data. ' +
      'Reports will stop immediately.\n\nType DELETE to confirm.'
    );
    if (phrase !== 'DELETE') return;
    setError(''); setBusy('delete');
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/account/delete', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + session.access_token },
    });
    setBusy('');
    if (!res.ok) { setError('Deletion failed. Email info@omnignis.com and we\u2019ll take care of it.'); return; }
    await supabase.auth.signOut();
    router.replace('/login');
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  if (!form) {
    return <div className="wrap center"><div className="brand"><span className="dot" /><span className="name">OMNIGNIS</span></div><p className="muted"><span className="spinner" /> Loading…</p></div>;
  }

  return (
    <div className="wrap-wide">
      <div className="topbar reveal">
        <div className="brand"><span className="dot" /><span className="name">OMNIGNIS</span></div>
        <nav>
          <a href="/dashboard">Dashboard</a>
          <a href="/account" className="active">My account</a>
          <button className="signout" onClick={signOut}>Sign out</button>
        </nav>
      </div>

      <div className="reveal d2" style={{ marginBottom: 24 }}>
        <p className="kicker">Settings</p>
        <h1>My <span className="em">account</span></h1>
      </div>

      {error && <div className="error reveal">{error}</div>}
      {notice && <div className="notice reveal">{notice}</div>}

      <div className="card reveal d2">
        <h2>Church &amp; reports</h2>
        <form onSubmit={saveProfile} style={{ marginTop: 14 }}>
          <div className="field">
            <label htmlFor="church">Church name</label>
            <input id="church" value={form.church_name || ''} onChange={e => set('church_name', e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="dest">Report recipients</label>
            <input id="dest" value={form.destination_emails || ''} onChange={e => set('destination_emails', e.target.value)} required />
            <p className="hint">Separate multiple addresses with commas.</p>
          </div>
          <div className="field">
            <label htmlFor="freq">Report frequency</label>
            <select id="freq" value={form.report_frequency || 'weekly'} onChange={e => set('report_frequency', e.target.value)}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly (Sundays)</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="addr">Business address <span style={{ opacity: .6 }}>(optional)</span></label>
            <input id="addr" value={form.business_address || ''} onChange={e => set('business_address', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="phone">Phone <span style={{ opacity: .6 }}>(optional)</span></label>
            <input id="phone" type="tel" value={form.phone || ''} onChange={e => set('phone', e.target.value)} />
          </div>
          <button className="btn btn-ember" disabled={busy === 'profile'}>
            {busy === 'profile' ? <span className="spinner" /> : 'Save changes'}
          </button>
        </form>
      </div>

      <div className="card reveal d3">
        <h2>Change password</h2>
        <form onSubmit={changePassword} style={{ marginTop: 14 }}>
          <div className="field">
            <label htmlFor="npw">New password</label>
            <input id="npw" type="password" autoComplete="new-password" minLength={8} value={pw.next} onChange={e => setPw(p => ({ ...p, next: e.target.value }))} required />
          </div>
          <div className="field">
            <label htmlFor="cpw">Confirm new password</label>
            <input id="cpw" type="password" autoComplete="new-password" minLength={8} value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} required />
          </div>
          <button className="btn btn-ghost" disabled={busy === 'password'}>
            {busy === 'password' ? <span className="spinner" /> : 'Change password'}
          </button>
        </form>
      </div>

      <div className="card reveal d3">
        <h2>Delete account</h2>
        <p className="muted" style={{ margin: '10px 0 16px' }}>
          Permanently removes your account, your encrypted Facebook token, and all stored data.
          This is the self-serve version of our <a href="https://omnignis.com/data-deletion.html">data deletion policy</a>.
        </p>
        <button className="btn btn-danger" onClick={deleteAccount} disabled={busy === 'delete'}>
          {busy === 'delete' ? <span className="spinner" /> : 'Delete my account'}
        </button>
      </div>
    </div>
  );
}
