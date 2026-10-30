'use client';

// ============================================================================
// FICHAS DE EPI — aba de Administração → Documentos dos Colaboradores (SÓ ADMIN)
// ============================================================================
// A página (app/documentos-colaboradores/page.js) confere o acesso e passa o
// usuário para cá.
// O administrador escolhe o colaborador (cadastro de Funcionários do Ponto,
// do hotel escolhido no topo), preenche os EPIs entregues e imprime a Ficha
// de Controle de EPI numa folha só. Depois acompanha quais fichas já foram
// impressas e dá baixa quando a ficha volta assinada.
//
// - Nome, função e setor vêm do cadastro do colaborador; função e setor podem
//   ser ajustados só nesta ficha. Tudo fica copiado na ficha, para a
//   reimpressão sair igual mesmo que o cadastro mude.
// - Tabela epi_fichas (sql/fichas_epi.sql): só ADMIN do hotel vê (RLS).
// - A folha impressa: app/components/FichaEpiDocumento.js
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../../lib/supabaseClient';
import { buscarTodos } from '../../../lib/buscarTodos';
import { dataCurta, hojeFortaleza } from '../../../lib/contratoTrabalhoUtil';
import {
  LINHAS_FICHA, catalogoDeEpis, conferirFicha, itemVazio, itensParaSalvar, normalizarValidade,
  resumoItens, situacaoFicha, validadeInvalida,
} from '../../../lib/fichasEpi';
import { ESTILOS_FICHA_EPI, FichaEpiDocumento } from '../FichaEpiDocumento';

const FUSO = 'America/Fortaleza';
const diaDe = (ts) => (ts ? new Date(ts).toLocaleDateString('en-CA', { timeZone: FUSO }) : '');
const diasDesde = (ts) => {
  if (!ts) return 0;
  const [a, b] = [diaDe(ts), hojeFortaleza()].map((d) => Date.parse(`${d}T12:00:00Z`));
  return Math.max(0, Math.round((b - a) / 86400000));
};

function mensagemBanco(error) {
  const m = String(error?.message || '');
  if (/epi_fichas|schema cache|does not exist|relation/i.test(m)) {
    return 'A tela ainda não foi ativada no banco de dados (falta rodar o SQL das Fichas de EPI no Supabase).';
  }
  return 'Não foi possível concluir. Detalhe técnico: ' + m;
}

const fichaNova = () => ({
  id: null, funcionario_id: '', colaborador_nome: '', funcao: '', setor: '', hotel_nome: '',
  data_entrega: hojeFortaleza(), itens: [itemVazio()],
});

const FILTROS = [
  ['PENDENTES', 'Aguardando devolução'],
  ['DEVOLVIDAS', 'Devolvidas assinadas'],
  ['TODAS', 'Todas'],
];

export default function FichasEpi({ usuario }) {
  const [montado, setMontado] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);

  const [fichas, setFichas] = useState([]);
  const [funcionarios, setFuncionarios] = useState([]);
  const [hotel, setHotel] = useState({ nome: '', nomeTopo: '', cidade: 'João Pessoa' });

  const [modo, setModo] = useState('lista'); // lista | form
  const [filtro, setFiltro] = useState('PENDENTES');
  const [busca, setBusca] = useState('');
  const [form, setForm] = useState(fichaNova());
  const [sugeridos, setSugeridos] = useState({}); // linha → true quando CA/validade vieram da última ficha
  const [previa, setPrevia] = useState(false);
  const [impressao, setImpressao] = useState(null); // ficha sendo impressa
  const [zoomPrevia, setZoomPrevia] = useState(1);

  function mostrarAviso(texto) { setAviso(texto); setTimeout(() => setAviso(''), 5000); }

  useEffect(() => { setMontado(true); }, []);

  // ---- Carregar fichas, colaboradores e dados do hotel ----------------------
  const carregar = useCallback(async (u) => {
    setCarregando(true);
    const [lista, func, h, cfg] = await Promise.all([
      buscarTodos(() => supabase.from('epi_fichas').select('*').eq('hotel_id', u.hotel_id)
        .order('criado_em', { ascending: false })),
      supabase.from('funcionarios').select('*').eq('hotel_id', u.hotel_id).order('nome', { ascending: true }),
      supabase.from('hoteis').select('*').eq('id', u.hotel_id).maybeSingle(),
      supabase.from('contratos_trabalho_config').select('dados').eq('hotel_id', u.hotel_id).maybeSingle(),
    ]);
    if (lista.error) setErro(mensagemBanco(lista.error));
    else if (func.error) setErro('Não foi possível ler os colaboradores. Detalhe técnico: ' + func.error.message);
    setFichas(lista.data || []);
    setFuncionarios(func.data || []);
    // Nome do hotel na ficha: o mesmo dos contratos de trabalho; se não tiver, o do cadastro
    const dh = h.data || {};
    const dc = (!cfg.error && cfg.data?.dados) || {};
    setHotel({
      nome: String(dc.EMPREGADOR_RAZAO_SOCIAL || dh.razao_social || dh.nome_fantasia || dh.nome || '').trim(),
      nomeTopo: dh.nome_fantasia || dh.nome || '',
      cidade: String(dc.EMPREGADOR_CIDADE || dh.cidade || '').trim() || 'João Pessoa',
    });
    setCarregando(false);
  }, []);

  useEffect(() => { if (usuario) carregar(usuario); }, [usuario, carregar]);

  // ---- Impressão: monta a folha e abre a janela de impressão ----------------
  useEffect(() => {
    if (!impressao) return undefined;
    const terminar = () => setImpressao(null);
    window.addEventListener('afterprint', terminar, { once: true });
    const espera = setTimeout(() => window.print(), 200);
    return () => { clearTimeout(espera); window.removeEventListener('afterprint', terminar); };
  }, [impressao]);

  // Prévia: a folha diminui para caber na largura da tela
  useEffect(() => {
    if (!previa) return undefined;
    const ajustar = () => setZoomPrevia(Math.min(1, (window.innerWidth - 24) / 794));
    ajustar();
    window.addEventListener('resize', ajustar);
    return () => window.removeEventListener('resize', ajustar);
  }, [previa]);

  const catalogo = useMemo(() => catalogoDeEpis(fichas), [fichas]);
  const contagem = useMemo(() => ({
    PENDENTES: fichas.filter((f) => !f.devolvida_em).length,
    DEVOLVIDAS: fichas.filter((f) => f.devolvida_em).length,
    TODAS: fichas.length,
  }), [fichas]);
  const listaFiltrada = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return fichas.filter((f) => {
      if (filtro === 'PENDENTES' && f.devolvida_em) return false;
      if (filtro === 'DEVOLVIDAS' && !f.devolvida_em) return false;
      if (!termo) return true;
      return [f.colaborador_nome, f.funcao, f.setor, ...(f.itens || []).flatMap((i) => [i.descricao, i.ca])]
        .some((t) => String(t || '').toLowerCase().includes(termo));
    });
  }, [fichas, filtro, busca]);
  const ativos = useMemo(() => funcionarios.filter((f) => f.ativo !== false), [funcionarios]);

  // ---- Formulário -------------------------------------------------------------
  function novaFicha() {
    setForm({ ...fichaNova(), hotel_nome: hotel.nome });
    setSugeridos({});
    setErro('');
    setModo('form');
  }

  function editarFicha(f) {
    setForm({
      id: f.id, funcionario_id: f.funcionario_id ?? '', colaborador_nome: f.colaborador_nome || '',
      funcao: f.funcao || '', setor: f.setor || '', hotel_nome: f.hotel_nome || hotel.nome,
      data_entrega: f.data_entrega || hojeFortaleza(),
      itens: (f.itens || []).length ? f.itens.map((i) => ({ ...itemVazio(), ...i })) : [itemVazio()],
    });
    setSugeridos({});
    setErro('');
    setModo('form');
  }

  function escolherColaborador(id) {
    const f = funcionarios.find((x) => String(x.id) === String(id));
    setForm((atual) => ({
      ...atual,
      funcionario_id: f ? f.id : '',
      colaborador_nome: f ? f.nome : '',
      funcao: f ? (f.cargo || '') : '',
      setor: f ? (f.setor || '') : '',
    }));
  }

  function mudarItem(i, campo, valor) {
    setForm((atual) => ({ ...atual, itens: atual.itens.map((it, k) => (k === i ? { ...it, [campo]: valor } : it)) }));
    if (campo !== 'quantidade') setSugeridos((s) => ({ ...s, [i]: false }));
  }

  // Ao sair da descrição: se o EPI já foi entregue antes, sugere CA, validade e ANVISA
  function aoSairDescricao(i) {
    const it = form.itens[i];
    const antes = catalogo.get(String(it?.descricao || '').trim().toLowerCase());
    if (!antes || it.ca || it.validade || it.anvisa) return;
    setForm((atual) => ({
      ...atual,
      itens: atual.itens.map((x, k) => (k === i ? { ...x, ca: antes.ca, validade: antes.validade, anvisa: antes.anvisa } : x)),
    }));
    setSugeridos((s) => ({ ...s, [i]: true }));
  }

  function adicionarItem() {
    setForm((atual) => (atual.itens.length >= LINHAS_FICHA ? atual : { ...atual, itens: [...atual.itens, itemVazio()] }));
  }

  function removerItem(i) {
    setForm((atual) => ({
      ...atual,
      itens: atual.itens.length === 1 ? [itemVazio()] : atual.itens.filter((_, k) => k !== i),
    }));
    setSugeridos({});
  }

  async function salvar({ imprimir }) {
    setErro('');
    const { erros, faltando } = conferirFicha(form);
    if (erros.length) { setErro(erros.join(' ')); return; }
    if (imprimir && faltando.length && !window.confirm(
      `Está faltando ${faltando.join(', ')}. Vai sair em branco na ficha, para preencher à mão.\n\nImprimir mesmo assim?`,
    )) return;

    setSalvando(true);
    const linha = {
      hotel_id: usuario.hotel_id,
      funcionario_id: form.funcionario_id === '' ? null : form.funcionario_id,
      colaborador_nome: form.colaborador_nome.trim(),
      funcao: form.funcao.trim() || null,
      setor: form.setor.trim() || null,
      hotel_nome: form.hotel_nome || hotel.nome || null,
      data_entrega: form.data_entrega,
      itens: itensParaSalvar(form.itens),
      atualizado_em: new Date().toISOString(),
    };
    const resposta = form.id
      ? await supabase.from('epi_fichas').update(linha).eq('id', form.id).select().single()
      : await supabase.from('epi_fichas').insert({ ...linha, criado_por_id: usuario.id }).select().single();
    setSalvando(false);
    if (resposta.error) { setErro(mensagemBanco(resposta.error)); return; }

    const salva = resposta.data;
    setFichas((lista) => [salva, ...lista.filter((f) => f.id !== salva.id)]);
    setModo('lista');
    setFiltro('PENDENTES');
    setPrevia(false);
    if (imprimir) await imprimirFicha(salva);
    else if (salva.impresso_em) mostrarAviso('Ficha salva. Ela já tinha sido impressa: use "Imprimir de novo" para sair com a mudança.');
    else mostrarAviso('Ficha salva. Ela fica na lista para imprimir quando quiser.');
  }

  async function imprimirFicha(f) {
    setErro('');
    const marca = { impresso_em: new Date().toISOString(), impressoes: (Number(f.impressoes) || 0) + 1 };
    const { error } = await supabase.from('epi_fichas').update(marca).eq('id', f.id);
    if (error) { setErro(mensagemBanco(error)); return; }
    const atualizada = { ...f, ...marca };
    setFichas((lista) => lista.map((x) => (x.id === f.id ? atualizada : x)));
    setImpressao(atualizada);
  }

  async function darBaixa(f) {
    setErro('');
    const dados = { devolvida_em: new Date().toISOString(), devolvida_por_id: usuario.id, devolvida_por_nome: usuario.nome || null };
    const { error } = await supabase.from('epi_fichas').update(dados).eq('id', f.id);
    if (error) { setErro(mensagemBanco(error)); return; }
    setFichas((lista) => lista.map((x) => (x.id === f.id ? { ...x, ...dados } : x)));
    mostrarAviso(`Baixa dada: a ficha de ${f.colaborador_nome} voltou assinada.`);
  }

  async function desfazerBaixa(f) {
    setErro('');
    const dados = { devolvida_em: null, devolvida_por_id: null, devolvida_por_nome: null };
    const { error } = await supabase.from('epi_fichas').update(dados).eq('id', f.id);
    if (error) { setErro(mensagemBanco(error)); return; }
    setFichas((lista) => lista.map((x) => (x.id === f.id ? { ...x, ...dados } : x)));
    mostrarAviso('A ficha voltou para "aguardando devolução".');
  }

  async function excluirFicha(f) {
    if (!window.confirm(`Excluir a ficha de EPI de ${f.colaborador_nome} (${dataCurta(f.data_entrega)})? Não dá para desfazer.`)) return;
    setErro('');
    const { error } = await supabase.from('epi_fichas').delete().eq('id', f.id);
    if (error) { setErro(mensagemBanco(error)); return; }
    setFichas((lista) => lista.filter((x) => x.id !== f.id));
    mostrarAviso('Ficha excluída.');
  }

  // ---- Pedacinhos da tela -------------------------------------------------------
  const escolhido = funcionarios.find((f) => String(f.id) === String(form.funcionario_id));
  const opcoesColaborador = [...ativos];
  if (form.funcionario_id !== '' && !ativos.some((f) => String(f.id) === String(form.funcionario_id))) {
    opcoesColaborador.push({ id: form.funcionario_id, nome: `${form.colaborador_nome} (inativo)`, cargo: '' });
  }
  const fichaParaVer = { ...form, itens: itensParaSalvar(form.itens), hotel_nome: form.hotel_nome || hotel.nome };

  function situacaoTexto(f) {
    const s = situacaoFicha(f);
    if (s === 'DEVOLVIDA') {
      return <span className="fe-sit fe-sit-ok">✅ Devolvida assinada em {dataCurta(diaDe(f.devolvida_em))}{f.devolvida_por_nome ? ` · baixa por ${f.devolvida_por_nome.split(' ')[0]}` : ''}</span>;
    }
    if (s === 'AGUARDANDO') {
      const dias = diasDesde(f.impresso_em);
      return (
        <span className="fe-sit fe-sit-espera">
          🖨️ Impressa em {dataCurta(diaDe(f.impresso_em))} · aguardando a ficha assinada
          {dias > 0 ? ` (há ${dias} dia${dias > 1 ? 's' : ''})` : ''}
        </span>
      );
    }
    return <span className="fe-sit fe-sit-nova">📝 Salva, ainda não impressa</span>;
  }

  return (
    <div>
      <div className="dc-barra-aba">
        <h2 className="dc-titulo-aba">Fichas de EPI</h2>
        {modo === 'lista' ? (
          <button type="button" className="botao botao-principal" onClick={novaFicha}>+ Nova ficha</button>
        ) : (
          <button type="button" className="botao botao-contorno" onClick={() => { setModo('lista'); setErro(''); }}>← Voltar para a lista</button>
        )}
      </div>

      {aviso && <div className="aviso-sucesso">{aviso}</div>}
      {erro && <div className="aviso-erro">{erro}</div>}

      {/* ================================ LISTA ================================ */}
      {modo === 'lista' && (
        <div className="cartao">
          <p className="texto-suave" style={{ marginTop: 0 }}>
            Preencha a ficha de entrega de EPI, imprima e entregue para o colaborador assinar. Quando ela voltar
            assinada, dê baixa aqui. Colaboradores do <strong>{hotel.nomeTopo || 'hotel escolhido no topo'}</strong>;
            para outro hotel, troque no topo da tela.
          </p>
          <div className="fe-filtros" role="tablist" aria-label="Situação das fichas">
            {FILTROS.map(([chave, rotulo]) => (
              <button
                key={chave} type="button" role="tab" aria-selected={filtro === chave}
                className={filtro === chave ? 'fe-filtro fe-filtro-ativo' : 'fe-filtro'}
                onClick={() => setFiltro(chave)}
              >
                {rotulo} <span className="fe-conta">{contagem[chave]}</span>
              </button>
            ))}
          </div>
          <input
            className="campo" type="search" aria-label="Buscar fichas"
            placeholder="Buscar por colaborador, função, EPI ou CA…"
            value={busca} onChange={(e) => setBusca(e.target.value)}
          />
          {carregando ? (
            <p className="texto-suave">Carregando…</p>
          ) : listaFiltrada.length === 0 ? (
            <p className="texto-suave">
              {busca ? 'Nenhuma ficha encontrada nessa busca.'
                : filtro === 'PENDENTES' ? 'Nenhuma ficha aguardando devolução.'
                  : filtro === 'DEVOLVIDAS' ? 'Nenhuma ficha devolvida ainda.' : 'Nenhuma ficha feita ainda.'}
            </p>
          ) : (
            <div className="fe-lista">
              {listaFiltrada.map((f) => {
                const s = situacaoFicha(f);
                return (
                  <div key={f.id} className={`fe-item fe-item-${s.toLowerCase()}`}>
                    <div className="fe-item-info">
                      <strong>{f.colaborador_nome}</strong>
                      <span className="texto-suave">
                        {[f.funcao, f.setor].filter(Boolean).join(' · ') || 'Função não informada'} · entrega em {dataCurta(f.data_entrega)}
                      </span>
                      <span className="fe-item-epis">{resumoItens(f.itens)}</span>
                      {situacaoTexto(f)}
                    </div>
                    <div className="fe-item-acoes">
                      {s === 'AGUARDANDO' && (
                        <button type="button" className="botao botao-principal" onClick={() => darBaixa(f)}>✅ Voltou assinada</button>
                      )}
                      <button type="button" className={s === 'NAO_IMPRESSA' ? 'botao botao-principal' : 'botao botao-contorno'} onClick={() => imprimirFicha(f)}>
                        🖨️ {s === 'NAO_IMPRESSA' ? 'Imprimir' : 'Imprimir de novo'}
                      </button>
                      {s !== 'DEVOLVIDA' && (
                        <button type="button" className="botao botao-suave" onClick={() => editarFicha(f)}>✏️ Editar</button>
                      )}
                      {s === 'DEVOLVIDA' && (
                        <button type="button" className="botao botao-suave" onClick={() => desfazerBaixa(f)}>↩️ Desfazer baixa</button>
                      )}
                      {s !== 'DEVOLVIDA' && (
                        <button type="button" className="botao botao-perigo" onClick={() => excluirFicha(f)} aria-label={`Excluir a ficha de ${f.colaborador_nome}`}>🗑️</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ============================== FORMULÁRIO ============================== */}
      {modo === 'form' && (
        <form onSubmit={(e) => { e.preventDefault(); salvar({ imprimir: true }); }}>
          <section className="cartao fe-secao">
            <h2 className="fe-titulo-secao">1. Colaborador</h2>
            {!ativos.length && !form.funcionario_id ? (
              <p className="aviso-erro" style={{ margin: 0 }}>
                Nenhum colaborador ativo cadastrado no {hotel.nomeTopo || 'hotel'}. Cadastre em Administração → Ponto → Funcionários.
              </p>
            ) : (
              <div className="fe-grade">
                <div className="fe-campo fe-larga">
                  <label className="rotulo" htmlFor="fe-colaborador">Colaborador *</label>
                  <select id="fe-colaborador" className="campo" value={form.funcionario_id} onChange={(e) => escolherColaborador(e.target.value)}>
                    <option value="">— escolha —</option>
                    {opcoesColaborador.map((f) => (
                      <option key={f.id} value={f.id}>{f.nome}{f.cargo ? ` — ${f.cargo}` : ''}</option>
                    ))}
                  </select>
                </div>
                {form.colaborador_nome && (
                  <>
                    <div className="fe-campo fe-larga fe-dados">
                      <div><span className="fe-dado-rotulo">Nome completo</span><strong>{form.colaborador_nome}</strong></div>
                      <div><span className="fe-dado-rotulo">Hotel</span><strong>{form.hotel_nome || hotel.nome || '—'}</strong></div>
                    </div>
                    <div className="fe-campo">
                      <label className="rotulo" htmlFor="fe-funcao">Função</label>
                      <input id="fe-funcao" className="campo" maxLength={120} value={form.funcao} onChange={(e) => setForm({ ...form, funcao: e.target.value })} />
                      <small className="fe-dica">
                        {escolhido && !escolhido.cargo
                          ? 'A função não está no cadastro do Ponto: digite aqui (vale só para esta ficha).'
                          : 'Veio do cadastro. Se mudar aqui, vale só para esta ficha.'}
                      </small>
                    </div>
                    <div className="fe-campo">
                      <label className="rotulo" htmlFor="fe-setor">Setor</label>
                      <input id="fe-setor" className="campo" maxLength={120} value={form.setor} onChange={(e) => setForm({ ...form, setor: e.target.value })} />
                    </div>
                  </>
                )}
                <div className="fe-campo">
                  <label className="rotulo" htmlFor="fe-data">Data da entrega *</label>
                  <input id="fe-data" className="campo" type="date" value={form.data_entrega} onChange={(e) => setForm({ ...form, data_entrega: e.target.value })} />
                </div>
              </div>
            )}
          </section>

          <section className="cartao fe-secao">
            <h2 className="fe-titulo-secao">2. EPIs entregues</h2>
            <p className="texto-suave fe-sub">Até {LINHAS_FICHA} EPIs por ficha. As linhas que sobrarem saem em branco na folha.</p>
            <datalist id="fe-epis-usados">
              {[...catalogo.values()].map((c) => <option key={c.descricao} value={c.descricao} />)}
            </datalist>
            <div className="fe-itens-cabecalho" aria-hidden="true">
              <span>Quantidade *</span><span>Descrição do EPI *</span><span>Data validade</span><span>CA número</span><span>ANVISA</span><span />
            </div>
            <div className="fe-itens">
              {form.itens.map((it, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <div key={i} className="fe-item-form">
                  <div className="fe-num">EPI {i + 1}</div>
                  <label className="fe-cel">
                    <span className="fe-rot">Quantidade *</span>
                    <input className="campo" id={`fe-qtd-${i}`} placeholder="ex.: 15 pares" maxLength={40} value={it.quantidade} onChange={(e) => mudarItem(i, 'quantidade', e.target.value)} />
                  </label>
                  <label className="fe-cel fe-cel-desc">
                    <span className="fe-rot">Descrição do EPI *</span>
                    <input className="campo" id={`fe-desc-${i}`} list="fe-epis-usados" placeholder="ex.: Luvas para procedimento" maxLength={120} value={it.descricao}
                      onChange={(e) => mudarItem(i, 'descricao', e.target.value)} onBlur={() => aoSairDescricao(i)} />
                  </label>
                  <label className="fe-cel">
                    <span className="fe-rot">Data validade</span>
                    <input className="campo" id={`fe-val-${i}`} placeholder="mm/aaaa" maxLength={20} value={it.validade}
                      onChange={(e) => mudarItem(i, 'validade', e.target.value)} onBlur={() => mudarItem(i, 'validade', normalizarValidade(it.validade))}
                      aria-invalid={validadeInvalida(it.validade) || undefined} />
                  </label>
                  <label className="fe-cel">
                    <span className="fe-rot">CA número</span>
                    <input className="campo" id={`fe-ca-${i}`} inputMode="numeric" maxLength={20} value={it.ca} onChange={(e) => mudarItem(i, 'ca', e.target.value)} />
                  </label>
                  <label className="fe-cel">
                    <span className="fe-rot">ANVISA (se tiver)</span>
                    <input className="campo" id={`fe-anvisa-${i}`} maxLength={30} value={it.anvisa} onChange={(e) => mudarItem(i, 'anvisa', e.target.value)} />
                  </label>
                  <button type="button" className="botao botao-suave fe-remover" onClick={() => removerItem(i)} aria-label={`Tirar o EPI ${i + 1}`}>✕</button>
                  {sugeridos[i] && <small className="fe-dica fe-sugerido">CA, validade e ANVISA iguais aos da última ficha com este EPI. Confira na embalagem.</small>}
                  {validadeInvalida(it.validade) && <small className="fe-dica fe-invalido">Essa data de validade não existe.</small>}
                </div>
              ))}
            </div>
            <button type="button" className="botao botao-contorno" onClick={adicionarItem} disabled={form.itens.length >= LINHAS_FICHA}>
              + Adicionar outro EPI
            </button>
          </section>

          <div className="fe-botoes">
            <button type="submit" className="botao botao-principal" disabled={salvando}>{salvando ? 'Salvando…' : '🖨️ Salvar e imprimir'}</button>
            <button type="button" className="botao botao-contorno" disabled={salvando} onClick={() => salvar({ imprimir: false })}>Salvar sem imprimir</button>
            <button type="button" className="botao botao-suave" onClick={() => setPrevia(true)}>👁️ Ver como fica</button>
          </div>
        </form>
      )}

      {/* ================================ PRÉVIA ================================ */}
      {previa && (
        <div className="fe-overlay" role="dialog" aria-modal="true" aria-label="Prévia da ficha de EPI">
          <div className="fe-previa-barra">
            <strong>Prévia da ficha</strong>
            <div className="fe-botoes">
              <button type="button" className="botao botao-principal" disabled={salvando} onClick={() => salvar({ imprimir: true })}>🖨️ Salvar e imprimir</button>
              <button type="button" className="botao botao-contorno" onClick={() => setPrevia(false)}>Fechar</button>
            </div>
          </div>
          <div className="fe-previa-rolagem">
            <div className="fe-papel" style={{ zoom: zoomPrevia }}>
              <FichaEpiDocumento ficha={fichaParaVer} cidade={hotel.cidade} />
            </div>
          </div>
        </div>
      )}

      {montado && impressao && createPortal(
        <div className="fe-impressao"><FichaEpiDocumento ficha={impressao} cidade={hotel.cidade} /></div>,
        document.body,
      )}

      <Estilos />
    </div>
  );
}

function Estilos() {
  return (
    <style>{`
      ${ESTILOS_FICHA_EPI}

      .fe-filtros { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
      .fe-filtro { border: 1px solid var(--borda); background: var(--branco); color: inherit; border-radius: 999px; padding: 7px 14px; font: inherit; font-size: 14px; cursor: pointer; }
      .fe-filtro-ativo { background: var(--marca); border-color: var(--marca); color: #fff; }
      .fe-conta { display: inline-block; min-width: 20px; padding: 0 6px; margin-left: 4px; border-radius: 999px; background: rgba(0,0,0,0.08); font-size: 12.5px; text-align: center; }
      .fe-filtro-ativo .fe-conta { background: rgba(255,255,255,0.25); }

      .fe-lista { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; }
      .fe-item { display: flex; flex-direction: column; gap: 10px; padding: 14px; border: 1px solid var(--borda); border-radius: 12px; border-left-width: 5px; }
      .fe-item-aguardando { border-left-color: #E6A100; }
      .fe-item-nao_impressa { border-left-color: var(--borda); }
      .fe-item-devolvida { border-left-color: #2E7D32; }
      .fe-item-info { display: flex; flex-direction: column; gap: 3px; min-width: 0; overflow-wrap: anywhere; }
      .fe-item-info span { font-size: 14px; }
      .fe-item-epis { font-size: 14px; }
      .fe-sit { font-size: 13.5px !important; font-weight: 600; }
      .fe-sit-espera { color: #7A5600; }
      .fe-sit-ok { color: #1E6B2A; }
      .fe-sit-nova { color: var(--texto-suave); }
      .fe-item-acoes { display: flex; flex-wrap: wrap; gap: 8px; }

      .fe-secao { margin-bottom: 16px; }
      .fe-titulo-secao { font-size: 18px; margin: 0 0 6px; }
      .fe-sub { margin: 0 0 10px; font-size: 14px; }
      .fe-grade { display: grid; grid-template-columns: 1fr; column-gap: 16px; row-gap: 4px; }
      .fe-campo { min-width: 0; }
      .fe-dados { display: flex; flex-wrap: wrap; gap: 8px 28px; padding: 10px 12px; margin: 6px 0; border-radius: 10px; background: var(--fundo, #F4F6F5); }
      .fe-dados > div { display: flex; flex-direction: column; min-width: 0; overflow-wrap: anywhere; }
      .fe-dado-rotulo { font-size: 12.5px; color: var(--texto-suave); }
      .fe-dica { display: block; margin-top: 4px; font-size: 12.5px; color: var(--texto-suave); }
      .fe-sugerido { color: #7A5600; grid-column: 1 / -1; }
      .fe-invalido { color: var(--erro-texto); font-weight: 600; grid-column: 1 / -1; }

      .fe-itens-cabecalho { display: none; }
      .fe-itens { display: flex; flex-direction: column; gap: 12px; margin-bottom: 12px; }
      .fe-item-form { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; padding: 12px; border: 1px solid var(--borda); border-radius: 12px; position: relative; }
      .fe-num { grid-column: 1 / -1; font-weight: 700; font-size: 14px; }
      .fe-cel { display: flex; flex-direction: column; min-width: 0; }
      .fe-cel .campo { margin: 0; }
      .fe-cel-desc { grid-column: 1 / -1; }
      .fe-rot { font-size: 13px; font-weight: 600; margin-bottom: 3px; }
      .fe-remover { position: absolute; top: 6px; right: 8px; padding: 4px 10px; }
      .fe-cel input[aria-invalid="true"] { border-color: var(--erro-texto); }
      .fe-botoes { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }

      @media (min-width: 640px) {
        .fe-grade { grid-template-columns: 1fr 1fr 1fr; }
        .fe-larga { grid-column: 1 / -1; }
        .fe-item { flex-direction: row; align-items: center; justify-content: space-between; }
        .fe-item-acoes { justify-content: flex-end; max-width: 50%; }
      }
      @media (min-width: 900px) {
        .fe-itens-cabecalho { display: grid; grid-template-columns: 130px 1fr 120px 110px 120px 44px; gap: 8px; font-size: 13px; font-weight: 600; margin-bottom: 4px; padding: 0 2px; }
        .fe-itens { gap: 6px; }
        .fe-item-form { grid-template-columns: 130px 1fr 120px 110px 120px 44px; gap: 4px 8px; padding: 0; border: none; border-radius: 0; }
        .fe-num, .fe-rot { display: none; }
        .fe-cel-desc { grid-column: auto; }
        .fe-remover { position: static; padding: 8px 0; }
      }

      /* Prévia em tela cheia (z-index 80: acima do menu) */
      .fe-overlay { position: fixed; inset: 0; z-index: 80; background: rgba(20, 30, 27, 0.92); display: flex; flex-direction: column; }
      .fe-previa-barra { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; padding: 10px 16px; background: var(--branco); border-bottom: 1px solid var(--borda); }
      .fe-previa-rolagem { flex: 1; overflow: auto; padding: 16px 12px 40px; }
      .fe-papel { width: 794px; margin: 0 auto; padding: 45px; background: #fff; box-shadow: 0 4px 18px rgba(0,0,0,0.25); }

      /* Papel: só a ficha aparece */
      @media screen { .fe-impressao { display: none; } }
      @media print {
        @page { margin: 12mm; }
        body > *:not(.fe-impressao) { display: none !important; }
        html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
        .fe-impressao { display: block; }
      }
    `}</style>
  );
}
