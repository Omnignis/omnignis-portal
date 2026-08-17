'use client';
// Route-level error boundary. Without this, any uncaught render or effect error
// showed the church a blank page with Next's default "Application error" text.
import { useEffect } from 'react';
import Brand from '../components/Brand';

export default function Error({ error, reset }) {
  useEffect(() => { console.error('Portal error boundary:', error); }, [error]);

  return (
    <div className="wrap center">
      <Brand />
      <div className="card" style={{ textAlign: 'left' }}>
        <h1>Something went <span className="em">wrong</span></h1>
        <p className="sub">
          That page did not load correctly. This is on our side, not yours.
        </p>
        <div className="btn-row">
          <button className="btn btn-ember" onClick={() => reset()}>Try again</button>
          <a className="btn btn-ghost" href="/dashboard" style={{ textDecoration: 'none' }}>Back to dashboard</a>
        </div>
        <div className="info">
          If this keeps happening, email <a href="mailto:info@omnignis.com">info@omnignis.com</a> and
          we will sort it out.
        </div>
      </div>
    </div>
  );
}
