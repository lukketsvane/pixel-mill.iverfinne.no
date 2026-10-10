import {createStorageHandler} from '../../../worker/storage-service.mjs';

const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
Deno.serve(createStorageHandler({url:Deno.env.get('SUPABASE_URL'),secretKey:keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}));
