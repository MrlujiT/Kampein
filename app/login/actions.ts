'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { failTo } from '@/lib/campaign';

export async function signIn(form: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(form.get('email') ?? '').trim(),
    password: String(form.get('password') ?? ''),
  });
  if (error) failTo('/login', error.message);
  redirect('/dashboard');
}

export async function signUp(form: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: String(form.get('email') ?? '').trim(),
    password: String(form.get('password') ?? ''),
  });
  if (error) failTo('/login', error.message);
  if (!data.session) {
    redirect('/login?ok=' + encodeURIComponent('Check your email to confirm your account, then sign in.'));
  }
  redirect('/onboarding');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
