// POST /api/facebook/data-deletion
// Meta's Data Deletion Request callback. Facebook POSTs a signed_request when a
// user removes the app from Business Integrations. We verify the signature,
// delete every connection tied to that Facebook user, and return the status URL
// + confirmation code Meta requires.
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

function b64urlToBuffer(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function parseSignedRequest(signedRequest, appSecret) {
  const parts = String(signedRequest).split('.');
  if (parts.length !== 2) return null;
  const [encodedSig, payload] = parts;
  const expected = crypto.createHmac('sha256', appSecret).update(payload).digest();
  const given = b64urlToBuffer(encodedSig);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(b64urlToBuffer(payload).toString('utf8'));
  } catch {
    return null;
  }
}

export async function POST(request) {
  let signedRequest = '';
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    signedRequest = form.get('signed_request') || '';
  } else {
    const body = await request.json().catch(() => ({}));
    signedRequest = body.signed_request || '';
  }

  const data = parseSignedRequest(signedRequest, process.env.FACEBOOK_APP_SECRET);
  if (!data?.user_id) {
    return NextResponse.json({ error: 'Invalid signed_request.' }, { status: 400 });
  }

  const admin = supabaseAdmin();
  await admin.from('facebook_connections').delete().eq('fb_user_id', String(data.user_id));

  const confirmationCode = crypto.randomBytes(8).toString('hex');
  return NextResponse.json({
    url: `https://omnignis.com/data-deletion.html?code=${confirmationCode}`,
    confirmation_code: confirmationCode,
  });
}
