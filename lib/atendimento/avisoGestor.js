// ============================================================================
// AVISO AOS ADMINISTRADORES DO HOTEL (celular + e-mail) — só no servidor
// ============================================================================
// Usado na nota baixa da pesquisa da estadia (M18). Celular: os ADMIN do
// hotel que ligaram os avisos (Funil e etiquetas → Avisos no celular).
// E-mail: os mesmos destinatários do resumo semanal (ADMIN + e-mails extras),
// pela caixa de e-mail do hotel.
// ============================================================================

import { enviarPush } from '../push';
import { destinatariosDoResumo, enviarPeloSistema } from './resumoSemanal';

export async function idsDosAdmins(supabaseAdmin, hotelId) {
  const ids = new Set();
  const { data: diretos } = await supabaseAdmin.from('usuarios').select('id, ativo').eq('hotel_id', hotelId).eq('papel', 'ADMIN');
  (diretos || []).filter((u) => u.ativo !== false).forEach((u) => ids.add(Number(u.id)));
  const { data: vinculos } = await supabaseAdmin.from('vinculos_usuario_hotel').select('auth_id').eq('hotel_id', hotelId).eq('papel', 'ADMIN').eq('ativo', true);
  const auths = (vinculos || []).map((v) => v.auth_id).filter(Boolean);
  if (auths.length) {
    const { data: us } = await supabaseAdmin.from('usuarios').select('id, ativo').in('auth_id', auths);
    (us || []).filter((u) => u.ativo !== false).forEach((u) => ids.add(Number(u.id)));
  }
  return [...ids];
}

// { titulo, corpo, url, tag, assunto, texto } → { celulares, emails, erros }
export async function avisarAdmins(supabaseAdmin, hotelId, m) {
  const resultado = { celulares: 0, emails: [], erros: [] };
  try {
    const ids = await idsDosAdmins(supabaseAdmin, hotelId);
    // Avisos de quem tem mais de um hotel ficam no hotel em que ligou os avisos
    const r = await enviarPush(supabaseAdmin, hotelId, ids, { titulo: m.titulo, corpo: m.corpo, url: m.url, tag: m.tag });
    resultado.celulares = r.enviados;
  } catch (e) { resultado.erros.push(`celular: ${e.message}`); }
  try {
    const { data: pref } = await supabaseAdmin.from('atendimento_preferencias').select('resumo_emails_extras').eq('hotel_id', hotelId).maybeSingle();
    const para = await destinatariosDoResumo(supabaseAdmin, hotelId, pref?.resumo_emails_extras);
    if (para.length) {
      await enviarPeloSistema(supabaseAdmin, hotelId, { para, assunto: m.assunto, texto: m.texto, html: m.html || undefined });
      resultado.emails = para;
    }
  } catch (e) { resultado.erros.push(`e-mail: ${e.message}`); }
  return resultado;
}
