'use client';

// ============================================================================
// CAIXA DE ENTRADA — "Funil e etiquetas" → Etiquetas automáticas por frase
// ============================================================================
// O ADMIN cadastra frases (ex.: a mensagem pronta do anúncio, “Quero
// reservar!”). Na 1ª mensagem do cliente com uma delas, a conversa ganha a
// etiqueta da regra (padrão AD, que conta em “Vieram de anúncio” no Painel).
// A resposta pronta (opcional) só sai quando o robô não vai responder.
// Banco: sql/etiquetas_por_frase.sql
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { dataHora } from './util';
import { ChipEtiqueta } from './Conversa';
import { ETIQUETA_PADRAO, HORAS_RECOMECO, MAX_FRASES, acharRegra, frasesDoTexto } from '../../../lib/atendimento/frasesConfig';

const SEM_SQL = 'Para usar, primeiro rode no Supabase o SQL sql/etiquetas_por_frase.sql.';
const NOVA = { nome: '', frasesTexto: '', etiqueta: ETIQUETA_PADRAO, resposta: '', ativo: true };

export function FrasesEtiqueta({ hotelId, usuarioId, etiquetas, setErro, setOk, onMudou }) {
  const [regras, setRegras] = useState(null);
  const [semSql, setSemSql] = useState(false);
  const [editando, setEditando] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [teste, setTeste] = useState('');

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from('atendimento_frases_etiqueta').select('*').eq('hotel_id', Number(hotelId)).order('id');
    if (error) { setSemSql(/atendimento_frases_etiqueta|does not exist|schema cache/i.test(error.message || '')); setRegras([]); return; }
    setSemSql(false);
    setRegras(data || []);
  }, [hotelId]);

  useEffect(() => { setEditando(null); setTeste(''); carregar(); }, [carregar]);

  const corDa = (nome) => etiquetas.find((e) => e.nome.toLowerCase() === String(nome || '').toLowerCase());
  const chip = (nome) => <ChipEtiqueta etiqueta={corDa(nome) || { id: 0, nome, cor: '#546E7A' }} pequeno />;

  async function executar(acao, mensagem) {
    setOcupado(true); setErro(''); setOk('');
    try {
      await acao();
      if (mensagem) setOk(mensagem);
      await carregar();
      onMudou?.();
    } catch (e) { setErro(/frases_etiqueta_check/i.test(e.message || '') ? 'Confira a regra: de 1 a 50 frases e uma etiqueta de até 40 letras.' : e.message); }
    setOcupado(false);
  }
  const conferir = ({ error }) => { if (error) throw error; };

  function salvar() {
    const frases = frasesDoTexto(editando.frasesTexto);
    const etiqueta = editando.etiqueta.trim() || ETIQUETA_PADRAO;
    if (!frases.length) { setErro('Escreva pelo menos uma frase (com 3 letras ou mais).'); return; }
    if (etiqueta.length > 40) { setErro('A etiqueta pode ter até 40 letras.'); return; }
    const campos = {
      nome: editando.nome.trim().slice(0, 80) || null, frases, etiqueta,
      resposta: editando.resposta.trim().slice(0, 2000) || null, ativo: editando.ativo !== false, atualizado_em: new Date().toISOString(),
    };
    executar(async () => {
      if (editando.id) conferir(await supabase.from('atendimento_frases_etiqueta').update(campos).eq('id', editando.id));
      else conferir(await supabase.from('atendimento_frases_etiqueta').insert({ ...campos, hotel_id: Number(hotelId), criado_por_id: usuarioId || null }));
      setEditando(null);
    }, `Regra salva: ${frases.length} frase(s) → etiqueta “${etiqueta}”.`);
  }

  const alternar = (r) => executar(async () => {
    conferir(await supabase.from('atendimento_frases_etiqueta').update({ ativo: !r.ativo, atualizado_em: new Date().toISOString() }).eq('id', r.id));
  }, r.ativo ? 'Regra desligada.' : 'Regra ligada.');

  function excluir(r) {
    if (!window.confirm(`Excluir a regra${r.nome ? ` “${r.nome}”` : ''}? As conversas que ela já marcou continuam com a etiqueta.`)) return;
    executar(async () => { conferir(await supabase.from('atendimento_frases_etiqueta').delete().eq('id', r.id)); }, 'Regra excluída.');
  }

  const resultadoTeste = teste.trim() ? acharRegra(regras || [], teste) : null;

  return (
    <section className="at-cartao" id="frases-etiqueta">
      <div className="at-canal-topo">
        <div>
          <h2>🏷️ Etiquetas automáticas por frase</h2>
          <p className="at-dica" style={{ margin: 0 }}>
            Para marcar quem chega pelos anúncios com mensagem pronta (ex.: “Quero reservar!”), que nem sempre trazem a marca de anúncio da Meta.
            A frase é procurada só na <strong>1ª mensagem</strong> do cliente: quando ele começa a conversa ou volta depois de {HORAS_RECOMECO} horas.
            Vale no WhatsApp e no chat do site (o e-mail fica de fora). Maiúsculas, acentos e pontuação não importam.
            Com a etiqueta <strong>AD</strong>, a conversa conta em “Vieram de anúncio” no Painel.
          </p>
        </div>
        {!semSql && <button type="button" className="at-btn at-btn-verde" onClick={() => { setErro(''); setEditando({ ...NOVA }); }} disabled={ocupado}>+ Nova regra</button>}
      </div>
      {semSql && <div className="aviso-erro" style={{ marginTop: 10 }}>{SEM_SQL}</div>}

      {editando && (
        <div className="at-canal" style={{ background: '#FAFBF9' }}>
          <label className="rotulo" htmlFor="fr-frases">Frases (uma por linha)</label>
          <textarea id="fr-frases" className="campo" rows={4} value={editando.frasesTexto} onChange={(e) => setEditando({ ...editando, frasesTexto: e.target.value })}
            placeholder={'Quero reservar!\nOlá! Tenho interesse e queria mais informações, por favor.'} />
          <p className="at-dica" style={{ marginTop: 2 }}>Até {MAX_FRASES} frases. Copie a mensagem pronta do anúncio do jeito que o cliente recebe.</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label className="at-detalhe" style={{ margin: 0 }}>
              <span>Etiqueta</span>
              <input className="campo" style={{ margin: 0, width: 180 }} list="fr-etiquetas" maxLength={40} value={editando.etiqueta}
                onChange={(e) => setEditando({ ...editando, etiqueta: e.target.value })} aria-label="Etiqueta" />
              <datalist id="fr-etiquetas">{etiquetas.map((e) => <option key={e.id} value={e.nome} />)}</datalist>
            </label>
            <label className="at-detalhe" style={{ margin: 0, flex: '1 1 220px' }}>
              <span>Nome da regra (opcional)</span>
              <input className="campo" style={{ margin: 0 }} maxLength={80} value={editando.nome} onChange={(e) => setEditando({ ...editando, nome: e.target.value })}
                placeholder="Ex.: Anúncio de dezembro" aria-label="Nome da regra" />
            </label>
          </div>
          <label className="rotulo" htmlFor="fr-resposta">Resposta pronta (opcional)</label>
          <textarea id="fr-resposta" className="campo" rows={3} maxLength={2000} value={editando.resposta} onChange={(e) => setEditando({ ...editando, resposta: e.target.value })}
            placeholder="Olá! Que bom que você quer reservar 😊 Para quais datas e para quantas pessoas?" />
          <p className="at-dica" style={{ marginTop: 2 }}>
            Só é enviada quando o robô não vai responder a conversa (robô desligado, canal sem robô ou alguém da equipe assumiu). Com o robô ligado, ele mesmo responde: assim o cliente não recebe 2 mensagens.
          </p>
          <div className="at-botoes">
            <button type="button" className="at-btn at-btn-verde" onClick={salvar} disabled={ocupado}>Salvar</button>
            <button type="button" className="at-btn" onClick={() => setEditando(null)} disabled={ocupado}>Cancelar</button>
          </div>
        </div>
      )}

      {regras === null ? <p className="at-dica">Carregando…</p> : !semSql && regras.length === 0 && !editando ? (
        <p className="at-dica">Nenhuma regra ainda. Clique em “+ Nova regra” e cole a mensagem pronta do seu anúncio.</p>
      ) : regras.map((r) => (
        <div key={r.id} className={`at-reserva ${r.ativo ? '' : 'desligada'}`} style={{ margin: '10px 0 0', opacity: r.ativo ? 1 : 0.65 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong>{r.nome || `Regra nº ${r.id}`}</strong> → {chip(r.etiqueta)}
              {!r.ativo && <span className="at-chip">desligada</span>}
            </span>
            <span className="at-botoes" style={{ margin: 0 }}>
              <button type="button" className="at-btn" onClick={() => { setErro(''); setEditando({ id: r.id, nome: r.nome || '', frasesTexto: (r.frases || []).join('\n'), etiqueta: r.etiqueta, resposta: r.resposta || '', ativo: r.ativo }); }} disabled={ocupado}>Editar</button>
              <button type="button" className="at-btn" onClick={() => alternar(r)} disabled={ocupado}>{r.ativo ? 'Desligar' : 'Ligar'}</button>
              <button type="button" className="at-btn at-btn-perigo" onClick={() => excluir(r)} disabled={ocupado}>Excluir</button>
            </span>
          </div>
          <div style={{ margin: '6px 0 0', overflowWrap: 'anywhere' }}>
            {(r.frases || []).map((f) => <span key={f} className="at-chip" style={{ marginRight: 6, marginBottom: 4, display: 'inline-block' }}>“{f}”</span>)}
          </div>
          <div className="at-dica" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {r.resposta ? `💬 Resposta pronta (sem o robô): ${r.resposta.length > 160 ? `${r.resposta.slice(0, 160)}…` : r.resposta}` : '💬 Sem resposta pronta: só a etiqueta.'}
          </div>
          <div className="at-dica" style={{ margin: '2px 0 0' }}>
            {r.vezes ? `Marcou ${r.vezes} conversa(s) · a última em ${dataHora(r.ultima_vez)}` : 'Ainda não marcou nenhuma conversa.'}
          </div>
        </div>
      ))}

      {!semSql && (regras || []).length > 0 && (
        <div style={{ marginTop: 14 }}>
          <label className="rotulo" htmlFor="fr-teste">Testar uma mensagem</label>
          <input id="fr-teste" className="campo" value={teste} onChange={(e) => setTeste(e.target.value)} placeholder="Cole aqui uma mensagem de cliente para ver se alguma regra marca" />
          {teste.trim() && (
            <p className="at-dica" style={{ marginTop: 4 }}>
              {resultadoTeste
                ? <>✓ Marca com {chip(resultadoTeste.regra.etiqueta)} pela frase “{resultadoTeste.frase}”{resultadoTeste.regra.nome ? ` (regra “${resultadoTeste.regra.nome}”)` : ''}, se for a 1ª mensagem do cliente.</>
                : 'Nenhuma regra ligada tem uma frase nesta mensagem.'}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
