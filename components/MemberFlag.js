'use client';
// Publishes a cross-subdomain hint so omnignis.com can offer "My account"
// instead of "Sign in" to someone who is already signed in here.
//
// The cookie carries NO token and no identifiers. It is a single "1" meaning
// "this browser has a portal session", which is why it is readable by
// JavaScript on the marketing site. Worst case if it goes stale: the member
// clicks "My account" and /dashboard bounces them to /login, which then
// redirects them straight back in.
import { useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

const NAME = 'omnignis_member';
const MAX_AGE = 60 * 60 * 24 * 30;      // 30 days

function publish(signedIn) {
  try {
    const host = window.location.hostname;
    // Domain=.omnignis.com is meaningless on localhost, and browsers reject it.
    if (!/(^|\.)omnignis\.com$/.test(host)) return;
    const base = `${NAME}=${signedIn ? '1' : ''}; Domain=.omnignis.com; Path=/; Secure; SameSite=Lax`;
    document.cookie = signedIn ? `${base}; Max-Age=${MAX_AGE}` : `${base}; Max-Age=0`;
  } catch (e) {
    // Never let a cosmetic nav hint break the app.
    console.error('member flag failed:', e);
  }
}

export default function MemberFlag() {
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession()
      .then(({ data }) => { if (!cancelled) publish(!!(data && data.session)); })
      .catch(() => {});
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      publish(!!session);
    });
    return () => {
      cancelled = true;
      if (data && data.subscription) data.subscription.unsubscribe();
    };
  }, []);
  return null;
}
