// Shared session guard for client pages.
//
// Every action handler used to do `session.access_token` directly. When the
// session had lapsed that threw a TypeError before the handler could clear its
// busy flag, leaving the button disabled with a spinner forever.
export async function getSessionOrRedirect(supabase, router) {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data || !data.session) {
      router.replace('/login');
      return null;
    }
    return data.session;
  } catch (e) {
    console.error('getSession failed:', e);
    router.replace('/login');
    return null;
  }
}
