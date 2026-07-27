# Sistema Hoteleiro

Primeira versão real do sistema de gestão hoteleira, conectada a um banco de dados de verdade (Supabase).

## O que já funciona

- **Agenda Telefônica** (`/agenda`): lista e cadastra contatos, salvando de verdade no banco de dados.

## Como este projeto se conecta ao banco de dados

O arquivo `lib/supabaseClient.js` usa duas variáveis de ambiente:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Essas variáveis são configuradas no painel do Netlify (Site settings → Environment variables), nunca escritas diretamente no código.

## Próximos módulos

Este é o primeiro módulo migrado do protótipo original. Os demais módulos serão adicionados aos poucos, um de cada vez.
