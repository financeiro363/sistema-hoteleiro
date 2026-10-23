// ============================================================================
// FUNÇÃO AGENDADA DA NETLIFY: busca e-mails novos a cada 2 minutos
// ============================================================================
// Mesmo com ninguém olhando a Caixa de Entrada, os e-mails novos entram no
// sistema (e o número no menu atualiza). A mesma chamada também procura, a
// cada 5 minutos por hotel, as reservas novas na Cloudbeds de quem conversou
// com o hotel e move o cartão para "Reservou" (Fase 3). Ela só chama a rota /api/atendimento
// com uma senha derivada da variável CLOUDBEDS_CRYPTO_SECRET (que já existe na
// Netlify) — não é preciso criar variável nova.
// Quando alguém está com a Caixa de Entrada aberta, a própria tela também pede
// a sincronização a cada minuto.
// Funções agendadas só rodam no site publicado (não nas prévias de deploy).
// ============================================================================

import crypto from 'crypto';

export default async function sincronizarEmails() {
  const segredo = process.env.CLOUDBEDS_CRYPTO_SECRET;
  const site = process.env.URL;
  if (!segredo || !site) {
    console.log('Caixa de Entrada: faltam as variáveis CLOUDBEDS_CRYPTO_SECRET ou URL.');
    return;
  }
  const senha = crypto.createHmac('sha256', segredo).update('atendimento-sincronizacao-agendada').digest('base64url');
  try {
    const resposta = await fetch(`${site}/api/atendimento`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-atendimento-agendado': senha },
      body: JSON.stringify({ acao: 'sincronizar' }),
    });
    const resultado = await resposta.json().catch(() => ({}));
    console.log('Caixa de Entrada — sincronização de e-mails:', resposta.status, JSON.stringify(resultado));
  } catch (e) {
    console.log('Caixa de Entrada — falha ao sincronizar:', e.message);
  }
}

export const config = {
  schedule: '*/2 * * * *',
};
