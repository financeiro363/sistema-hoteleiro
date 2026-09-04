'use client';

// ============================================================================
// PLANEJADOR DE ARRUMAÇÃO
// ============================================================================
// Uma página só, que se adapta por papel (mesmo padrão de Governança e
// Manutenção): Admin vê o calendário + gerenciamento completo; Colaborador
// vê um quadro Kanban só com as PRÓPRIAS arrumações do dia — e só se tiver
// a permissão "pode_ver_tarefas_do_dia" marcada (senão, nem acessa).
//
// Tabela: "arrumacoes_planejadas" — nome escolhido de propósito pra não
// colidir com "tarefas" (Solicitações) nem "tarefas_pessoais" (bloco de
// notas pessoal), que já existem no sistema.
// ============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { bloquearSeNaoPermitido } from '../../lib/restricaoAcesso';

const PRIORIDADE_LABEL = { BAIXA: 'Baixa', MEDIA: 'Média', ALTA: 'Alta' };
const PRIORIDADE_COR = {
  BAIXA: { fundo: '#DDF2E4', texto: '#1E6B3C' },
  MEDIA: { fundo: '#FDF3D7', texto: '#8A6100' },
  ALTA: { fundo: '#FBDDDD', texto: '#A31212' },
};
const STATUS_LABEL = { PENDENTE: 'Pendente', EM_EXECUCAO: 'Em Execução', CONCLUIDA: 'Concluída' };
const STATUS_EMOJI = { PENDENTE: '⌛', EM_EXECUCAO: '🧹', CONCLUIDA: '✅' };

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const DIAS_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatarDataBR(iso) {
  if (!iso) return '—';
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

export default function PlanejadorArrumacao() {
  const router = useRouter();
  const [verificandoLogin, setVerificandoLogin] = useState(true);
  const [usuario, setUsuario] = useState(null);

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
      if (bloquearSeNaoPermitido(dadosUsuario.papel, router)) return;
      setVerificandoLogin(false);
    }
    verificar();
    return () => { ativo = false; };
  }, [router]);

  if (verificandoLogin) {
    return <main className="conteudo"><p className="texto-suave">Verificando seu acesso…</p></main>;
  }

  if (usuario.papel === 'COLABORADOR' && !usuario.pode_ver_tarefas_do_dia) {
    return (
      <main className="conteudo">
        <span className="olho">Operações</span>
        <h1>Minhas Arrumações</h1>
        <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
          Você ainda não tem permissão pra ver suas arrumações do dia. Peça pro administrador
          liberar em Administração → Usuários.
        </div>
      </main>
    );
  }

  return usuario.papel === 'ADMIN' ? <VisaoAdmin usuario={usuario} /> : <VisaoColaborador usuario={usuario} />;
}

// ============================================================================
// ADMIN — calendário + gerenciamento
// ============================================================================

function VisaoAdmin({ usuario }) {
  const [arrumacoes, setArrumacoes] = useState([]);
  const [colaboradores, setColaboradores] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  const hoje = new Date();
  const [mesVisto, setMesVisto] = useState(hoje.getMonth());
  const [anoVisto, setAnoVisto] = useState(hoje.getFullYear());
  const [diaSelecionado, setDiaSelecionado] = useState(null); // 'AAAA-MM-DD'

  const [mostrarModal, setMostrarModal] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [fData, setFData] = useState(hojeISO());
  const [fTitulo, setFTitulo] = useState('');
  const [fPrioridade, setFPrioridade] = useState('MEDIA');
  const [fResponsavelId, setFResponsavelId] = useState('');
  const [fDescricao, setFDescricao] = useState('');
  const [buscaResponsavel, setBuscaResponsavel] = useState('');
  const [erroModal, setErroModal] = useState('');
  const [salvandoModal, setSalvandoModal] = useState(false);
  const [excluindoId, setExcluindoId] = useState(null);

  function mostrarAviso(texto) { setAviso(texto); setTimeout(() => setAviso(''), 5000); }

  const carregarTudo = useCallback(async () => {
    setCarregando(true);
    const [{ data: arr, error: erroArr }, { data: colegas }] = await Promise.all([
      supabase.from('arrumacoes_planejadas').select('*').order('data', { ascending: true }),
      supabase.from('usuarios').select('id, nome').eq('hotel_id', usuario.hotel_id).eq('papel', 'COLABORADOR').eq('ativo', true).order('nome'),
    ]);
    if (erroArr) setErro('Não foi possível carregar. Detalhe técnico: ' + erroArr.message);
    setArrumacoes(arr || []);
    setColaboradores(colegas || []);
    setCarregando(false);
  }, [usuario.hotel_id]);

  useEffect(() => { carregarTudo(); }, [carregarTudo]);

  function nomeDe(id) { return colaboradores.find((c) => c.id === id)?.nome || '—'; }

  // ---- Estatísticas ----
  const noMesVisto = arrumacoes.filter((a) => {
    const [ano, mes] = a.data.split('-');
    return Number(ano) === anoVisto && Number(mes) - 1 === mesVisto;
  });
  const totalPendentes = arrumacoes.filter((a) => a.status === 'PENDENTE').length;
  const totalEmExecucao = arrumacoes.filter((a) => a.status === 'EM_EXECUCAO').length;
  const totalConcluidas = arrumacoes.filter((a) => a.status === 'CONCLUIDA').length;

  // ---- Calendário ----
  const primeiroDiaSemana = new Date(anoVisto, mesVisto, 1).getDay();
  const totalDiasMes = new Date(anoVisto, mesVisto + 1, 0).getDate();
  const celulas = [];
  for (let i = 0; i < primeiroDiaSemana; i++) celulas.push(null);
  for (let dia = 1; dia <= totalDiasMes; dia++) celulas.push(dia);

  function isoDoDia(dia) { return `${anoVisto}-${String(mesVisto + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`; }
  function arrumacoesDoDia(iso) { return arrumacoes.filter((a) => a.data === iso); }

  function mudarMes(delta) {
    let novoMes = mesVisto + delta;
    let novoAno = anoVisto;
    if (novoMes < 0) { novoMes = 11; novoAno -= 1; }
    if (novoMes > 11) { novoMes = 0; novoAno += 1; }
    setMesVisto(novoMes); setAnoVisto(novoAno);
    setDiaSelecionado(null);
  }

  // ---- Modal ----
  function abrirNovo(diaClicadoIso) {
    setEditandoId(null);
    setFData(diaClicadoIso || hojeISO());
    setFTitulo(''); setFPrioridade('MEDIA'); setFResponsavelId(''); setFDescricao(''); setBuscaResponsavel('');
    setErroModal('');
    setMostrarModal(true);
  }

  function abrirEdicao(item) {
    setEditandoId(item.id);
    setFData(item.data); setFTitulo(item.titulo); setFPrioridade(item.prioridade);
    setFResponsavelId(String(item.responsavel_id)); setFDescricao(item.descricao || '');
    setBuscaResponsavel(nomeDe(item.responsavel_id));
    setErroModal('');
    setMostrarModal(true);
  }

  async function salvar(evento) {
    evento.preventDefault();
    if (salvandoModal) return;
    setErroModal('');
    if (!fData) { setErroModal('Escolha a data.'); return; }
    if (!fTitulo.trim()) { setErroModal('Informe o título.'); return; }
    if (!fResponsavelId) { setErroModal('Escolha o responsável.'); return; }

    const dados = {
      data: fData, titulo: fTitulo.trim(), prioridade: fPrioridade,
      responsavel_id: Number(fResponsavelId), descricao: fDescricao.trim() || null,
    };

    setSalvandoModal(true);
    if (editandoId) {
      const { error } = await supabase.from('arrumacoes_planejadas')
        .update({ ...dados, atualizado_em: new Date().toISOString() }).eq('id', editandoId);
      setSalvandoModal(false);
      if (error) { setErroModal('Não foi possível salvar. Detalhe técnico: ' + error.message); return; }
      mostrarAviso('Arrumação atualizada!');
    } else {
      const { error } = await supabase.from('arrumacoes_planejadas')
        .insert({ ...dados, status: 'PENDENTE', hotel_id: usuario.hotel_id, criado_por_id: usuario.id });
      setSalvandoModal(false);
      if (error) { setErroModal('Não foi possível cadastrar. Detalhe técnico: ' + error.message); return; }
      mostrarAviso('Arrumação criada!');
    }
    setMostrarModal(false);
    carregarTudo();
  }

  async function excluir(item) {
    setExcluindoId(null);
    const { error } = await supabase.from('arrumacoes_planejadas').delete().eq('id', item.id);
    if (error) { setErro('Não foi possível excluir. Detalhe técnico: ' + error.message); return; }
    mostrarAviso('Arrumação excluída.');
    carregarTudo();
  }

  const colaboradoresFiltrados = colaboradores.filter((c) =>
    c.nome.toLowerCase().includes(buscaResponsavel.trim().toLowerCase())
  );

  const listaDoDia = diaSelecionado ? arrumacoesDoDia(diaSelecionado) : [];

  return (
    <main className="conteudo pa-conteudo">
      <EstilosPlanejador />
      <span className="olho">Operações</span>
      <div className="pa-cabecalho">
        <h1 style={{ margin: 0 }}>Gerenciador de Tarefas</h1>
        <button type="button" className="botao botao-principal" onClick={() => abrirNovo(diaSelecionado)}>
          + Nova Arrumação
        </button>
      </div>

      {erro && <div className="aviso-erro">{erro}</div>}
      {aviso && <div className="aviso-sucesso">{aviso}</div>}

      <div className="pa-cards-resumo">
        <div className="pa-card-resumo"><span className="pa-card-numero">{noMesVisto.length}</span><span className="pa-card-rotulo">Planejadas (mês)</span></div>
        <div className="pa-card-resumo"><span className="pa-card-numero">{totalPendentes}</span><span className="pa-card-rotulo">⌛ Pendentes</span></div>
        <div className="pa-card-resumo"><span className="pa-card-numero">{totalEmExecucao}</span><span className="pa-card-rotulo">🧹 Em Execução</span></div>
        <div className="pa-card-resumo"><span className="pa-card-numero">{totalConcluidas}</span><span className="pa-card-rotulo">✅ Concluídas</span></div>
      </div>

      {carregando ? <p className="texto-suave">Carregando…</p> : (
        <>
          <div className="cartao pa-calendario">
            <div className="pa-calendario-nav">
              <button type="button" className="botao botao-suave" onClick={() => mudarMes(-1)}>‹</button>
              <strong>{MESES[mesVisto]} de {anoVisto}</strong>
              <button type="button" className="botao botao-suave" onClick={() => mudarMes(1)}>›</button>
            </div>
            <div className="pa-grade-semana">
              {DIAS_SEMANA.map((d, i) => <div key={i} className="pa-dia-semana">{d}</div>)}
            </div>
            <div className="pa-grade-mes">
              {celulas.map((dia, i) => {
                if (dia === null) return <div key={`vazio-${i}`} className="pa-celula pa-celula-vazia" />;
                const iso = isoDoDia(dia);
                const doDia = arrumacoesDoDia(iso);
                const ehHoje = iso === hojeISO();
                return (
                  <button key={iso} type="button"
                    className={`pa-celula ${diaSelecionado === iso ? 'pa-celula-selecionada' : ''} ${ehHoje ? 'pa-celula-hoje' : ''}`}
                    onClick={() => setDiaSelecionado(diaSelecionado === iso ? null : iso)}>
                    <span className="pa-celula-numero">{dia}</span>
                    {doDia.length > 0 && (
                      <div className="pa-celula-barras">
                        {doDia.slice(0, 3).map((a) => (
                          <span key={a.id} className="pa-barra" style={{ background: PRIORIDADE_COR[a.prioridade].texto }} />
                        ))}
                        {doDia.length > 3 && <span className="pa-celula-mais">+{doDia.length - 3}</span>}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {diaSelecionado && (
            <section style={{ marginTop: 16 }}>
              <h2 style={{ fontSize: '1.1rem' }}>Arrumações em {formatarDataBR(diaSelecionado)}</h2>
              {listaDoDia.length === 0 ? (
                <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
                  Nenhuma arrumação planejada pra esse dia.
                </div>
              ) : (
                <div className="pa-lista-dia">
                  {listaDoDia.map((a) => (
                    <div key={a.id} className="cartao pa-item-dia">
                      <div className="pa-item-dia-esq">
                        <div className="pa-item-dia-topo">
                          <strong>{a.titulo}</strong>
                          <span className="pa-badge" style={{ background: PRIORIDADE_COR[a.prioridade].fundo, color: PRIORIDADE_COR[a.prioridade].texto }}>
                            {PRIORIDADE_LABEL[a.prioridade]}
                          </span>
                          <span className="pa-badge" style={{ background: '#EAF0FB', color: '#2C4C7C' }}>
                            {STATUS_EMOJI[a.status]} {STATUS_LABEL[a.status]}
                          </span>
                        </div>
                        <div className="texto-suave" style={{ fontSize: 13 }}>Responsável: {nomeDe(a.responsavel_id)}</div>
                        {a.descricao && <div className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>{a.descricao}</div>}
                      </div>
                      <div className="pa-item-dia-acoes">
                        <button type="button" className="botao botao-suave" onClick={() => abrirEdicao(a)}>Editar</button>
                        {excluindoId === a.id ? (
                          <span className="pa-confirmar">
                            Excluir?
                            <button type="button" className="botao botao-perigo" onClick={() => excluir(a)}>Sim</button>
                            <button type="button" className="botao botao-suave" onClick={() => setExcluindoId(null)}>Não</button>
                          </span>
                        ) : (
                          <button type="button" className="botao botao-suave" onClick={() => setExcluindoId(a.id)}>Excluir</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {mostrarModal && (
        <div className="pa-overlay" role="dialog" aria-modal="true">
          <div className="pa-modal">
            <div className="pa-modal-topo">
              <h2 style={{ fontSize: '1.15rem', margin: 0 }}>{editandoId ? 'Editar arrumação' : 'Nova Arrumação'}</h2>
              <button type="button" className="pa-fechar" onClick={() => setMostrarModal(false)} aria-label="Fechar">✕</button>
            </div>
            <form onSubmit={salvar}>
              <label className="rotulo">Data *</label>
              <input className="campo" type="date" value={fData} onChange={(e) => setFData(e.target.value)} />

              <label className="rotulo">Título *</label>
              <input className="campo" type="text" value={fTitulo} onChange={(e) => setFTitulo(e.target.value)} placeholder="Ex.: Arrumação geral do 3º andar" />

              <label className="rotulo">Prioridade</label>
              <select className="campo" value={fPrioridade} onChange={(e) => setFPrioridade(e.target.value)}>
                {Object.entries(PRIORIDADE_LABEL).map(([chave, rotulo]) => <option key={chave} value={chave}>{rotulo}</option>)}
              </select>

              <label className="rotulo">Responsável *</label>
              <input className="campo" type="text" value={buscaResponsavel}
                onChange={(e) => { setBuscaResponsavel(e.target.value); setFResponsavelId(''); }}
                placeholder="Digite pra buscar um colaborador…" />
              {buscaResponsavel && !fResponsavelId && (
                <div className="pa-lista-busca">
                  {colaboradoresFiltrados.length === 0 ? (
                    <div className="pa-busca-vazia">Ninguém encontrado.</div>
                  ) : colaboradoresFiltrados.map((c) => (
                    <button key={c.id} type="button" className="pa-busca-item"
                      onClick={() => { setFResponsavelId(String(c.id)); setBuscaResponsavel(c.nome); }}>
                      {c.nome}
                    </button>
                  ))}
                </div>
              )}
              {colaboradores.length === 0 && (
                <p className="texto-suave" style={{ fontSize: 12, marginTop: 4 }}>
                  Nenhum colaborador cadastrado ainda.
                </p>
              )}

              <label className="rotulo">Descrição / Observações</label>
              <textarea className="campo" rows={3} value={fDescricao} onChange={(e) => setFDescricao(e.target.value)}
                placeholder="Detalhe o que precisa ser feito…" />

              {erroModal && <div className="aviso-erro">{erroModal}</div>}
              <div className="pa-modal-botoes">
                <button type="submit" className="botao botao-principal" disabled={salvandoModal}>
                  {salvandoModal ? 'Salvando…' : editandoId ? 'Salvar alterações' : 'Criar arrumação'}
                </button>
                <button type="button" className="botao botao-suave" onClick={() => setMostrarModal(false)}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

// ============================================================================
// COLABORADOR — quadro Kanban, só do dia
// ============================================================================

function VisaoColaborador({ usuario }) {
  const [arrumacoes, setArrumacoes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [movendoId, setMovendoId] = useState(null);

  const carregarTudo = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase
      .from('arrumacoes_planejadas').select('*')
      .eq('responsavel_id', usuario.id).eq('data', hojeISO())
      .order('prioridade', { ascending: false });
    if (error) setErro('Não foi possível carregar. Detalhe técnico: ' + error.message);
    setArrumacoes(data || []);
    setCarregando(false);
  }, [usuario.id]);

  useEffect(() => { carregarTudo(); }, [carregarTudo]);

  async function mudarStatus(item, novoStatus) {
    setMovendoId(item.id);
    const { error } = await supabase.from('arrumacoes_planejadas')
      .update({ status: novoStatus, atualizado_em: new Date().toISOString() }).eq('id', item.id);
    setMovendoId(null);
    if (error) { setErro('Não foi possível atualizar. Detalhe técnico: ' + error.message); return; }
    setArrumacoes(arrumacoes.map((a) => (a.id === item.id ? { ...a, status: novoStatus } : a)));
  }

  function Card({ item }) {
    return (
      <div className="cartao pa-card-kanban">
        <div className="pa-card-topo">
          <strong>{item.titulo}</strong>
          <span className="pa-badge" style={{ background: PRIORIDADE_COR[item.prioridade].fundo, color: PRIORIDADE_COR[item.prioridade].texto }}>
            {PRIORIDADE_LABEL[item.prioridade]}
          </span>
        </div>
        <div className="texto-suave" style={{ fontSize: 12 }}>{formatarDataBR(item.data)} · {usuario.nome}</div>
        {item.descricao && <p style={{ fontSize: 13, margin: '6px 0' }}>{item.descricao}</p>}
        <div className="pa-card-acoes">
          {item.status === 'PENDENTE' && (
            <button type="button" className="botao botao-principal" disabled={movendoId === item.id}
              onClick={() => mudarStatus(item, 'EM_EXECUCAO')}>Mover para Em Execução</button>
          )}
          {item.status === 'EM_EXECUCAO' && (
            <>
              <button type="button" className="botao botao-principal" disabled={movendoId === item.id}
                onClick={() => mudarStatus(item, 'CONCLUIDA')}>Concluir</button>
              <button type="button" className="botao botao-suave" disabled={movendoId === item.id}
                onClick={() => mudarStatus(item, 'PENDENTE')}>Voltar</button>
            </>
          )}
          {item.status === 'CONCLUIDA' && (
            <button type="button" className="botao botao-suave" disabled={movendoId === item.id}
              onClick={() => mudarStatus(item, 'EM_EXECUCAO')}>Reabrir</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <main className="conteudo pa-conteudo">
      <EstilosPlanejador />
      <span className="olho">Operações</span>
      <h1>Minhas Arrumações — Hoje</h1>
      <p className="texto-suave" style={{ fontSize: 13 }}>{formatarDataBR(hojeISO())}</p>
      {erro && <div className="aviso-erro">{erro}</div>}

      {carregando ? <p className="texto-suave">Carregando…</p> : (
        <div className="pa-kanban">
          {['PENDENTE', 'EM_EXECUCAO', 'CONCLUIDA'].map((coluna) => {
            const doColuna = arrumacoes.filter((a) => a.status === coluna);
            return (
              <div key={coluna} className="pa-coluna">
                <div className="pa-coluna-titulo">
                  {STATUS_EMOJI[coluna]} {STATUS_LABEL[coluna]} <span className="pa-coluna-contador">{doColuna.length}</span>
                </div>
                <div className="pa-coluna-cards">
                  {doColuna.length === 0 ? (
                    <div className="pa-coluna-vazia">Nada por aqui.</div>
                  ) : doColuna.map((item) => <Card key={item.id} item={item} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

// ---- Estilos ----------------------------------------------------------------

function EstilosPlanejador() {
  return (
    <style>{`
      .pa-conteudo { max-width: 900px; }
      .pa-cabecalho { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; }

      .pa-cards-resumo { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 16px; }
      @media (min-width: 640px) { .pa-cards-resumo { grid-template-columns: repeat(4, 1fr); } }
      .pa-card-resumo {
        background: var(--branco); border: 1px solid var(--borda); border-radius: 12px;
        padding: 14px; display: flex; flex-direction: column; gap: 2px;
      }
      .pa-card-numero { font-size: 24px; font-weight: 700; }
      .pa-card-rotulo { font-size: 12px; color: var(--texto-suave); text-transform: uppercase; letter-spacing: 0.02em; }

      .pa-calendario-nav { display: flex; align-items: center; justify-content: center; gap: 16px; margin-bottom: 10px; }
      .pa-grade-semana { display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; font-size: 12px; color: var(--texto-suave); margin-bottom: 4px; }
      .pa-grade-mes { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
      .pa-celula {
        aspect-ratio: 1; border: 1px solid var(--borda); border-radius: 8px; background: var(--branco);
        cursor: pointer; padding: 4px; display: flex; flex-direction: column; align-items: center; gap: 3px;
        font-family: inherit;
      }
      .pa-celula-vazia { border: none; background: none; cursor: default; }
      .pa-celula-numero { font-size: 13px; }
      .pa-celula-hoje { border-color: var(--marca); }
      .pa-celula-selecionada { background: var(--marca-clara); border-color: var(--marca); }
      .pa-celula-barras { display: flex; gap: 2px; flex-wrap: wrap; justify-content: center; }
      .pa-barra { width: 6px; height: 6px; border-radius: 50%; }
      .pa-celula-mais { font-size: 9px; color: var(--texto-suave); }

      .pa-lista-dia { display: flex; flex-direction: column; gap: 10px; }
      .pa-item-dia { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; flex-wrap: wrap; }
      .pa-item-dia-topo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .pa-item-dia-acoes { display: flex; gap: 8px; flex-shrink: 0; }
      .pa-badge { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; }
      .pa-confirmar { display: flex; align-items: center; gap: 6px; font-size: 13px; }

      .pa-overlay {
        position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex;
        align-items: center; justify-content: center; padding: 16px; z-index: 50;
      }
      .pa-modal { background: var(--branco); border-radius: 14px; padding: 20px; width: 100%; max-width: 480px; max-height: 90vh; overflow-y: auto; }
      .pa-modal-topo { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
      .pa-fechar { border: none; background: none; font-size: 18px; cursor: pointer; }
      .pa-modal-botoes { display: flex; gap: 10px; margin-top: 14px; }

      .pa-lista-busca {
        border: 1px solid var(--borda); border-radius: 10px; margin-top: -8px; margin-bottom: 10px;
        max-height: 160px; overflow-y: auto;
      }
      .pa-busca-item {
        display: block; width: 100%; text-align: left; padding: 8px 12px; border: none; background: none;
        cursor: pointer; font-family: inherit; font-size: 14px; border-bottom: 1px solid var(--borda);
      }
      .pa-busca-item:last-child { border-bottom: none; }
      .pa-busca-item:hover { background: var(--fundo); }
      .pa-busca-vazia { padding: 10px 12px; font-size: 13px; color: var(--texto-suave); }

      .pa-kanban { display: grid; grid-template-columns: 1fr; gap: 14px; }
      @media (min-width: 860px) { .pa-kanban { grid-template-columns: 1fr 1fr 1fr; align-items: start; } }
      .pa-coluna { background: var(--fundo); border: 1px solid var(--borda); border-radius: 14px; padding: 12px; }
      .pa-coluna-titulo { font-weight: 700; font-size: 15px; margin-bottom: 10px; display: flex; align-items: center; gap: 6px; }
      .pa-coluna-contador { font-size: 12px; background: var(--branco); border: 1px solid var(--borda); border-radius: 999px; padding: 1px 8px; }
      .pa-coluna-cards { display: flex; flex-direction: column; gap: 10px; }
      .pa-coluna-vazia { text-align: center; color: var(--texto-suave); font-size: 13px; padding: 16px 8px; }
      .pa-card-kanban { display: flex; flex-direction: column; gap: 4px; }
      .pa-card-topo { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
      .pa-card-acoes { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
    `}</style>
  );
}
