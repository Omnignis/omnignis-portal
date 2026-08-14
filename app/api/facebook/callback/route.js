// GET /api/facebook/callback?code=...&state=...
// Facebook redirects here after the church approves. We validate the CSRF state
// against BOTH the oauth_states table and the HttpOnly cookie set by /start,
// exchange the code for a long-lived user token, and either finish the
// connection (one page) or send them to the page picker (multiple pages).
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { encryptToken } from '../../../../lib/crypto';

export const dynamic = 'force-dynamic';

const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_COOKIE = 'fb_oauth_state';

function graph(path, params) {
  const v = process.env.GRAPH_API_VERSION || 'v21.0';
  const qs = new URLSearchParams(params).toString();
  return fetch(`https://graph.facebook.com/${v}${path}?${qs}`).then(r => r.json());
}

function proofFor(token) {
  return crypto.createHmac('sha256', process.env.FACEBOOK_APP_SECRET).update(token).digest('hex');
}

// Constant-time compare that tolerates differing lengths.
function sameToken(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Every exit from this route clears the state cookie so a stale value can never
// be replayed against a later attempt.
function redirectTo(path) {
  const res = NextResponse.redirect(`${process.env.PORTAL_URL}${path}`);
  res.cookies.set(STATE_COOKIE, '', {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0,
  });
  return res;
}

function fail(msg) {
  return redirectTo(`/dashboard?fb_error=${encodeURIComponent(msg)}`);
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  if (searchParams.get('error')) {
    return fail('Facebook connection was cancelled. Nothing was stored.');
  }
  if (!code || !state) return fail('Facebook did not return a valid response. Please try again.');

  // The cookie proves this is the same browser that started the flow. Without
  // it, anyone could hand a victim a state minted under their own account.
  const cookieState = request.cookies.get(STATE_COOKIE)?.value;
  if (!sameToken(cookieState, state)) {
    console.warn('FB callback: state cookie missing or mismatched');
    return fail('That connection attempt could not be verified. Please start again from your dashboard.');
  }

  const admin = supabaseAdmin();

  // Validate + consume the state row (single use, 10-minute TTL).
  const { data: st, error: stErr } = await admin
    .from('oauth_states').select('profile_id,created_at').eq('state', state).maybeSingle();
  if (stErr) {
    console.error('oauth_states lookup failed:', stErr);
    return fail('We could not verify that connection attempt. Please try again.');
  }
  if (st) await admin.from('oauth_states').delete().eq('state', state);
  if (!st) return fail('That connection attempt expired or was already used. Please try again.');
  if (Date.now() - new Date(st.created_at).getTime() > STATE_TTL_MS) {
    return fail('That connection attempt expired. Please try again.');
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
    // Treat a Graph error as an error. Falling through to an empty list here
    // used to overwrite a working connection with nulls.
    if (accounts.error) throw new Error(accounts.error.message || 'Could not read your Facebook pages.');
    const pages = Array.isArray(accounts.data) ? accounts.data : [];

    // Zero pages is never a reason to touch an existing connection.
    if (pages.length === 0) {
      return fail(
        'Facebook did not return any pages you manage. Make sure you granted access to your church page, then try again.'
      );
    }

    const base = {
      profile_id: profileId,
      fb_user_id: me.id,
      user_token_ciphertext: encryptToken(userToken),
      connected_at: new Date().toISOString(),
    };

    if (pages.length === 1) {
      // One page: finish the whole connection right now.
      const p = pages[0];
      const { error: upErr } = await admin.from('facebook_connections').upsert({
        ...base,
        page_id: p.id,
        page_name: p.name,
        token_ciphertext: encryptToken(p.access_token),
      });
      if (upErr) throw new Error('Could not save the connection: ' + upErr.message);
      return redirectTo('/dashboard?connected=1');
    }

    // Several pages: store the user token and let them pick which one.
    const { error: upErr } = await admin.from('facebook_connections').upsert({
      ...base,
      page_id: null,
      page_name: null,
      token_ciphertext: null,
    });
    if (upErr) throw new Error('Could not save the connection: ' + upErr.message);
    return redirectTo('/select-page');
  } catch (e) {
    // Log the detail, show the church something safe. The old version put
    // e.message straight into the URL, which leaked config errors verbatim.
    console.error('FB callback error:', e);
    return fail('We could not finish connecting your Facebook page. Please try again, or email info@omnignis.com.');
  }
}
