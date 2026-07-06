// POST /api/facebook/start
// Creates a short-lived CSRF state and returns the Facebook OAuth dialog URL.
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../../../lib/serverAuth';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

const SCOPES = 'pages_show_list,pages_read_engagement,read_insights';

export async function POST(request) {
  const user = await getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const admin = supabaseAdmin();
  const state = crypto.randomBytes(24).toString('hex');

  // Clear any stale states for this user, then insert the new one.
  await admin.from('oauth_states').delete().eq('profile_id', user.id);
  const { error } = await admin.from('oauth_states').insert({ state, profile_id: user.id });
  if (error) return NextResponse.json({ error: 'Could not start the connection.' }, { status: 500 });

  const v = process.env.GRAPH_API_VERSION || 'v21.0';
  const redirectUri = `${process.env.PORTAL_URL}/api/facebook/callback`;
  const url =
    `https://www.facebook.com/${v}/dialog/oauth` +
    `?client_id=${encodeURIComponent(process.env.FACEBOOK_APP_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}` +
    `&scope=${encodeURIComponent(SCOPES)}`;

  return NextResponse.json({ url });
}
