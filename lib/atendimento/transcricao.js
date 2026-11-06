// ============================================================================
// ÁUDIO DO CLIENTE → TEXTO (M6) — só no servidor
// ============================================================================
// A IA do robô (Claude) não ouve áudio. O áudio do WhatsApp é transcrito pela
// Groq (Whisper), com uma chave da Groq que o ADMIN cola em Robô (IA) →
// Configuração (fica criptografada, nunca volta para a tela). Decisão do dono
// (06/11/2026): Groq, cerca de US$ 0,0007 por minuto de áudio.
// Quando: o robô transcreve os áudios que vai responder; o atendente pode
// apertar "Transcrever" em qualquer áudio. O texto fica guardado no anexo da
// mensagem (anexos[0].transcricao) e aparece embaixo do áudio.
// ============================================================================

import { lerSegredo, lerAnexo } from './servidor';

export const CHAVE_GROQ = 'groq_chave';
export const MODELO_TRANSCRICAO = 'whisper-large-v3-turbo';
export const LIMITE_AUDIO_MB = 20;
const URL_GROQ = 'https://api.groq.com/openai/v1/audio/transcriptions';

export const chaveGroqValida = (c) => /^gsk_[A-Za-z0-9]{20,}$/.test(String(c || '').trim());

// Chama a Groq. { texto, duracao, idioma } ou lança erro com mensagem em português
export async function transcreverAudio(chave, { dados, mime, nome }, { tempoMs = 15000 } = {}) {
  if (!dados?.length) throw new Error('áudio vazio');
  if (dados.length > LIMITE_AUDIO_MB * 1024 * 1024) throw new Error(`áudio maior que ${LIMITE_AUDIO_MB} MB`);
  const form = new FormData();
  form.append('file', new Blob([dados], { type: mime || 'audio/ogg' }), nome || 'audio.ogg');
  form.append('model', MODELO_TRANSCRICAO);
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), tempoMs);
  let resposta;
  try {
    resposta = await fetch(URL_GROQ, { method: 'POST', headers: { Authorization: `Bearer ${chave}` }, body: form, signal: controle.signal });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'a Groq demorou demais para responder' : `não foi possível falar com a Groq (${e.message})`);
  } finally { clearTimeout(timer); }
  const j = await resposta.json().catch(() => null);
  if (resposta.status === 401) throw new Error('a chave da Groq não foi aceita (confira em Robô → Configuração)');
  if (resposta.status === 429) throw new Error('limite de uso da Groq atingido; tente de novo em alguns minutos');
  if (!resposta.ok) throw new Error(j?.error?.message || `a Groq recusou o áudio (status ${resposta.status})`);
  return { texto: String(j?.text || '').trim(), duracao: Number(j?.duration) || null, idioma: j?.language || null };
}

// Transcreve o áudio de uma mensagem (se ainda não tiver) e guarda no anexo.
// Devolve a mensagem atualizada, ou { erro }.
export async function transcreverMensagem(supabaseAdmin, mensagem, { tempoMs = 15000 } = {}) {
  const anexos = Array.isArray(mensagem?.anexos) ? mensagem.anexos : [];
  const a = anexos[0];
  if (mensagem?.tipo !== 'audio' || !a) return { erro: 'Esta mensagem não é um áudio.' };
  if (a.transcricao) return { mensagem };
  if (!a.caminho) return { erro: 'O áudio não foi guardado (não deu para baixar do WhatsApp).' };
  const chave = await lerSegredo(supabaseAdmin, mensagem.hotel_id, CHAVE_GROQ);
  if (!chave) return { erro: 'Falta a chave da Groq para transcrever áudio. O administrador coloca em Robô (IA) → Configuração.', semChave: true };
  let r;
  try { r = await transcreverAudio(chave, { dados: await lerAnexo(supabaseAdmin, a.caminho), mime: a.mime, nome: a.nome }, { tempoMs }); }
  catch (e) { return { erro: `Não foi possível transcrever: ${e.message}.` }; }
  const novos = [{ ...a, transcricao: r.texto || '(áudio sem fala)', transcricao_duracao: r.duracao, transcricao_em: new Date().toISOString() }, ...anexos.slice(1)];
  await supabaseAdmin.from('atendimento_mensagens').update({ anexos: novos }).eq('id', mensagem.id);
  return { mensagem: { ...mensagem, anexos: novos }, duracao: r.duracao };
}
