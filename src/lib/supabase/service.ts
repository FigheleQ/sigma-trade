// ============================================================
// Supabase service-role client — TYLKO po stronie serwera.
//
// Używany przez zadania w tle (cron DCA), które nie mają sesji użytkownika,
// więc nie mogą polegać na RLS opartym o auth.uid(). Klucz service-role
// OMIJA RLS — dlatego nigdy nie wolno go użyć w kliencie ani zwrócić do
// przeglądarki. Cała filtracja per-portfel musi być jawna w zapytaniach.
// ============================================================
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function createServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL not set');
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set');

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
