// Este arquivo cria a "conexão" com o banco de dados (Supabase).
// As duas informações abaixo (URL e chave) NÃO ficam escritas aqui dentro —
// elas vêm de "variáveis de ambiente", configuradas no painel do Netlify.
// Isso é importante por segurança: assim, ninguém que olhar o código no
// GitHub consegue ver essas informações.

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
