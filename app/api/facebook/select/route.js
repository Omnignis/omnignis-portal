// POST /api/facebook/select { page_id }
// Confirms the chosen page belongs to this connection, then stores its
// encrypted page token to complete the setup.
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../../../lib/serverAuth';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { encryptToken, decryptToken } from '../../../../lib/crypto';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const user = await getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const pageId = String(body.page_id || '');
  if (!pageId) return NextResponse.json({ error: 'Missing page_id.' }, { status: 400 });

  const admin = supabaseAdmin();
  const { data: conn } = await admin.from('facebook_connections')
    .select('user_token_ciphertext').eq('profile_id', user.id).maybeSingle();
  if (!conn?.user_token_ciphertext) {
    return NextResponse.json({ error: 'No Facebook connection in progress.' }, { status: 400 });
  }

  try {
    const userToken = decryptToken(conn.user_token_ciphertext);
    const proof = crypto.createHmac('sha256', process.env.FACEBOOK_APP_SECRET).update(userToken).digest('hex');
    const v = process.env.GRAPH_API_VERSION || 'v21.0';
    const qs = new URLSearchParams({ access_token: userToken, appsecret_proof: proof, fields: 'id,name,access_token', limit: '100' });
    const res = await fetch(`https://graph.facebook.com/${v}/me/accounts?${qs}`).then(r => r.json());
    if (res.error) throw new Error(res.error.message);

    const page = (res.data || []).find(p => p.id === pageId);
    if (!page) return NextResponse.json({ error: 'That page isn\u2019t part of this connection.' }, { status: 403 });

    const { error } = await admin.from('facebook_connections').update({
      page_id: page.id,
      page_name: page.name,
      token_ciphertext: encryptToken(page.access_token),
      connected_at: new Date().toISOString(),
    }).eq('profile_id', user.id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('FB select error:', e);
    return NextResponse.json({ error: 'Could not connect that page. Try again.' }, { status: 502 });
  }
}
