'use client';

// Chama uma rota do nosso servidor com o login da pessoa (GET sem corpo, POST com corpo)
import { supabase } from '../../../lib/supabaseClient';

export async function chamarRota(caminho, corpo) {
  try {
    const { data: sessao } = await supabase.auth.getSession();
    const resposta = await fetch(caminho, {
      method: corpo ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.session.access_token}` },
      ...(corpo ? { body: JSON.stringify(corpo) } : {}),
    });
    const r = await resposta.json().catch(() => ({}));
    return { ok: resposta.ok && !r.erro, status: resposta.status, ...r };
  } catch (e) {
    return { ok: false, erro: 'Falha de conexão. Confira a internet e tente de novo.' };
  }
}
