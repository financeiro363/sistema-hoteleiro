'use client';

// ============================================================================
// CAIXA DE ENTRADA — aba "Funil e etiquetas" (só ADMIN)
// ============================================================================
// - Etapas do quadro (Kanban): nome, cor, ordem, ligada/desligada
// - Etiquetas: manuais (a equipe usa) e automáticas (o sistema coloca)
// - Horário comercial (para o Painel contar "fora do horário") e o alerta
//   de cliente esperando
// - Motor de reservas e cotação (link do motor, textos da cotação e a
//   verificação automática de reservas novas → "Reservou")
// - Copiar tudo para o outro hotel
// ============================================================================

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { CORES_SUGERIDAS, chaveNome, chamarApi, dataHora } from './util';
import { ABERTURA_PADRAO, FINAL_PADRAO } from '../../../lib/atendimento/cotacaoTexto';
import { ChipEtiqueta } from './Conversa';

const DIAS = [['1', 'Segunda'], ['2', 'Terça'], ['3', 'Quarta'], ['4', 'Quinta'], ['5', 'Sexta'], ['6', 'Sábado'], ['0', 'Domingo']];
const HORARIO_PADRAO = { 1: ['08:00', '18:00'], 2: ['08:00', '18:00'], 3: ['08:00', '18:00'], 4: ['08:00', '18:00'], 5: ['08:00', '18:00'], 6: ['08:00', '12:00'] };

function EscolherCor({ valor, onMudar }) {
  return (
    <span className="at-cores">
      {CORES_SUGERIDAS.map((c) => (
        <button key={c} type="button" className={`at-cor ${valor === c ? 'ativa' : ''}`} style={{ background: c }} onClick={() => onMudar(c)} aria-label={`Cor ${c}`} />
      ))}
      <input type="color" value={valor || '#546E7A'} onChange={(e) => onMudar(e.target.value.toUpperCase())} aria-label="Outra cor" />
    </span>
  );
}

export function FunilEtiquetas({ hoteis, hotelAtual, etapas, etiquetas, preferencias, onMudou }) {
  const [hotelId, setHotelId] = useState((hoteis.find((h) => h.id === Number(hotelAtual)) || hoteis[0])?.id);
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [editEtapa, setEditEtapa] = useState(null);
  const [editEtiqueta, setEditEtiqueta] = useState(null);
  const [horario, setHorario] = useState(HORARIO_PADRAO);
  const [alerta, setAlerta] = useState(15);
  const [motor, setMotor] = useState('');
  const [abertura, setAbertura] = useState('');
  const [finalTexto, setFinalTexto] = useState('');
  const [verificar, setVerificar] = useState(true);
  const [resultadoReservas, setResultadoReservas] = useState('');

  const minhasEtapas = etapas.filter((e) => e.hotel_id === Number(hotelId)).sort((a, b) => a.ordem - b.ordem || a.id - b.id);
  const minhasEtiquetas = etiquetas.filter((e) => e.hotel_id === Number(hotelId));
  const pref = preferencias.find((p) => p.hotel_id === Number(hotelId));
  const outros = hoteis.filter((h) => h.id !== Number(hotelId));

  useEffect(() => {
    setHorario(pref?.horario_comercial || HORARIO_PADRAO);
    setAlerta(pref?.alerta_espera_minutos ?? 15);
    setMotor(pref?.motor_url || '');
    setAbertura(pref?.cotacao_texto_abertura || '');
    setFinalTexto(pref?.cotacao_texto_final || '');
    setVerificar(pref?.verificar_reservas !== false);
  }, [hotelId, pref]);

  // ---- Motor de reservas e cotação ----
  function salvarMotor() {
    const url = motor.trim();
    if (url && !/^https:\/\/\S+$/i.test(url)) { setErro('O link do motor tem que começar com https://'); return; }
    executar(async () => verificar_(await supabase.from('atendimento_preferencias').upsert({
      hotel_id: Number(hotelId), motor_url: url || null,
      cotacao_texto_abertura: abertura.trim() || null, cotacao_texto_final: finalTexto.trim() || null,
      verificar_reservas: verificar, atualizado_em: new Date().toISOString(),
    }, { onConflict: 'hotel_id' })), 'Motor de reservas e textos da cotação salvos.');
  }

  async function detectarMotor() {
    setOcupado(true); setErro(''); setOk('');
    try {
      const r = await chamarApi('/api/atendimento', { acao: 'motor_detectar', hotelId: Number(hotelId) });
      setMotor(r.url);
      setOk('Link do motor encontrado na Cloudbeds e salvo.');
      onMudou();
    } catch (e) { setErro(e.message); }
    setOcupado(false);
  }

  async function verificarAgora() {
    setOcupado(true); setErro(''); setResultadoReservas('');
    try {
      const r = await chamarApi('/api/atendimento', { acao: 'reservas_verificar' });
      const meu = (r.resultados || []).find((x) => Number(x.hotelId) === Number(hotelId));
      setResultadoReservas(!meu ? 'Este hotel não tem a Cloudbeds configurada.'
        : meu.erro ? `Erro: ${meu.erro}`
          : meu.pulou ? `Não verificado: ${meu.pulou}.`
            : `${meu.reservas} reserva(s) nova(s) na Cloudbeds; ${meu.marcadas} ligada(s) a conversas e marcada(s) como “Reservou”.`);
    } catch (e) { setErro(e.message); }
    setOcupado(false);
  }

  async function executar(acao, mensagemOk) {
    setOcupado(true); setErro(''); setOk('');
    try {
      await acao();
      if (mensagemOk) setOk(mensagemOk);
      onMudou();
    } catch (e) {
      setErro(/duplicate|unique/i.test(e.message) ? 'Já existe um item com esse nome neste hotel.' : e.message);
    }
    setOcupado(false);
  }
  const verificar_ = ({ error }) => { if (error) throw new Error(/motor_url|cotacao_texto|verificar_reservas/.test(error.message) ? 'Falta rodar no Supabase o SQL da Fase 3.' : error.message); };

  // ---- Etapas ----
  function salvarEtapa() {
    const nome = String(editEtapa.nome || '').trim();
    if (!nome) { setErro('Dê um nome para a etapa.'); return; }
    executar(async () => {
      if (editEtapa.id) verificar_(await supabase.from('atendimento_etapas').update({ nome, cor: editEtapa.cor }).eq('id', editEtapa.id));
      else {
        const ordem = (minhasEtapas.at(-1)?.ordem || 0) + 1;
        verificar_(await supabase.from('atendimento_etapas').insert({ hotel_id: Number(hotelId), nome, cor: editEtapa.cor || CORES_SUGERIDAS[0], ordem }));
      }
      setEditEtapa(null);
    });
  }

  function moverEtapa(i, passo) {
    const lista = [...minhasEtapas];
    const j = i + passo;
    if (j < 0 || j >= lista.length) return;
    [lista[i], lista[j]] = [lista[j], lista[i]];
    executar(async () => {
      for (let k = 0; k < lista.length; k += 1) {
        if (lista[k].ordem !== k + 1) verificar_(await supabase.from('atendimento_etapas').update({ ordem: k + 1 }).eq('id', lista[k].id));
      }
    });
  }

  function alternarEtapa(e) {
    executar(async () => verificar_(await supabase.from('atendimento_etapas').update({ ativa: !e.ativa }).eq('id', e.id)));
  }

  function excluirEtapa(e) {
    if (!window.confirm(`Excluir a etapa “${e.nome}”? Os atendimentos que estão nela ficam “sem etapa” até alguém mover.`)) return;
    executar(async () => verificar_(await supabase.from('atendimento_etapas').delete().eq('id', e.id)));
  }

  // ---- Etiquetas ----
  function salvarEtiqueta() {
    const nome = String(editEtiqueta.nome || '').trim();
    if (!nome) { setErro('Dê um nome para a etiqueta.'); return; }
    executar(async () => {
      if (editEtiqueta.id) {
        const original = minhasEtiquetas.find((x) => x.id === editEtiqueta.id);
        verificar_(await supabase.from('atendimento_etiquetas').update({ cor: editEtiqueta.cor, ...(original?.automatica ? {} : { nome }) }).eq('id', editEtiqueta.id));
      } else {
        verificar_(await supabase.from('atendimento_etiquetas').insert({ hotel_id: Number(hotelId), nome, cor: editEtiqueta.cor || CORES_SUGERIDAS[6] }));
      }
      setEditEtiqueta(null);
    });
  }

  function excluirEtiqueta(e) {
    if (!window.confirm(`Excluir a etiqueta “${e.nome}”? Ela sai de todas as conversas.`)) return;
    executar(async () => {
      const { data: usando } = await supabase.from('atendimento_conversas').select('id, etiquetas').contains('etiquetas', [e.id]).limit(5000);
      for (const c of usando || []) {
        verificar_(await supabase.from('atendimento_conversas').update({ etiquetas: (c.etiquetas || []).filter((x) => x !== e.id) }).eq('id', c.id));
      }
      verificar_(await supabase.from('atendimento_etiquetas').delete().eq('id', e.id));
    });
  }

  // ---- Horário e alerta ----
  function salvarPreferencias() {
    for (const [, faixa] of Object.entries(horario)) {
      if (faixa && (!faixa[0] || !faixa[1] || faixa[0] >= faixa[1])) { setErro('Confira os horários: o fim tem que ser depois do início.'); return; }
    }
    const minutos = Math.max(1, Math.min(1440, Number(alerta) || 15));
    executar(async () => verificar_(await supabase.from('atendimento_preferencias').upsert({
      hotel_id: Number(hotelId), horario_comercial: horario, alerta_espera_minutos: minutos, atualizado_em: new Date().toISOString(),
    }, { onConflict: 'hotel_id' })), 'Horário e alerta salvos.');
  }

  // ---- Copiar para outro hotel ----
  function copiarPara(destinoId) {
    const destino = hoteis.find((h) => h.id === Number(destinoId));
    if (!destino) return;
    if (!window.confirm(`Copiar etapas, etiquetas, horário e alerta para ${destino.nome}? Itens com o mesmo nome são atualizados (cor e ordem); nada é apagado lá.`)) return;
    executar(async () => {
      const etapasDestino = etapas.filter((e) => e.hotel_id === destino.id);
      for (const e of minhasEtapas) {
        const igual = etapasDestino.find((x) => chaveNome(x.nome) === chaveNome(e.nome));
        if (igual) verificar_(await supabase.from('atendimento_etapas').update({ cor: e.cor, ordem: e.ordem, ativa: e.ativa }).eq('id', igual.id));
        else verificar_(await supabase.from('atendimento_etapas').insert({ hotel_id: destino.id, nome: e.nome, cor: e.cor, ordem: e.ordem, ativa: e.ativa }));
      }
      const etiquetasDestino = etiquetas.filter((e) => e.hotel_id === destino.id);
      for (const e of minhasEtiquetas) {
        const igual = etiquetasDestino.find((x) => chaveNome(x.nome) === chaveNome(e.nome));
        if (igual) verificar_(await supabase.from('atendimento_etiquetas').update({ cor: e.cor }).eq('id', igual.id));
        else verificar_(await supabase.from('atendimento_etiquetas').insert({ hotel_id: destino.id, nome: e.nome, cor: e.cor, automatica: e.automatica }));
      }
      verificar_(await supabase.from('atendimento_preferencias').upsert({
        hotel_id: destino.id, horario_comercial: horario, alerta_espera_minutos: Number(alerta) || 15, atualizado_em: new Date().toISOString(),
      }, { onConflict: 'hotel_id' }));
    }, `Copiado para ${destino.nome}.`);
  }

  return (
    <>
      {hoteis.length > 1 && (
        <div className="at-filtros-mais" style={{ marginBottom: 12 }}>
          <label><span>Hotel</span>
            <select className="at-select" value={hotelId} onChange={(e) => { setHotelId(Number(e.target.value)); setEditEtapa(null); setEditEtiqueta(null); }}>
              {hoteis.map((h) => <option key={h.id} value={h.id}>{h.nome}</option>)}
            </select>
          </label>
          {outros.length > 0 && (
            <label><span>Copiar tudo para</span>
              <select className="at-select" value="" onChange={(e) => copiarPara(e.target.value)} disabled={ocupado}>
                <option value="">— escolha o hotel —</option>
                {outros.map((h) => <option key={h.id} value={h.id}>{h.nome}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      {erro && <div className="aviso-erro">{erro}</div>}
      {ok && <div className="aviso-erro" style={{ background: '#DDF2E4', color: '#1E6B3C' }}>{ok}</div>}

      <section className="at-cartao">
        <div className="at-canal-topo">
          <div>
            <h2>🧩 Etapas do quadro</h2>
            <p className="at-dica" style={{ margin: 0 }}>São as colunas do Quadro. Toda conversa nova começa na primeira etapa. Ao mover para “Cotação”, “Reservar agora” ou “Reservou”, a etiqueta de mesmo nome entra sozinha (é ela que alimenta o Painel).</p>
          </div>
          <button type="button" className="at-btn at-btn-verde" onClick={() => { setErro(''); setEditEtapa({ nome: '', cor: CORES_SUGERIDAS[minhasEtapas.length % CORES_SUGERIDAS.length] }); }}>+ Nova etapa</button>
        </div>
        {editEtapa && (
          <div className="at-canal" style={{ background: '#FAFBF9' }}>
            <label className="rotulo" htmlFor="fe-nome">Nome da etapa</label>
            <input id="fe-nome" className="campo" value={editEtapa.nome} onChange={(e) => setEditEtapa({ ...editEtapa, nome: e.target.value })} placeholder="Ex.: Pós-venda" />
            <label className="rotulo">Cor</label>
            <EscolherCor valor={editEtapa.cor} onMudar={(cor) => setEditEtapa({ ...editEtapa, cor })} />
            <div className="at-botoes">
              <button type="button" className="at-btn at-btn-verde" onClick={salvarEtapa} disabled={ocupado}>Salvar</button>
              <button type="button" className="at-btn" onClick={() => setEditEtapa(null)}>Cancelar</button>
            </div>
          </div>
        )}
        {minhasEtapas.length === 0 && <p className="at-vazio">Nenhuma etapa. (Rodou o SQL da Fase 2?)</p>}
        {minhasEtapas.map((e, i) => (
          <div key={e.id} className={`at-linha-config ${e.ativa ? '' : 'desligada'}`}>
            <span className="at-ordem">{i + 1}</span>
            <i className="at-bolinha" style={{ background: e.cor || '#8A938E' }} />
            <strong style={{ flex: 1 }}>{e.nome}{!e.ativa && <span className="at-chip" style={{ marginLeft: 6 }}>desligada</span>}</strong>
            <button type="button" className="at-btn" onClick={() => moverEtapa(i, -1)} disabled={ocupado || i === 0} aria-label="Subir">↑</button>
            <button type="button" className="at-btn" onClick={() => moverEtapa(i, 1)} disabled={ocupado || i === minhasEtapas.length - 1} aria-label="Descer">↓</button>
            <button type="button" className="at-btn" onClick={() => { setErro(''); setEditEtapa({ ...e }); }}>Editar</button>
            <button type="button" className="at-btn" onClick={() => alternarEtapa(e)} disabled={ocupado}>{e.ativa ? 'Desligar' : 'Ligar'}</button>
            <button type="button" className="at-btn at-btn-perigo" onClick={() => excluirEtapa(e)} disabled={ocupado}>Excluir</button>
          </div>
        ))}
      </section>

      <section className="at-cartao">
        <div className="at-canal-topo">
          <div>
            <h2>🏷️ Etiquetas</h2>
            <p className="at-dica" style={{ margin: 0 }}>A equipe coloca as etiquetas na conversa. As <strong>automáticas</strong> o sistema coloca sozinho (ex.: <strong>AD</strong> quando o cliente chega por anúncio da Meta) — delas só dá para trocar a cor.</p>
          </div>
          <button type="button" className="at-btn at-btn-verde" onClick={() => { setErro(''); setEditEtiqueta({ nome: '', cor: CORES_SUGERIDAS[6] }); }}>+ Nova etiqueta</button>
        </div>
        {editEtiqueta && (
          <div className="at-canal" style={{ background: '#FAFBF9' }}>
            <label className="rotulo" htmlFor="fq-nome">Nome da etiqueta</label>
            <input id="fq-nome" className="campo" value={editEtiqueta.nome} disabled={!!editEtiqueta.automatica} onChange={(e) => setEditEtiqueta({ ...editEtiqueta, nome: e.target.value })} placeholder="Ex.: Grupo" />
            <label className="rotulo">Cor</label>
            <EscolherCor valor={editEtiqueta.cor} onMudar={(cor) => setEditEtiqueta({ ...editEtiqueta, cor })} />
            <div className="at-botoes">
              <button type="button" className="at-btn at-btn-verde" onClick={salvarEtiqueta} disabled={ocupado}>Salvar</button>
              <button type="button" className="at-btn" onClick={() => setEditEtiqueta(null)}>Cancelar</button>
            </div>
          </div>
        )}
        <div className="at-grade">
          {[['Manuais', minhasEtiquetas.filter((e) => !e.automatica)], ['Automáticas', minhasEtiquetas.filter((e) => e.automatica)]].map(([titulo, lista]) => (
            <div key={titulo}>
              <p className="at-lateral-titulo" style={{ marginTop: 12 }}>{titulo}</p>
              {lista.length === 0 && <p className="at-dica">Nenhuma.</p>}
              {lista.map((e) => (
                <div key={e.id} className="at-linha-config">
                  <span style={{ flex: 1 }}><ChipEtiqueta etiqueta={e} /></span>
                  <button type="button" className="at-btn" onClick={() => { setErro(''); setEditEtiqueta({ ...e }); }}>Editar</button>
                  {!e.automatica && <button type="button" className="at-btn at-btn-perigo" onClick={() => excluirEtiqueta(e)} disabled={ocupado}>Excluir</button>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="at-cartao">
        <h2>🏨 Motor de reservas e cotação</h2>
        <p className="at-dica" style={{ marginTop: 0 }}>
          O link “Reservar agora” da cotação abre o motor de reservas da Cloudbeds com as datas, os hóspedes e o quarto já escolhidos.
        </p>
        <label className="rotulo" htmlFor="fm-motor">Link do motor de reservas</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input id="fm-motor" className="campo" style={{ flex: '1 1 320px' }} value={motor} onChange={(e) => setMotor(e.target.value)} placeholder="https://hotels.cloudbeds.com/reservation/XXXXXX" />
          <button type="button" className="at-btn" onClick={detectarMotor} disabled={ocupado}>🔎 Buscar na Cloudbeds</button>
        </div>
        <label className="rotulo" htmlFor="fm-abertura">Texto de abertura da cotação</label>
        <textarea id="fm-abertura" className="campo" rows={2} value={abertura} onChange={(e) => setAbertura(e.target.value)} placeholder={ABERTURA_PADRAO} />
        <label className="rotulo" htmlFor="fm-final">Texto final da cotação</label>
        <textarea id="fm-final" className="campo" rows={3} value={finalTexto} onChange={(e) => setFinalTexto(e.target.value)} placeholder={FINAL_PADRAO} />
        <p className="at-dica">Em branco = texto padrão (o que aparece apagado no campo). Variáveis: {'{nome}'} {'{checkin}'} {'{checkout}'} {'{noites}'} {'{hospedes}'} {'{hotel}'}.</p>
        <label className="at-detalhe" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={verificar} onChange={(e) => setVerificar(e.target.checked)} />
          <span style={{ color: 'var(--tinta)', fontWeight: 600 }}>Marcar “Reservou” sozinho quando a reserva entrar na Cloudbeds</span>
        </label>
        <p className="at-dica">A cada 5 minutos o sistema olha as reservas novas da Cloudbeds e, se o e-mail ou o telefone for de alguém que conversou nos últimos 45 dias, move o cartão para “Reservou”.
          {pref?.reservas_verificadas_ate ? ` Última verificação: ${dataHora(pref.reservas_verificadas_ate)}.` : ''}</p>
        <div className="at-botoes">
          <button type="button" className="at-btn at-btn-verde" onClick={salvarMotor} disabled={ocupado}>Salvar</button>
          <button type="button" className="at-btn" onClick={verificarAgora} disabled={ocupado}>🔄 Verificar reservas agora</button>
        </div>
        {resultadoReservas && <p className="at-dica">{resultadoReservas}</p>}
      </section>

      <section className="at-cartao">
        <h2>🕘 Horário comercial e alerta</h2>
        <p className="at-dica" style={{ marginTop: 0 }}>O horário comercial serve para o Painel contar os atendimentos que chegaram fora do horário (que, no futuro, a IA vai cobrir). Dia sem horário = fechado.</p>
        <div className="at-horarios">
          {DIAS.map(([d, nome]) => {
            const faixa = horario[d];
            return (
              <div key={d} className="at-horario">
                <label className="at-detalhe" style={{ minWidth: 120 }}>
                  <input type="checkbox" checked={!!faixa} onChange={(e) => setHorario({ ...horario, [d]: e.target.checked ? ['08:00', '18:00'] : undefined })} />
                  <span style={{ color: 'var(--tinta)', fontWeight: 600 }}>{nome}</span>
                </label>
                {faixa ? (
                  <>
                    <input type="time" className="at-select" value={faixa[0]} onChange={(e) => setHorario({ ...horario, [d]: [e.target.value, faixa[1]] })} aria-label={`${nome}: início`} />
                    <span>às</span>
                    <input type="time" className="at-select" value={faixa[1]} onChange={(e) => setHorario({ ...horario, [d]: [faixa[0], e.target.value] })} aria-label={`${nome}: fim`} />
                  </>
                ) : <span className="at-dica" style={{ margin: 0 }}>Fechado</span>}
              </div>
            );
          })}
        </div>
        <label className="rotulo" htmlFor="fa-alerta">Avisar em vermelho quando o cliente estiver esperando resposta há mais de (minutos)</label>
        <input id="fa-alerta" className="campo" style={{ maxWidth: 140 }} type="number" min={1} max={1440} value={alerta} onChange={(e) => setAlerta(e.target.value)} />
        <div className="at-botoes">
          <button type="button" className="at-btn at-btn-verde" onClick={salvarPreferencias} disabled={ocupado}>Salvar horário e alerta</button>
        </div>
      </section>
    </>
  );
}
