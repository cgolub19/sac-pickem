// src/supabaseClient.js
import { createClient } from "@supabase/supabase-js";

const url = process.env.REACT_APP_SUPABASE_URL;
const anon = process.env.REACT_APP_SUPABASE_ANON_KEY;

// If you don't have keys yet, you can still run the UI;
// DB calls will simply no-op (see fallback below).
let supabase;

if (url && anon) {
  supabase = createClient(url, anon);
} else {
  console.warn(
    "[supabaseClient] Missing REACT_APP_SUPABASE_URL / REACT_APP_SUPABASE_ANON_KEY; using no-op client."
  );
  // Minimal no-op client so the app doesn't crash when keys are missing.
  supabase = {
    from() {
      return {
        select: async () => ({ data: [], error: null }),
        upsert: async () => ({ data: [], error: null }),
        insert: async () => ({ data: [], error: null }),
        update: async () => ({ data: [], error: null }),
        delete: async () => ({ data: [], error: null }),
        eq() { return this; },
        order() { return this; },
        limit() { return this; },
        single: async () => ({ data: null, error: null }),
      };
    },
  };
}

export { supabase };
