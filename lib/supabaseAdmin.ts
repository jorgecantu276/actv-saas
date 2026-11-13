import { createClient } from '@supabase/supabase-js';

// Este cliente TIENE PODER ABSOLUTO y solo corre en el servidor.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Nota que no tiene "NEXT_PUBLIC" para que no se filtre al navegador
);