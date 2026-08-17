'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { getSessionOrRedirect } from '../../lib/session';
import AppFooter from '../../components/AppFooter';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Mirrors report/formats.py SUPPORTED, same order.
const FORMATS = [
  { key: 'xlsx', label: 'Excel', hint: '.xlsx' },
  { key: 'pdf',  label: 'PDF',   hint: '.pdf' },
  { key: 'csv',  label: 'CSV',   hint: '.csv' },
  { key: 'docx', label: 'Word',  hint: '.docx' },
  { key: 'txt',  label: 'Plain text', hint: '.txt' },
  { key: 'png',  label: 'Image', hint: '.png' },
];

const COMMON_ZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix',
  'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu',
];

const WEEKDAYS = [
  { v: 6, label: 'Sunday' }, { v: 0, label: 'Monday' }, { v: 1, label: 'Tuesday' },
  { v: 2, label: 'Wednesday' }, { v: 3, label: 'Thursday' }, { v: 4, label: 'Friday' },
  { v: 5, label: 'Saturday' },
];

function hourLabel(h) {
  const suffix = h < 12 ? 'AM' : 'PM';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:00 ${suffix}`;
}

function allZones() {
  try {
    if (typeof Intl.supportedValuesOf === 'function') {
      return Intl.supportedValuesOf('timeZone');
    }
  } catch (e) { /* older browser */ }
  return [];
}

export default function Account() {
  const router = useRouter();
  const [form, setForm] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [pw, setPw] = useState({ next: '', confirm: '' });

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function load() {
    setLoadError('');
    const session = await getSessionOrRedirect(supabase, router);
    if (!session) return;
    try {
      const { data, error } = await supabase.from('profiles')
        .select('church_name,destination_emails,report_frequency,business_address,phone,timezone,send_hour,send_weekday,report_formats').single();
      // Previously the error was discarded, so a missing row rendered a blank
      // form that looked like the customer's settings had been wiped.
      if (error) throw error;
      setForm(data || {});
    } catch (e) {
      console.error('Account load failed:', e);
      setLoadError('We could not load your settings. Check your connection and try again.');
    }
  }

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })); }

  const chosenFormats = (form && form.report_formats ? form.report_formats : 'xlsx')
    .split(',').map(f => f.trim()).filter(Boolean);

  function toggleFormat(key) {
    const next = chosenFormats.includes(key)
      ? chosenFormats.filter(f => f !== key)
      : [...chosenFormats, key];
    // Keep the canonical order and never allow an empty selection: an email
    // with no attachment is worse than one in a format they did not pick.
    const ordered = FORMATS.map(f => f.key).filter(k => next.includes(k));
    set('report_formats', (ordered.length ? ordered : ['xlsx']).join(','));
  }
  function clearBanners() { setError(''); setNotice(''); }

  async function saveProfile(e) {
    e.preventDefault();
    clearBanners();
    const dests = (form.destination_emails || '').split(',').map(s => s.trim()).filter(Boolean);
    if (dests.length === 0) { setError('Add at least one report recipient email.'); return; }
    const bad = dests.find(d => !EMAIL_RE.test(d));
    if (bad) { setError(`"${bad}" does not look like an email address.`); return; }
    if (!(form.church_name || '').trim()) { setError('Church name cannot be blank.'); return; }

    setBusy('profile');
    try {
      const session = await getSessionOrRedirect(supabase, router);
      if (!session) return;
      const { data, error } = await supabase.from('profiles').update({
        church_name: (form.church_name || '').trim(),
        destination_emails: dests.join(', '),
        report_frequency: form.report_frequency,
        business_address: form.business_address || null,
        phone: form.phone || null,
        timezone: form.timezone || 'America/Chicago',
        send_hour: Number(form.send_hour ?? 13),
        send_weekday: Number(form.send_weekday ?? 6),
        report_formats: form.report_formats || 'xlsx',
      }).eq('id', session.user.id).select('id');
      if (error) throw error;
      // A zero-row update is reported as success by PostgREST. Without this the
      // page showed a green "saved" banner while nothing had been written.
      if (!data || data.length === 0) {
        setError('We could not find your account record to update. Please email info@omnignis.com.');
        return;
      }
      setNotice('Account details saved.');
    } catch (e) {
      console.error('saveProfile failed:', e);
      setError('Could not save your changes. Check your connection and try again.');
    } finally {
      setBusy('');
    }
  }

  async function changePassword(e) {
    e.preventDefault();
    clearBanners();
    if (pw.next.length < 8) { setError('New password must be at least 8 characters.'); return; }
    if (pw.next !== pw.confirm) { setError('Those passwords do not match.'); return; }
    setBusy('password');
    try {
      const { error } = await supabase.auth.updateUser({ password: pw.next });
      if (error) throw error;
      setPw({ next: '', confirm: '' });
      setNotice('Password changed.');
    } catch (e) {
      console.error('changePassword failed:', e);
      setError('Could not change your password. Please try again.');
    } finally {
      setBusy('');
    }
  }

  async function deleteAccount() {
    const phrase = window.prompt(
      'This permanently deletes your account, your Facebook connection, and all stored data. ' +
      'Reports will stop immediately.\n\nType DELETE to confirm.'
    );
    if (phrase === null) return;                 // cancelled
    if (phrase.trim().toUpperCase() !== 'DELETE') {
      setError('Account was not deleted. You need to type DELETE exactly to confirm.');
      return;
    }
    clearBanners();
    setBusy('delete');
    try {
      const session = await getSessionOrRedirect(supabase, router);
      if (!session) return;
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + session.access_token },
      });
      if (!res.ok) {
        setError('Deletion failed. Email info@omnignis.com and we will take care of it.');
        return;
      }
      await supabase.auth.signOut();
      router.replace('/login');
    } catch (e) {
      console.error('deleteAccount failed:', e);
      setError('Could not reach Omnignis. Check your connection and try again.');
    } finally {
      setBusy('');
    }
  }

  async function signOut() {
    try { await supabase.auth.signOut(); } catch (e) { console.error(e); }
    router.replace('/login');
  }

  const topbar = (
    <div className="topbar reveal">
      <div className="brand"><span className="dot" /><span className="name">OMNIGNIS</span></div>
      <nav>
        <a href="/dashboard">Dashboard</a>
        <a href="/account" className="active">My account</a>
        <span className="sep" aria-hidden="true" />
        <a className="ext" href="https://omnignis.com">Omnignis home</a>
        <button className="signout" onClick={signOut}>Sign out</button>
      </nav>
    </div>
  );

  if (loadError) {
    return (
      <div className="wrap-wide">
        {topbar}
        <div className="error reveal" role="alert">
          {loadError} <button className="linklike" onClick={load}>Retry</button>
        </div>
        <AppFooter />
      </div>
    );
  }

  if (!form) {
    return (
      <div className="wrap center">
        <div className="brand"><span className="dot" /><span className="name">OMNIGNIS</span></div>
        <p className="muted" role="status"><span className="spinner" /> Loading your settings</p>
      </div>
    );
  }

  return (
    <div className="wrap-wide">
      {topbar}

      <div className="reveal d2" style={{ marginBottom: 24 }}>
        <p className="kicker">Settings</p>
        <h1>My <span className="em">account</span></h1>
      </div>

      {error && <div className="error reveal" role="alert">{error}</div>}
      {notice && <div className="notice reveal" role="status">{notice}</div>}

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
            <label htmlFor="freq">How often</label>
            <select id="freq" value={form.report_frequency || 'weekly'} onChange={e => set('report_frequency', e.target.value)}>
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
            </select>
          </div>

          {(form.report_frequency || 'weekly') === 'weekly' && (
            <div className="field">
              <label htmlFor="wd">Which day</label>
              <select id="wd" value={String(form.send_weekday ?? 6)} onChange={e => set('send_weekday', e.target.value)}>
                {WEEKDAYS.map(d => <option key={d.v} value={d.v}>{d.label}</option>)}
              </select>
              <p className="hint">Many churches pick Monday so the report covers the whole weekend.</p>
            </div>
          )}

          <div className="field">
            <label htmlFor="hour">What time</label>
            <select id="hour" value={String(form.send_hour ?? 13)} onChange={e => set('send_hour', e.target.value)}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{hourLabel(h)}</option>
              ))}
            </select>
            <p className="hint">
              Your local time. Reports go out within the hour you choose.
              {(form.report_frequency || 'weekly') === 'monthly' && ' Monthly reports send on the 1st.'}
            </p>
          </div>

          <div className="field">
            <label htmlFor="tz">Time zone</label>
            <select id="tz" value={form.timezone || 'America/Chicago'} onChange={e => set('timezone', e.target.value)}>
              <optgroup label="Common">
                {COMMON_ZONES.map(z => <option key={z} value={z}>{z.replace('_', ' ')}</option>)}
              </optgroup>
              {allZones().length > 0 && (
                <optgroup label="All time zones">
                  {allZones().map(z => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
                </optgroup>
              )}
            </select>
            <p className="hint">
              This also sets the dates on your report. Without it, an evening service
              would be dated the following day.
            </p>
          </div>

          <div className="field">
            <label>File formats</label>
            <div className="fmt-grid">
              {FORMATS.map(f => {
                const on = chosenFormats.includes(f.key);
                return (
                  <label key={f.key} className={'fmt' + (on ? ' on' : '')}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleFormat(f.key)}
                    />
                    <span className="fmt-box">
                      <span className="fmt-label">{f.label}</span>
                      <span className="fmt-hint">{f.hint}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="hint">
              Pick as many as you like. Each one is attached to the same email.
            </p>
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

      <AppFooter />
    </div>
  );
}
