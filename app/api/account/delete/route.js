// POST /api/account/delete
// Self-serve full account deletion: revoke Facebook (best effort), then delete
// the auth user. profiles + facebook_connections + oauth_states cascade via FK.
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../../../lib/serverAuth';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { decryptToken } from '../../../../lib/crypto';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const user = await getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const admin = supabaseAdmin();

  const { data: conn } = await admin.from('facebook_connections')
    .select('fb_user_id,user_token_ciphertext').eq('profile_id', user.id).maybeSingle();
  if (conn?.fb_user_id && conn?.user_token_ciphertext) {
    try {
      const userToken = decryptToken(conn.user_token_ciphertext);
      const proof = crypto.createHmac('sha256', process.env.FACEBOOK_APP_SECRET).update(userToken).digest('hex');
      const v = process.env.GRAPH_API_VERSION || 'v21.0';
      const qs = new URLSearchParams({ access_token: userToken, appsecret_proof: proof });
      await fetch(`https://graph.facebook.com/${v}/${conn.fb_user_id}/permissions?${qs}`, { method: 'DELETE' });
    } catch (e) {
      console.error('FB revoke during account delete failed (continuing):', e);
    }
  }

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return NextResponse.json({ error: 'Could not delete the account.' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
