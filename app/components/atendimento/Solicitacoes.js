'use client';

// ============================================================================
// CAIXA DE ENTRADA — aba "Solicitações" (Fase 4)
// ============================================================================
// Pedidos que o robô registrou para a equipe resolver: cotação de grupo,
// pedido especial, problema ao reservar, reserva existente (confirmar,
// alterar, cancelar). Quem atende vê, abre a conversa e muda a situação.
// Grupo (sql/painel_grupos.sql): quartos, noites e valor estimado pela
// Cloudbeds (a equipe pode corrigir) e "Fechou" / "Não fechou" com motivo.
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { dataHora, ICONE_CANAL, baixarCsv, nomeDaConversa, chamarApi } from './util';
import { TIPOS_SOLICITACAO, SITUACOES_SOLICITACAO } from '../../../lib/atendimento/roboConfig';
import { MOTIVOS_PERDA, PESSOAS_POR_QUARTO, lerReais, valorDoGrupo } from '../../../lib/atendimento/gruposConfig';
import { ORIGENS_GRUPO, montarGrupoManual } from '../../../lib/atendimento/grupoManual';

const telefoneBonito = (d) => {
  const t = String(d || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  return t.length >= 10 ? `(${t.slice(0, 2)}) ${t.slice(2, t.length - 4)}-${t.slice(-4)}` : t;
};
const hojeAqui = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Fortaleza' });
const grupoVazio = (hotelId) => ({ hotelId: hotelId || '', nome: '', telefone: '', email: '', origem: 'TELEFONE', checkin: '', checkout: '', pessoas: '', quartos: '', detalhes: '' });

// ---------------------------------------------------------------------------
// "+ Registrar grupo": pedido que chegou por telefone, no balcão, por e-mail…
function RegistrarGrupo({ hoteis, multiHotel, onFechar, onRegistrado }) {
  const [f, setF] = useState(grupoVazio(hoteis.length === 1 ? hoteis[0].id : ''));
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const mudar = (campo) => (e) => setF({ ...f, [campo]: e.target.value });

  async function salvar(e) {
    e.preventDefault();
    setErro('');
    if (multiHotel && !f.hotelId) { setErro('Escolha o hotel.'); return; }
    const conferido = montarGrupoManual(f, hojeAqui());
    if (conferido.erros.length) { setErro(conferido.erros.join(' ')); return; }
    setSalvando(true);
    try {
      const r = await chamarApi('/api/atendimento', { acao: 'grupo_registrar', ...f, hotelId: Number(f.hotelId) || undefined });
      onRegistrado(r.solicitacao);
    } catch (erroApi) { setErro(erroApi.message); }
    setSalvando(false);
  }

  return (
    <form className="at-reserva sg-form" onSubmit={salvar}>
      <strong>✍️ Registrar pedido de grupo</strong>
      <p className="at-dica" style={{ margin: '2px 0 8px' }}>Para o grupo que chegou por telefone, no balcão ou por e-mail. Ele entra em Solicitações e no painel de grupos, com o valor estimado pela Cloudbeds.</p>
      <div className="sg-grade">
        {multiHotel && (
          <label className="sg-campo"><span>Hotel *</span>
            <select className="at-select" value={f.hotelId} onChange={mudar('hotelId')}>
              <option value="">Escolha…</option>
              {hoteis.map((h) => <option key={h.id} value={h.id}>{h.nome}</option>)}
            </select>
          </label>
        )}
        <label className="sg-campo sg-larga"><span>Cliente ou empresa *</span>
          <input className="campo" value={f.nome} onChange={mudar('nome')} maxLength={120} placeholder="ex.: Igreja Batista Central — Pr. Marcos" />
        </label>
        <label className="sg-campo"><span>Telefone</span>
          <input className="campo" value={f.telefone} onChange={mudar('telefone')} inputMode="tel" placeholder="(83) 98888-7777" />
        </label>
        <label className="sg-campo"><span>E-mail</span>
          <input className="campo" type="email" value={f.email} onChange={mudar('email')} placeholder="cliente@email.com" />
        </label>
        <label className="sg-campo"><span>Como chegou</span>
          <select className="at-select" value={f.origem} onChange={mudar('origem')}>
            {Object.entries(ORIGENS_GRUPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="sg-campo"><span>Entrada</span>
          <input className="campo" type="date" value={f.checkin} onChange={mudar('checkin')} />
        </label>
        <label className="sg-campo"><span>Saída</span>
          <input className="campo" type="date" value={f.checkout} onChange={mudar('checkout')} />
        </label>
        <label className="sg-campo"><span>Pessoas</span>
          <input className="campo" inputMode="numeric" value={f.pessoas} onChange={mudar('pessoas')} placeholder="ex.: 30" />
        </label>
        <label className="sg-campo"><span>Quartos</span>
          <input className="campo" inputMode="numeric" value={f.quartos} onChange={mudar('quartos')} placeholder={`em branco: ${PESSOAS_POR_QUARTO} pessoas por quarto`} />
        </label>
        <label className="sg-campo sg-larga"><span>Detalhes</span>
          <textarea className="campo" rows={3} value={f.detalhes} onChange={mudar('detalhes')} maxLength={2000} placeholder="ex.: evento, café da manhã, ônibus, forma de pagamento combinada…" />
        </label>
      </div>
      {erro && <div className="aviso-erro" style={{ margin: '8px 0 0' }}>{erro}</div>}
      <div className="at-botoes">
        <button type="submit" className="at-btn at-btn-verde" disabled={salvando}>{salvando ? 'Registrando…' : 'Registrar grupo'}</button>
        <button type="button" className="at-btn" onClick={onFechar} disabled={salvando}>Cancelar</button>
      </div>
      <style>{`
        .sg-form { background: #FAFBF9; }
        .sg-grade { display: grid; grid-template-columns: 1fr; gap: 6px 12px; }
        .sg-campo { display: flex; flex-direction: column; gap: 3px; min-width: 0; font-size: 13px; font-weight: 600; }
        .sg-campo .campo, .sg-campo .at-select { margin: 0; font-weight: 400; }
        @media (min-width: 640px) { .sg-grade { grid-template-columns: 1fr 1fr; } .sg-larga { grid-column: 1 / -1; } }
        @media (min-width: 980px) { .sg-grade { grid-template-columns: 1fr 1fr 1fr; } }
      `}</style>
    </form>
  );
}

const ROTULOS_DADOS = {
  nome: 'Nome', telefone: 'Telefone', email: 'E-mail', checkin: 'Entrada', checkout: 'Saída', pessoas: 'Pessoas', quartos: 'Quartos',
  numero_reserva: 'Nº da reserva', detalhes: 'Detalhes', origem: 'Como chegou',
};
const dataCurta = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.split('-').reverse().join('/') : iso);
const reais = (v) => (v == null ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const valorCampo = (v) => (v == null ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

// ---------------------------------------------------------------------------
// Pedido de grupo: números, valor estimado e resultado
function BlocoGrupo({ s, usuario, nomes, alterar, setErro, setOk, onAtualizado }) {
  const [modo, setModo] = useState(null); // 'fechou' | 'naofechou' | 'corrigir'
  const [valor, setValor] = useState('');
  const [motivo, setMotivo] = useState('');
  const [obs, setObs] = useState('');
  const [quartos, setQuartos] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const temTarifa = s.valor_estimado_origem === 'CLOUDBEDS' && Number(s.grupo_tarifa_noite) > 0 && s.grupo_noites;

  function abrir(m) {
    setModo(m); setErro(''); setOk('');
    if (m === 'fechou') setValor(valorCampo(s.valor_estimado));
    if (m === 'naofechou') { setMotivo(''); setObs(''); }
    if (m === 'corrigir') { setQuartos(s.grupo_quartos ? String(s.grupo_quartos) : ''); setValor(valorCampo(s.valor_estimado)); }
  }

  // Quartos mudaram e o valor veio da Cloudbeds: o valor acompanha
  function mudarQuartos(v) {
    setQuartos(v);
    const q = Math.trunc(Number(v));
    if (temTarifa && q >= 1) setValor(valorCampo(valorDoGrupo(s.grupo_tarifa_noite, q, s.grupo_noites)));
  }

  async function salvar() {
    setOcupado(true);
    let ok = false;
    const agora = new Date().toISOString();
    const resp = s.responsavel_id ? {} : { responsavel_id: usuario.id };
    if (modo === 'fechou') {
      const v = lerReais(valor);
      if (v == null) { setErro('Digite o valor fechado (ex.: 11.500,00).'); setOcupado(false); return; }
      ok = await alterar(s, { resultado: 'FECHOU', valor_fechado: v, motivo_perda: null, resultado_obs: null, resultado_em: agora, resultado_por_id: usuario.id, situacao: 'CONCLUIDA', ...resp });
      if (ok) setOk(`Grupo nº ${s.id} marcado como fechado (${reais(v)}). Ele foi para “Concluída”.`);
    } else if (modo === 'naofechou') {
      if (!motivo) { setErro('Escolha o motivo.'); setOcupado(false); return; }
      ok = await alterar(s, { resultado: 'NAO_FECHOU', valor_fechado: null, motivo_perda: motivo, resultado_obs: obs.trim().slice(0, 300) || null, resultado_em: agora, resultado_por_id: usuario.id, situacao: 'CONCLUIDA', ...resp });
      if (ok) setOk(`Grupo nº ${s.id} marcado como “não fechou” (${MOTIVOS_PERDA[motivo]}). Ele foi para “Concluída”.`);
    } else if (modo === 'corrigir') {
      const q = quartos.trim() ? Math.trunc(Number(quartos)) : null;
      if (quartos.trim() && !(q >= 1 && q <= 1000)) { setErro('Quartos: um número de 1 a 1.000.'); setOcupado(false); return; }
      const v = valor.trim() ? lerReais(valor) : null;
      if (valor.trim() && v == null) { setErro('Valor estimado: digite um valor como 4.400,00.'); setOcupado(false); return; }
      const mudouValor = v !== (s.valor_estimado == null ? null : Number(s.valor_estimado));
      const seguiuTarifa = temTarifa && q && v === valorDoGrupo(s.grupo_tarifa_noite, q, s.grupo_noites);
      ok = await alterar(s, {
        grupo_quartos: q, grupo_quartos_estimado: false, valor_estimado: v,
        ...(mudouValor ? { valor_estimado_origem: v == null ? null : (seguiuTarifa ? 'CLOUDBEDS' : 'EQUIPE'), valor_estimado_obs: null } : {}),
      });
      if (ok) setOk(`Grupo nº ${s.id} corrigido.`);
    }
    setOcupado(false);
    if (ok) setModo(null);
  }

  async function reabrir() {
    if (!window.confirm(`Reabrir o grupo nº ${s.id}? O resultado marcado sai e o pedido volta para “Em andamento”.`)) return;
    await alterar(s, { resultado: null, valor_fechado: null, motivo_perda: null, resultado_obs: null, resultado_em: null, resultado_por_id: null, situacao: 'EM_ANDAMENTO' });
  }

  async function recalcular() {
    setOcupado(true); setErro(''); setOk('');
    try {
      const r = await chamarApi('/api/atendimento', { acao: 'grupo_estimar', id: s.id });
      const n = r.solicitacao || {};
      setOk(n.valor_estimado != null ? `Grupo nº ${s.id}: valor estimado ${reais(n.valor_estimado)} pela Cloudbeds.` : `Grupo nº ${s.id}: ${n.valor_estimado_obs || 'sem valor.'}`);
      await onAtualizado();
    } catch (e) { setErro(e.message); }
    setOcupado(false);
  }

  const partes = [
    s.grupo_pessoas ? `${s.grupo_pessoas} pessoas` : null,
    s.grupo_quartos ? `${s.grupo_quartos} quarto(s)${s.grupo_quartos_estimado ? ` (estimado: ${PESSOAS_POR_QUARTO} por quarto)` : ''}` : 'quartos: ?',
    s.grupo_noites ? `${s.grupo_noites} noite(s)` : null,
  ].filter(Boolean);

  return (
    <div className="at-grupo" style={{ margin: '8px 0 0', padding: '8px 10px', borderRadius: 8, background: 'var(--fundo-suave, #f6f6f3)' }}>
      <div>👥 {partes.join(' · ')}</div>
      <div style={{ marginTop: 2 }}>
        💰 Valor estimado:{' '}
        {s.valor_estimado != null ? (
          <>
            <strong>{reais(s.valor_estimado)}</strong>
            <span className="at-dica" style={{ margin: 0 }}>
              {' '}{s.valor_estimado_origem === 'EQUIPE' ? '(corrigido pela equipe)'
                : s.grupo_tarifa_noite ? `(${reais(s.grupo_tarifa_noite)} por quarto/noite na Cloudbeds × ${s.grupo_quartos} × ${s.grupo_noites})` : ''}
            </span>
          </>
        ) : !s.valor_estimado_em ? <span className="at-dica" style={{ margin: 0 }}>calculando pela Cloudbeds… (em até 2 minutos)</span>
          : <span className="at-dica" style={{ margin: 0 }}>sem valor</span>}
      </div>
      {s.valor_estimado_obs && <div className="at-dica" style={{ margin: '2px 0 0' }}>⚠️ {s.valor_estimado_obs}</div>}

      {s.resultado ? (
        <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
          {s.resultado === 'FECHOU'
            ? <strong style={{ color: '#14532D' }}>✅ Fechou: {reais(s.valor_fechado)}</strong>
            : <strong style={{ color: '#8A1C1C' }}>❌ Não fechou: {MOTIVOS_PERDA[s.motivo_perda] || s.motivo_perda}{s.resultado_obs ? ` — ${s.resultado_obs}` : ''}</strong>}
          <span className="at-dica" style={{ margin: 0 }}>
            {s.resultado_em ? dataHora(s.resultado_em) : ''}{s.resultado_por_id ? ` · ${s.resultado_por_id === usuario.id ? 'você' : (nomes[s.resultado_por_id] || `#${s.resultado_por_id}`)}` : ''}
          </span>
          <button type="button" className="at-link-pequeno" onClick={reabrir}>Reabrir</button>
        </div>
      ) : modo ? (
        <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {modo === 'fechou' && (
            <label className="at-detalhe" style={{ margin: 0 }}>
              <span>Valor fechado (R$)</span>
              <input className="campo" style={{ margin: 0, width: 150 }} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} autoFocus aria-label="Valor fechado" />
            </label>
          )}
          {modo === 'naofechou' && (
            <>
              <label className="at-detalhe" style={{ margin: 0 }}>
                <span>Motivo</span>
                <select className="at-select" value={motivo} onChange={(e) => setMotivo(e.target.value)} aria-label="Motivo">
                  <option value="">Escolha…</option>
                  {Object.entries(MOTIVOS_PERDA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className="at-detalhe" style={{ margin: 0, flex: '1 1 200px' }}>
                <span>Observação (opcional)</span>
                <input className="campo" style={{ margin: 0 }} maxLength={300} value={obs} onChange={(e) => setObs(e.target.value)} aria-label="Observação" />
              </label>
            </>
          )}
          {modo === 'corrigir' && (
            <>
              <label className="at-detalhe" style={{ margin: 0 }}>
                <span>Quartos</span>
                <input className="campo" style={{ margin: 0, width: 90 }} inputMode="numeric" value={quartos} onChange={(e) => mudarQuartos(e.target.value)} aria-label="Quartos" />
              </label>
              <label className="at-detalhe" style={{ margin: 0 }}>
                <span>Valor estimado (R$)</span>
                <input className="campo" style={{ margin: 0, width: 150 }} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} aria-label="Valor estimado" />
              </label>
            </>
          )}
          <button type="button" className="at-btn at-btn-verde" onClick={salvar} disabled={ocupado}>Salvar</button>
          <button type="button" className="at-btn" onClick={() => setModo(null)} disabled={ocupado}>Cancelar</button>
          {modo === 'corrigir' && temTarifa && <span className="at-dica" style={{ margin: 0, flexBasis: '100%' }}>Ao mudar os quartos, o valor acompanha a tarifa da Cloudbeds ({reais(s.grupo_tarifa_noite)} por quarto/noite).</span>}
        </div>
      ) : (
        <div className="at-botoes" style={{ marginTop: 6 }}>
          <button type="button" className="at-btn at-btn-verde" onClick={() => abrir('fechou')}>✅ Fechou</button>
          <button type="button" className="at-btn" onClick={() => abrir('naofechou')}>❌ Não fechou</button>
          <button type="button" className="at-btn" onClick={() => abrir('corrigir')}>✏️ Corrigir quartos e valor</button>
          <button type="button" className="at-btn" onClick={recalcular} disabled={ocupado}>{ocupado ? 'Calculando…' : '🔄 Recalcular pela Cloudbeds'}</button>
        </div>
      )}
    </div>
  );
}

export function Solicitacoes({ usuario, hoteis, multiHotel, nomes, onAbrirConversa, onMudou }) {
  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');
  const [situacao, setSituacao] = useState('abertas');
  const [tipo, setTipo] = useState('');
  const [hotel, setHotel] = useState('');
  const [aberta, setAberta] = useState(null);
  const [registrando, setRegistrando] = useState(false);

  const carregar = useCallback(async () => {
    let q = supabase.from('atendimento_solicitacoes')
      .select('*, atendimento_conversas(contato_nome, contato_endereco, canal_tipo)')
      .order('criado_em', { ascending: false }).limit(300);
    if (situacao === 'abertas') q = q.neq('situacao', 'CONCLUIDA');
    else if (situacao) q = q.eq('situacao', situacao);
    if (tipo) q = q.eq('tipo', tipo);
    const hotelEscolhido = hotel || (hoteis.length === 1 ? hoteis[0].id : '');
    if (hotelEscolhido) q = q.eq('hotel_id', Number(hotelEscolhido));
    const { data, error } = await q;
    if (error) setErro(/atendimento_solicitacoes|does not exist|schema cache/i.test(error.message) ? 'Falta rodar no Supabase o SQL da Fase 4 (sql/caixa_de_entrada_fase4.sql).' : error.message);
    else { setErro(''); setLista(data || []); }
    setCarregando(false);
  }, [situacao, tipo, hotel, hoteis]);

  useEffect(() => { carregar(); const id = setInterval(carregar, 30000); return () => clearInterval(id); }, [carregar]);

  async function alterar(s, campos) {
    const { error } = await supabase.from('atendimento_solicitacoes').update({ ...campos, atualizado_em: new Date().toISOString() }).eq('id', s.id);
    if (error) {
      setErro(/grupo_|valor_|resultado|motivo_perda/i.test(error.message || '') ? 'Para marcar grupos, primeiro rode no Supabase o SQL sql/painel_grupos.sql.' : 'Não foi possível salvar: ' + error.message);
      return false;
    }
    await carregar();
    onMudou?.();
    return true;
  }

  function exportar() {
    const numeroCsv = (v) => (v == null ? '' : String(v).replace('.', ','));
    baixarCsv('solicitacoes.csv', ['Nº', 'Data', 'Hotel', 'Tipo', 'Situação', 'Resumo', 'Cliente', 'Contato', 'Responsável', ...Object.values(ROTULOS_DADOS),
      'Grupo: pessoas', 'Grupo: quartos', 'Grupo: noites', 'Valor estimado', 'Resultado', 'Valor fechado', 'Motivo'],
      lista.map((s) => [
        s.id, dataHora(s.criado_em), hoteis.find((h) => h.id === s.hotel_id)?.nome || s.hotel_id, TIPOS_SOLICITACAO[s.tipo] || s.tipo,
        SITUACOES_SOLICITACAO[s.situacao] || s.situacao, s.resumo || '', s.atendimento_conversas?.contato_nome || '', s.atendimento_conversas?.contato_endereco || '',
        s.responsavel_id ? (nomes[s.responsavel_id] || `#${s.responsavel_id}`) : '', ...Object.keys(ROTULOS_DADOS).map((k) => s.dados?.[k] || ''),
        s.grupo_pessoas ?? '', s.grupo_quartos ?? '', s.grupo_noites ?? '', numeroCsv(s.valor_estimado),
        s.resultado === 'FECHOU' ? 'Fechou' : s.resultado === 'NAO_FECHOU' ? 'Não fechou' : '', numeroCsv(s.valor_fechado), MOTIVOS_PERDA[s.motivo_perda] || '',
      ]));
  }

  return (
    <section className="at-cartao">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <h2>📋 Solicitações</h2>
        <div className="at-botoes" style={{ marginTop: 0 }}>
          <button type="button" className="at-btn at-btn-verde" onClick={() => { setRegistrando(true); setOk(''); setErro(''); }} disabled={registrando}>+ Registrar grupo</button>
          <button type="button" className="at-btn" onClick={exportar} disabled={!lista.length}>⬇ Exportar</button>
        </div>
      </div>
      {registrando && (
        <RegistrarGrupo hoteis={hoteis} multiHotel={multiHotel} onFechar={() => setRegistrando(false)} onRegistrado={async (sol) => {
          setRegistrando(false);
          setOk(`Grupo nº ${sol.id} registrado${sol.valor_estimado != null ? `: valor estimado ${reais(sol.valor_estimado)}` : ''}. Ele ficou com você, em “Em andamento”.`);
          await carregar();
          onMudou?.();
        }} />
      )}
      <p className="at-dica" style={{ marginTop: 0 }}>Pedidos que o robô registrou para a equipe: grupos, pedidos especiais, problemas ao reservar e reservas que já existem. Nos grupos, marque “Fechou” ou “Não fechou”: o resultado aparece no Painel. Grupo que chegou por telefone ou no balcão: use “+ Registrar grupo”.</p>
      <div className="at-filtros-mais" style={{ marginBottom: 10 }}>
        <label><span>Situação</span>
          <select className="at-select" value={situacao} onChange={(e) => setSituacao(e.target.value)}>
            <option value="abertas">Abertas (novas e em andamento)</option>
            {Object.entries(SITUACOES_SOLICITACAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            <option value="">Todas</option>
          </select>
        </label>
        <label><span>Tipo</span>
          <select className="at-select" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(TIPOS_SOLICITACAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        {multiHotel && (
          <label><span>Hotel</span>
            <select className="at-select" value={hotel} onChange={(e) => setHotel(e.target.value)}>
              <option value="">Todos os hotéis</option>
              {hoteis.map((h) => <option key={h.id} value={h.id}>{h.nome}</option>)}
            </select>
          </label>
        )}
      </div>
      {erro && <div className="aviso-erro">{erro}</div>}
      {ok && <div className="aviso-erro" style={{ background: '#E5F4EA', color: '#14532D' }}>{ok}</div>}
      {carregando ? <div className="at-vazio">Carregando…</div> : lista.length === 0 ? (
        <div className="at-vazio">Nenhuma solicitação {situacao === 'abertas' ? 'aberta' : 'com esses filtros'}. 🎉</div>
      ) : lista.map((s) => {
        const conv = s.atendimento_conversas || {};
        const dados = Object.entries(s.dados || {}).filter(([, v]) => v);
        return (
          <div key={s.id} className="at-reserva">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
              <strong>Nº {s.id} · {TIPOS_SOLICITACAO[s.tipo] || s.tipo}</strong>
              <span className="at-dica" style={{ margin: 0 }}>{dataHora(s.criado_em)}{multiHotel ? ` · ${hoteis.find((h) => h.id === s.hotel_id)?.nome || ''}` : ''}</span>
            </div>
            <div style={{ margin: '4px 0' }}>{s.resumo}</div>
            <div className="at-dica" style={{ margin: 0 }}>
              {s.conversa_id
                ? <>{ICONE_CANAL[conv.canal_tipo] || ''} {nomeDaConversa(conv)}{conv.contato_endereco ? ` · ${conv.contato_endereco}` : ''}</>
                : <>✍️ {s.dados?.nome || 'Cliente'}{s.dados?.telefone ? ` · ${telefoneBonito(s.dados.telefone)}` : ''}{s.dados?.email ? ` · ${s.dados.email}` : ''} · registrado à mão{s.criado_por_id ? ` por ${(nomes[s.criado_por_id] || '').split(' ')[0] || `#${s.criado_por_id}`}` : ''}{s.dados?.origem ? ` (${s.dados.origem.toLowerCase()})` : ''}</>}
              {s.email_enviado_em ? ' · ✉️ aviso enviado por e-mail' : s.email_erro ? ` · ⚠️ e-mail não enviado: ${s.email_erro}` : ''}
            </div>
            {s.tipo === 'GRUPO' && 'valor_estimado' in s && (
              <BlocoGrupo s={s} usuario={usuario} nomes={nomes} alterar={alterar} setErro={setErro} setOk={setOk} onAtualizado={carregar} />
            )}
            {aberta === s.id && dados.length > 0 && (
              <div style={{ margin: '8px 0', maxWidth: 560 }}>
                {dados.map(([k, v]) => <div key={k} className="at-dado"><span>{ROTULOS_DADOS[k] || k}</span><span style={{ whiteSpace: 'pre-wrap' }}>{dataCurta(String(v))}</span></div>)}
              </div>
            )}
            <div className="at-botoes" style={{ alignItems: 'center' }}>
              {dados.length > 0 && <button type="button" className="at-btn" onClick={() => setAberta(aberta === s.id ? null : s.id)}>{aberta === s.id ? 'Esconder dados' : 'Ver dados'}</button>}
              {s.conversa_id && <button type="button" className="at-btn" onClick={() => onAbrirConversa(s.conversa_id)}>💬 Abrir conversa</button>}
              <select className="at-select" value={s.situacao} onChange={(e) => alterar(s, { situacao: e.target.value, ...(s.responsavel_id ? {} : { responsavel_id: usuario.id }) })} aria-label="Situação">
                {Object.entries(SITUACOES_SOLICITACAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              {s.responsavel_id
                ? <span className="at-chip at-chip-resp">{s.responsavel_id === usuario.id ? 'Comigo' : (nomes[s.responsavel_id] || `#${s.responsavel_id}`)}</span>
                : <button type="button" className="at-btn" onClick={() => alterar(s, { responsavel_id: usuario.id, situacao: s.situacao === 'NOVA' ? 'EM_ANDAMENTO' : s.situacao })}>Pegar para mim</button>}
            </div>
          </div>
        );
      })}
    </section>
  );
}
