// ============================================================================
// FUNÇÃO AGENDADA DA NETLIFY: resumo semanal por e-mail para o gestor
// ============================================================================
// Toda segunda às 8h (horário de Fortaleza = 11h UTC) manda, para cada hotel
// com Caixa de Entrada, o resumo da semana anterior (lib/atendimento/resumoSemanal.js).
// Usa a mesma senha das outras funções agendadas, derivada de
// CLOUDBEDS_CRYPTO_SECRET — não precisa de variável nova.
// Funções agendadas só rodam no site publicado (não nas prévias de deploy).
// ============================================================================

import crypto from 'crypto';

export default async function resumoSemanal() {
  const segredo = process.env.CLOUDBEDS_CRYPTO_SECRET;
  const site = process.env.URL;
  if (!segredo || !site) {
    console.log('Resumo semanal: faltam as variáveis CLOUDBEDS_CRYPTO_SECRET ou URL.');
    return;
  }
  const senha = crypto.createHmac('sha256', segredo).update('atendimento-sincronizacao-agendada').digest('base64url');
  try {
    const resposta = await fetch(`${site}/api/atendimento`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-atendimento-agendado': senha },
      body: JSON.stringify({ acao: 'resumo_semanal' }),
    });
    const resultado = await resposta.json().catch(() => ({}));
    console.log('Resumo semanal:', resposta.status, JSON.stringify(resultado));
  } catch (e) {
    console.log('Resumo semanal — falha:', e.message);
  }
}

export const config = {
  schedule: '0 11 * * 1',
};
