'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

export default function SelectPage() {
  const router = useRouter();
  const [pages, setPages] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/login'); return; }
      const res = await fetch('/api/facebook/pages', {
        headers: { Authorization: 'Bearer ' + session.access_token },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || 'Could not load your pages.'); setPages([]); return; }
      setPages(body.pages || []);
    })();
  }, [router]);

  async function choose(pageId) {
    setError(''); setBusyId(pageId);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/facebook/select', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ page_id: pageId }),
    });
    setBusyId('');
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || 'Could not connect that page. Try again.');
      return;
    }
    router.replace('/dashboard?connected=1');
  }

  return (
    <div className="wrap">
      <div className="brand reveal"><span className="dot" /><span className="name">OMNIGNIS</span></div>
      <div className="card reveal d2">
        <h1>Choose your <span className="em">page</span></h1>
        <p className="sub">Which Facebook page should we pull livestream numbers from?</p>
        {error && <div className="error">{error}</div>}
        {pages === null && <p className="muted"><span className="spinner" /> Loading your pages…</p>}
        {pages && pages.length === 0 && !error && (
          <p className="muted">
            No pages came back from Facebook. Make sure you granted access to at least one page during
            the connection step, then <a href="/dashboard">try connecting again</a>.
          </p>
        )}
        {pages && pages.map(p => (
          <button key={p.id} className="page-option" onClick={() => choose(p.id)} disabled={!!busyId}>
            {busyId === p.id ? <span className="spinner" /> : <span style={{ color: 'var(--ember)' }}>▸</span>}
            <span>
              {p.name}
              <span className="pid" style={{ display: 'block' }}>Page ID {p.id}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="foot-link reveal d3"><a href="/dashboard">Back to dashboard</a></p>
    </div>
  );
}
