// GET /api/facebook/pages — list the pages the signed-in church granted us.
// Only id + name are ever sent to the browser; tokens stay server-side.
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../../../lib/serverAuth';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { decryptToken } from '../../../../lib/crypto';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const user = await getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const admin = supabaseAdmin();
  const { data: conn } = await admin.from('facebook_connections')
    .select('user_token_ciphertext').eq('profile_id', user.id).maybeSingle();
  if (!conn?.user_token_ciphertext) {
    return NextResponse.json({ error: 'No Facebook connection in progress. Start from the dashboard.' }, { status: 400 });
  }

  try {
    const userToken = decryptToken(conn.user_token_ciphertext);
    const proof = crypto.createHmac('sha256', process.env.FACEBOOK_APP_SECRET).update(userToken).digest('hex');
    const v = process.env.GRAPH_API_VERSION || 'v21.0';
    const qs = new URLSearchParams({ access_token: userToken, appsecret_proof: proof, fields: 'id,name', limit: '100' });
    const res = await fetch(`https://graph.facebook.com/${v}/me/accounts?${qs}`).then(r => r.json());
    if (res.error) throw new Error(res.error.message);
    return NextResponse.json({ pages: (res.data || []).map(p => ({ id: p.id, name: p.name })) });
  } catch (e) {
    console.error('FB pages error:', e);
    return NextResponse.json({ error: 'Could not load pages from Facebook. Try reconnecting.' }, { status: 502 });
  }
}
