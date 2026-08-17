// POST /api/report/send-now
// Triggers the existing GitHub Actions report job for the signed-in church only.
//
// We deliberately reuse report.py rather than reimplementing the Graph API,
// XLSX and email logic in JS. A second implementation would drift from the
// scheduled one and every bug would need fixing twice.
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../../../lib/serverAuth';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

const COOLDOWN_MS = 60 * 60 * 1000;               // one hour
const DEFAULT_REPO = 'omnignis/omnignis-portal';
const WORKFLOW_FILE = 'report.yml';

export async function POST(request) {
  const user = await getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) {
    console.error('GITHUB_DISPATCH_TOKEN is not set; on-demand reports are disabled.');
    return NextResponse.json({
      error: 'On-demand reports are not configured yet. Please email info@omnignis.com.',
    }, { status: 500 });
  }

  const admin = supabaseAdmin();

  // The church must have a finished connection, otherwise the job would fail
  // in CI with nothing useful shown to the user.
  const { data: conn, error: connErr } = await admin
    .from('facebook_connections')
    .select('page_id,token_ciphertext')
    .eq('profile_id', user.id)
    .maybeSingle();
  if (connErr) {
    console.error('send-now connection lookup failed:', connErr);
    return NextResponse.json({ error: 'Could not check your Facebook connection.' }, { status: 500 });
  }
  if (!conn || !conn.page_id || !conn.token_ciphertext) {
    return NextResponse.json({
      error: 'Connect a Facebook page first, then you can send a report on demand.',
    }, { status: 400 });
  }

  // Server-side rate limit. The column is not in the authenticated UPDATE
  // grant, so a client cannot clear its own cooldown.
  const { data: prof, error: profErr } = await admin
    .from('profiles').select('last_manual_report_at').eq('id', user.id).maybeSingle();
  if (profErr) {
    console.error('send-now profile lookup failed:', profErr);
    return NextResponse.json({ error: 'Could not check your account.' }, { status: 500 });
  }
  if (prof && prof.last_manual_report_at) {
    const elapsed = Date.now() - new Date(prof.last_manual_report_at).getTime();
    if (elapsed < COOLDOWN_MS) {
      const minutes = Math.max(1, Math.ceil((COOLDOWN_MS - elapsed) / 60000));
      return NextResponse.json({
        error: `You already requested a report recently. You can send another in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        retryAfterMinutes: minutes,
      }, { status: 429 });
    }
  }

  const repo = process.env.GITHUB_REPO || DEFAULT_REPO;
  const ref = process.env.GITHUB_REF_NAME || 'main';

  let res;
  try {
    res = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref,
          inputs: { profile_id: user.id, mode: 'latest' },
        }),
      }
    );
  } catch (e) {
    console.error('GitHub dispatch request failed:', e);
    return NextResponse.json({ error: 'Could not start the report. Please try again.' }, { status: 502 });
  }

  // A successful workflow_dispatch returns 204 with no body.
  if (res.status !== 204) {
    const detail = await res.text().catch(() => '');
    console.error('GitHub dispatch rejected:', res.status, detail.slice(0, 500));
    return NextResponse.json({ error: 'Could not start the report. Please try again.' }, { status: 502 });
  }

  // Stamp the cooldown only after the job was actually accepted.
  const { error: stampErr } = await admin
    .from('profiles')
    .update({ last_manual_report_at: new Date().toISOString() })
    .eq('id', user.id);
  if (stampErr) console.error('send-now cooldown stamp failed:', stampErr);

  return NextResponse.json({ ok: true });
}
