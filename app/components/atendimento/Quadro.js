'use client';

// ============================================================================
// CAIXA DE ENTRADA — cartão da conversa e quadro (Kanban) por etapa
// ============================================================================
// - CartaoConversa: usado na lista e no quadro (nome, hotel, resumo, tempo de
//   espera, não lidas, responsável, etiquetas, anúncio, valor da cotação)
// - Quadro: uma coluna por etapa. As etapas com o mesmo nome nos dois hotéis
//   viram uma coluna só. No computador, arraste o cartão para outra coluna;
//   no celular, use "Mover para…" no próprio cartão.
// ============================================================================

import { useMemo, useState } from 'react';
import {
  ICONE_CANAL, nomeDaConversa, visitanteNoSite, STATUS_CONVERSA, horaCurta, iniciais, primeiroNome, tempoDesde, minutosEsperando, inicioEspera, chaveNome, dinheiro,
} from './util';
import { ChipEtiqueta, roboPausado } from './Conversa';

export function CartaoConversa({
  c, ativo, compacto, nomeHotel, nomeResponsavel, souEu, etiquetasPorId, alertaMinutos, agora, onAbrir, extra, jaReservou, robo,
}) {
  const nome = nomeDaConversa(c);
  const espera = minutosEsperando(c, agora);
  const atrasada = espera !== null && alertaMinutos && espera >= alertaMinutos;
  const etqs = (c.etiquetas || []).map((id) => etiquetasPorId[id]).filter(Boolean);
  const temAnuncio = !!c.origem || etqs.some((e) => chaveNome(e.nome) === 'ad');
  const mostrar = etqs.filter((e) => chaveNome(e.nome) !== 'ad');
  const comRobo = robo?.ligado && (robo.canais || []).includes(c.canal_tipo);
  const pausado = comRobo && roboPausado(c, robo, agora);
  const chamouEquipe = pausado && ['PEDIU_HUMANO', 'ROBO_NAO_SABE', 'ERRO', 'LIMITE'].includes(c.robo_pausa_motivo);

  return (
    <div
      role="button"
      tabIndex={0}
      className={`at-item ${ativo ? 'ativo' : ''} ${compacto ? 'at-cartao-quadro' : ''} ${atrasada ? 'atrasada' : ''}`}
      onClick={onAbrir}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAbrir(); } }}
    >
      <div className="at-avatar">{iniciais(nome)}<span className="at-avatar-canal">{ICONE_CANAL[c.canal_tipo]}</span></div>
      <div className="at-item-meio">
        <div className="at-item-linha">
          <span className="at-item-nome">{nome}</span>
          <span className={`at-item-hora ${c.nao_lidas ? 'nova' : ''}`}>{horaCurta(c.ultima_mensagem_em)}</span>
        </div>
        {nomeHotel && <div className="at-item-hotel">🏨 {nomeHotel}</div>}
        {c.canal_tipo === 'EMAIL' && c.assunto && <div className="at-item-resumo"><strong>{c.assunto}</strong></div>}
        <div className="at-item-linha">
          <span className="at-item-resumo">{c.ultima_direcao === 'SAIDA' ? '↪ ' : ''}{c.ultima_mensagem_resumo || '—'}</span>
          {c.nao_lidas > 0 && <span className="at-badge" aria-label={`${c.nao_lidas} não lidas`}>{c.nao_lidas}</span>}
        </div>
        <div className="at-item-rodape">
          {espera !== null && (
            <span className={`at-chip ${atrasada ? 'at-chip-atrasada' : 'at-chip-espera'}`} title="Tempo esperando resposta">⏳ {tempoDesde(inicioEspera(c), agora)}</span>
          )}
          {c.status !== 'ABERTA' && <span className={`at-chip ${c.status === 'PENDENTE' ? 'at-chip-pendente' : 'at-chip-resolvida'}`}>{STATUS_CONVERSA[c.status]}</span>}
          {c.responsavel_id
            ? <span className="at-chip at-chip-resp">{souEu ? 'Comigo' : primeiroNome(nomeResponsavel || '—')}</span>
            : <span className="at-chip">Sem responsável</span>}
          {comRobo && !pausado && c.robo_atendeu && <span className="at-chip at-chip-robo" title="O robô está atendendo esta conversa">🤖 Robô</span>}
          {chamouEquipe && <span className="at-chip at-chip-humano" title="O robô passou esta conversa para a equipe">🙋 Chamou a equipe</span>}
          {jaReservou && <span className="at-chip at-chip-estrela" title="Este cliente já reservou antes">⭐ Já reservou</span>}
          {temAnuncio && <span className="at-chip at-chip-ad" title={c.origem?.titulo || 'Veio de anúncio'}>📣 AD</span>}
          {visitanteNoSite(c, agora) && <span className="at-chip at-chip-site" title="O visitante está com o site aberto agora">🟢 No site</span>}
          {c.valor_cotacao ? <span className="at-chip">{dinheiro(c.valor_cotacao)}</span> : null}
          {c.cloudbeds_reservation_id && <span className="at-chip">🏨 {c.cloudbeds_reservation_id}</span>}
          {mostrar.slice(0, 3).map((e) => <ChipEtiqueta key={e.id} etiqueta={e} pequeno />)}
          {mostrar.length > 3 && <span className="at-chip">+{mostrar.length - 3}</span>}
        </div>
        {extra}
      </div>
    </div>
  );
}

// Junta as etapas dos hotéis por nome → colunas
export function colunasDoQuadro(etapas) {
  const mapa = new Map();
  for (const e of (etapas || []).filter((x) => x.ativa)) {
    const chave = chaveNome(e.nome);
    const col = mapa.get(chave) || { chave, nome: e.nome, cor: e.cor, ordem: e.ordem, porHotel: {} };
    if (e.ordem < col.ordem) { col.ordem = e.ordem; col.nome = e.nome; col.cor = e.cor || col.cor; }
    col.porHotel[e.hotel_id] = e.id;
    mapa.set(chave, col);
  }
  return [...mapa.values()].sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR'));
}

export function Quadro({
  conversas, etapas, etiquetasPorId, nomesHoteis, multiHotel, nomes, usuarioId, alertas, agora, selecionadaId,
  onAbrir, onMover, limite, reservaram, robos,
}) {
  const colunas = useMemo(() => colunasDoQuadro(etapas), [etapas]);
  const chavePorEtapa = useMemo(() => Object.fromEntries((etapas || []).map((e) => [e.id, e.ativa ? chaveNome(e.nome) : null])), [etapas]);
  const [sobre, setSobre] = useState(null);
  const [arrastando, setArrastando] = useState(null);

  const grupos = useMemo(() => {
    const g = { __sem: [] };
    colunas.forEach((c) => { g[c.chave] = []; });
    for (const c of conversas) {
      const chave = chavePorEtapa[c.etapa_id];
      (chave && g[chave] ? g[chave] : g.__sem).push(c);
    }
    return g;
  }, [conversas, colunas, chavePorEtapa]);

  const todas = [
    ...(grupos.__sem.length ? [{ chave: '__sem', nome: 'Sem etapa', cor: '#8A938E', porHotel: {} }] : []),
    ...colunas,
  ];

  function soltar(e, coluna) {
    e.preventDefault();
    setSobre(null);
    const id = Number(e.dataTransfer.getData('text/plain'));
    const conversa = conversas.find((c) => c.id === id);
    setArrastando(null);
    if (conversa && coluna.chave !== '__sem' && chavePorEtapa[conversa.etapa_id] !== coluna.chave) onMover(conversa, coluna);
  }

  if (!colunas.length) {
    return <div className="at-vazio">Nenhuma etapa cadastrada. O administrador cria as etapas na aba “Funil e etiquetas”.</div>;
  }

  return (
    <div className="at-quadro" aria-label="Quadro de atendimentos por etapa">
      {todas.map((col) => {
        const lista = grupos[col.chave] || [];
        const total = lista.reduce((s, c) => s + (Number(c.valor_cotacao) || 0), 0);
        return (
          <section
            key={col.chave}
            className={`at-coluna ${sobre === col.chave ? 'sobre' : ''}`}
            onDragOver={(e) => { if (arrastando && col.chave !== '__sem') { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (sobre !== col.chave) setSobre(col.chave); } }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setSobre(null); }}
            onDrop={(e) => soltar(e, col)}
            aria-label={`Etapa ${col.nome}`}
          >
            <header className="at-coluna-topo" style={{ borderTopColor: col.cor || '#8A938E' }}>
              <div className="at-coluna-nome"><i className="at-bolinha" style={{ background: col.cor || '#8A938E' }} />{col.nome}</div>
              <div className="at-coluna-info">
                <span className="at-coluna-qtd">{lista.length}</span>
                {total > 0 && <span className="at-dica" style={{ margin: 0 }}>{dinheiro(total)}</span>}
              </div>
            </header>
            <div className="at-coluna-cartoes">
              {lista.length === 0 && <div className="at-coluna-vazia">{arrastando ? 'Solte aqui' : 'Nenhum atendimento'}</div>}
              {lista.map((c) => (
                <div
                  key={c.id}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(c.id)); e.dataTransfer.effectAllowed = 'move'; setArrastando(c.id); }}
                  onDragEnd={() => { setArrastando(null); setSobre(null); }}
                  className={arrastando === c.id ? 'at-arrastando' : ''}
                >
                  <CartaoConversa
                    c={c}
                    compacto
                    ativo={c.id === selecionadaId}
                    nomeHotel={multiHotel ? nomesHoteis[c.hotel_id] : null}
                    nomeResponsavel={nomes[c.responsavel_id]}
                    souEu={c.responsavel_id === usuarioId}
                    etiquetasPorId={etiquetasPorId}
                    alertaMinutos={alertas[c.hotel_id]}
                    agora={agora}
                    jaReservou={reservaram?.has(c.contato_id)}
                    robo={robos?.[c.hotel_id]}
                    onAbrir={() => onAbrir(c.id)}
                    extra={(
                      <select
                        className="at-mover"
                        value=""
                        aria-label="Mover para outra etapa"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const destino = colunas.find((x) => x.chave === e.target.value);
                          if (destino) onMover(c, destino);
                        }}
                      >
                        <option value="">Mover para…</option>
                        {colunas.filter((x) => x.chave !== chavePorEtapa[c.etapa_id]).map((x) => <option key={x.chave} value={x.chave}>{x.nome}</option>)}
                      </select>
                    )}
                  />
                </div>
              ))}
            </div>
          </section>
        );
      })}
      {limite && conversas.length >= limite && (
        <div className="at-dica" style={{ alignSelf: 'flex-end', padding: 8 }}>Mostrando os {limite} atendimentos mais recentes. Use os filtros para ver outros.</div>
      )}
    </div>
  );
}
