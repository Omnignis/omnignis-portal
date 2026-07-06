// Resolve the signed-in user from a "Authorization: Bearer <supabase access token>"
// header on an API route. Returns the auth user or null.
import { supabaseAdmin } from './supabaseAdmin';

export async function getUserFromRequest(request) {
  const header = request.headers.get('authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await supabaseAdmin().auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}
