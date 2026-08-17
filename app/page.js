'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import Brand from '../components/Brand';

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      router.replace(data.session ? '/dashboard' : '/login');
    });
  }, [router]);
  return (
    <div className="wrap center">
      <Brand />
      <p className="muted"><span className="spinner" /> Loading…</p>
    </div>
  );
}
