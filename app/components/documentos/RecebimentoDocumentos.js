'use client';

// ============================================================================
// RECEBIMENTO DE DOCUMENTOS — aba de Administração → Documentos dos
// Colaboradores (SÓ ADMIN). Substitui a planilha de confirmação de
// recebimento (e-mail do contracheque, folha de ponto, folha de alimentação
// e banco de horas).
// ============================================================================
// - A cada pagamento (do mês ou quinzena) cria-se uma "rodada" com a data, os
//   documentos e os colaboradores ativos do hotel (cadastro do Ponto).
// - Um clique numa célula vazia marca OK; a setinha (ou um clique numa célula
//   já marcada) abre as outras situações: Falta, Férias, Licença, Demitido.
// - Férias/Licença/Demitido valem para todos os documentos da pessoa de uma vez.
// - "Copiar pendências" monta o texto para cobrar no WhatsApp ou e-mail.
// - Tabelas documentos_rodadas e documentos_recebimentos
//   (sql/documentos_recebimento.sql): só ADMIN do hotel vê (RLS).
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { buscarTodos } from '../../../lib/buscarTodos';
import { hojeFortaleza } from '../../../lib/contratoTrabalhoUtil';
import {
  DOCUMENTOS, SITUACOES, TIPOS_PAGAMENTO, dataBr, mesDaData, nomeCurtoDocumento, nomeDocumento, nomeSituacao,
  nomeTipo, ordenarDocumentos, pessoasDaRodada, resolvida, resumoRodada, textoPendencias, tipoSugerido,
} from '../../../lib/documentosRecebimento';

const FUSO = 'America/Fortaleza';
const semAcento = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const quando = (ts) => (ts ? new Date(ts).toLocaleString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

function mensagemBanco(error) {
  const m = String(error?.message || '');
  if (/documentos_rodadas_unica|duplicate key/i.test(m)) return 'Já existe um pagamento desse tipo nessa data. Abra o que já existe na lista.';
  if (/documentos_(rodadas|recebimentos)|schema cache|does not exist|relation/i.test(m)) {
    return 'A tela ainda não foi ativada no banco de dados (falta rodar o SQL do Recebimento de Documentos no Supabase).';
  }
  return 'Não foi possível concluir. Detalhe técnico: ' + m;
}

function formNovo() {
  const hoje = hojeFortaleza();
  const tipo = tipoSugerido(hoje);
  return { id: null, tipo, data_pagamento: hoje, documentos: [...TIPOS_PAGAMENTO[tipo].documentos], pessoas: null, observacao: '' };
}

export default function RecebimentoDocumentos({ usuario }) {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);

  const [rodadas, setRodadas] = useState([]);
  const [celulas, setCelulas] = useState([]);
  const [funcionarios, setFuncionarios] = useState([]);
  const [nomeHotel, setNomeHotel] = useState('');

  const [modo, setModo] = useState('lista'); // lista | form | rodada
  const [filtroLista, setFiltroLista] = useState('ABERTOS');
  const [form, setForm] = useState(formNovo());
  const [rodadaId, setRodadaId] = useState(null);
  const [busca, setBusca] = useState('');
  const [soPendentes, setSoPendentes] = useState(false);
  const [menu, setMenu] = useState(null); // { tipo: 'celula'|'pessoa'|'adicionar'|'copiar', ... }

  function mostrarAviso(texto) { setAviso(texto); setTimeout(() => setAviso(''), 5000); }

  const carregar = useCallback(async (u) => {
    setCarregando(true);
    const [r, c, f, h] = await Promise.all([
      buscarTodos(() => supabase.from('documentos_rodadas').select('*').eq('hotel_id', u.hotel_id)
        .order('data_pagamento', { ascending: false })),
      buscarTodos(() => supabase.from('documentos_recebimentos').select('*').eq('hotel_id', u.hotel_id)),
      supabase.from('funcionarios').select('*').eq('hotel_id', u.hotel_id).order('nome', { ascending: true }),
      supabase.from('hoteis').select('*').eq('id', u.hotel_id).maybeSingle(),
    ]);
    if (r.error) setErro(mensagemBanco(r.error));
    else if (c.error) setErro(mensagemBanco(c.error));
    else if (f.error) setErro('Não foi possível ler os colaboradores. Detalhe técnico: ' + f.error.message);
    setRodadas(r.data || []);
    setCelulas(c.data || []);
    setFuncionarios(f.data || []);
    setNomeHotel(h.data?.nome_fantasia || h.data?.nome || '');
    setCarregando(false);
  }, []);

  useEffect(() => { if (usuario) carregar(usuario); }, [usuario, carregar]);

  const ativos = useMemo(() => funcionarios.filter((f) => f.ativo !== false), [funcionarios]);
  const celulasPorRodada = useMemo(() => {
    const m = new Map();
    celulas.forEach((c) => { if (!m.has(c.rodada_id)) m.set(c.rodada_id, []); m.get(c.rodada_id).push(c); });
    return m;
  }, [celulas]);
  const resumos = useMemo(() => new Map(rodadas.map((r) => [r.id, resumoRodada(celulasPorRodada.get(r.id))])), [rodadas, celulasPorRodada]);
  const rodada = rodadas.find((r) => r.id === rodadaId) || null;
  const celulasDaRodada = useMemo(() => (rodada ? celulasPorRodada.get(rodada.id) || [] : []), [rodada, celulasPorRodada]);
  const pessoas = useMemo(() => pessoasDaRodada(celulasDaRodada), [celulasDaRodada]);
  const docsDaRodada = useMemo(() => ordenarDocumentos(rodada?.documentos), [rodada]);

  // ---- Gravar situações (otimista: muda na tela e desfaz se o banco recusar) --
  async function marcar(lista, situacao) {
    const alvo = lista.filter((c) => c && (c.situacao || null) !== (situacao || null));
    if (!alvo.length) return;
    setErro('');
    const dados = situacao
      ? { situacao, marcado_em: new Date().toISOString(), marcado_por_id: usuario.id, marcado_por_nome: usuario.nome || null }
      : { situacao: null, marcado_em: null, marcado_por_id: null, marcado_por_nome: null };
    const ids = new Set(alvo.map((c) => c.id));
    const antes = celulas;
    setCelulas((atual) => atual.map((c) => (ids.has(c.id) ? { ...c, ...dados } : c)));
    const { error } = await supabase.from('documentos_recebimentos').update(dados).in('id', [...ids]);
    if (error) { setCelulas(antes); setErro(mensagemBanco(error)); }
  }

  function cliqueCelula(c) {
    if (!c.situacao) marcar([c], 'OK');
    else setMenu({ tipo: 'celula', celulaId: c.id });
  }

  function todosOkNoDocumento(doc) {
    const vazias = celulasDaRodada.filter((c) => c.documento === doc && !c.situacao);
    if (!vazias.length) { mostrarAviso(`Ninguém está sem conferir em ${nomeDocumento(doc)}.`); return; }
    if (!window.confirm(`Marcar OK em "${nomeDocumento(doc)}" para os ${vazias.length} colaborador(es) ainda não conferidos?`)) return;
    marcar(vazias, 'OK');
  }

  // ---- Criar / editar pagamento -----------------------------------------------
  function novoPagamento() {
    setForm({ ...formNovo(), pessoas: new Set(ativos.map((f) => String(f.id))) });
    setErro('');
    setModo('form');
  }

  function editarPagamento() {
    if (!rodada) return;
    setForm({ id: rodada.id, tipo: rodada.tipo, data_pagamento: rodada.data_pagamento, documentos: [...rodada.documentos], pessoas: null, observacao: rodada.observacao || '' });
    setErro('');
    setModo('form');
  }

  function mudarTipo(tipo) {
    setForm((f) => ({ ...f, tipo, documentos: f.id ? f.documentos : [...TIPOS_PAGAMENTO[tipo].documentos] }));
  }

  function alternarDocumento(cod) {
    setForm((f) => ({ ...f, documentos: f.documentos.includes(cod) ? f.documentos.filter((d) => d !== cod) : ordenarDocumentos([...f.documentos, cod]) }));
  }

  function alternarPessoa(id) {
    setForm((f) => {
      const s = new Set(f.pessoas);
      if (s.has(id)) s.delete(id); else s.add(id);
      return { ...f, pessoas: s };
    });
  }

  const linhasPara = (rodadaAlvo, listaFuncionarios, docs) => listaFuncionarios.flatMap((f) => docs.map((doc) => ({
    rodada_id: rodadaAlvo.id, hotel_id: rodadaAlvo.hotel_id, funcionario_id: f.id, colaborador_nome: f.nome, documento: doc,
  })));

  async function salvarPagamento(e) {
    e.preventDefault();
    setErro('');
    if (!form.data_pagamento) { setErro('Informe a data do pagamento.'); return; }
    if (!form.documentos.length) { setErro('Marque pelo menos um documento.'); return; }
    const dados = {
      tipo: form.tipo, data_pagamento: form.data_pagamento, documentos: ordenarDocumentos(form.documentos),
      observacao: form.observacao.trim() || null, atualizado_em: new Date().toISOString(),
    };

    if (!form.id) {
      const escolhidos = ativos.filter((f) => form.pessoas?.has(String(f.id)));
      if (!escolhidos.length) { setErro('Marque pelo menos um colaborador.'); return; }
      setSalvando(true);
      const r = await supabase.from('documentos_rodadas').insert({ ...dados, hotel_id: usuario.hotel_id, criado_por_id: usuario.id }).select().single();
      if (r.error) { setSalvando(false); setErro(mensagemBanco(r.error)); return; }
      const c = await supabase.from('documentos_recebimentos').insert(linhasPara(r.data, escolhidos, dados.documentos)).select();
      if (c.error) {
        await supabase.from('documentos_rodadas').delete().eq('id', r.data.id);
        setSalvando(false); setErro(mensagemBanco(c.error)); return;
      }
      setRodadas((lista) => [r.data, ...lista].sort((a, b) => String(b.data_pagamento).localeCompare(String(a.data_pagamento))));
      setCelulas((lista) => [...lista, ...(c.data || [])]);
      setSalvando(false);
      setRodadaId(r.data.id); setBusca(''); setSoPendentes(false);
      setModo('rodada');
      mostrarAviso('Pagamento criado. Clique num documento para marcar OK.');
      return;
    }

    // Edição: documentos tirados apagam as marcações deles; os novos entram vazios
    const atual = rodadas.find((x) => x.id === form.id);
    const tirados = atual.documentos.filter((d) => !dados.documentos.includes(d));
    const novos = dados.documentos.filter((d) => !atual.documentos.includes(d));
    const celulasAtuais = celulasPorRodada.get(form.id) || [];
    const marcadasTiradas = celulasAtuais.filter((c) => tirados.includes(c.documento) && c.situacao).length;
    if (tirados.length && !window.confirm(
      `Tirar ${tirados.map(nomeDocumento).join(', ')} deste pagamento?${marcadasTiradas ? ` As ${marcadasTiradas} marcação(ões) desse(s) documento(s) serão apagadas.` : ''}`,
    )) return;
    setSalvando(true);
    const r = await supabase.from('documentos_rodadas').update(dados).eq('id', form.id).select().single();
    if (r.error) { setSalvando(false); setErro(mensagemBanco(r.error)); return; }
    let celulasNovas = [];
    if (tirados.length) {
      const d = await supabase.from('documentos_recebimentos').delete().eq('rodada_id', form.id).in('documento', tirados);
      if (d.error) { setSalvando(false); setErro(mensagemBanco(d.error)); return; }
    }
    if (novos.length) {
      const pessoasAtuais = pessoasDaRodada(celulasAtuais).map((p) => ({ id: p.funcionario_id, nome: p.nome }));
      const c = await supabase.from('documentos_recebimentos').insert(linhasPara(r.data, pessoasAtuais, novos)).select();
      if (c.error) { setSalvando(false); setErro(mensagemBanco(c.error)); return; }
      celulasNovas = c.data || [];
    }
    setRodadas((lista) => lista.map((x) => (x.id === form.id ? r.data : x)));
    setCelulas((lista) => [...lista.filter((c) => !(c.rodada_id === form.id && tirados.includes(c.documento))), ...celulasNovas]);
    setSalvando(false);
    setModo('rodada');
    mostrarAviso('Pagamento atualizado.');
  }

  async function excluirPagamento() {
    if (!rodada) return;
    const marcadas = celulasDaRodada.filter((c) => c.situacao).length;
    if (!window.confirm(`Excluir o pagamento "${nomeTipo(rodada.tipo)} de ${dataBr(rodada.data_pagamento)}"${marcadas ? ` e as ${marcadas} marcação(ões) dele` : ''}? Não dá para desfazer.`)) return;
    const { error } = await supabase.from('documentos_rodadas').delete().eq('id', rodada.id);
    if (error) { setErro(mensagemBanco(error)); return; }
    setRodadas((lista) => lista.filter((x) => x.id !== rodada.id));
    setCelulas((lista) => lista.filter((c) => c.rodada_id !== rodada.id));
    setModo('lista');
    mostrarAviso('Pagamento excluído.');
  }

  async function adicionarPessoa(funcionarioId) {
    const f = funcionarios.find((x) => String(x.id) === String(funcionarioId));
    if (!f || !rodada) return;
    const c = await supabase.from('documentos_recebimentos').insert(linhasPara(rodada, [f], docsDaRodada)).select();
    if (c.error) { setErro(mensagemBanco(c.error)); return; }
    setCelulas((lista) => [...lista, ...(c.data || [])]);
    setMenu(null);
    mostrarAviso(`${f.nome} entrou neste pagamento.`);
  }

  async function tirarPessoa(p) {
    if (!window.confirm(`Tirar ${p.nome} deste pagamento?`)) return;
    const ids = Object.values(p.celulas).map((c) => c.id);
    const { error } = await supabase.from('documentos_recebimentos').delete().in('id', ids);
    if (error) { setErro(mensagemBanco(error)); return; }
    setCelulas((lista) => lista.filter((c) => !ids.includes(c.id)));
    setMenu(null);
  }

  async function copiarPendencias() {
    const texto = textoPendencias(rodada, celulasDaRodada, nomeHotel);
    try {
      await navigator.clipboard.writeText(texto);
      mostrarAviso('Lista de pendências copiada. É só colar no WhatsApp ou no e-mail.');
    } catch (e) {
      setMenu({ tipo: 'copiar', texto });
    }
  }

  // ---- Pedacinhos da tela -------------------------------------------------------
  const barra = (resumo) => {
    const pct = resumo.total ? Math.round((resumo.resolvidas / resumo.total) * 100) : 0;
    return (
      <div className="dr-progresso" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Documentos conferidos">
        <div className={resumo.completo ? 'dr-progresso-cheio dr-progresso-ok' : 'dr-progresso-cheio'} style={{ width: `${pct}%` }} />
      </div>
    );
  };

  const statusRodada = (resumo) => (resumo.completo
    ? <span className="dr-status dr-status-ok">✅ Tudo conferido</span>
    : <span className="dr-status dr-status-pendente">{resumo.pessoasPendentes} colaborador{resumo.pessoasPendentes === 1 ? '' : 'es'} com pendência</span>);

  const celulaMenu = menu?.tipo === 'celula' ? celulas.find((c) => c.id === menu.celulaId) : null;
  const pessoaMenu = menu?.tipo === 'pessoa' ? pessoas.find((p) => p.chave === menu.chave) : null;
  const foraDaRodada = ativos.filter((f) => !pessoas.some((p) => String(p.funcionario_id) === String(f.id)));

  const rodadasFiltradas = rodadas.filter((r) => filtroLista === 'TODOS' || !resumos.get(r.id)?.completo);
  const grupos = [];
  rodadasFiltradas.forEach((r) => {
    const mes = mesDaData(r.data_pagamento);
    if (!grupos.length || grupos[grupos.length - 1].mes !== mes) grupos.push({ mes, itens: [] });
    grupos[grupos.length - 1].itens.push(r);
  });

  const termo = semAcento(busca.trim());
  const pessoasVisiveis = pessoas.filter((p) => (!termo || semAcento(p.nome).includes(termo))
    && (!soPendentes || Object.values(p.celulas).some((c) => !resolvida(c.situacao))));
  const resumoAberta = rodada ? resumos.get(rodada.id) || resumoRodada([]) : null;

  return (
    <div>
      <div className="dc-barra-aba">
        <h2 className="dc-titulo-aba">
          {modo === 'rodada' && rodada ? `${nomeTipo(rodada.tipo)} — ${dataBr(rodada.data_pagamento)}` : 'Recebimento de documentos'}
        </h2>
        {modo === 'lista' ? (
          <button type="button" className="botao botao-principal" onClick={novoPagamento}>+ Novo pagamento</button>
        ) : (
          <button type="button" className="botao botao-contorno" onClick={() => { setModo(modo === 'form' && form.id ? 'rodada' : 'lista'); setErro(''); setMenu(null); }}>
            ← {modo === 'form' && form.id ? 'Voltar para o pagamento' : 'Voltar para a lista'}
          </button>
        )}
      </div>

      {aviso && <div className="aviso-sucesso">{aviso}</div>}
      {erro && <div className="aviso-erro">{erro}</div>}

      {/* ================================ LISTA ================================ */}
      {modo === 'lista' && (
        <div className="cartao">
          <p className="texto-suave" style={{ marginTop: 0 }}>
            A cada pagamento, crie um <strong>novo pagamento</strong>: a lista dos colaboradores já vem pronta. Depois é só
            marcar o que voltou. Colaboradores do <strong>{nomeHotel || 'hotel escolhido no topo'}</strong>; para outro
            hotel, troque no topo da tela.
          </p>
          <div className="fe-filtros" role="tablist" aria-label="Pagamentos">
            {[['ABERTOS', 'Com pendência', rodadas.filter((r) => !resumos.get(r.id)?.completo).length], ['TODOS', 'Todos', rodadas.length]].map(([chave, rotulo, n]) => (
              <button key={chave} type="button" role="tab" aria-selected={filtroLista === chave}
                className={filtroLista === chave ? 'fe-filtro fe-filtro-ativo' : 'fe-filtro'} onClick={() => setFiltroLista(chave)}>
                {rotulo} <span className="fe-conta">{n}</span>
              </button>
            ))}
          </div>
          {carregando ? (
            <p className="texto-suave">Carregando…</p>
          ) : !grupos.length ? (
            <p className="texto-suave">
              {rodadas.length ? 'Nenhum pagamento com pendência. Tudo conferido! ✅' : 'Nenhum pagamento criado ainda. Clique em "+ Novo pagamento".'}
            </p>
          ) : grupos.map((g) => (
            <div key={g.mes} className="dr-grupo">
              <h3 className="dr-mes">{g.mes}</h3>
              <div className="dr-rodadas">
                {g.itens.map((r) => {
                  const resumo = resumos.get(r.id) || resumoRodada([]);
                  return (
                    <button key={r.id} type="button" className={resumo.completo ? 'dr-rodada dr-rodada-ok' : 'dr-rodada'}
                      onClick={() => { setRodadaId(r.id); setBusca(''); setSoPendentes(false); setModo('rodada'); setErro(''); }}>
                      <span className="dr-rodada-topo">
                        <strong>{nomeTipo(r.tipo)} · {dataBr(r.data_pagamento)}</strong>
                        {statusRodada(resumo)}
                      </span>
                      <span className="dr-rodada-docs">{ordenarDocumentos(r.documentos).map(nomeCurtoDocumento).join(' · ')}</span>
                      {barra(resumo)}
                      <span className="dr-rodada-conta">{resumo.resolvidas} de {resumo.total} conferidos{resumo.faltas ? ` · ${resumo.faltas} falta(s)` : ''}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ============================== FORMULÁRIO ============================== */}
      {modo === 'form' && (
        <form className="cartao" onSubmit={salvarPagamento}>
          <h3 className="dr-form-titulo">{form.id ? 'Editar pagamento' : 'Novo pagamento'}</h3>
          <span className="rotulo">Tipo de pagamento</span>
          <div className="dr-tipos" role="radiogroup" aria-label="Tipo de pagamento">
            {Object.entries(TIPOS_PAGAMENTO).map(([cod, t]) => (
              <button key={cod} type="button" role="radio" aria-checked={form.tipo === cod}
                className={form.tipo === cod ? 'dr-tipo dr-tipo-ativo' : 'dr-tipo'} onClick={() => mudarTipo(cod)}>
                {t.nome}
              </button>
            ))}
          </div>
          <div className="dr-campo-data">
            <label className="rotulo" htmlFor="dr-data">Data do pagamento *</label>
            <input id="dr-data" className="campo" type="date" value={form.data_pagamento} onChange={(e) => setForm({ ...form, data_pagamento: e.target.value })} />
          </div>
          <fieldset className="dr-fieldset">
            <legend className="rotulo">Documentos que precisam voltar *</legend>
            {DOCUMENTOS.map((d) => (
              <label key={d.codigo} className="dr-check">
                <input type="checkbox" checked={form.documentos.includes(d.codigo)} onChange={() => alternarDocumento(d.codigo)} />
                {d.nome}
              </label>
            ))}
          </fieldset>
          {!form.id && (
            <fieldset className="dr-fieldset">
              <legend className="rotulo">Colaboradores ({form.pessoas?.size || 0} de {ativos.length})</legend>
              {!ativos.length ? (
                <p className="aviso-erro" style={{ margin: 0 }}>Nenhum colaborador ativo no {nomeHotel || 'hotel'}. Cadastre em Administração → Ponto → Funcionários.</p>
              ) : (
                <>
                  <div className="dr-pessoas-acoes">
                    <button type="button" className="dr-link" onClick={() => setForm({ ...form, pessoas: new Set(ativos.map((f) => String(f.id))) })}>Marcar todos</button>
                    <button type="button" className="dr-link" onClick={() => setForm({ ...form, pessoas: new Set() })}>Desmarcar todos</button>
                  </div>
                  <div className="dr-pessoas">
                    {ativos.map((f) => (
                      <label key={f.id} className="dr-check">
                        <input type="checkbox" checked={!!form.pessoas?.has(String(f.id))} onChange={() => alternarPessoa(String(f.id))} />
                        <span>{f.nome}{f.cargo ? <span className="texto-suave"> · {f.cargo}</span> : null}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </fieldset>
          )}
          <label className="rotulo" htmlFor="dr-obs">Observação (opcional)</label>
          <input id="dr-obs" className="campo" maxLength={500} value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} placeholder="ex.: pagamento atrasou por causa do feriado" />
          <div className="fe-botoes" style={{ marginTop: 12 }}>
            <button type="submit" className="botao botao-principal" disabled={salvando}>{salvando ? 'Salvando…' : form.id ? 'Salvar alterações' : 'Criar pagamento'}</button>
          </div>
        </form>
      )}

      {/* ================================ RODADA ================================ */}
      {modo === 'rodada' && rodada && (
        <div className="cartao">
          <div className="dr-cabeca">
            <span className="texto-suave">
              {mesDaData(rodada.data_pagamento)} · {pessoas.length} colaborador{pessoas.length === 1 ? '' : 'es'}
              {rodada.observacao ? ` · ${rodada.observacao}` : ''}
            </span>
            {statusRodada(resumoAberta)}
          </div>
          {barra(resumoAberta)}
          <p className="dr-legenda">
            {resumoAberta.resolvidas} de {resumoAberta.total} conferidos
            {SITUACOES.map((s) => {
              const n = celulasDaRodada.filter((c) => c.situacao === s.codigo).length;
              return n ? <span key={s.codigo}> · {s.nome} {n}</span> : null;
            })}
            {resumoAberta.vazias ? <span> · Não conferidos {resumoAberta.vazias}</span> : null}
          </p>
          <div className="dr-ferramentas">
            <input className="campo dr-busca" type="search" aria-label="Buscar colaborador" placeholder="Buscar colaborador…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <label className="dr-check dr-so-pendentes">
              <input type="checkbox" checked={soPendentes} onChange={(e) => setSoPendentes(e.target.checked)} /> Só quem tem pendência
            </label>
          </div>
          <div className="dr-ferramentas">
            <button type="button" className="botao botao-contorno" onClick={copiarPendencias}>📋 Copiar pendências</button>
            <button type="button" className="botao botao-suave" onClick={() => setMenu({ tipo: 'adicionar' })}>+ Colaborador</button>
            <button type="button" className="botao botao-suave" onClick={editarPagamento}>✏️ Editar pagamento</button>
            <button type="button" className="botao botao-perigo" onClick={excluirPagamento} aria-label="Excluir este pagamento">🗑️</button>
          </div>
          <p className="dr-dica">Clique num documento para marcar <strong>OK</strong>. Na setinha ▾ estão Falta, Férias, Licença e Demitido. Em ⋯ você marca tudo da pessoa de uma vez.</p>

          <div className="dr-grade" style={{ '--dr-docs': docsDaRodada.length }}>
            <div className="dr-linha dr-linha-cabeca" role="row">
              <span className="dr-nome-cab">Colaborador</span>
              {docsDaRodada.map((doc) => (
                <span key={doc} className="dr-doc-cab">
                  {nomeCurtoDocumento(doc)}
                  <button type="button" className="dr-link dr-todos" onClick={() => todosOkNoDocumento(doc)} aria-label={`Marcar OK em ${nomeDocumento(doc)} para todos os não conferidos`}>✓ todos</button>
                </span>
              ))}
              <span />
            </div>
            {pessoasVisiveis.map((p) => {
              const pendente = Object.values(p.celulas).some((c) => !resolvida(c.situacao));
              return (
                <div key={p.chave} className={pendente ? 'dr-linha' : 'dr-linha dr-linha-ok'} role="row">
                  <span className="dr-nome">{p.nome}</span>
                  {docsDaRodada.map((doc) => {
                    const c = p.celulas[doc];
                    if (!c) return <span key={doc} className="dr-cel" />;
                    const sit = c.situacao || 'VAZIO';
                    const dica = c.situacao ? `${nomeSituacao(c.situacao)} — marcado${c.marcado_por_nome ? ` por ${c.marcado_por_nome}` : ''} em ${quando(c.marcado_em)}` : 'Ainda não conferido';
                    return (
                      <span key={doc} className="dr-cel">
                        <span className="dr-cel-rot">{nomeCurtoDocumento(doc)}</span>
                        <span className={`dr-chip dr-${sit.toLowerCase()}`} title={dica}>
                          <button type="button" className="dr-chip-principal" onClick={() => cliqueCelula(c)} aria-label={`${p.nome}, ${nomeDocumento(doc)}: ${c.situacao ? nomeSituacao(c.situacao) : 'não conferido'}`}>
                            {c.situacao ? nomeSituacao(c.situacao) : '—'}
                          </button>
                          <button type="button" className="dr-chip-seta" onClick={() => setMenu({ tipo: 'celula', celulaId: c.id })} aria-label={`Escolher situação de ${nomeDocumento(doc)} de ${p.nome}`}>▾</button>
                        </span>
                      </span>
                    );
                  })}
                  <button type="button" className="botao botao-suave dr-mais" onClick={() => setMenu({ tipo: 'pessoa', chave: p.chave })} aria-label={`Mais opções de ${p.nome}`}>⋯</button>
                </div>
              );
            })}
            {!pessoasVisiveis.length && (
              <p className="texto-suave" style={{ padding: '10px 4px' }}>
                {pessoas.length ? (soPendentes ? 'Ninguém com pendência. ✅' : 'Ninguém com esse nome.') : 'Nenhum colaborador neste pagamento. Use "+ Colaborador".'}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ============================ MENUS (janelas) ============================ */}
      {menu && (
        <div className="dr-fundo" onClick={() => setMenu(null)} role="presentation">
          <div className="dr-janela" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            {celulaMenu && (
              <>
                <strong className="dr-janela-titulo">{celulaMenu.colaborador_nome}</strong>
                <span className="texto-suave">{nomeDocumento(celulaMenu.documento)}</span>
                {celulaMenu.situacao && (
                  <span className="dr-janela-info">Marcado {celulaMenu.marcado_por_nome ? `por ${celulaMenu.marcado_por_nome} ` : ''}em {quando(celulaMenu.marcado_em)}</span>
                )}
                <div className="dr-opcoes">
                  {SITUACOES.map((s) => (
                    <button key={s.codigo} type="button" className={`dr-opcao dr-${s.codigo.toLowerCase()}`} aria-pressed={celulaMenu.situacao === s.codigo}
                      onClick={() => { marcar([celulaMenu], s.codigo); setMenu(null); }}>
                      {s.nome}
                    </button>
                  ))}
                  <button type="button" className="dr-opcao dr-vazio" onClick={() => { marcar([celulaMenu], null); setMenu(null); }}>Limpar (não conferido)</button>
                </div>
              </>
            )}
            {pessoaMenu && (
              <>
                <strong className="dr-janela-titulo">{pessoaMenu.nome}</strong>
                <span className="texto-suave">Vale para todos os documentos deste pagamento</span>
                <div className="dr-opcoes dr-opcoes-coluna">
                  <button type="button" className="dr-opcao dr-ok" onClick={() => { marcar(Object.values(pessoaMenu.celulas).filter((c) => !c.situacao || c.situacao === 'FALTA'), 'OK'); setMenu(null); }}>✓ Tudo OK</button>
                  {SITUACOES.filter((s) => ['FERIAS', 'LICENCA', 'DEMITIDO'].includes(s.codigo)).map((s) => (
                    <button key={s.codigo} type="button" className={`dr-opcao dr-${s.codigo.toLowerCase()}`} onClick={() => { marcar(Object.values(pessoaMenu.celulas), s.codigo); setMenu(null); }}>
                      {s.nome} em todos
                    </button>
                  ))}
                  <button type="button" className="dr-opcao dr-vazio" onClick={() => { marcar(Object.values(pessoaMenu.celulas), null); setMenu(null); }}>Limpar tudo</button>
                  <button type="button" className="botao botao-perigo" onClick={() => tirarPessoa(pessoaMenu)}>Tirar deste pagamento</button>
                </div>
              </>
            )}
            {menu.tipo === 'adicionar' && (
              <>
                <strong className="dr-janela-titulo">Colocar colaborador neste pagamento</strong>
                {foraDaRodada.length ? (
                  <div className="dr-opcoes dr-opcoes-coluna">
                    {foraDaRodada.map((f) => (
                      <button key={f.id} type="button" className="botao botao-suave" onClick={() => adicionarPessoa(f.id)}>{f.nome}</button>
                    ))}
                  </div>
                ) : <p className="texto-suave">Todos os colaboradores ativos já estão neste pagamento.</p>}
              </>
            )}
            {menu.tipo === 'copiar' && (
              <>
                <strong className="dr-janela-titulo">Pendências</strong>
                <span className="texto-suave">Selecione o texto e copie (Ctrl+C).</span>
                <textarea className="campo dr-copiar" readOnly value={menu.texto} rows={10} onFocus={(e) => e.target.select()} />
              </>
            )}
            <button type="button" className="botao botao-contorno dr-fechar" onClick={() => setMenu(null)}>Fechar</button>
          </div>
        </div>
      )}

      <Estilos />
    </div>
  );
}

function Estilos() {
  return (
    <style>{`
      .dr-grupo { margin-top: 14px; }
      .dr-mes { font-size: 15px; margin: 0 0 8px; color: var(--texto-suave); text-transform: uppercase; letter-spacing: 0.04em; }
      .dr-rodadas { display: grid; grid-template-columns: 1fr; gap: 10px; }
      .dr-rodada { display: flex; flex-direction: column; gap: 6px; text-align: left; padding: 14px; border: 1px solid var(--borda); border-left: 5px solid #E6A100; border-radius: 12px; background: var(--branco); color: inherit; font: inherit; cursor: pointer; min-width: 0; }
      .dr-rodada:hover { border-color: var(--marca); }
      .dr-rodada-ok { border-left-color: #2E7D32; }
      .dr-rodada-topo { display: flex; flex-wrap: wrap; gap: 4px 12px; justify-content: space-between; align-items: baseline; }
      .dr-rodada-docs, .dr-rodada-conta { font-size: 13.5px; color: var(--texto-suave); }
      .dr-status { font-size: 13.5px; font-weight: 600; }
      .dr-status-ok { color: #1E6B2A; }
      .dr-status-pendente { color: #7A5600; }
      .dr-progresso { height: 8px; border-radius: 999px; background: rgba(0,0,0,0.08); overflow: hidden; }
      .dr-progresso-cheio { height: 100%; background: #E6A100; border-radius: 999px; transition: width .25s; }
      .dr-progresso-ok { background: #2E7D32; }

      .dr-form-titulo { margin: 0 0 10px; font-size: 18px; }
      .dr-tipos { display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0 12px; }
      .dr-tipo { border: 1px solid var(--borda); background: var(--branco); color: inherit; border-radius: 10px; padding: 10px 16px; font: inherit; font-weight: 600; cursor: pointer; }
      .dr-tipo-ativo { background: var(--marca); border-color: var(--marca); color: #fff; }
      .dr-campo-data { max-width: 260px; }
      .dr-fieldset { border: 1px solid var(--borda); border-radius: 12px; padding: 10px 14px 12px; margin: 8px 0 12px; min-width: 0; }
      .dr-fieldset legend { padding: 0 6px; }
      .dr-check { display: flex; align-items: center; gap: 8px; font-size: 14.5px; padding: 5px 0; cursor: pointer; min-width: 0; overflow-wrap: anywhere; }
      .dr-check input { width: 18px; height: 18px; flex: none; accent-color: var(--marca); }
      .dr-pessoas { display: grid; grid-template-columns: 1fr; column-gap: 18px; }
      .dr-pessoas-acoes { display: flex; gap: 14px; margin-bottom: 4px; }
      .dr-link { background: none; border: none; padding: 0; color: var(--marca); text-decoration: underline; cursor: pointer; font: inherit; font-size: 13px; }

      .dr-cabeca { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; margin-bottom: 8px; }
      .dr-legenda { font-size: 13.5px; color: var(--texto-suave); margin: 6px 0 10px; }
      .dr-ferramentas { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; margin-bottom: 8px; }
      .dr-busca { flex: 1 1 220px; margin: 0; }
      .dr-so-pendentes { padding: 0; }
      .dr-dica { font-size: 13px; color: var(--texto-suave); margin: 4px 0 10px; }

      .dr-grade { display: flex; flex-direction: column; }
      .dr-linha { display: grid; grid-template-columns: 1fr auto; gap: 8px 10px; align-items: center; padding: 10px 2px; border-top: 1px solid var(--borda); }
      .dr-linha-cabeca { display: none; }
      .dr-linha-ok .dr-nome { color: #1E6B2A; }
      .dr-nome { font-weight: 600; font-size: 14.5px; min-width: 0; overflow-wrap: anywhere; grid-column: 1; grid-row: 1; }
      .dr-mais { grid-column: 2; grid-row: 1; padding: 4px 12px; }
      .dr-cel { display: flex; align-items: center; justify-content: space-between; gap: 8px; grid-column: 1 / -1; min-width: 0; }
      .dr-cel-rot { font-size: 13.5px; color: var(--texto-suave); }
      .dr-chip { display: inline-flex; align-items: stretch; border-radius: 999px; overflow: hidden; min-width: 120px; }
      .dr-chip button { border: none; background: transparent; color: inherit; font: inherit; cursor: pointer; }
      .dr-chip-principal { flex: 1; padding: 6px 4px 6px 12px; font-weight: 700; font-size: 13.5px; text-align: center; min-height: 34px; }
      .dr-chip-seta { padding: 0 10px; font-size: 12px; opacity: 0.8; }
      .dr-vazio { background: #E8EAED; color: #5F6368; }
      .dr-ok { background: #D4EDBC; color: #11734B; }
      .dr-falta { background: #FFCFC9; color: #B10202; }
      .dr-ferias { background: #753800; color: #fff; }
      .dr-licenca { background: #B10202; color: #fff; }
      .dr-demitido { background: #BFE1F6; color: #0A53A8; }
      .dr-todos { display: block; font-size: 12px; margin-top: 2px; }

      .dr-fundo { position: fixed; inset: 0; z-index: 80; background: rgba(20, 30, 27, 0.55); display: flex; align-items: flex-end; justify-content: center; padding: 12px; }
      .dr-janela { width: 100%; max-width: 420px; max-height: 85vh; overflow: auto; background: var(--branco); border-radius: 16px; padding: 18px; display: flex; flex-direction: column; gap: 6px; box-shadow: 0 10px 30px rgba(0,0,0,0.25); }
      .dr-janela-titulo { font-size: 16px; overflow-wrap: anywhere; }
      .dr-janela-info { font-size: 13px; color: var(--texto-suave); }
      .dr-opcoes { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 8px 0 4px; }
      .dr-opcoes-coluna { grid-template-columns: 1fr; }
      .dr-opcao { border: 2px solid transparent; border-radius: 10px; padding: 11px 10px; font: inherit; font-weight: 700; cursor: pointer; }
      .dr-opcao[aria-pressed="true"] { border-color: #111; }
      .dr-copiar { font-family: inherit; font-size: 14px; resize: vertical; }
      .dr-fechar { margin-top: 6px; }

      @media (min-width: 640px) {
        .dr-rodadas { grid-template-columns: 1fr 1fr; }
        .dr-pessoas { grid-template-columns: 1fr 1fr; }
        .dr-fundo { align-items: center; }
      }
      @media (min-width: 860px) {
        .dr-linha { grid-template-columns: minmax(180px, 1fr) repeat(var(--dr-docs), 132px) 48px; padding: 6px 2px; }
        .dr-linha-cabeca { display: grid; font-size: 13px; font-weight: 700; border-top: none; align-items: end; }
        .dr-doc-cab { text-align: center; }
        .dr-nome, .dr-mais, .dr-cel { grid-column: auto; grid-row: auto; }
        .dr-cel { justify-content: center; }
        .dr-cel-rot { display: none; }
        .dr-chip { min-width: 0; width: 124px; }
        .dr-linha:not(.dr-linha-cabeca):hover { background: rgba(0,0,0,0.025); }
      }
    `}</style>
  );
}
