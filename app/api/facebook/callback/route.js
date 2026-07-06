// GET /api/facebook/callback?code=...&state=...
// Facebook redirects here after the church approves. We validate the CSRF state,
// exchange the code for a long-lived user token, and either finish the connection
// (one page) or send them to the page picker (multiple pages).
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { encryptToken } from '../../../../lib/crypto';

export const dynamic = 'force-dynamic';

const STATE_TTL_MS = 10 * 60 * 1000;

function graph(path, params) {
  const v = process.env.GRAPH_API_VERSION || 'v21.0';
  const qs = new URLSearchParams(params).toString();
  return fetch(`https://graph.facebook.com/${v}${path}?${qs}`).then(r => r.json());
}

function proofFor(token) {
  return crypto.createHmac('sha256', process.env.FACEBOOK_APP_SECRET).update(token).digest('hex');
}

function fail(msg) {
  const to = `${process.env.PORTAL_URL}/dashboard?fb_error=${encodeURIComponent(msg)}`;
  return NextResponse.redirect(to);
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  if (searchParams.get('error')) {
    return fail('Facebook connection was cancelled. Nothing was stored.');
  }
  if (!code || !state) return fail('Facebook did not return a valid response. Try again.');

  const admin = supabaseAdmin();

  // Validate + consume the CSRF state (single use, 10-minute TTL).
  const { data: st } = await admin.from('oauth_states').select('profile_id,created_at').eq('state', state).maybeSingle();
  if (st) await admin.from('oauth_states').delete().eq('state', state);
  if (!st) return fail('That connection attempt expired or was already used. Try again.');
  if (Date.now() - new Date(st.created_at).getTime() > STATE_TTL_MS) {
    return fail('That connection attempt expired. Try again.');
  }
  const profileId = st.profile_id;

  try {
    const redirectUri = `${process.env.PORTAL_URL}/api/facebook/callback`;

    // 1. Code -> short-lived user token
    const tok = await graph('/oauth/access_token', {
      client_id: process.env.FACEBOOK_APP_ID,
      client_secret: process.env.FACEBOOK_APP_SECRET,
      redirect_uri: redirectUri,
      code,
    });
    if (!tok.access_token) throw new Error(tok.error?.message || 'Token exchange failed.');

    // 2. Short-lived -> long-lived user token (page tokens derived from it don't expire)
    const ll = await graph('/oauth/access_token', {
      grant_type: 'fb_exchange_token',
      client_id: process.env.FACEBOOK_APP_ID,
      client_secret: process.env.FACEBOOK_APP_SECRET,
      fb_exchange_token: tok.access_token,
    });
    const userToken = ll.access_token || tok.access_token;

    // 3. Who is this? (needed for revoke-on-disconnect and the deletion webhook)
    const me = await graph('/me', { access_token: userToken, appsecret_proof: proofFor(userToken), fields: 'id' });
    if (!me.id) throw new Error(me.error?.message || 'Could not read the Facebook user.');

    // 4. Which pages did they grant?
    const accounts = await graph('/me/accounts', {
      access_token: userToken,
      appsecret_proof: proofFor(userToken),
      fields: 'id,name,access_token',
      limit: 100,
    });
    const pages = accounts.data || [];

    const base = {
      profile_id: profileId,
      fb_user_id: me.id,
      user_token_ciphertext: encryptToken(userToken),
      connected_at: new Date().toISOString(),
    };

    if (pages.length === 1) {
      // One page: finish the whole connection right now.
      const p = pages[0];
      await admin.from('facebook_connections').upsert({
        ...base,
        page_id: p.id,
        page_name: p.name,
        token_ciphertext: encryptToken(p.access_token),
      });
      return NextResponse.redirect(`${process.env.PORTAL_URL}/dashboard?connected=1`);
    }

    // Zero or many pages: store the user token and let them pick.
    await admin.from('facebook_connections').upsert({
      ...base,
      page_id: null,
      page_name: null,
      token_ciphertext: null,
    });
    return NextResponse.redirect(`${process.env.PORTAL_URL}/select-page`);
  } catch (e) {
    console.error('FB callback error:', e);
    return fail('Facebook connection failed: ' + (e.message || 'unknown error'));
  }
}
