'use client';

// ============================================================================
// CAIXA DE ENTRADA — aba "Solicitações" (Fase 4)
// ============================================================================
// Pedidos que o robô registrou para a equipe resolver: cotação de grupo,
// pedido especial, problema ao reservar, reserva existente (confirmar,
// alterar, cancelar). Quem atende vê, abre a conversa e muda a situação.
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { dataHora, ICONE_CANAL, baixarCsv, nomeDaConversa } from './util';
import { TIPOS_SOLICITACAO, SITUACOES_SOLICITACAO } from '../../../lib/atendimento/roboConfig';

const ROTULOS_DADOS = {
  nome: 'Nome', email: 'E-mail', checkin: 'Entrada', checkout: 'Saída', pessoas: 'Pessoas', quartos: 'Quartos',
  numero_reserva: 'Nº da reserva', detalhes: 'Detalhes',
};
const dataCurta = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.split('-').reverse().join('/') : iso);

export function Solicitacoes({ usuario, hoteis, multiHotel, nomes, onAbrirConversa, onMudou }) {
  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [situacao, setSituacao] = useState('abertas');
  const [tipo, setTipo] = useState('');
  const [hotel, setHotel] = useState('');
  const [aberta, setAberta] = useState(null);

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
    if (error) { setErro('Não foi possível salvar: ' + error.message); return; }
    await carregar();
    onMudou?.();
  }

  function exportar() {
    baixarCsv('solicitacoes.csv', ['Nº', 'Data', 'Hotel', 'Tipo', 'Situação', 'Resumo', 'Cliente', 'Contato', 'Responsável', ...Object.values(ROTULOS_DADOS)],
      lista.map((s) => [
        s.id, dataHora(s.criado_em), hoteis.find((h) => h.id === s.hotel_id)?.nome || s.hotel_id, TIPOS_SOLICITACAO[s.tipo] || s.tipo,
        SITUACOES_SOLICITACAO[s.situacao] || s.situacao, s.resumo || '', s.atendimento_conversas?.contato_nome || '', s.atendimento_conversas?.contato_endereco || '',
        s.responsavel_id ? (nomes[s.responsavel_id] || `#${s.responsavel_id}`) : '', ...Object.keys(ROTULOS_DADOS).map((k) => s.dados?.[k] || ''),
      ]));
  }

  return (
    <section className="at-cartao">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <h2>📋 Solicitações</h2>
        <button type="button" className="at-btn" onClick={exportar} disabled={!lista.length}>⬇ Exportar</button>
      </div>
      <p className="at-dica" style={{ marginTop: 0 }}>Pedidos que o robô registrou para a equipe: grupos, pedidos especiais, problemas ao reservar e reservas que já existem.</p>
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
              {ICONE_CANAL[conv.canal_tipo] || ''} {nomeDaConversa(conv)}{conv.contato_endereco ? ` · ${conv.contato_endereco}` : ''}
              {s.email_enviado_em ? ' · ✉️ aviso enviado por e-mail' : s.email_erro ? ` · ⚠️ e-mail não enviado: ${s.email_erro}` : ''}
            </div>
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
