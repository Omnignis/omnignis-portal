'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

const FREQ_LABEL = { daily: 'Daily', weekly: 'Weekly (Sundays)', monthly: 'Monthly (1st)' };

export default function Dashboard() {
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [connection, setConnection] = useState(undefined); // undefined = loading, null = none
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected')) setNotice('Facebook page connected. Your reports are ready to run on schedule.');
    if (params.get('fb_error')) setError(decodeURIComponent(params.get('fb_error')));
    if (params.get('connected') || params.get('fb_error')) {
      window.history.replaceState({}, '', '/dashboard');
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.replace('/login'); return; }
    const [{ data: prof }, { data: conn }] = await Promise.all([
      supabase.from('profiles').select('church_name,destination_emails,report_frequency,last_report_at').single(),
      supabase.from('facebook_connections').select('page_id,page_name,connected_at,token_ciphertext').maybeSingle(),
    ]);
    setProfile(prof || null);
    setConnection(conn || null);
  }

  const connected = !!(connection && connection.token_ciphertext && connection.page_id);
  const partial = !!(connection && !connected); // OAuth done, page not picked yet

  async function connect() {
    setError(''); setBusy('connect');
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/facebook/start', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + session.access_token },
    });
    const body = await res.json().catch(() => ({}));
    setBusy('');
    if (!res.ok || !body.url) { setError(body.error || 'Could not start the Facebook connection. Try again.'); return; }
    window.location.href = body.url;
  }

  async function disconnect() {
    if (!window.confirm('Disconnect your Facebook page? We\u2019ll revoke and delete the stored access token, and reports will stop until you reconnect.')) return;
    setError(''); setBusy('disconnect');
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/facebook/disconnect', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + session.access_token },
    });
    setBusy('');
    if (!res.ok) { setError('Disconnect failed. Try again, or email info@omnignis.com.'); return; }
    setNotice('Facebook page disconnected. The stored token has been deleted.');
    setConnection(null);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  return (
    <div className="wrap-wide">
      <div className="topbar reveal">
        <div className="brand"><span className="dot" /><span className="name">OMNIGNIS</span></div>
        <nav>
          <a href="/dashboard" className="active">Dashboard</a>
          <a href="/account">My account</a>
          <button className="signout" onClick={signOut}>Sign out</button>
        </nav>
      </div>

      <div className="reveal d2" style={{ marginBottom: 24 }}>
        <p className="kicker">Dashboard</p>
        <h1>{profile ? profile.church_name : '\u00A0'}</h1>
      </div>

      {error && <div className="error reveal">{error}</div>}
      {notice && <div className="notice reveal">{notice}</div>}

      <div className="card reveal d2">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div>
            <h2>Facebook page</h2>
            <p className="muted" style={{ marginTop: 2 }}>
              {connected
                ? <>Connected to <b style={{ color: 'var(--cream)' }}>{connection.page_name || connection.page_id}</b></>
                : partial
                  ? 'Almost there — pick which page to report on.'
                  : 'Connect once, and viewer numbers are pulled automatically after every livestream.'}
            </p>
          </div>
          <span className={'pill ' + (connected ? 'on' : 'off')}>
            <span className="d" />{connected ? 'CONNECTED' : partial ? 'CHOOSE PAGE' : 'NOT CONNECTED'}
          </span>
        </div>
        <div className="divider" />
        {connected ? (
          <button className="btn btn-danger" onClick={disconnect} disabled={busy === 'disconnect'}>
            {busy === 'disconnect' ? <span className="spinner" /> : 'Disconnect Facebook page'}
          </button>
        ) : partial ? (
          <a className="btn btn-ember" href="/select-page" style={{ textDecoration: 'none' }}>Choose your page</a>
        ) : (
          <>
            <button className="btn btn-fb" onClick={connect} disabled={busy === 'connect'}>
              {busy === 'connect' ? <span className="spinner" /> : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.09 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.7 4.53-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.95.93-1.95 1.89v2.26h3.32l-.53 3.49h-2.79V24C19.61 23.09 24 18.1 24 12.07z"/></svg>
                  Connect Facebook page
                </>
              )}
            </button>
            <p className="hint" style={{ marginTop: 10 }}>
              You&rsquo;ll approve this on Facebook&rsquo;s own site — we never see your password, and the access
              token we receive is stored encrypted.
            </p>
            <div className="info">
              <b style={{ color: 'var(--cream)' }}>Heads up:</b> our Facebook app is currently under review by Meta.
              Until that clears, connections work for invited pages only. If yours fails, email{' '}
              <a href="mailto:info@omnignis.com">info@omnignis.com</a> and we&rsquo;ll enable your page right away.
            </div>
          </>
        )}
      </div>

      <div className="card reveal d3">
        <h2>Reports</h2>
        <div className="row"><span className="k">Frequency</span><span className="v">{profile ? (FREQ_LABEL[profile.report_frequency] || profile.report_frequency) : '—'}</span></div>
        <div className="row"><span className="k">Sent to</span><span className="v">{profile ? profile.destination_emails : '—'}</span></div>
        <div className="row"><span className="k">Last report</span><span className="v">{profile && profile.last_report_at ? new Date(profile.last_report_at).toLocaleString() : 'None yet'}</span></div>
        <p className="muted" style={{ marginTop: 14 }}>
          Change the schedule or recipients any time in <a href="/account">My account</a>.
        </p>
      </div>
    </div>
  );
}
