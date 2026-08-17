'use client';
// Public pages (/login, /signup) must not show a form to someone who is already
// authenticated. Every link from omnignis.com points at /login, so a signed-in
// church clicking "Sign in" was handed the form again and assumed the session
// had expired. It had not: the page simply never checked.
import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

export function useRedirectIfSignedIn(router, to = '/dashboard') {
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!cancelled && data && data.session) {
          router.replace(to);
          return;                       // stay in "checking" so no form flashes
        }
      } catch (e) {
        console.error('Session check failed:', e);
      }
      if (!cancelled) setChecking(false);
    })();
    return () => { cancelled = true; };
  }, [router, to]);

  return checking;
}
