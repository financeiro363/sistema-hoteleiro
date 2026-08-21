'use client';

// ============================================================================
// OCORRÊNCIAS (Gestão de Incidentes)
// - Banner de aviso legal compulsório no topo (texto exato do protótipo)
// - Registro: título, categoria (7), gravidade (4), data do ocorrido,
//   local/setor, descrição (até 2000 caracteres) e medidas tomadas
// - Feed com barra colorida por gravidade, filtros (categoria, gravidade,
//   status), busca e contador de relatos
// - Ciclo de vida: Aberto → Em Andamento → Resolvido (com quem/quando)
// - Atribuição de responsável (quem vai resolver)
// - Andamentos (linha do tempo de comentários/mudanças) por ocorrência
// - Excluir: só ADMIN (garantido também no banco via RLS)
// ============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { bloquearSeNaoPermitido } from '../../lib/restricaoAcesso';

// ---- Constantes (mesmas do protótipo) ---------------------------------------

const CATEGORIA_LABEL = {
  INFRAESTRUTURA: '🏗️ Infraestrutura',
  SEGURANCA: '🔒 Segurança',
  COMPORTAMENTO: '🤝 Comportamento',
  PATRIMONIO: '🏛️ Patrimônio',
  SAUDE: '❤️ Saúde',
  FINANCEIRO: '💰 Financeiro',
  OUTROS: '📌 Outros',
};

const GRAVIDADE_LABEL = {
  BAIXA: '🟢 Baixa',
  MEDIA: '🟡 Média',
  ALTA: '🔴 Alta',
  CRITICA: '🚨 Crítica',
};
const GRAVIDADE_COR = {
  BAIXA: '#1E6B3C',
  MEDIA: '#8A6100',
  ALTA: '#A34E00',
  CRITICA: '#A31212',
};

const STATUS_LABEL = {
  ABERTO: 'Pendente / Aberto',
  EM_ANDAMENTO: 'Em Andamento',
  RESOLVIDO: 'Resolvido',
};
const STATUS_COR = {
  ABERTO: { fundo: '#FBDDDD', texto: '#A31212' },
  EM_ANDAMENTO: { fundo: '#FDF3D7', texto: '#8A6100' },
  RESOLVIDO: { fundo: '#DDF2E4', texto: '#1E6B3C' },
};

const LIMITE_DESCRICAO = 2000;

// ---- Funções de apoio -------------------------------------------------------

function formatarData(valor) {
  if (!valor) return '—';
  const [ano, mes, dia] = String(valor).slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

function formatarDataHora(valor) {
  if (!valor) return '—';
  try {
    return new Date(valor).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch (e) { return String(valor); }
}

// ---- Componente principal ---------------------------------------------------

export default function Ocorrencias() {
  const router = useRouter();

  const [verificandoLogin, setVerificandoLogin] = useState(true);
  const [usuario, setUsuario] = useState(null);
  const [colegas, setColegas] = useState([]);
  const [nomesUsuarios, setNomesUsuarios] = useState({});

  const [ocorrencias, setOcorrencias] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);

  // Filtros
  const [busca, setBusca] = useState('');
  const [fCategoria, setFCategoria] = useState('');
  const [fGravidade, setFGravidade] = useState('');
  const [fStatus, setFStatus] = useState('');

  // Formulário de novo relato
  const [mostrarForm, setMostrarForm] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [categoria, setCategoria] = useState('INFRAESTRUTURA');
  const [gravidade, setGravidade] = useState('MEDIA');
  const [dataOcorrido, setDataOcorrido] = useState(new Date().toISOString().slice(0, 10));
  const [localSetor, setLocalSetor] = useState('');
  const [descricao, setDescricao] = useState('');
  const [medidas, setMedidas] = useState('');
  const [erroForm, setErroForm] = useState('');

  // Detalhe / andamentos
  const [detalhe, setDetalhe] = useState(null);
  const [andamentos, setAndamentos] = useState([]);
  const [carregandoAndamentos, setCarregandoAndamentos] = useState(false);
  const [novoComentario, setNovoComentario] = useState('');
  const [excluindo, setExcluindo] = useState(false);

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
      if (bloquearSeNaoPermitido(dadosUsuario.papel, router)) return;
      setVerificandoLogin(false);
    }
    verificar();
    return () => { ativo = false; };
  }, [router]);

  const carregarTudo = useCallback(async () => {
    setCarregando(true);
    setErro('');

    const { data: pessoas } = await supabase
      .from('usuarios').select('id, nome, papel').eq('hotel_id', usuario.hotel_id).order('nome', { ascending: true });
    if (pessoas) {
      setColegas(pessoas);
      const mapa = {};
      pessoas.forEach((p) => { mapa[p.id] = p.nome; });
      setNomesUsuarios(mapa);
    }

    const { data: lista, error } = await supabase
      .from('ocorrencias').select('*').order('registrado_em', { ascending: false });
    if (error) setErro('Não foi possível carregar as ocorrências. Detalhe técnico: ' + error.message);
    else setOcorrencias(lista || []);

    setCarregando(false);
  }, [usuario]);

  useEffect(() => {
    if (usuario) carregarTudo();
  }, [usuario, carregarTudo]);

  // ---- Registrar andamento ----
  async function registrarAndamento(ocorrenciaId, acao, texto) {
    await supabase.from('ocorrencias_andamentos').insert({
      ocorrencia_id: ocorrenciaId, usuario_id: usuario.id, acao, texto: texto || null, hotel_id: usuario.hotel_id,
    });
  }

  // ---- Novo relato ----
  async function registrarOcorrencia(evento) {
    evento.preventDefault();
    if (salvando) return;
    setErroForm('');

    if (!titulo.trim()) { setErroForm('Escreva o título da ocorrência.'); return; }
    if (!dataOcorrido) { setErroForm('Informe a data do ocorrido.'); return; }
    if (!descricao.trim()) { setErroForm('Descreva o que aconteceu.'); return; }
    if (descricao.length > LIMITE_DESCRICAO) { setErroForm(`A descrição passou de ${LIMITE_DESCRICAO} caracteres.`); return; }

    setSalvando(true);
    const { data: criada, error } = await supabase
      .from('ocorrencias')
      .insert({
        titulo: titulo.trim(),
        categoria,
        gravidade,
        data_ocorrido: dataOcorrido,
        local_setor: localSetor.trim() || null,
        descricao: descricao.trim(),
        medidas_tomadas: medidas.trim() || null,
        registrado_por_id: usuario.id,
        hotel_id: usuario.hotel_id,
      })
      .select().single();
    setSalvando(false);
    if (error) { setErroForm('Não foi possível registrar. Detalhe técnico: ' + error.message); return; }

    await registrarAndamento(criada.id, 'Registrou', `Ocorrência registrada com gravidade "${GRAVIDADE_LABEL[gravidade]}".`);

    setTitulo(''); setCategoria('INFRAESTRUTURA'); setGravidade('MEDIA');
    setDataOcorrido(new Date().toISOString().slice(0, 10));
    setLocalSetor(''); setDescricao(''); setMedidas('');
    setMostrarForm(false);
    mostrarAviso('Ocorrência registrada!');
    carregarTudo();
  }

  // ---- Detalhe / andamentos ----
  const carregarAndamentos = useCallback(async (ocorrenciaId) => {
    setCarregandoAndamentos(true);
    const { data } = await supabase
      .from('ocorrencias_andamentos').select('*')
      .eq('ocorrencia_id', ocorrenciaId)
      .order('data_hora', { ascending: true });
    setAndamentos(data || []);
    setCarregandoAndamentos(false);
  }, []);

  function abrirDetalhe(o) {
    setDetalhe(o);
    setNovoComentario('');
    setExcluindo(false);
    setAndamentos([]);
    carregarAndamentos(o.id);
  }

  // ---- Mudar status ----
  async function mudarStatus(novoStatus) {
    if (!detalhe || salvando || detalhe.status === novoStatus) return;
    setSalvando(true);
    const extra = novoStatus === 'RESOLVIDO'
      ? { resolvido_por_id: usuario.id, resolvido_em: new Date().toISOString() }
      : { resolvido_por_id: null, resolvido_em: null };
    const { error } = await supabase
      .from('ocorrencias').update({ status: novoStatus, ...extra }).eq('id', detalhe.id);
    setSalvando(false);
    if (error) { setErro('Não foi possível mudar o status. Detalhe técnico: ' + error.message); return; }
    await registrarAndamento(detalhe.id, 'Alterou Status', `Status alterado para "${STATUS_LABEL[novoStatus]}".`);
    const atualizado = { ...detalhe, status: novoStatus, ...extra };
    setDetalhe(atualizado);
    setOcorrencias(ocorrencias.map((o) => (o.id === detalhe.id ? atualizado : o)));
    carregarAndamentos(detalhe.id);
    mostrarAviso(`Status: ${STATUS_LABEL[novoStatus]}.`);
  }

  // ---- Atribuir responsável ----
  async function atribuirResponsavel(responsavelId) {
    if (!detalhe || salvando) return;
    const id = responsavelId ? Number(responsavelId) : null;
    setSalvando(true);
    const { error } = await supabase
      .from('ocorrencias').update({ responsavel_id: id }).eq('id', detalhe.id);
    setSalvando(false);
    if (error) { setErro('Não foi possível atribuir. Detalhe técnico: ' + error.message); return; }
    await registrarAndamento(detalhe.id, 'Atribuiu Responsável',
      id ? `Responsável definido: ${nomeDe(id)}.` : 'Responsável removido.');
    const atualizado = { ...detalhe, responsavel_id: id };
    setDetalhe(atualizado);
    setOcorrencias(ocorrencias.map((o) => (o.id === detalhe.id ? atualizado : o)));
    carregarAndamentos(detalhe.id);
    mostrarAviso('Responsável atualizado.');
  }

  // ---- Comentar ----
  async function comentar() {
    if (!detalhe || salvando) return;
    if (!novoComentario.trim()) return;
    setSalvando(true);
    await registrarAndamento(detalhe.id, 'Comentou', novoComentario.trim());
    setSalvando(false);
    setNovoComentario('');
    carregarAndamentos(detalhe.id);
    mostrarAviso('Comentário adicionado.');
  }

  // ---- Excluir (admin) ----
  async function excluirOcorrencia() {
    if (!detalhe || salvando) return;
    setSalvando(true);
    const { error } = await supabase.from('ocorrencias').delete().eq('id', detalhe.id);
    setSalvando(false);
    if (error) { setErro('Não foi possível excluir. Detalhe técnico: ' + error.message); return; }
    setOcorrencias(ocorrencias.filter((o) => o.id !== detalhe.id));
    setDetalhe(null);
    mostrarAviso('Ocorrência excluída.');
  }

  // ---- Filtros ----
  const termo = busca.trim().toLowerCase();
  const lista = ocorrencias
    .filter((o) => (fCategoria ? o.categoria === fCategoria : true))
    .filter((o) => (fGravidade ? o.gravidade === fGravidade : true))
    .filter((o) => (fStatus ? o.status === fStatus : true))
    .filter((o) =>
      termo
        ? (o.titulo || '').toLowerCase().includes(termo) ||
          (o.descricao || '').toLowerCase().includes(termo) ||
          (o.local_setor || '').toLowerCase().includes(termo)
        : true
    );

  if (verificandoLogin) {
    return (
      <main className="conteudo">
        <p className="texto-suave">Verificando seu acesso…</p>
      </main>
    );
  }

  return (
    <main className="conteudo">
      <EstilosOcorrencias />

      <span className="olho">Gestão de incidentes</span>
      <div className="barra-pagina">
        <h1 style={{ margin: 0 }}>Ocorrências</h1>
        <button type="button" className="botao botao-principal"
          onClick={() => { setMostrarForm(!mostrarForm); setErroForm(''); }}>
          {mostrarForm ? 'Fechar formulário' : '+ Novo Relato'}
        </button>
      </div>

      {/* Aviso legal compulsório (texto exato do protótipo) */}
      <div className="oc-aviso-legal">
        <strong>Atenção:</strong> tome muito cuidado com o que vai relatar. O conteúdo
        não deve ser discriminatório, assim como não deve denegrir ninguém. Todo o
        conteúdo relatado aqui é público dentro do hotel e você é legalmente
        responsável pelo que está relatando.
      </div>

      {aviso && <div className="aviso-sucesso">{aviso}</div>}
      {erro && <div className="aviso-erro">{erro}</div>}

      {/* Formulário de novo relato */}
      {mostrarForm && (
        <form className="cartao" style={{ marginBottom: 16 }} onSubmit={registrarOcorrencia}>
          <h2 style={{ fontSize: '1.15rem', marginBottom: 4 }}>Registrar novo relato</h2>

          <label className="rotulo">Título da ocorrência *</label>
          <input className="campo" type="text" maxLength={120} value={titulo}
            onChange={(e) => setTitulo(e.target.value)} placeholder="Descreva brevemente o incidente…" />

          <div className="oc-tres">
            <div>
              <label className="rotulo">Categoria</label>
              <select className="campo" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                {Object.entries(CATEGORIA_LABEL).map(([chave, rotulo]) => (
                  <option key={chave} value={chave}>{rotulo}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="rotulo">Gravidade</label>
              <select className="campo" value={gravidade} onChange={(e) => setGravidade(e.target.value)}>
                {Object.entries(GRAVIDADE_LABEL).map(([chave, rotulo]) => (
                  <option key={chave} value={chave}>{rotulo}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="rotulo">Data do ocorrido *</label>
              <input className="campo" type="date" value={dataOcorrido}
                onChange={(e) => setDataOcorrido(e.target.value)} />
            </div>
          </div>

          <label className="rotulo">Local / setor</label>
          <input className="campo" type="text" value={localSetor}
            onChange={(e) => setLocalSetor(e.target.value)} placeholder="Ex.: Recepção, Apto 305, Cozinha…" />

          <label className="rotulo">Descrição *</label>
          <textarea className="campo" rows={4} maxLength={LIMITE_DESCRICAO} value={descricao}
            onChange={(e) => setDescricao(e.target.value)} placeholder="Conte o que aconteceu, com o máximo de detalhes úteis…" />
          <p className="texto-suave" style={{ fontSize: 12, margin: '4px 0 0', textAlign: 'right' }}>
            {descricao.length}/{LIMITE_DESCRICAO}
          </p>

          <label className="rotulo">Medidas já tomadas (opcional)</label>
          <textarea className="campo" rows={2} value={medidas}
            onChange={(e) => setMedidas(e.target.value)} placeholder="O que já foi feito para conter/resolver…" />

          {erroForm && <div className="aviso-erro">{erroForm}</div>}

          <button type="submit" className="botao botao-principal" disabled={salvando} style={{ marginTop: 16 }}>
            {salvando ? 'Registrando…' : 'Registrar Ocorrência'}
          </button>
        </form>
      )}

      {/* Filtros */}
      <div className="oc-filtros">
        <input className="campo" type="search" value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por título, descrição ou local…" aria-label="Buscar ocorrências" />
        <select className="campo" value={fCategoria} onChange={(e) => setFCategoria(e.target.value)}>
          <option value="">Todas as categorias</option>
          {Object.entries(CATEGORIA_LABEL).map(([chave, rotulo]) => (
            <option key={chave} value={chave}>{rotulo}</option>
          ))}
        </select>
        <select className="campo" value={fGravidade} onChange={(e) => setFGravidade(e.target.value)}>
          <option value="">Todas as gravidades</option>
          {Object.entries(GRAVIDADE_LABEL).map(([chave, rotulo]) => (
            <option key={chave} value={chave}>{rotulo}</option>
          ))}
        </select>
        <select className="campo" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">Todos os status</option>
          {Object.entries(STATUS_LABEL).map(([chave, rotulo]) => (
            <option key={chave} value={chave}>{rotulo}</option>
          ))}
        </select>
      </div>

      <p className="texto-suave" style={{ fontSize: 13 }}>{lista.length} relato(s)</p>

      {/* Feed */}
      {carregando ? (
        <p className="texto-suave">Carregando ocorrências…</p>
      ) : lista.length === 0 ? (
        <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
          {busca || fCategoria || fGravidade || fStatus
            ? 'Nenhuma ocorrência encontrada com esses filtros.'
            : 'Nenhuma ocorrência registrada ainda. Clique em "+ Novo Relato" para registrar o primeiro incidente.'}
        </div>
      ) : (
        <div className="oc-feed">
          {lista.map((o) => (
            <button key={o.id} type="button" className="cartao oc-card"
              style={{ borderTopColor: GRAVIDADE_COR[o.gravidade] }}
              onClick={() => abrirDetalhe(o)}>
              <div className="oc-card-topo">
                <span className="oc-tag" style={{ background: STATUS_COR[o.status].fundo, color: STATUS_COR[o.status].texto }}>
                  {STATUS_LABEL[o.status]}
                </span>
                <span className="oc-tag-grav" style={{ color: GRAVIDADE_COR[o.gravidade] }}>
                  {GRAVIDADE_LABEL[o.gravidade]}
                </span>
                <span className="oc-cat">{CATEGORIA_LABEL[o.categoria]}</span>
              </div>
              <div className="oc-card-titulo">{o.titulo}</div>
              <div className="oc-card-meta">
                <span>📅 {formatarData(o.data_ocorrido)}</span>
                {o.local_setor && <span>📍 {o.local_setor}</span>}
                <span>Relatado por {nomeDe(o.registrado_por_id)}</span>
                {o.responsavel_id && <span>Responsável: {nomeDe(o.responsavel_id)}</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ================= DETALHE ================= */}
      {detalhe && (
        <div className="oc-overlay" role="dialog" aria-modal="true">
          <div className="oc-modal">
            <div className="oc-modal-topo">
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="oc-tag" style={{ background: STATUS_COR[detalhe.status].fundo, color: STATUS_COR[detalhe.status].texto }}>
                  {STATUS_LABEL[detalhe.status]}
                </span>
                <span className="oc-tag-grav" style={{ color: GRAVIDADE_COR[detalhe.gravidade] }}>
                  {GRAVIDADE_LABEL[detalhe.gravidade]}
                </span>
              </div>
              <button type="button" className="oc-fechar" onClick={() => setDetalhe(null)} aria-label="Fechar">✕</button>
            </div>

            <h2 className="oc-modal-titulo">{detalhe.titulo}</h2>

            <div className="oc-ficha">
              <Linha rotulo="Categoria" valor={CATEGORIA_LABEL[detalhe.categoria]} />
              <Linha rotulo="Data do ocorrido" valor={formatarData(detalhe.data_ocorrido)} />
              <Linha rotulo="Local / setor" valor={detalhe.local_setor} />
              <Linha rotulo="Relatado por" valor={`${nomeDe(detalhe.registrado_por_id)} em ${formatarDataHora(detalhe.registrado_em)}`} />
              {detalhe.status === 'RESOLVIDO' && (
                <Linha rotulo="Resolvido por" valor={`${nomeDe(detalhe.resolvido_por_id)} em ${formatarDataHora(detalhe.resolvido_em)}`} />
              )}
            </div>

            <div className="oc-bloco">
              <strong>Descrição</strong>
              <p style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{detalhe.descricao}</p>
            </div>
            {detalhe.medidas_tomadas && (
              <div className="oc-bloco">
                <strong>Medidas já tomadas</strong>
                <p style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{detalhe.medidas_tomadas}</p>
              </div>
            )}

            {/* Controles: status + responsável */}
            <div className="oc-controles">
              <div>
                <label className="rotulo" style={{ marginTop: 0 }}>Status</label>
                <select className="campo" value={detalhe.status}
                  onChange={(e) => mudarStatus(e.target.value)} disabled={salvando}>
                  {Object.entries(STATUS_LABEL).map(([chave, rotulo]) => (
                    <option key={chave} value={chave}>{rotulo}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="rotulo" style={{ marginTop: 0 }}>Responsável</label>
                <select className="campo" value={detalhe.responsavel_id || ''}
                  onChange={(e) => atribuirResponsavel(e.target.value)} disabled={salvando}>
                  <option value="">— Ninguém —</option>
                  {colegas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>
            </div>

            {/* Andamentos */}
            <div className="oc-andamentos">
              <strong>Andamentos</strong>
              {carregandoAndamentos && <p className="texto-suave" style={{ fontSize: 13 }}>Carregando…</p>}
              <ol className="oc-timeline">
                {andamentos.map((a) => (
                  <li key={a.id} className="oc-evento">
                    <div className="oc-evento-topo">
                      <strong>{nomeDe(a.usuario_id)}</strong>
                      <span className="oc-evento-acao">{a.acao}</span>
                    </div>
                    {a.texto && <div className="oc-evento-texto">{a.texto}</div>}
                    <div className="oc-evento-data">{formatarDataHora(a.data_hora)}</div>
                  </li>
                ))}
                {!carregandoAndamentos && andamentos.length === 0 && (
                  <p className="texto-suave" style={{ fontSize: 13 }}>Sem andamentos ainda.</p>
                )}
              </ol>

              <div className="oc-comentar">
                <input className="campo" type="text" value={novoComentario}
                  onChange={(e) => setNovoComentario(e.target.value)}
                  placeholder="Escreva um comentário / atualização…"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); comentar(); } }} />
                <button type="button" className="botao botao-principal" onClick={comentar}
                  disabled={salvando || !novoComentario.trim()}>
                  Comentar
                </button>
              </div>
            </div>

            {/* Excluir: só admin */}
            {souAdmin && (
              <div style={{ marginTop: 16, borderTop: '1px solid var(--borda)', paddingTop: 14 }}>
                {excluindo ? (
                  <div className="oc-confirmar">
                    Excluir esta ocorrência? Não dá para desfazer.
                    <button type="button" className="botao botao-perigo" onClick={excluirOcorrencia} disabled={salvando}>
                      Sim, excluir
                    </button>
                    <button type="button" className="botao botao-suave" onClick={() => setExcluindo(false)}>Não</button>
                  </div>
                ) : (
                  <button type="button" className="botao botao-perigo" onClick={() => setExcluindo(true)}>
                    Excluir ocorrência
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function Linha({ rotulo, valor }) {
  return (
    <div className="oc-linha">
      <span className="oc-linha-rotulo">{rotulo}</span>
      <span className="oc-linha-valor">{valor || '—'}</span>
    </div>
  );
}

// ---- Estilos específicos deste módulo ---------------------------------------

function EstilosOcorrencias() {
  return (
    <style>{`
      .oc-aviso-legal {
        background: #FDF3D7; border: 1px solid #EBD394; color: #6B5000;
        border-radius: 12px; padding: 14px 16px; font-size: 14px; line-height: 1.6;
        margin: 6px 0 16px;
      }

      .oc-filtros { display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; }

      .oc-feed { display: flex; flex-direction: column; gap: 12px; }
      .oc-card {
        text-align: left; width: 100%; cursor: pointer; font-family: inherit; color: inherit;
        border-top: 4px solid var(--borda); padding: 16px;
      }
      .oc-card:hover { border-color: var(--marca); }
      .oc-card-topo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .oc-tag { display: inline-block; font-size: 12px; font-weight: 700; border-radius: 999px; padding: 3px 10px; }
      .oc-tag-grav { font-size: 13px; font-weight: 700; }
      .oc-cat { font-size: 13px; color: var(--texto-suave); }
      .oc-card-titulo { font-size: 16px; font-weight: 700; margin: 8px 0 6px; }
      .oc-card-meta { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 13px; color: var(--texto-suave); }

      .oc-overlay {
        position: fixed; inset: 0; background: rgba(15, 25, 22, 0.45);
        display: flex; align-items: flex-end; justify-content: center; z-index: 70;
      }
      .oc-modal {
        background: var(--branco); width: 100%; max-height: 92vh; overflow-y: auto;
        border-radius: 18px 18px 0 0; padding: 18px;
      }
      .oc-modal-topo { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
      .oc-fechar {
        border: none; background: #E9ECE8; border-radius: 999px;
        width: 40px; height: 40px; font-size: 16px; cursor: pointer; flex-shrink: 0;
      }
      .oc-modal-titulo { font-size: 20px; margin: 4px 0 12px; }

      .oc-ficha { margin-bottom: 12px; }
      .oc-linha { display: flex; justify-content: space-between; gap: 14px; padding: 7px 0; border-bottom: 1px dashed var(--borda); font-size: 14px; }
      .oc-linha-rotulo { color: var(--texto-suave); flex-shrink: 0; }
      .oc-linha-valor { text-align: right; font-weight: 600; overflow-wrap: anywhere; }

      .oc-bloco { background: var(--fundo); border-radius: 12px; padding: 12px 14px; margin-bottom: 12px; font-size: 14px; }

      .oc-controles { display: grid; grid-template-columns: 1fr; gap: 12px; margin-bottom: 16px; }

      .oc-andamentos { border-top: 1px solid var(--borda); padding-top: 14px; }
      .oc-timeline { list-style: none; margin: 10px 0; padding: 0; }
      .oc-evento { border-left: 3px solid var(--borda); padding: 0 0 12px 14px; position: relative; }
      .oc-evento::before {
        content: ''; position: absolute; left: -7px; top: 3px;
        width: 11px; height: 11px; border-radius: 999px; background: var(--marca);
      }
      .oc-evento-topo { display: flex; gap: 8px; flex-wrap: wrap; align-items: baseline; font-size: 14px; }
      .oc-evento-acao {
        font-size: 12px; font-weight: 700; color: var(--marca);
        background: var(--marca-clara); border-radius: 999px; padding: 2px 9px;
      }
      .oc-evento-texto { font-size: 14px; margin-top: 4px; white-space: pre-wrap; }
      .oc-evento-data { font-size: 12px; color: var(--texto-suave); margin-top: 3px; }

      .oc-comentar { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
      .oc-comentar .campo { flex: 1; min-width: 160px; }

      .oc-confirmar { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; color: var(--erro-texto); flex-wrap: wrap; }

      @media (min-width: 640px) {
        .oc-filtros { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; align-items: center; }
        .oc-filtros .campo { width: auto; }
        .oc-tres { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0 14px; }
        .oc-controles { grid-template-columns: 1fr 1fr; }
        .oc-overlay { align-items: center; padding: 24px; }
        .oc-modal { max-width: 640px; border-radius: 18px; padding: 24px; }
      }
    `}</style>
  );
}
