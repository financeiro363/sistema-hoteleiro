'use client';

// ============================================================================
// GOVERNANÇA → Painel → "Pedidos especiais" (recepção e governança)
// Lança o pedido do hóspede (toalha extra, travesseiro...) e acompanha em
// tempo real: Novo → A caminho (quem está levando) → Entregue.
// O aviso no celular vai para a camareira do andar (regra em
// lib/governanca/pedidos.js); quem manda é o servidor (/api/governanca-pedidos).
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { compararNumero } from '../../../lib/governanca/regras';
import { TIPOS_PEDIDO, SITUACAO_PEDIDO, textoDoPedido, pedidoValido, haQuantoTempo } from '../../../lib/governanca/pedidos';
import { chamarRota } from './rota';

function hora(valor) {
  if (!valor) return '';
  try { return new Date(valor).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Fortaleza' }); } catch (e) { return ''; }
}

export default function PedidosRecepcao({ usuario, quartos }) {
  const [pedidos, setPedidos] = useState([]);
  const [quartoId, setQuartoId] = useState('');
  const [tipo, setTipo] = useState('TOALHA_BANHO');
  const [quantidade, setQuantidade] = useState('1');
  const [descricao, setDescricao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null); // { tipo: 'ok' | 'erro', texto }
  const [ocupado, setOcupado] = useState(null);

  const carregar = useCallback(async () => {
    const inicioHoje = new Date(`${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Fortaleza' })}T00:00:00-03:00`).toISOString();
    // Os de hoje + os que ainda estão em aberto de dias anteriores
    const [{ data: deHoje }, { data: abertos }] = await Promise.all([
      supabase.from('governanca_pedidos').select('*').eq('hotel_id', usuario.hotel_id).gte('criado_em', inicioHoje)
        .order('criado_em', { ascending: false }).limit(100),
      supabase.from('governanca_pedidos').select('*').eq('hotel_id', usuario.hotel_id).in('situacao', ['NOVO', 'A_CAMINHO'])
        .lt('criado_em', inicioHoje).order('criado_em', { ascending: false }).limit(50),
    ]);
    setPedidos([...(deHoje || []), ...(abertos || [])]);
  }, [usuario.hotel_id]);

  useEffect(() => {
    carregar();
    const canal = supabase.channel(`pedidos-recepcao-${usuario.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'governanca_pedidos', filter: `hotel_id=eq.${usuario.hotel_id}` }, () => carregar())
      .subscribe();
    const relogio = setInterval(() => { if (document.visibilityState === 'visible') carregar(); }, 30000);
    return () => { clearInterval(relogio); supabase.removeChannel(canal); };
  }, [carregar, usuario.hotel_id, usuario.id]);

  async function enviar(evento) {
    evento.preventDefault();
    setResultado(null);
    const problema = pedidoValido({ quartoId, tipo, quantidade: Number(quantidade), descricao });
    if (problema) { setResultado({ tipo: 'erro', texto: problema }); return; }
    setEnviando(true);
    const r = await chamarRota('/api/governanca-pedidos', { acao: 'criar', quartoId, tipo, quantidade: Number(quantidade), descricao });
    setEnviando(false);
    if (!r.ok) { setResultado({ tipo: 'erro', texto: r.erro }); return; }
    const quem = (r.avisadas || []).join(', ') || 'ninguém (não há camareira cadastrada)';
    const sem = (r.semCelular || []);
    setResultado({
      tipo: 'ok',
      texto: `📣 Pedido enviado para ${quem} (${r.motivo}).`
        + (sem.length ? ` ${sem.join(', ')} ainda não ${sem.length > 1 ? 'ligaram' : 'ligou'} os avisos no celular — vê quando abrir a tela.` : ' Aviso chegou no celular.'),
    });
    setQuantidade('1'); setDescricao('');
    carregar();
  }

  async function acao(p, nome) {
    setOcupado(p.id);
    const r = await chamarRota('/api/governanca-pedidos', { acao: nome, pedidoId: p.id });
    setOcupado(null);
    if (!r.ok) setResultado({ tipo: 'erro', texto: r.erro });
    else if (nome === 'reavisar') setResultado({ tipo: 'ok', texto: `🔁 Avisado de novo: ${(r.avisadas || []).join(', ')}.` });
    carregar();
  }

  const lista = [...quartos].sort((a, b) => compararNumero(a.numero, b.numero));
  const abertos = pedidos.filter((p) => p.situacao === 'NOVO' || p.situacao === 'A_CAMINHO').length;

  return (
    <div className="cartao gp-bloco">
      <div className="gp-cabeca">
        <h2>Pedidos especiais</h2>
        <span className="texto-suave">{abertos ? `${abertos} em aberto` : 'Nenhum em aberto'}</span>
      </div>
      <form className="gr-form" onSubmit={enviar}>
        <label className="gr-campo">
          <span>Apartamento</span>
          <select className="campo" value={quartoId} onChange={(e) => setQuartoId(e.target.value)}>
            <option value="">Escolha…</option>
            {lista.map((q) => <option key={q.id} value={q.id}>{q.numero}</option>)}
          </select>
        </label>
        <label className="gr-campo gr-campo-largo">
          <span>Pedido</span>
          <select className="campo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {Object.entries(TIPOS_PEDIDO).map(([k, t]) => <option key={k} value={k}>{t.icone} {t.rotulo}</option>)}
          </select>
        </label>
        <label className="gr-campo gr-campo-curto">
          <span>Qtd.</span>
          <input className="campo" type="number" min={1} max={20} value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
        </label>
        <label className="gr-campo gr-campo-todo">
          <span>{tipo === 'OUTRO' ? 'O que o hóspede pediu? *' : 'Observação (opcional)'}</span>
          <input className="campo" type="text" maxLength={300} value={descricao} onChange={(e) => setDescricao(e.target.value)}
            placeholder={tipo === 'OUTRO' ? 'Ex.: cabide, ferro de passar' : 'Ex.: hóspede está saindo às 15h'} />
        </label>
        <button type="submit" className="botao botao-principal gr-enviar" disabled={enviando}>{enviando ? 'Enviando…' : '📣 Enviar para a camareira'}</button>
      </form>
      {resultado && <p className={resultado.tipo === 'ok' ? 'gr-ok' : 'gr-erro'}>{resultado.texto}</p>}

      {pedidos.length > 0 && (
        <div className="gr-lista">
          {pedidos.map((p) => {
            const s = SITUACAO_PEDIDO[p.situacao];
            const aberto = p.situacao === 'NOVO' || p.situacao === 'A_CAMINHO';
            return (
              <div key={p.id} className="gr-linha">
                <span className="gr-quarto">{p.quarto_numero}</span>
                <span className="gr-texto">
                  <strong>{TIPOS_PEDIDO[p.tipo]?.icone} {textoDoPedido(p)}</strong>
                  <span className="gr-meta">
                    {hora(p.criado_em)} · {haQuantoTempo(p.criado_em)}
                    {p.situacao === 'A_CAMINHO' && p.atendido_por_nome ? ` · ${p.atendido_por_nome} levando` : ''}
                    {p.situacao === 'ENTREGUE' ? ` · entregue às ${hora(p.entregue_em)}${p.atendido_por_nome ? ` por ${p.atendido_por_nome}` : ''}` : ''}
                    {p.situacao === 'NOVO' && !p.avisos_enviados ? ' · ninguém recebeu no celular' : ''}
                  </span>
                </span>
                <span className="gr-situacao" style={{ background: s.fundo, color: s.texto }}>{s.rotulo}</span>
                {aberto && (
                  <span className="gr-acoes">
                    {p.situacao === 'NOVO' && <button type="button" onClick={() => acao(p, 'reavisar')} disabled={ocupado === p.id}>Avisar de novo</button>}
                    <button type="button" onClick={() => acao(p, 'cancelar')} disabled={ocupado === p.id}>Cancelar</button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      <style>{`
        .gr-form { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; align-items: end; }
        .gr-campo { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: var(--texto-suave); }
        .gr-campo .campo { margin: 0; }
        .gr-campo-todo, .gr-enviar { grid-column: 1 / -1; }
        .gr-enviar { min-height: 48px; }
        .gr-ok { font-size: 13px; color: #1E6B3C; margin: 10px 0 0; }
        .gr-erro { font-size: 13px; color: #A31212; margin: 10px 0 0; }
        .gr-lista { margin-top: 12px; display: flex; flex-direction: column; }
        .gr-linha { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--borda); flex-wrap: wrap; }
        .gr-quarto { font-family: var(--fonte-titulo); font-weight: 700; font-size: 18px; min-width: 46px; }
        .gr-texto { flex: 1; display: flex; flex-direction: column; font-size: 14px; min-width: 150px; }
        .gr-meta { font-size: 12px; color: var(--texto-suave); }
        .gr-situacao { font-size: 12px; font-weight: 700; border-radius: 999px; padding: 3px 10px; }
        .gr-acoes { display: flex; gap: 6px; }
        .gr-acoes button { background: var(--branco); border: 1px solid var(--borda); border-radius: 8px; padding: 6px 10px; font-size: 12px; font-weight: 600; cursor: pointer; color: var(--tinta); font-family: inherit; }
        @media (min-width: 720px) {
          .gr-form { grid-template-columns: 140px 1fr 90px; }
          .gr-enviar { justify-self: start; padding-left: 28px; padding-right: 28px; }
        }
      `}</style>
    </div>
  );
}
