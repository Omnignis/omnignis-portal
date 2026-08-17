// POST /api/facebook/start
// Creates a short-lived CSRF state and returns the Facebook OAuth dialog URL.
//
// The state is stored in two places that must agree at callback time:
//   1. the oauth_states table, which maps state -> profile_id
//   2. an HttpOnly cookie on this browser
// Requiring both means a state minted by one account cannot be completed in a
// different browser, which is what stops an attacker from binding a victim's
// Facebook page to the attacker's portal account.
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../../../lib/serverAuth';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { portalBaseUrl } from '../../../../lib/portalUrl';

export const dynamic = 'force-dynamic';

const SCOPES = 'pages_show_list,pages_read_engagement,read_insights';
export const STATE_COOKIE = 'fb_oauth_state';
const STATE_TTL_SECONDS = 600;

export async function POST(request) {
  const user = await getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  // Fail loudly on missing config. Without this, an unset FACEBOOK_APP_ID
  // produced client_id=undefined and Facebook answered with a bare
  // "Invalid App ID" page that says nothing about the real cause.
  const missing = ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET']
    .filter(k => !process.env[k]);
  const { url: portal, problem } = portalBaseUrl();
  if (missing.length || problem) {
    const detail = [missing.length ? 'missing: ' + missing.join(', ') : null, problem]
      .filter(Boolean).join('; ');
    console.error('Facebook connect is misconfigured.', detail);
    return NextResponse.json({
      error: 'Facebook connections are not configured yet. Please email info@omnignis.com.',
    }, { status: 500 });
  }

  const admin = supabaseAdmin();
  const state = crypto.randomBytes(24).toString('hex');

  // Clear any stale states for this user, then insert the new one.
  await admin.from('oauth_states').delete().eq('profile_id', user.id);
  const { error } = await admin.from('oauth_states').insert({ state, profile_id: user.id });
  if (error) {
    console.error('oauth_states insert failed:', error);
    return NextResponse.json({ error: 'Could not start the connection.' }, { status: 500 });
  }

  const v = process.env.GRAPH_API_VERSION || 'v21.0';
  const redirectUri = `${portal}/api/facebook/callback`;
  const url =
    `https://www.facebook.com/${v}/dialog/oauth` +
    `?client_id=${encodeURIComponent(process.env.FACEBOOK_APP_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}` +
    `&scope=${encodeURIComponent(SCOPES)}`;

  const res = NextResponse.json({ url });
  // SameSite=Lax still sends this on the top-level GET redirect back from
  // facebook.com, which is exactly the navigation the callback receives.
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: STATE_TTL_SECONDS,
  });
  return res;
}
