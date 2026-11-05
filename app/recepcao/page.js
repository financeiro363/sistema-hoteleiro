'use client';

// ============================================================================
// RECEPÇÃO — Chegadas e saídas de hoje (M3)
// Numa tela só, para o check-in sem abrir três sistemas: quarto pronto
// (limpo / vistoriado), hora prevista, ficha de hóspede, saldo a pagar e o
// benefício combinado na oferta. Saídas: quem ainda está e o saldo.
// Dados da Cloudbeds e da Governança (rota /api/recepcao-dia), atualiza a
// cada 5 minutos. ADMIN e recepção (COLABORADOR).
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { bloquearSeNaoPermitido } from '../../lib/restricaoAcesso';

const reais = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const diaBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const hora = (v) => (v ? new Date(v).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Fortaleza' }) : '');

function Saldo({ v }) {
  if (v === null || v === undefined) return <span className="rc-tag rc-cinza">saldo: —</span>;
  return v > 0 ? <span className="rc-tag rc-alerta">💳 falta {reais(v)}</span> : <span className="rc-tag rc-ok">💳 pago</span>;
}

export default function Recepcao() {
  const router = useRouter();
  const [verificando, setVerificando] = useState(true);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('');
    try {
      const { data: s } = await supabase.auth.getSession();
      const r = await fetch('/api/recepcao-dia', { headers: { Authorization: `Bearer ${s?.session?.access_token || ''}` } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.erro || 'Não foi possível buscar as chegadas e saídas.');
      setDados(j);
    } catch (e) { setErro(e.message); }
    setCarregando(false);
  }, []);

  useEffect(() => {
    let ativo = true;
    (async () => {
      const { data: sessao } = await supabase.auth.getSession();
      if (!sessao?.session) { router.push('/login'); return; }
      const { data: u } = await supabase.from('usuarios').select('*').eq('auth_id', sessao.session.user.id).single();
      if (!u) { router.push('/login'); return; }
      if (bloquearSeNaoPermitido(u.papel, router)) return;
      if (!['ADMIN', 'COLABORADOR'].includes(u.papel)) { router.push('/'); return; }
      if (!ativo) return;
      setVerificando(false);
      carregar();
    })();
    return () => { ativo = false; };
  }, [router, carregar]);

  useEffect(() => {
    if (verificando) return undefined;
    const id = setInterval(carregar, 5 * 60000);
    return () => clearInterval(id);
  }, [verificando, carregar]);

  if (verificando) return <main className="conteudo"><p className="texto-suave">Verificando seu acesso…</p></main>;

  const chegadas = dados?.chegadas || [];
  const saidas = dados?.saidas || [];
  const aChegar = chegadas.filter((c) => !c.chegou);
  const prontos = aChegar.filter((c) => c.quartos.length && c.quartos.every((q) => q.pronto)).length;
  const semFicha = aChegar.filter((c) => !c.ficha).length;
  const comSaldo = [...aChegar, ...saidas.filter((s) => !s.saiu)].filter((c) => c.saldo > 0).length;

  return (
    <main className="conteudo">
      <span className="olho">Recepção</span>
      <h1 style={{ marginBottom: 6 }}>Chegadas e saídas de hoje</h1>
      <div className="rc-topo">
        <p className="texto-suave" style={{ margin: 0 }}>
          {dados ? `${diaBR(dados.hoje)} · atualizado às ${hora(dados.atualizado_em)} (atualiza sozinho a cada 5 min)` : 'Buscando na Cloudbeds…'}
        </p>
        <button type="button" className="botao botao-suave" onClick={carregar} disabled={carregando}>{carregando ? 'Buscando…' : '🔄 Atualizar'}</button>
      </div>
      {erro && <div className="aviso-erro">{erro}</div>}

      {dados && (
        <div className="rc-resumo">
          <div className="cartao rc-num"><strong>{aChegar.length}</strong><span>a chegar</span></div>
          <div className="cartao rc-num"><strong>{prontos}</strong><span>com quarto pronto</span></div>
          <div className="cartao rc-num"><strong>{semFicha}</strong><span>sem ficha</span></div>
          <div className="cartao rc-num"><strong>{comSaldo}</strong><span>com saldo a pagar</span></div>
          <div className="cartao rc-num"><strong>{saidas.filter((s) => !s.saiu).length}</strong><span>saídas pendentes</span></div>
        </div>
      )}

      {dados && (
        <section className="cartao rc-bloco">
          <h2>🧳 Chegadas ({chegadas.length})</h2>
          {!chegadas.length && <p className="texto-suave">Nenhuma chegada hoje.</p>}
          <ul className="rc-lista">
            {chegadas.map((c) => (
              <li key={c.id} className={`rc-item ${c.chegou ? 'rc-feito' : ''}`}>
                <div className="rc-linha1">
                  <strong>{c.nome}</strong>
                  <span className="texto-suave">{c.chegou ? '✅ já fez check-in' : c.hora ? `previsto às ${c.hora}` : 'sem hora prevista'}</span>
                </div>
                <div className="rc-tags">
                  {c.quartos.length ? c.quartos.map((q, i) => (
                    <span key={i} className={`rc-tag ${q.pronto ? 'rc-ok' : 'rc-alerta'}`}>🛏️ {q.numero}: {q.pronto ? '✅ ' : '⏳ '}{q.texto}</span>
                  )) : <span className="rc-tag rc-alerta">🛏️ quarto ainda não definido</span>}
                  <span className={`rc-tag ${c.ficha ? 'rc-ok' : 'rc-alerta'}`}>{c.ficha ? '📝 ficha ok' : '📝 falta a ficha'}</span>
                  <Saldo v={c.saldo} />
                  {c.adultos ? <span className="rc-tag rc-cinza">👥 {c.adultos} adulto(s){c.criancas ? ` + ${c.criancas} criança(s)` : ''}</span> : null}
                  {c.fonte && <span className="rc-tag rc-cinza">{c.fonte}</span>}
                </div>
                {c.oferta && <div className="rc-oferta">🎁 Combinado na oferta: <strong>{c.oferta}</strong></div>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {dados && (
        <section className="cartao rc-bloco">
          <h2>🚪 Saídas ({saidas.length})</h2>
          {!saidas.length && <p className="texto-suave">Nenhuma saída hoje.</p>}
          <ul className="rc-lista">
            {saidas.map((s) => (
              <li key={s.id} className={`rc-item ${s.saiu ? 'rc-feito' : ''}`}>
                <div className="rc-linha1">
                  <strong>{s.nome}</strong>
                  <span className="texto-suave">{s.saiu ? '✅ já saiu' : 'ainda no hotel'}</span>
                </div>
                <div className="rc-tags">
                  {s.quartos.map((q, i) => <span key={i} className="rc-tag rc-cinza">🛏️ {q.numero}</span>)}
                  <Saldo v={s.saldo} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="texto-suave" style={{ fontSize: 12 }}>
        Quarto pronto = limpo na Governança (e “vistoriado” se a governanta aprovou hoje). A ficha é reconhecida pelo link da mensagem,
        pelo nº da reserva ou pelo nome + data de entrada. Saldo = o que falta pagar na Cloudbeds.
      </p>
      <style>{`
        .rc-topo { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
        .rc-resumo { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 14px; }
        .rc-num { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; }
        .rc-num strong { font-size: 26px; }
        .rc-num span { font-size: 13px; color: var(--texto-suave); }
        .rc-bloco { margin-bottom: 14px; }
        .rc-bloco h2 { font-size: 17px; margin: 0 0 8px; }
        .rc-lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
        .rc-item { border-top: 1px solid var(--borda); padding: 10px 0; }
        .rc-feito { opacity: 0.65; }
        .rc-linha1 { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; align-items: baseline; }
        .rc-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
        .rc-tag { font-size: 12px; padding: 3px 8px; border-radius: 999px; background: #EEF1EE; }
        .rc-ok { background: #DDF2E4; color: #1E6B3C; }
        .rc-alerta { background: #FDF3D7; color: #8A6100; }
        .rc-cinza { background: #F1F1EE; color: #5B6762; }
        .rc-oferta { margin-top: 6px; font-size: 13px; background: #F3ECFD; color: #4B2A85; padding: 6px 10px; border-radius: 8px; }
      `}</style>
    </main>
  );
}
