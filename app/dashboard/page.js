'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { getSessionOrRedirect } from '../../lib/session';
import AppFooter from '../../components/AppFooter';

const FREQ_LABEL = { daily: 'Daily', weekly: 'Weekly (Sundays)', monthly: 'Monthly (1st)' };

const MANUAL_COOLDOWN_MS = 60 * 60 * 1000;

function cooldownMinutesLeft(iso) {
  if (!iso) return 0;
  const left = MANUAL_COOLDOWN_MS - (Date.now() - new Date(iso).getTime());
  return left > 0 ? Math.ceil(left / 60000) : 0;
}

function formatWhen(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    + ' at ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function Dashboard() {
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [connection, setConnection] = useState(undefined); // undefined = loading, null = none
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [manualAt, setManualAt] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected')) setNotice('Facebook page connected. Your reports are ready to run on schedule.');
    // URLSearchParams already percent-decodes. Decoding again threw URIError on
    // any message containing a stray %, which white-screened the page.
    if (params.get('fb_error')) setError(params.get('fb_error'));
    if (params.get('connected') || params.get('fb_error')) {
      router.replace('/dashboard', { scroll: false });
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoadError('');
    const session = await getSessionOrRedirect(supabase, router);
    if (!session) return;
    try {
      const [profRes, connRes] = await Promise.all([
        supabase.from('profiles')
          .select('church_name,destination_emails,report_frequency,last_report_at,last_manual_report_at').single(),
        // token_ciphertext is deliberately NOT selected. Connection state is
        // derived from page_id, so the encrypted token never reaches the browser.
        supabase.from('facebook_connections')
          .select('page_id,page_name,connected_at').maybeSingle(),
      ]);
      if (profRes.error) throw profRes.error;
      if (connRes.error) throw connRes.error;
      setProfile(profRes.data || null);
      setManualAt((profRes.data && profRes.data.last_manual_report_at) || null);
      setConnection(connRes.data || null);
    } catch (e) {
      console.error('Dashboard load failed:', e);
      setLoadError('We could not load your dashboard. Check your connection and try again.');
      setConnection(null);
    }
  }

  const loading = connection === undefined && !loadError;
  const connected = !!(connection && connection.page_id);
  const partial = !!(connection && !connection.page_id); // OAuth done, page not picked yet

  async function connect() {
    setError(''); setNotice(''); setBusy('connect');
    try {
      const session = await getSessionOrRedirect(supabase, router);
      if (!session) return;
      const res = await fetch('/api/facebook/start', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + session.access_token },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) {
        setError(body.error || 'Could not start the Facebook connection. Please try again.');
        return;
      }
      window.location.href = body.url;
    } catch (e) {
      console.error('connect failed:', e);
      setError('Could not reach Omnignis. Check your connection and try again.');
    } finally {
      setBusy('');
    }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect your Facebook page? We will revoke and delete the stored access token, and reports will stop until you reconnect.')) return;
    setError(''); setNotice(''); setBusy('disconnect');
    try {
      const session = await getSessionOrRedirect(supabase, router);
      if (!session) return;
      const res = await fetch('/api/facebook/disconnect', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + session.access_token },
      });
      if (!res.ok) {
        setError('Disconnect failed. Please try again, or email info@omnignis.com.');
        return;
      }
      setNotice('Facebook page disconnected. The stored token has been deleted.');
      setConnection(null);
    } catch (e) {
      console.error('disconnect failed:', e);
      setError('Could not reach Omnignis. Check your connection and try again.');
    } finally {
      setBusy('');
    }
  }

  async function sendNow() {
    setError(''); setNotice(''); setBusy('sendnow');
    try {
      const session = await getSessionOrRedirect(supabase, router);
      if (!session) return;
      const res = await fetch('/api/report/send-now', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + session.access_token },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || 'Could not start the report. Please try again.');
        return;
      }
      setManualAt(new Date().toISOString());
      setNotice('Report requested. It is generating now and will arrive by email in a few minutes.');
    } catch (e) {
      console.error('sendNow failed:', e);
      setError('Could not reach Omnignis. Check your connection and try again.');
    } finally {
      setBusy('');
    }
  }

  async function signOut() {
    try { await supabase.auth.signOut(); } catch (e) { console.error(e); }
    router.replace('/login');
  }

  const statusLabel = connected ? 'CONNECTED' : partial ? 'ACTION NEEDED' : 'NOT CONNECTED';
  const lastReport = formatWhen(profile && profile.last_report_at);
  const cooldown = cooldownMinutesLeft(manualAt);

  return (
    <div className="wrap-wide">
      <div className="topbar reveal">
        <div className="brand"><span className="dot" /><span className="name">OMNIGNIS</span></div>
        <nav>
          <a href="/dashboard" className="active">Dashboard</a>
          <a href="/account">My account</a>
          <span className="sep" aria-hidden="true" />
          <a className="ext" href="https://omnignis.com">Omnignis home</a>
          <button className="signout" onClick={signOut}>Sign out</button>
        </nav>
      </div>

      <header className="reveal d2" style={{ marginBottom: 22 }}>
        <p className="kicker">Dashboard</p>
        <h1 aria-busy={loading ? 'true' : 'false'}>
          {loading
            ? <span className="skel" aria-hidden="true">Loading church name</span>
            : (profile && profile.church_name) || 'Your church'}
        </h1>
      </header>

      {loadError && (
        <div className="error reveal" role="alert">
          {loadError}{' '}
          <button className="linklike" onClick={load}>Retry</button>
        </div>
      )}
      {error && <div className="error reveal" role="alert">{error}</div>}
      {notice && <div className="notice reveal" role="status">{notice}</div>}

      <section className="card reveal d2">
        <div className="card-head">
          <div>
            <h2>Facebook page</h2>
            <p className="muted" style={{ marginTop: 2 }}>
              {loading
                ? 'Checking your connection.'
                : loadError
                  ? 'We could not check your connection.'
                  : connected
                    ? <>Reporting on <b style={{ color: 'var(--cream)' }}>{connection.page_name || connection.page_id}</b></>
                    : partial
                      ? 'One step left. Choose which page to report on.'
                      : 'Connect once, and viewer numbers are pulled automatically after every livestream.'}
            </p>
          </div>
          {!loading && !loadError && (
            <span className={'pill ' + (connected ? 'on' : 'off')}>
              <span className="d" />{statusLabel}
            </span>
          )}
        </div>

        {!loading && !loadError && (
          <>
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
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.09 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.7 4.53-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.95.93-1.95 1.89v2.26h3.32l-.53 3.49h-2.79V24C19.61 23.09 24 18.1 24 12.07z" /></svg>
                      Connect Facebook page
                    </>
                  )}
                </button>
                <p className="hint" style={{ marginTop: 10 }}>
                  You approve this on Facebook&rsquo;s own site. We never see your password, and the access
                  token we receive is stored encrypted.
                </p>
              </>
            )}
          </>
        )}
      </section>

      <section className="card reveal d3">
        <div className="card-head">
          <h2>Reports</h2>
          <a href="/account" style={{ fontSize: 14 }}>Edit settings</a>
        </div>
        <div style={{ marginTop: 10 }} aria-busy={loading ? 'true' : 'false'}>
          <div className="row">
            <span className="k">Frequency</span>
            <span className={'v' + (profile ? '' : ' none')}>
              {loading ? <span className="skel" aria-hidden="true">Weekly</span>
                : profile ? (FREQ_LABEL[profile.report_frequency] || profile.report_frequency) : 'Not set'}
            </span>
          </div>
          <div className="row">
            <span className="k">Sent to</span>
            <span className={'v' + (profile && profile.destination_emails ? '' : ' none')}>
              {loading ? <span className="skel" aria-hidden="true">name@church.org</span>
                : (profile && profile.destination_emails) || 'Not set'}
            </span>
          </div>
          <div className="row">
            <span className="k">Last report</span>
            <span className={'v' + (lastReport ? '' : ' none')}>
              {loading ? <span className="skel" aria-hidden="true">Jan 1, 2026</span> : lastReport || 'None sent yet'}
            </span>
          </div>
        </div>

        {!loading && !loadError && (
          <>
            <div className="divider" />
            <button
              className="btn btn-ghost"
              onClick={sendNow}
              disabled={!connected || !!busy || cooldown > 0}
            >
              {busy === 'sendnow' ? <span className="spinner" /> : 'Send report for my last livestream'}
            </button>
            <p className="hint" style={{ marginTop: 10 }}>
              {!connected
                ? 'Connect a Facebook page first, then you can send a report whenever you like.'
                : cooldown > 0
                  ? `You can send another on-demand report in ${cooldown} minute${cooldown === 1 ? '' : 's'}.`
                  : 'Covers your most recent livestream only. Your scheduled reports are not affected.'}
            </p>
          </>
        )}
      </section>

      <AppFooter />
    </div>
  );
}
