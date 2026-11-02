'use client';

// ============================================================================
// GOVERNANÇA → Camareira → "Pedidos da recepção"
// Mostra os pedidos especiais que vieram para ela (avisadas) ou que ela está
// levando. "Estou levando" → a recepção vê "a caminho"; "Entregue" fecha.
// Tempo real: pedido novo aparece na hora, com som e vibração.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { TIPOS_PEDIDO, textoDoPedido, pedidoEhMeu, haQuantoTempo } from '../../../lib/governanca/pedidos';
import { chamarRota } from './rota';

function bipe() {
  try {
    const Contexto = window.AudioContext || window.webkitAudioContext;
    const ctx = new Contexto();
    [0, 0.25].forEach((t) => {
      const osc = ctx.createOscillator(); const vol = ctx.createGain();
      osc.frequency.value = 880; vol.gain.value = 0.15;
      osc.connect(vol); vol.connect(ctx.destination);
      osc.start(ctx.currentTime + t); osc.stop(ctx.currentTime + t + 0.15);
    });
    navigator.vibrate?.([200, 100, 200]);
  } catch (e) { /* sem som */ }
}

export default function PedidosCamareira({ usuario }) {
  const [pedidos, setPedidos] = useState([]);
  const [ocupado, setOcupado] = useState(null);
  const [aviso, setAviso] = useState('');
  const vistos = useRef(null);

  const carregar = useCallback(async () => {
    const desde = new Date(Date.now() - 2 * 86400000).toISOString();
    const { data } = await supabase.from('governanca_pedidos').select('*')
      .eq('hotel_id', usuario.hotel_id).in('situacao', ['NOVO', 'A_CAMINHO']).gte('criado_em', desde)
      .order('criado_em', { ascending: true });
    const meus = (data || []).filter((p) => pedidoEhMeu(p, usuario.id));
    // Pedido novo desde a última olhada: som e vibração
    if (vistos.current) {
      if (meus.some((p) => p.situacao === 'NOVO' && !vistos.current.has(p.id))) bipe();
    }
    vistos.current = new Set(meus.map((p) => p.id));
    setPedidos(meus);
  }, [usuario.hotel_id, usuario.id]);

  useEffect(() => {
    carregar();
    const canal = supabase.channel(`pedidos-camareira-${usuario.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'governanca_pedidos', filter: `hotel_id=eq.${usuario.hotel_id}` }, () => carregar())
      .subscribe();
    const relogio = setInterval(() => { if (document.visibilityState === 'visible') carregar(); }, 30000);
    const aoVoltar = () => { if (document.visibilityState === 'visible') carregar(); };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => { clearInterval(relogio); document.removeEventListener('visibilitychange', aoVoltar); supabase.removeChannel(canal); };
  }, [carregar, usuario.hotel_id, usuario.id]);

  async function andar(p, situacao) {
    setOcupado(p.id); setAviso('');
    const r = await chamarRota('/api/governanca-pedidos', { acao: 'andamento', pedidoId: p.id, situacao });
    setOcupado(null);
    if (!r.ok) setAviso(`⚠️ ${r.erro}`);
    carregar();
  }

  if (!pedidos.length && !aviso) return null;

  return (
    <div className="cartao gc-pedidos">
      <h2 className="gc-pedidos-titulo">📣 Pedidos da recepção ({pedidos.length})</h2>
      {aviso && <p className="gc-pedidos-aviso">{aviso}</p>}
      {pedidos.map((p) => {
        const meu = Number(p.atendido_por_id) === Number(usuario.id);
        return (
          <div key={p.id} className={p.situacao === 'NOVO' ? 'gc-pedido gc-pedido-novo' : 'gc-pedido'}>
            <div className="gc-pedido-topo">
              <span className="gc-pedido-quarto">{p.quarto_numero}</span>
              <span className="gc-pedido-texto">
                <strong>{TIPOS_PEDIDO[p.tipo]?.icone} {textoDoPedido(p)}</strong>
                {p.descricao && p.tipo !== 'OUTRO' && <span className="gc-pedido-obs">{p.descricao}</span>}
                <span className="gc-pedido-meta">{haQuantoTempo(p.criado_em)}{p.criado_por_nome ? ` · ${p.criado_por_nome.split(' ')[0]}` : ''}</span>
              </span>
            </div>
            {p.situacao === 'NOVO' && (
              <div className="gc-pedido-botoes">
                <button type="button" className="botao botao-principal" onClick={() => andar(p, 'A_CAMINHO')} disabled={ocupado === p.id}>🏃 Estou levando</button>
                <button type="button" className="botao botao-suave" onClick={() => andar(p, 'ENTREGUE')} disabled={ocupado === p.id}>✅ Já entreguei</button>
              </div>
            )}
            {p.situacao === 'A_CAMINHO' && meu && (
              <div className="gc-pedido-botoes">
                <button type="button" className="botao botao-principal" onClick={() => andar(p, 'ENTREGUE')} disabled={ocupado === p.id}>✅ Entregue</button>
              </div>
            )}
            {p.situacao === 'A_CAMINHO' && !meu && (
              <p className="gc-pedido-meta">🏃 {p.atendido_por_nome || 'Outra camareira'} está levando.</p>
            )}
          </div>
        );
      })}
      <style>{`
        .gc-pedidos { margin-bottom: 14px; border: 2px solid #E8C55A; padding: 14px; }
        .gc-pedidos-titulo { font-size: 1.05rem; margin: 0 0 8px; }
        .gc-pedidos-aviso { font-size: 13px; color: #8A6100; margin: 0 0 8px; }
        .gc-pedido { padding: 10px 0; border-top: 1px solid var(--borda); }
        .gc-pedido:first-of-type { border-top: none; }
        .gc-pedido-topo { display: flex; gap: 12px; align-items: flex-start; }
        .gc-pedido-quarto { font-family: var(--fonte-titulo); font-size: 26px; font-weight: 700; min-width: 58px; line-height: 1.1; }
        .gc-pedido-texto { display: flex; flex-direction: column; gap: 2px; font-size: 15px; }
        .gc-pedido-obs { font-size: 13px; }
        .gc-pedido-meta { font-size: 12px; color: var(--texto-suave); margin: 4px 0 0; }
        .gc-pedido-novo .gc-pedido-quarto { color: #8A6100; }
        .gc-pedido-botoes { display: flex; gap: 8px; margin-top: 10px; }
        .gc-pedido-botoes .botao { flex: 1; min-height: 50px; font-size: 15px; font-weight: 700; }
      `}</style>
    </div>
  );
}
