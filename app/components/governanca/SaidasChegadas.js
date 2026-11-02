'use client';

// ============================================================================
// GOVERNANÇA → Painel → "Saídas e chegadas de hoje"
// Mostra o que a rotina das 6h encontrou na Cloudbeds (saídas, chegadas e o
// que mudou na lista das camareiras) e tem o botão "Atualizar agora".
// Regras em lib/governanca/rotina.js; rota /api/governanca-rotina.
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { hojeNoHotel } from '../../../lib/governanca/regras';
import { chamarRota } from './rota';

function hora(valor) {
  if (!valor) return '';
  try { return new Date(valor).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Fortaleza' }); } catch (e) { return ''; }
}

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

export default function SaidasChegadas({ usuario, recarregar, mostrarAviso }) {
  const [ultima, setUltima] = useState(undefined); // undefined = carregando, null = nada hoje
  const [boa, setBoa] = useState(null); // a última que deu certo hoje
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    const { data } = await supabase.from('governanca_rotina_execucoes').select('*')
      .eq('hotel_id', usuario.hotel_id).eq('data', hojeNoHotel()).order('executado_em', { ascending: false }).limit(10);
    setUltima(data?.[0] || null);
    setBoa((data || []).find((e) => !e.erro) || null);
  }, [usuario.hotel_id]);

  useEffect(() => { carregar(); }, [carregar]);

  async function atualizar() {
    setRodando(true); setErro('');
    const r = await chamarRota('/api/governanca-rotina', {});
    setRodando(false);
    // Erro 400 já fica registrado e aparece pela última tentativa; os outros, aqui
    if (!r.ok) { if (r.status !== 400) setErro(r.erro || 'Não foi possível atualizar.'); }
    else if (r.ignorado) setErro(r.ignorado);
    else {
      const m = r.resumo?.marcados || {};
      const mudou = ['SAIDA', 'FICOU', 'SAIU', 'DIARIA', 'CHEGADA'].reduce((s, k) => s + (m[k] || []).length, 0);
      mostrarAviso(mudou ? `✅ Saídas e chegadas atualizadas: ${plural(mudou, 'mudança', 'mudanças')} na lista.` : '✅ Saídas e chegadas atualizadas — nada novo para mudar.');
    }
    carregar();
    recarregar();
  }

  const r = boa?.resumo || {};
  const m = r.marcados || {};
  const feito = [
    (m.DIARIA || []).length ? `${plural(m.DIARIA.length, 'quarto com hóspede voltou', 'quartos com hóspede voltaram')} para a lista` : null,
    (m.FICOU || []).length ? `${plural(m.FICOU.length, 'virou', 'viraram')} arrumação (${m.FICOU.join(', ')})` : null,
    (m.SAIU || []).length ? `${plural(m.SAIU.length, 'saída já feita', 'saídas já feitas')} (${m.SAIU.join(', ')})` : null,
    (m.CHEGADA || []).length ? `⭐ prioridade por chegada: ${m.CHEGADA.join(', ')}` : null,
  ].filter(Boolean);

  return (
    <div className="cartao gp-bloco">
      <div className="gp-cabeca">
        <h2>Saídas e chegadas de hoje</h2>
        <span className="texto-suave">
          {ultima === undefined ? 'Carregando…' : !boa ? 'Ainda não atualizado hoje (roda sozinho às 6h).'
            : `Atualizado às ${hora(boa.executado_em)}${boa.origem === 'AGENDADA' ? ' (automático)' : boa.executado_por_nome ? ` por ${boa.executado_por_nome.split(' ')[0]}` : ''}`}
        </span>
      </div>
      {ultima?.erro && <p className="sc-erro">⚠️ Última tentativa falhou: {ultima.erro}</p>}
      {boa && (
        <>
          <div className="sc-linha">
            <strong>🚪 Saídas ({(r.saidas || []).length})</strong>
            <div className="gp-chips">{(r.saidas || []).length ? r.saidas.map((n) => <span key={n} className="gp-chip">{n}</span>) : <span className="texto-suave">nenhuma</span>}</div>
          </div>
          <div className="sc-linha">
            <strong>🧳 Chegadas ({(r.chegadas || []).length + (r.semQuarto || 0)})</strong>
            <div className="gp-chips">
              {(r.chegadas || []).map((c) => <span key={c.numero} className="gp-chip">{c.numero}{c.hora ? ` · ${c.hora}` : ''}</span>)}
              {!(r.chegadas || []).length && !r.semQuarto && <span className="texto-suave">nenhuma</span>}
            </div>
            {r.semQuarto > 0 && <span className="sc-nota">{plural(r.semQuarto, 'chegada ainda sem quarto definido', 'chegadas ainda sem quarto definido')} na Cloudbeds.</span>}
          </div>
          {feito.length > 0 && <p className="sc-feito">Na lista das camareiras: {feito.join(' · ')}.</p>}
        </>
      )}
      {erro && <p className="sc-erro">⚠️ {erro}</p>}
      <div className="gp-botoes">
        <button type="button" className="botao botao-suave" onClick={atualizar} disabled={rodando}>{rodando ? 'Buscando na Cloudbeds…' : '🔄 Atualizar agora'}</button>
      </div>
      <style>{`
        .sc-linha { display: flex; flex-direction: column; gap: 6px; padding: 8px 0; border-top: 1px solid var(--borda); }
        .sc-linha strong { font-size: 14px; }
        .sc-nota { font-size: 12px; color: #8A6100; }
        .sc-feito { font-size: 13px; color: var(--texto-suave); margin: 8px 0 0; }
        .sc-erro { font-size: 13px; color: #A31212; margin: 6px 0 0; }
      `}</style>
    </div>
  );
}
