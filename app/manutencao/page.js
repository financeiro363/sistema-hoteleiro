'use client';

// ============================================================================
// MANUTENÇÃO (Kanban de chamados)
// - Painel Kanban com 3 colunas: ⏳ Pendentes / 🔨 Em Execução / ✅ Concluídos,
//   com botões para mover o card ("Iniciar" / "Concluir")
// - Nova Manutenção (manual): local livre (apartamento OU área comum),
//   prioridade e atribuição opcional a um colaborador
// - Duas visões: Admin (Kanban inteiro) e Técnico ("Minhas Tarefas": só o
//   que foi atribuído ao usuário logado, enxuto e mobile-friendly)
// - Insights (admin): filtro de período (Dia/Mês/Ano) e por local; 4 números
//   (pendentes, em execução, concluídos, tempo médio de resolução) + gráfico
//   de barras dos locais que mais geram chamados (SVG puro, sem dependências)
// - Log de Auditoria (admin, imutável): abertura, atribuição, mudança de
//   status e conclusão, com quem/quando
// - Campo "origem" já preparado para a futura integração com a Governança
//   (chamado aberto pela camareira → entra em Pendentes automaticamente)
// ============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { bloquearSeNaoPermitido } from '../../lib/restricaoAcesso';

// ---- Constantes -------------------------------------------------------------

const PRIORIDADE_LABEL = { BAIXA: 'Baixa', MEDIA: 'Média', ALTA: 'Alta' };
const PRIORIDADE_COR = {
  BAIXA: { fundo: '#DDF2E4', texto: '#1E6B3C' },
  MEDIA: { fundo: '#FDF3D7', texto: '#8A6100' },
  ALTA: { fundo: '#FBDDDD', texto: '#A31212' },
};

const STATUS_LABEL = { PENDENTE: 'Pendentes', EM_EXECUCAO: 'Em Execução', CONCLUIDO: 'Concluídos' };
const STATUS_EMOJI = { PENDENTE: '⏳', EM_EXECUCAO: '🔨', CONCLUIDO: '✅' };

// ---- Funções de apoio -------------------------------------------------------

function formatarDataHora(valor) {
  if (!valor) return '—';
  try {
    return new Date(valor).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch (e) { return String(valor); }
}

// Tempo decorrido legível (para tempo médio de resolução)
function duracaoLegivel(minutos) {
  if (!isFinite(minutos) || minutos <= 0) return '—';
  if (minutos < 60) return `${Math.round(minutos)} min`;
  const horas = minutos / 60;
  if (horas < 24) return `${horas.toFixed(1)} h`;
  return `${(horas / 24).toFixed(1)} dias`;
}

// ---- Componente principal ---------------------------------------------------

export default function Manutencao() {
  const router = useRouter();

  const [verificandoLogin, setVerificandoLogin] = useState(true);
  const [usuario, setUsuario] = useState(null);
  const [colegas, setColegas] = useState([]);
  const [nomesUsuarios, setNomesUsuarios] = useState({});

  const [chamados, setChamados] = useState([]);
  const [logs, setLogs] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);

  // Aba: 'kanban' (admin) | 'minhas' (todos) | 'insights' (admin) | 'log' (admin)
  const [subAba, setSubAba] = useState('kanban');

  // Nova manutenção
  const [mostrarForm, setMostrarForm] = useState(false);
  const [fLocal, setFLocal] = useState('');
  const [fDescricao, setFDescricao] = useState('');
  const [fPrioridade, setFPrioridade] = useState('MEDIA');
  const [fResponsavel, setFResponsavel] = useState('');
  const [erroForm, setErroForm] = useState('');

  // Insights
  const [insightPeriodo, setInsightPeriodo] = useState('MES'); // DIA | MES | ANO | TUDO
  const [insightLocal, setInsightLocal] = useState('');

  // Log
  const [buscaLog, setBuscaLog] = useState('');

  // Exclusão
  const [excluindoId, setExcluindoId] = useState(null);

  const souAdmin = usuario?.papel === 'ADMIN';

  function mostrarAviso(texto) {
    setAviso(texto);
    setTimeout(() => setAviso(''), 5000);
  }

  const nomeDe = useCallback(
    (id) => (id ? nomesUsuarios[id] || `Usuário #${id}` : '—'),
    [nomesUsuarios]
  );

  // ---- Login e carregamento ----
  useEffect(() => {
    let ativo = true;
    async function verificar() {
      const { data: sessao } = await supabase.auth.getSession();
      if (!sessao?.session) { router.push('/login'); return; }
      const { data: dadosUsuario, error } = await supabase
        .from('usuarios').select('*').eq('auth_id', sessao.session.user.id).single();
      if (error || !dadosUsuario) { router.push('/login'); return; }
      if (!ativo) return;
      setUsuario(dadosUsuario);
      if (bloquearSeNaoPermitido(dadosUsuario.papel, router, '/manutencao')) return;
      setSubAba(dadosUsuario.papel === 'ADMIN' ? 'kanban' : 'minhas');
      setVerificandoLogin(false);
    }
    verificar();
    return () => { ativo = false; };
  }, [router]);

  const carregarTudo = useCallback(async (u) => {
    setCarregando(true);
    setErro('');

    const { data: pessoas } = await supabase
      .from('usuarios').select('id, nome, papel').eq('hotel_id', u.hotel_id).order('nome', { ascending: true });
    if (pessoas) {
      setColegas(pessoas);
      const mapa = {};
      pessoas.forEach((p) => { mapa[p.id] = p.nome; });
      setNomesUsuarios(mapa);
    }

    const { data: lista, error } = await supabase
      .from('manutencoes').select('*').order('criado_em', { ascending: false });
    if (error) setErro('Não foi possível carregar os chamados. Detalhe técnico: ' + error.message);
    else setChamados(lista || []);

    if (u.papel === 'ADMIN') {
      const { data: ls } = await supabase
        .from('manutencoes_log').select('*')
        .order('data_hora', { ascending: false }).limit(300);
      setLogs(ls || []);
    }
    setCarregando(false);
  }, []);

  useEffect(() => {
    if (usuario) carregarTudo(usuario);
  }, [usuario, carregarTudo]);

  async function registrarLog(local, acao, detalhe) {
    await supabase.from('manutencoes_log').insert({
      usuario_id: usuario.id, local, acao, detalhe: detalhe || null, hotel_id: usuario.hotel_id,
    });
  }

  // ---- Nova manutenção ----
  async function abrirChamado(evento) {
    evento.preventDefault();
    if (salvando) return;
    setErroForm('');
    if (!fLocal.trim()) { setErroForm('Informe o local (apartamento ou área).'); return; }
    if (!fDescricao.trim()) { setErroForm('Descreva o problema.'); return; }

    const responsavelId = fResponsavel ? Number(fResponsavel) : null;

    setSalvando(true);
    const { data: criado, error } = await supabase
      .from('manutencoes')
      .insert({
        local: fLocal.trim(),
        descricao: fDescricao.trim(),
        prioridade: fPrioridade,
        responsavel_id: responsavelId,
        origem: 'MANUAL',
        criado_por_id: usuario.id,
        hotel_id: usuario.hotel_id,
      })
      .select().single();
    setSalvando(false);
    if (error) { setErroForm('Não foi possível abrir o chamado. Detalhe técnico: ' + error.message); return; }

    await registrarLog(criado.local, 'Chamado aberto',
      `Chamado aberto por ${usuario.nome} (prioridade ${PRIORIDADE_LABEL[fPrioridade]}).`);
    if (responsavelId) {
      await registrarLog(criado.local, 'Atribuído', `Atribuído a ${nomeDe(responsavelId)}.`);
    }

    setFLocal(''); setFDescricao(''); setFPrioridade('MEDIA'); setFResponsavel('');
    setMostrarForm(false);
    mostrarAviso('Chamado aberto!');
    carregarTudo(usuario);
  }

  // ---- Mover status ----
  async function moverStatus(chamado, novoStatus) {
    if (salvando) return;
    setSalvando(true);
    const extra = {};
    if (novoStatus === 'EM_EXECUCAO' && !chamado.iniciado_em) extra.iniciado_em = new Date().toISOString();
    if (novoStatus === 'CONCLUIDO') { extra.concluido_por_id = usuario.id; extra.concluido_em = new Date().toISOString(); }
    if (novoStatus === 'PENDENTE') { extra.iniciado_em = null; extra.concluido_por_id = null; extra.concluido_em = null; }

    const { error } = await supabase
      .from('manutencoes').update({ status: novoStatus, ...extra }).eq('id', chamado.id);
    setSalvando(false);
    if (error) { setErro('Não foi possível mover. Detalhe técnico: ' + error.message); return; }

    const rotulo = novoStatus === 'EM_EXECUCAO' ? 'Em Execução' : novoStatus === 'CONCLUIDO' ? 'Concluído' : 'Pendente';
    await registrarLog(chamado.local,
      novoStatus === 'CONCLUIDO' ? 'Concluído' : 'Status alterado',
      novoStatus === 'CONCLUIDO'
        ? `Concluído por ${usuario.nome}.`
        : `Status alterado para ${rotulo} por ${usuario.nome}.`);

    setChamados(chamados.map((c) => (c.id === chamado.id ? { ...c, status: novoStatus, ...extra } : c)));
    carregarTudo(usuario);
  }

  // ---- Atribuir (no card, admin) ----
  async function atribuir(chamado, responsavelId) {
    if (salvando) return;
    const id = responsavelId ? Number(responsavelId) : null;
    setSalvando(true);
    const { error } = await supabase
      .from('manutencoes').update({ responsavel_id: id }).eq('id', chamado.id);
    setSalvando(false);
    if (error) { setErro('Não foi possível atribuir. Detalhe técnico: ' + error.message); return; }
    await registrarLog(chamado.local, 'Atribuído',
      id ? `Atribuído a ${nomeDe(id)}.` : 'Atribuição removida.');
    setChamados(chamados.map((c) => (c.id === chamado.id ? { ...c, responsavel_id: id } : c)));
    carregarTudo(usuario);
  }

  // ---- Excluir (admin) ----
  async function excluir(chamado) {
    setExcluindoId(null);
    await registrarLog(chamado.local, 'Excluído', `Chamado removido por ${usuario.nome}.`);
    const { error } = await supabase.from('manutencoes').delete().eq('id', chamado.id);
    if (error) { setErro('Não foi possível excluir. Detalhe técnico: ' + error.message); return; }
    setChamados(chamados.filter((c) => c.id !== chamado.id));
    mostrarAviso('Chamado excluído.');
  }

  // ---- Insights ----
  function dentroDoPeriodo(chamado) {
    if (insightPeriodo === 'TUDO') return true;
    const d = new Date(chamado.criado_em);
    const agora = new Date();
    if (insightPeriodo === 'DIA') return d.toDateString() === agora.toDateString();
    if (insightPeriodo === 'MES') return d.getMonth() === agora.getMonth() && d.getFullYear() === agora.getFullYear();
    if (insightPeriodo === 'ANO') return d.getFullYear() === agora.getFullYear();
    return true;
  }

  const chamadosInsight = chamados
    .filter(dentroDoPeriodo)
    .filter((c) => (insightLocal ? c.local === insightLocal : true));

  const totPendentes = chamadosInsight.filter((c) => c.status === 'PENDENTE').length;
  const totExecucao = chamadosInsight.filter((c) => c.status === 'EM_EXECUCAO').length;
  const totConcluidos = chamadosInsight.filter((c) => c.status === 'CONCLUIDO').length;

  const concluidosComTempo = chamadosInsight.filter((c) => c.status === 'CONCLUIDO' && c.concluido_em);
  const tempoMedio = concluidosComTempo.length > 0
    ? concluidosComTempo.reduce((soma, c) => soma + (new Date(c.concluido_em) - new Date(c.criado_em)) / 60000, 0) / concluidosComTempo.length
    : 0;

  // Ranking de locais (para o gráfico de barras)
  const contagemPorLocal = {};
  chamadosInsight.forEach((c) => { contagemPorLocal[c.local] = (contagemPorLocal[c.local] || 0) + 1; });
  const rankingLocais = Object.entries(contagemPorLocal)
    .sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxRanking = rankingLocais.length > 0 ? rankingLocais[0][1] : 1;

  const locaisUnicos = Array.from(new Set(chamados.map((c) => c.local))).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  // ---- Minhas Tarefas (técnico) ----
  const minhas = chamados.filter((c) => c.responsavel_id === usuario?.id);

  // ---- Log filtrado ----
  const termoLog = buscaLog.trim().toLowerCase();
  const logsFiltrados = logs.filter((l) =>
    !termoLog ||
    (l.local || '').toLowerCase().includes(termoLog) ||
    (l.acao || '').toLowerCase().includes(termoLog) ||
    (l.detalhe || '').toLowerCase().includes(termoLog) ||
    nomeDe(l.usuario_id).toLowerCase().includes(termoLog)
  );

  if (verificandoLogin) {
    return (
      <main className="conteudo">
        <p className="texto-suave">Verificando seu acesso…</p>
      </main>
    );
  }

  // Card de chamado (reutilizado no Kanban e em Minhas Tarefas)
  function CardChamado({ c, compacto }) {
    return (
      <div className="mn-card">
        <div className="mn-card-topo">
          <strong>{c.local}</strong>
          <span className="mn-tag" style={{ background: PRIORIDADE_COR[c.prioridade].fundo, color: PRIORIDADE_COR[c.prioridade].texto }}>
            {PRIORIDADE_LABEL[c.prioridade]}
          </span>
          {c.origem === 'GOVERNANCA' && <span className="mn-tag mn-tag-gov">Via checklist</span>}
        </div>
        <div className="mn-card-desc">{c.descricao}</div>
        <div className="mn-card-meta">
          {c.responsavel_id ? `Técnico: ${nomeDe(c.responsavel_id)}` : 'Sem técnico atribuído'} · aberto em {formatarDataHora(c.criado_em)}
        </div>

        {/* Atribuição rápida (só admin, e não em modo compacto) */}
        {souAdmin && !compacto && c.status !== 'CONCLUIDO' && (
          <select className="campo mn-atribuir" value={c.responsavel_id || ''}
            onChange={(e) => atribuir(c, e.target.value)} disabled={salvando}>
            <option value="">— Atribuir técnico —</option>
            {colegas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        )}

        {/* Botões de mover */}
        <div className="mn-card-acoes">
          {c.status === 'PENDENTE' && (
            <button type="button" className="botao botao-principal" onClick={() => moverStatus(c, 'EM_EXECUCAO')} disabled={salvando}>
              Iniciar Manutenção
            </button>
          )}
          {c.status === 'EM_EXECUCAO' && (
            <>
              <button type="button" className="botao botao-principal" onClick={() => moverStatus(c, 'CONCLUIDO')} disabled={salvando}>
                Concluir
              </button>
              <button type="button" className="botao botao-suave" onClick={() => moverStatus(c, 'PENDENTE')} disabled={salvando}>
                Voltar p/ Pendente
              </button>
            </>
          )}
          {c.status === 'CONCLUIDO' && (
            <>
              <span className="mn-concluido-info">
                ✅ por {nomeDe(c.concluido_por_id)} em {formatarDataHora(c.concluido_em)}
              </span>
              <button type="button" className="botao botao-suave" onClick={() => moverStatus(c, 'EM_EXECUCAO')} disabled={salvando}>
                Reabrir
              </button>
            </>
          )}
          {souAdmin && !compacto && (
            excluindoId === c.id ? (
              <span className="mn-confirmar">
                Excluir?
                <button type="button" className="botao botao-perigo" onClick={() => excluir(c)}>Sim</button>
                <button type="button" className="botao botao-suave" onClick={() => setExcluindoId(null)}>Não</button>
              </span>
            ) : (
              <button type="button" className="botao botao-suave" onClick={() => setExcluindoId(c.id)}>Excluir</button>
            )
          )}
        </div>
      </div>
    );
  }

  return (
    <main className="conteudo">
      <EstilosManutencao />

      <span className="olho">Reparos e chamados</span>
      <div className="barra-pagina">
        <h1 style={{ margin: 0 }}>Manutenção</h1>
        <button type="button" className="botao botao-principal"
          onClick={() => { setMostrarForm(!mostrarForm); setErroForm(''); }}>
          {mostrarForm ? 'Fechar' : '+ Nova Manutenção'}
        </button>
      </div>

      {aviso && <div className="aviso-sucesso">{aviso}</div>}
      {erro && <div className="aviso-erro">{erro}</div>}

      {/* Formulário de novo chamado */}
      {mostrarForm && (
        <form className="cartao" style={{ marginBottom: 16 }} onSubmit={abrirChamado}>
          <h2 style={{ fontSize: '1.15rem', marginBottom: 4 }}>Nova manutenção</h2>

          <label className="rotulo">Local *</label>
          <input className="campo" type="text" value={fLocal}
            onChange={(e) => setFLocal(e.target.value)} placeholder="Ex.: Apartamento 104, Piscina, Recepção…" />

          <label className="rotulo">Descrição do problema *</label>
          <textarea className="campo" rows={3} value={fDescricao}
            onChange={(e) => setFDescricao(e.target.value)} placeholder="Descreva o problema encontrado…" />

          <div className="mn-duas">
            <div>
              <label className="rotulo">Prioridade</label>
              <select className="campo" value={fPrioridade} onChange={(e) => setFPrioridade(e.target.value)}>
                {Object.entries(PRIORIDADE_LABEL).map(([chave, rotulo]) => (
                  <option key={chave} value={chave}>{rotulo}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="rotulo">Atribuir a (opcional)</label>
              <select className="campo" value={fResponsavel} onChange={(e) => setFResponsavel(e.target.value)}>
                <option value="">— Ninguém por enquanto —</option>
                {colegas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </div>
          </div>

          {erroForm && <div className="aviso-erro">{erroForm}</div>}

          <button type="submit" className="botao botao-principal" disabled={salvando} style={{ marginTop: 16 }}>
            {salvando ? 'Abrindo…' : 'Abrir Chamado'}
          </button>
        </form>
      )}

      {/* Sub-abas */}
      <nav className="mn-abas" aria-label="Seções">
        {souAdmin && (
          <button type="button" className={subAba === 'kanban' ? 'mn-aba mn-aba-ativa' : 'mn-aba'}
            onClick={() => setSubAba('kanban')}>
            Painel Kanban
          </button>
        )}
        <button type="button" className={subAba === 'minhas' ? 'mn-aba mn-aba-ativa' : 'mn-aba'}
          onClick={() => setSubAba('minhas')}>
          Minhas Tarefas <span className="mn-contador">{minhas.filter((c) => c.status !== 'CONCLUIDO').length}</span>
        </button>
        {souAdmin && (
          <button type="button" className={subAba === 'insights' ? 'mn-aba mn-aba-ativa' : 'mn-aba'}
            onClick={() => setSubAba('insights')}>
            Insights
          </button>
        )}
        {souAdmin && (
          <button type="button" className={subAba === 'log' ? 'mn-aba mn-aba-ativa' : 'mn-aba'}
            onClick={() => setSubAba('log')}>
            Log de Auditoria
          </button>
        )}
      </nav>

      {carregando && <p className="texto-suave">Carregando…</p>}

      {/* ================= KANBAN (admin) ================= */}
      {!carregando && subAba === 'kanban' && souAdmin && (
        <div className="mn-kanban">
          {['PENDENTE', 'EM_EXECUCAO', 'CONCLUIDO'].map((coluna) => {
            const daColuna = chamados
              .filter((c) => c.status === coluna)
              .sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em));
            return (
              <div key={coluna} className="mn-coluna">
                <div className="mn-coluna-titulo">
                  {STATUS_EMOJI[coluna]} {STATUS_LABEL[coluna]} <span className="mn-coluna-contador">{daColuna.length}</span>
                </div>
                <div className="mn-coluna-cards">
                  {daColuna.length === 0 ? (
                    <div className="mn-coluna-vazia">Nenhum chamado aqui.</div>
                  ) : (
                    daColuna.map((c) => <CardChamado key={c.id} c={c} />)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ================= MINHAS TAREFAS (técnico) — quadro Kanban ================= */}
      {!carregando && subAba === 'minhas' && (
        <div className="mn-kanban">
          {['PENDENTE', 'EM_EXECUCAO', 'CONCLUIDO'].map((coluna) => {
            const daColuna = minhas
              .filter((c) => c.status === coluna)
              .sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em));
            return (
              <div key={coluna} className="mn-coluna">
                <div className="mn-coluna-titulo">
                  {STATUS_EMOJI[coluna]} {STATUS_LABEL[coluna]} <span className="mn-coluna-contador">{daColuna.length}</span>
                </div>
                <div className="mn-coluna-cards">
                  {daColuna.length === 0 ? (
                    <div className="mn-coluna-vazia">Nenhum chamado aqui.</div>
                  ) : (
                    daColuna.map((c) => <CardChamado key={c.id} c={c} compacto />)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ================= INSIGHTS (admin) ================= */}
      {!carregando && subAba === 'insights' && souAdmin && (
        <section>
          <div className="mn-insight-filtros">
            <div className="mn-periodo">
              {[['DIA', 'Hoje'], ['MES', 'Este mês'], ['ANO', 'Este ano'], ['TUDO', 'Tudo']].map(([chave, rotulo]) => (
                <button key={chave} type="button"
                  className={insightPeriodo === chave ? 'mn-periodo-botao mn-periodo-ativo' : 'mn-periodo-botao'}
                  onClick={() => setInsightPeriodo(chave)}>
                  {rotulo}
                </button>
              ))}
            </div>
            <select className="campo" value={insightLocal} onChange={(e) => setInsightLocal(e.target.value)}>
              <option value="">Todos os locais</option>
              {locaisUnicos.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>

          <div className="mn-numeros">
            <div className="cartao mn-numero"><div className="mn-numero-valor">{totPendentes}</div><div className="mn-numero-rot">⏳ Pendentes</div></div>
            <div className="cartao mn-numero"><div className="mn-numero-valor">{totExecucao}</div><div className="mn-numero-rot">🔨 Em execução</div></div>
            <div className="cartao mn-numero"><div className="mn-numero-valor">{totConcluidos}</div><div className="mn-numero-rot">✅ Concluídos</div></div>
            <div className="cartao mn-numero"><div className="mn-numero-valor" style={{ fontSize: 20 }}>{duracaoLegivel(tempoMedio)}</div><div className="mn-numero-rot">⏱️ Tempo médio</div></div>
          </div>

          <div className="cartao" style={{ marginTop: 14 }}>
            <h3 style={{ fontSize: '1rem', marginTop: 0 }}>Locais que mais geram chamados</h3>
            {rankingLocais.length === 0 ? (
              <p className="texto-suave" style={{ fontSize: 14 }}>Sem dados no período selecionado.</p>
            ) : (
              <div className="mn-grafico">
                {rankingLocais.map(([local, qtd]) => (
                  <div key={local} className="mn-barra-linha">
                    <div className="mn-barra-rotulo" title={local}>{local}</div>
                    <div className="mn-barra-trilho">
                      <div className="mn-barra-preenchida" style={{ width: `${(qtd / maxRanking) * 100}%` }}>
                        <span>{qtd}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ================= LOG (admin) ================= */}
      {!carregando && subAba === 'log' && souAdmin && (
        <section>
          <input className="campo" type="search" value={buscaLog}
            onChange={(e) => setBuscaLog(e.target.value)}
            placeholder="Buscar no log (local, ação, usuário)…" style={{ marginBottom: 14 }} />
          <div className="mn-lista">
            {logsFiltrados.length === 0 ? (
              <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
                Nenhum registro no log.
              </div>
            ) : (
              logsFiltrados.map((l) => (
                <div key={l.id} className="cartao" style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                    {l.local && <strong>{l.local}</strong>}
                    <span className="mn-log-acao">{l.acao}</span>
                  </div>
                  {l.detalhe && <div style={{ fontSize: 14, marginTop: 3 }}>{l.detalhe}</div>}
                  <div className="texto-suave" style={{ fontSize: 12 }}>
                    {nomeDe(l.usuario_id)} · {formatarDataHora(l.data_hora)}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      )}
    </main>
  );
}

// ---- Estilos específicos deste módulo ---------------------------------------

function EstilosManutencao() {
  return (
    <style>{`
      .mn-abas { display: flex; gap: 6px; overflow-x: auto; margin: 14px 0 16px; padding-bottom: 4px; }
      .mn-aba {
        border: 1px solid var(--borda); background: var(--branco); color: var(--tinta);
        border-radius: 999px; padding: 10px 16px; font-size: 14px; font-weight: 600;
        cursor: pointer; white-space: nowrap; min-height: 42px;
      }
      .mn-aba-ativa { background: var(--marca); border-color: var(--marca); color: var(--branco); }
      .mn-contador { display: inline-block; margin-left: 6px; font-size: 12px; background: rgba(0,0,0,0.10); border-radius: 999px; padding: 1px 8px; }
      .mn-aba-ativa .mn-contador { background: rgba(255,255,255,0.22); }

      .mn-duas { display: grid; grid-template-columns: 1fr; gap: 0 14px; }

      /* Kanban */
      .mn-kanban { display: grid; grid-template-columns: 1fr; gap: 14px; }
      .mn-coluna { background: var(--fundo); border: 1px solid var(--borda); border-radius: 14px; padding: 12px; }
      .mn-coluna-titulo { font-weight: 700; font-size: 15px; margin-bottom: 10px; display: flex; align-items: center; gap: 6px; }
      .mn-coluna-contador { font-size: 12px; background: var(--branco); border: 1px solid var(--borda); border-radius: 999px; padding: 1px 8px; }
      .mn-coluna-cards { display: flex; flex-direction: column; gap: 10px; }
      .mn-coluna-vazia { text-align: center; color: var(--texto-suave); font-size: 13px; padding: 16px 8px; }

      .mn-lista { display: flex; flex-direction: column; gap: 10px; }

      .mn-card { background: var(--branco); border: 1px solid var(--borda); border-radius: 12px; padding: 14px; box-shadow: var(--sombra); }
      .mn-card-topo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .mn-card-topo strong { font-size: 15px; }
      .mn-tag { display: inline-block; font-size: 11px; font-weight: 700; border-radius: 999px; padding: 3px 9px; }
      .mn-tag-gov { background: #F4ECD7; color: var(--latao-texto); }
      .mn-card-desc { font-size: 14px; margin: 8px 0; }
      .mn-card-meta { font-size: 12px; color: var(--texto-suave); }
      .mn-atribuir { margin-top: 10px; }
      .mn-card-acoes { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; align-items: center; }
      .mn-concluido-info { font-size: 12px; color: var(--sucesso-texto); }
      .mn-confirmar { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--erro-texto); flex-wrap: wrap; }

      .mn-log-acao { font-size: 12px; font-weight: 700; color: var(--marca); background: var(--marca-clara); border-radius: 999px; padding: 2px 9px; }

      /* Insights */
      .mn-insight-filtros { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
      .mn-periodo { display: flex; gap: 6px; flex-wrap: wrap; }
      .mn-periodo-botao {
        border: 1px solid var(--borda); background: var(--branco); color: var(--tinta);
        border-radius: 999px; padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer;
      }
      .mn-periodo-ativo { background: var(--marca); border-color: var(--marca); color: var(--branco); }

      .mn-numeros { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .mn-numero { text-align: center; padding: 18px 12px; }
      .mn-numero-valor { font-family: var(--fonte-titulo); font-weight: 700; font-size: 30px; color: var(--marca); }
      .mn-numero-rot { font-size: 13px; color: var(--texto-suave); margin-top: 4px; }

      .mn-grafico { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
      .mn-barra-linha { display: grid; grid-template-columns: 110px 1fr; gap: 10px; align-items: center; }
      .mn-barra-rotulo { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .mn-barra-trilho { background: var(--fundo); border-radius: 999px; height: 26px; overflow: hidden; }
      .mn-barra-preenchida {
        background: var(--marca); height: 100%; border-radius: 999px;
        display: flex; align-items: center; justify-content: flex-end;
        min-width: 26px; transition: width 0.3s ease;
      }
      .mn-barra-preenchida span { color: #FFFFFF; font-size: 12px; font-weight: 700; padding: 0 10px; }

      @media (min-width: 640px) {
        .mn-duas { grid-template-columns: 1fr 1fr; }
        .mn-numeros { grid-template-columns: 1fr 1fr 1fr 1fr; }
        .mn-insight-filtros { flex-direction: row; align-items: center; justify-content: space-between; }
        .mn-insight-filtros .campo { width: auto; min-width: 200px; }
      }
      @media (min-width: 900px) {
        .mn-kanban { grid-template-columns: 1fr 1fr 1fr; align-items: start; }
      }
    `}</style>
  );
}
