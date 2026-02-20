import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const createDbClient = (url: string, key: string): SupabaseClient => {
    if (!url || !key) {
        throw new Error("createDbClient: Missing Supabase URL or Key");
    }

    return createClient(url, key, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
        }
    });
};
