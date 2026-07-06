'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      router.replace(data.session ? '/dashboard' : '/login');
    });
  }, [router]);
  return (
    <div className="wrap center">
      <div className="brand"><span className="dot" /><span className="name">OMNIGNIS</span></div>
      <p className="muted"><span className="spinner" /> Loading…</p>
    </div>
  );
}
