// ============================================================================
// AVISOS NO CELULAR (Web Push) — só no SERVIDOR
// ============================================================================
// - Cada hotel tem o seu par de chaves VAPID, criado sozinho no primeiro uso e
//   guardado criptografado em atendimento_segredos ("push_vapid"). A chave
//   pública vai para o celular; a privada nunca sai do servidor.
// - push_inscricoes guarda o endereço de cada celular que ligou os avisos.
//   Endereço que o serviço de push diz que não existe mais (404/410) é apagado.
// - No iPhone só funciona com o sistema instalado na tela de início
//   (iOS 16.4 ou mais novo).
// ============================================================================

import webpush from 'web-push';
import { lerSegredo, gravarSegredo } from './atendimento/servidor';

const SUJEITO = 'https://chokmahsystem.netlify.app';
const CHAVE = 'push_vapid';

export async function chavesVapid(supabaseAdmin, hotelId) {
  const ler = async () => {
    const salvo = await lerSegredo(supabaseAdmin, hotelId, CHAVE);
    try { const j = JSON.parse(salvo || ''); return j.publicKey && j.privateKey ? j : null; } catch (e) { return null; }
  };
  const atual = await ler();
  if (atual) return atual;
  await gravarSegredo(supabaseAdmin, hotelId, CHAVE, JSON.stringify(webpush.generateVAPIDKeys()));
  return ler(); // relê: se duas chamadas criaram ao mesmo tempo, vale a que ficou gravada
}

export function inscricaoValida(inscricao) {
  const endpoint = String(inscricao?.endpoint || '');
  const p256dh = String(inscricao?.keys?.p256dh || '');
  const auth = String(inscricao?.keys?.auth || '');
  if (!/^https:\/\/[^\s]+$/.test(endpoint) || endpoint.length > 1000) return null;
  if (!/^[A-Za-z0-9_-]{60,120}=*$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,40}=*$/.test(auth)) return null;
  return { endpoint, p256dh, auth };
}

// mensagem: { titulo, corpo, url, tag }
// Devolve { enviados, semCelular: [ids], falhas }
export async function enviarPush(supabaseAdmin, hotelId, usuarioIds, mensagem) {
  const ids = [...new Set((usuarioIds || []).map(Number))].filter(Boolean);
  if (!ids.length) return { enviados: 0, semCelular: [], falhas: 0 };
  const { data: inscricoes } = await supabaseAdmin.from('push_inscricoes').select('*').eq('hotel_id', hotelId).in('usuario_id', ids);
  const comCelular = new Set((inscricoes || []).map((i) => Number(i.usuario_id)));
  const semCelular = ids.filter((id) => !comCelular.has(id));
  if (!inscricoes?.length) return { enviados: 0, semCelular, falhas: 0 };

  const chaves = await chavesVapid(supabaseAdmin, hotelId);
  const corpo = JSON.stringify({
    titulo: String(mensagem.titulo || 'Governança').slice(0, 80),
    corpo: String(mensagem.corpo || '').slice(0, 200),
    url: mensagem.url || '/governanca',
    tag: mensagem.tag || undefined,
  });
  const opcoes = { vapidDetails: { subject: SUJEITO, publicKey: chaves.publicKey, privateKey: chaves.privateKey }, TTL: 3600, urgency: 'high', timeout: 6000 };
  const resultados = await Promise.allSettled(inscricoes.map((i) =>
    webpush.sendNotification({ endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } }, corpo, opcoes)));

  let enviados = 0; let falhas = 0; const usuariosAvisados = new Set();
  for (let k = 0; k < resultados.length; k++) {
    const r = resultados[k]; const i = inscricoes[k];
    if (r.status === 'fulfilled') {
      enviados += 1; usuariosAvisados.add(Number(i.usuario_id));
      await supabaseAdmin.from('push_inscricoes').update({ ultimo_aviso_em: new Date().toISOString() }).eq('id', i.id);
    } else {
      falhas += 1;
      const codigo = r.reason?.statusCode;
      if (codigo === 404 || codigo === 410) await supabaseAdmin.from('push_inscricoes').delete().eq('id', i.id);
    }
  }
  // quem tinha celular mas nenhum aviso chegou conta como "sem celular"
  for (const id of comCelular) if (!usuariosAvisados.has(id)) semCelular.push(id);
  return { enviados, semCelular, falhas };
}
