// ============================================================================
// FUNÇÃO AGENDADA DA NETLIFY: saídas e chegadas do dia na Governança
// ============================================================================
// Todo dia às 6h (horário de Fortaleza = 9h UTC) busca na Cloudbeds as saídas
// e chegadas de hoje e prepara a lista das camareiras (rota
// /api/governanca-rotina). Usa a mesma senha das outras funções agendadas,
// derivada de CLOUDBEDS_CRYPTO_SECRET — não precisa de variável nova.
// Funções agendadas só rodam no site publicado (não nas prévias de deploy).
// ============================================================================

import crypto from 'crypto';

export default async function rotinaDaGovernanca() {
  const segredo = process.env.CLOUDBEDS_CRYPTO_SECRET;
  const site = process.env.URL;
  if (!segredo || !site) {
    console.log('Governança: faltam as variáveis CLOUDBEDS_CRYPTO_SECRET ou URL.');
    return;
  }
  const senha = crypto.createHmac('sha256', segredo).update('atendimento-sincronizacao-agendada').digest('base64url');
  try {
    const resposta = await fetch(`${site}/api/governanca-rotina`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-atendimento-agendado': senha },
      body: '{}',
    });
    const resultado = await resposta.json().catch(() => ({}));
    console.log('Governança — saídas e chegadas do dia:', resposta.status, JSON.stringify(resultado));
  } catch (e) {
    console.log('Governança — falha:', e.message);
  }
}

export const config = {
  schedule: '0 9 * * *',
};
