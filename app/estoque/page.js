'use client';

// ============================================================================
// ESTOQUE
// 3 áreas (como o protótipo):
//   1. Dar Baixa (Saída) — TODA a equipe. Com "carrinho": seleciona vários
//      produtos e quantidades e confirma tudo de uma vez (economiza tempo).
//      Não deixa retirar mais do que há disponível.
//   2. Gerenciar Estoque (só ADMIN) — cadastro completo, badge de status
//      🟢 Ok / 🟡 Baixo / 🔴 Sem Estoque (calculado pela qtd mínima),
//      entrada rápida, editar e excluir (com confirmação).
//   3. Histórico de Lançamentos (só ADMIN) — auditoria imutável, filtro por
//      tipo (Cadastro/Entrada/Saída/Edição/Exclusão) e busca.
// ============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { bloquearSeNaoPermitido } from '../../lib/restricaoAcesso';

// ---- Constantes -------------------------------------------------------------

const TIPO_LABEL = {
  CADASTRO: 'Cadastro', ENTRADA: 'Entrada', SAIDA: 'Saída', EDICAO: 'Edição', EXCLUSAO: 'Exclusão',
  TRANSFERENCIA: 'Transferência',
};
const TIPO_COR = {
  CADASTRO: { fundo: '#DCEBFA', texto: '#1D4E89' },
  ENTRADA: { fundo: '#DDF2E4', texto: '#1E6B3C' },
  SAIDA: { fundo: '#FBDDDD', texto: '#A31212' },
  EDICAO: { fundo: '#FDF3D7', texto: '#8A6100' },
  EXCLUSAO: { fundo: '#EFEFEF', texto: '#666666' },
  TRANSFERENCIA: { fundo: '#E2EFEA', texto: '#0E5A4E' },
};

// ---- Funções de apoio -------------------------------------------------------

function dinheiro(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(valor || 0));
}

function formatarDataHora(valor) {
  if (!valor) return '—';
  try {
    return new Date(valor).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch (e) { return String(valor); }
}

// Quantidade "bonita": mostra sem casas decimais se for inteiro
function qtd(valor) {
  const n = Number(valor || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',');
}

// Status pela quantidade x mínimo (agora recebe os dois já calculados,
// porque dependem de qual depósito está sendo olhado)
function statusProduto(quantidade, minimo) {
  const q = Number(quantidade || 0);
  const min = Number(minimo || 0);
  if (q <= 0) return { chave: 'SEM', rotulo: '🔴 Sem Estoque', cor: '#A31212', fundo: '#FBDDDD' };
  if (q <= min) return { chave: 'BAIXO', rotulo: '🟡 Estoque Baixo', cor: '#8A6100', fundo: '#FDF3D7' };
  return { chave: 'OK', rotulo: '🟢 Ok', cor: '#1E6B3C', fundo: '#DDF2E4' };
}

// ---- Componente principal ---------------------------------------------------

export default function Estoque() {
  const router = useRouter();

  const [verificandoLogin, setVerificandoLogin] = useState(true);
  const [usuario, setUsuario] = useState(null);
  const [nomesUsuarios, setNomesUsuarios] = useState({});

  const [produtos, setProdutos] = useState([]);
  const [historico, setHistorico] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);

  const [subAba, setSubAba] = useState('baixa'); // baixa | transferencia | gerenciar | depositos | historico

  // Multi-depósito
  const [depositos, setDepositos] = useState([]);
  const [saldos, setSaldos] = useState([]); // [{id, produto_id, deposito_id, quantidade, estoque_minimo}]
  const [depositoFiltro, setDepositoFiltro] = useState('GERAL'); // 'GERAL' ou o id do depósito (string)

  // Dar Baixa — busca e carrinho
  const [buscaBaixa, setBuscaBaixa] = useState('');
  const [carrinho, setCarrinho] = useState([]); // [{produtoId, nome, disponivel, quantidade}]
  const [obsBaixa, setObsBaixa] = useState('');
  const [erroBaixa, setErroBaixa] = useState('');

  // Transferência interna
  const [transfProdutoId, setTransfProdutoId] = useState('');
  const [transfOrigemId, setTransfOrigemId] = useState('');
  const [transfDestinoId, setTransfDestinoId] = useState('');
  const [transfQtd, setTransfQtd] = useState('');
  const [transfObs, setTransfObs] = useState('');
  const [erroTransf, setErroTransf] = useState('');

  // Gerenciar — busca, formulário, entrada rápida
  const [buscaGer, setBuscaGer] = useState('');
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [gNome, setGNome] = useState('');
  const [gCodigo, setGCodigo] = useState('');
  const [gDescricao, setGDescricao] = useState('');
  const [gQuantidade, setGQuantidade] = useState('');
  const [gDepositoInicial, setGDepositoInicial] = useState('');
  const [gMinima, setGMinima] = useState('');
  const [gValor, setGValor] = useState('');
  const [gLocal, setGLocal] = useState('');
  const [erroForm, setErroForm] = useState('');
  const [entradaProduto, setEntradaProduto] = useState(null); // {produto}
  const [entradaQtd, setEntradaQtd] = useState('');
  const [entradaDepositoId, setEntradaDepositoId] = useState('');
  const [entradaObs, setEntradaObs] = useState('');
  const [excluindoId, setExcluindoId] = useState(null);
  const [minimoEditando, setMinimoEditando] = useState(null); // `${produtoId}:${depositoId}`
  const [minimoValor, setMinimoValor] = useState('');

  // Depósitos (admin)
  const [mostrarFormDep, setMostrarFormDep] = useState(false);
  const [editandoDepId, setEditandoDepId] = useState(null);
  const [dNome, setDNome] = useState('');
  const [dDescricao, setDDescricao] = useState('');
  const [erroFormDep, setErroFormDep] = useState('');

  // Histórico — filtros
  const [filtroTipo, setFiltroTipo] = useState('TODOS');
  const [buscaHist, setBuscaHist] = useState('');

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

  const carregarTudo = useCallback(async (u) => {
    setCarregando(true);
    setErro('');

    const { data: pessoas } = await supabase.from('usuarios').select('id, nome').eq('hotel_id', u.hotel_id);
    if (pessoas) {
      const mapa = {};
      pessoas.forEach((p) => { mapa[p.id] = p.nome; });
      setNomesUsuarios(mapa);
    }

    const { data: prods, error: e1 } = await supabase
      .from('estoque_produtos').select('*').order('nome', { ascending: true });
    if (e1) setErro('Não foi possível carregar os produtos. Detalhe técnico: ' + e1.message);
    else setProdutos(prods || []);

    const { data: deps } = await supabase
      .from('estoque_depositos').select('*').eq('hotel_id', u.hotel_id).order('nome', { ascending: true });
    setDepositos(deps || []);

    const { data: sld } = await supabase.from('estoque_saldos').select('*').eq('hotel_id', u.hotel_id);
    setSaldos(sld || []);

    const { data: hist } = await supabase
      .from('estoque_historico').select('*')
      .order('data_hora', { ascending: false }).limit(500);
    setHistorico(hist || []);

    setCarregando(false);
  }, []);

  useEffect(() => {
    if (usuario) carregarTudo(usuario);
  }, [usuario, carregarTudo]);

  async function registrarHistorico(tipo, produtoNome, quantidade, observacao, depositoOrigemId, depositoDestinoId) {
    await supabase.from('estoque_historico').insert({
      tipo, produto_nome: produtoNome,
      quantidade: quantidade != null ? Number(quantidade) : null,
      usuario_id: usuario.id, observacao: observacao || null, hotel_id: usuario.hotel_id,
      deposito_origem_id: depositoOrigemId || null, deposito_destino_id: depositoDestinoId || null,
    });
  }

  // ---- Apoio: saldo por depósito, mínimo aplicável, nome do depósito ----
  function saldoDe(produtoId, depositoId) {
    const s = saldos.find((x) => x.produto_id === produtoId && x.deposito_id === Number(depositoId));
    return s ? Number(s.quantidade) : 0;
  }
  function minimoDe(produto, depositoId) {
    if (depositoId && depositoId !== 'GERAL') {
      const s = saldos.find((x) => x.produto_id === produto.id && x.deposito_id === Number(depositoId));
      if (s && s.estoque_minimo != null) return Number(s.estoque_minimo);
    }
    return Number(produto.qtd_minima || 0);
  }
  function quantidadeExibida(produto) {
    return depositoFiltro === 'GERAL' ? Number(produto.quantidade || 0) : saldoDe(produto.id, depositoFiltro);
  }
  function nomeDeposito(id) {
    const d = depositos.find((x) => x.id === id);
    return d ? d.nome : '—';
  }
  // Recalcula e grava o total do produto (soma de todos os depósitos) —
  // é essa coluna que a "Visão Geral" usa pra não ter que somar toda hora.
  async function recomputarTotalProduto(produtoId) {
    const { data: linhas } = await supabase.from('estoque_saldos').select('quantidade').eq('produto_id', produtoId);
    const total = (linhas || []).reduce((s, l) => s + Number(l.quantidade), 0);
    await supabase.from('estoque_produtos').update({ quantidade: total }).eq('id', produtoId);
    return total;
  }

  // ================= DAR BAIXA (carrinho) =================

  function adicionarAoCarrinho(produto) {
    setErroBaixa('');
    if (depositoFiltro === 'GERAL') { setErroBaixa('Escolha um depósito específico antes de dar baixa.'); return; }
    if (carrinho.some((i) => i.produtoId === produto.id)) return; // já está
    const disponivel = saldoDe(produto.id, depositoFiltro);
    if (disponivel <= 0) {
      setErroBaixa(`"${produto.nome}" está sem estoque neste depósito.`);
      return;
    }
    setCarrinho([...carrinho, {
      produtoId: produto.id, nome: produto.nome, disponivel, quantidade: 1,
    }]);
  }

  function mudarQtdCarrinho(produtoId, novaQtd) {
    setCarrinho(carrinho.map((i) =>
      i.produtoId === produtoId
        ? { ...i, quantidade: Math.max(1, Math.min(Number(novaQtd) || 1, i.disponivel)) }
        : i
    ));
  }

  function removerDoCarrinho(produtoId) {
    setCarrinho(carrinho.filter((i) => i.produtoId !== produtoId));
  }

  async function confirmarSaida() {
    if (salvando || carrinho.length === 0 || depositoFiltro === 'GERAL') return;
    setErroBaixa('');

    // Revalida disponibilidade no depósito (pode ter mudado)
    for (const item of carrinho) {
      const disponivelAgora = saldoDe(item.produtoId, depositoFiltro);
      if (disponivelAgora < item.quantidade) {
        setErroBaixa(`Estoque insuficiente de "${item.nome}" neste depósito. Disponível agora: ${qtd(disponivelAgora)}.`);
        return;
      }
    }

    setSalvando(true);
    try {
      for (const item of carrinho) {
        const linha = saldos.find((s) => s.produto_id === item.produtoId && s.deposito_id === Number(depositoFiltro));
        const novaQtd = Number(linha.quantidade) - item.quantidade;
        const { error } = await supabase.from('estoque_saldos')
          .update({ quantidade: novaQtd, atualizado_em: new Date().toISOString() }).eq('id', linha.id);
        if (error) throw new Error(`Falha ao dar baixa em "${item.nome}": ${error.message}`);
        await recomputarTotalProduto(item.produtoId);
        await registrarHistorico('SAIDA', item.nome, item.quantidade, obsBaixa.trim() || null, Number(depositoFiltro), null);
      }
      const qtdProdutos = carrinho.length;
      setCarrinho([]);
      setObsBaixa('');
      mostrarAviso(`Saída registrada: ${qtdProdutos} produto(s) em ${nomeDeposito(Number(depositoFiltro))}.`);
      await carregarTudo(usuario);
    } catch (e) {
      setErroBaixa(e.message);
    } finally {
      setSalvando(false);
    }
  }

  // ================= TRANSFERÊNCIA INTERNA =================

  async function confirmarTransferencia() {
    if (salvando) return;
    setErroTransf('');
    if (!transfProdutoId) { setErroTransf('Escolha o produto.'); return; }
    if (!transfOrigemId || !transfDestinoId) { setErroTransf('Escolha os dois depósitos.'); return; }
    if (transfOrigemId === transfDestinoId) { setErroTransf('Escolha depósitos diferentes para origem e destino.'); return; }
    const q = Number(transfQtd);
    if (!(q > 0)) { setErroTransf('Informe uma quantidade válida.'); return; }

    const disponivel = saldoDe(Number(transfProdutoId), transfOrigemId);
    if (q > disponivel) { setErroTransf(`Só há ${qtd(disponivel)} disponível em ${nomeDeposito(Number(transfOrigemId))}.`); return; }

    setSalvando(true);
    const origemLinha = saldos.find((s) => s.produto_id === Number(transfProdutoId) && s.deposito_id === Number(transfOrigemId));
    const { error: erroOrigem } = await supabase.from('estoque_saldos')
      .update({ quantidade: disponivel - q, atualizado_em: new Date().toISOString() }).eq('id', origemLinha.id);
    if (erroOrigem) { setSalvando(false); setErroTransf('Não foi possível transferir. Detalhe técnico: ' + erroOrigem.message); return; }

    const destinoLinha = saldos.find((s) => s.produto_id === Number(transfProdutoId) && s.deposito_id === Number(transfDestinoId));
    if (destinoLinha) {
      await supabase.from('estoque_saldos')
        .update({ quantidade: Number(destinoLinha.quantidade) + q, atualizado_em: new Date().toISOString() }).eq('id', destinoLinha.id);
    } else {
      await supabase.from('estoque_saldos')
        .insert({ hotel_id: usuario.hotel_id, produto_id: Number(transfProdutoId), deposito_id: Number(transfDestinoId), quantidade: q });
    }

    const produto = produtos.find((p) => p.id === Number(transfProdutoId));
    await registrarHistorico('TRANSFERENCIA', produto?.nome || '', q, transfObs.trim() || null, Number(transfOrigemId), Number(transfDestinoId));

    setSalvando(false);
    setTransfProdutoId(''); setTransfOrigemId(''); setTransfDestinoId(''); setTransfQtd(''); setTransfObs('');
    mostrarAviso(`Transferência registrada: ${qtd(q)} un. de ${nomeDeposito(Number(transfOrigemId))} para ${nomeDeposito(Number(transfDestinoId))}.`);
    carregarTudo(usuario);
  }

  // ================= GERENCIAR (admin) =================

  function abrirNovo() {
    setEditandoId(null);
    setGNome(''); setGCodigo(''); setGDescricao(''); setGQuantidade('');
    setGDepositoInicial(depositos.find((d) => d.ativo)?.id ? String(depositos.find((d) => d.ativo).id) : '');
    setGMinima(''); setGValor(''); setGLocal('');
    setErroForm('');
    setMostrarForm(true);
  }

  function abrirEdicao(p) {
    setEditandoId(p.id);
    setGNome(p.nome); setGCodigo(p.codigo || ''); setGDescricao(p.descricao || '');
    setGQuantidade(''); setGDepositoInicial('');
    setGMinima(String(p.qtd_minima));
    setGValor(String(p.valor)); setGLocal(p.localizacao || '');
    setErroForm('');
    setMostrarForm(true);
  }

  async function salvarProduto(evento) {
    evento.preventDefault();
    if (salvando) return;
    setErroForm('');
    if (!gNome.trim()) { setErroForm('Informe o nome do produto.'); return; }
    if (!editandoId && Number(gQuantidade) > 0 && !gDepositoInicial) {
      setErroForm('Escolha em qual depósito fica a quantidade inicial.');
      return;
    }

    const dados = {
      nome: gNome.trim(),
      codigo: gCodigo.trim() || null,
      descricao: gDescricao.trim() || null,
      qtd_minima: Number(gMinima) || 0,
      valor: Number(gValor) || 0,
      localizacao: gLocal.trim() || null,
    };

    setSalvando(true);
    if (editandoId) {
      // Na edição não mexe em quantidade — isso só muda via Entrada/Saída/Transferência.
      const { error } = await supabase.from('estoque_produtos').update(dados).eq('id', editandoId);
      setSalvando(false);
      if (error) { setErroForm('Não foi possível salvar. Detalhe técnico: ' + error.message); return; }
      await registrarHistorico('EDICAO', dados.nome, null, 'Produto editado.');
      mostrarAviso('Produto atualizado!');
    } else {
      const quantidadeInicial = Number(gQuantidade) || 0;
      const { data: novoProduto, error } = await supabase.from('estoque_produtos')
        .insert({ ...dados, quantidade: quantidadeInicial, criado_por_id: usuario.id, hotel_id: usuario.hotel_id })
        .select().single();
      if (error) { setSalvando(false); setErroForm('Não foi possível cadastrar. Detalhe técnico: ' + error.message); return; }
      if (quantidadeInicial > 0 && gDepositoInicial) {
        await supabase.from('estoque_saldos').insert({
          hotel_id: usuario.hotel_id, produto_id: novoProduto.id, deposito_id: Number(gDepositoInicial), quantidade: quantidadeInicial,
        });
      }
      setSalvando(false);
      await registrarHistorico('CADASTRO', dados.nome, quantidadeInicial, 'Produto cadastrado.', null, gDepositoInicial ? Number(gDepositoInicial) : null);
      mostrarAviso('Produto cadastrado!');
    }
    setMostrarForm(false);
    carregarTudo(usuario);
  }

  async function confirmarEntrada() {
    if (!entradaProduto || salvando) return;
    const q = Number(entradaQtd);
    if (!(q > 0) || !entradaDepositoId) return;
    setSalvando(true);

    const existente = saldos.find((s) => s.produto_id === entradaProduto.id && s.deposito_id === Number(entradaDepositoId));
    let error;
    if (existente) {
      ({ error } = await supabase.from('estoque_saldos')
        .update({ quantidade: Number(existente.quantidade) + q, atualizado_em: new Date().toISOString() }).eq('id', existente.id));
    } else {
      ({ error } = await supabase.from('estoque_saldos')
        .insert({ hotel_id: usuario.hotel_id, produto_id: entradaProduto.id, deposito_id: Number(entradaDepositoId), quantidade: q }));
    }
    if (error) { setSalvando(false); setErro('Não foi possível registrar a entrada. Detalhe técnico: ' + error.message); return; }

    await recomputarTotalProduto(entradaProduto.id);
    await registrarHistorico('ENTRADA', entradaProduto.nome, q, entradaObs.trim() || 'Entrada de estoque.', null, Number(entradaDepositoId));
    setSalvando(false);
    setEntradaProduto(null); setEntradaQtd(''); setEntradaObs(''); setEntradaDepositoId('');
    mostrarAviso('Entrada registrada!');
    carregarTudo(usuario);
  }

  async function salvarMinimoDeposito(produtoId, depositoId, valor) {
    const chave = `${produtoId}:${depositoId}`;
    const existente = saldos.find((s) => s.produto_id === produtoId && s.deposito_id === depositoId);
    const novoMinimo = valor.trim() === '' ? null : Number(valor);
    if (existente) {
      await supabase.from('estoque_saldos').update({ estoque_minimo: novoMinimo }).eq('id', existente.id);
    } else {
      await supabase.from('estoque_saldos').insert({
        hotel_id: usuario.hotel_id, produto_id: produtoId, deposito_id: depositoId, quantidade: 0, estoque_minimo: novoMinimo,
      });
    }
    setMinimoEditando(null);
    mostrarAviso('Mínimo deste depósito atualizado.');
    carregarTudo(usuario);
  }

  async function excluirProduto(p) {
    setExcluindoId(null);
    await registrarHistorico('EXCLUSAO', p.nome, null, 'Produto excluído.');
    const { error } = await supabase.from('estoque_produtos').delete().eq('id', p.id);
    if (error) { setErro('Não foi possível excluir. Detalhe técnico: ' + error.message); return; }
    mostrarAviso('Produto excluído.');
    carregarTudo(usuario);
  }

  // ================= DEPÓSITOS (admin) =================

  function abrirNovoDeposito() {
    setEditandoDepId(null); setDNome(''); setDDescricao(''); setErroFormDep('');
    setMostrarFormDep(true);
  }
  function abrirEdicaoDeposito(d) {
    setEditandoDepId(d.id); setDNome(d.nome); setDDescricao(d.descricao || ''); setErroFormDep('');
    setMostrarFormDep(true);
  }
  async function salvarDeposito(evento) {
    evento.preventDefault();
    if (salvando) return;
    setErroFormDep('');
    if (!dNome.trim()) { setErroFormDep('Informe o nome do depósito.'); return; }
    setSalvando(true);
    if (editandoDepId) {
      const { error } = await supabase.from('estoque_depositos')
        .update({ nome: dNome.trim(), descricao: dDescricao.trim() || null }).eq('id', editandoDepId);
      setSalvando(false);
      if (error) { setErroFormDep('Não foi possível salvar. Detalhe técnico: ' + error.message); return; }
      mostrarAviso('Depósito atualizado!');
    } else {
      const { error } = await supabase.from('estoque_depositos')
        .insert({ nome: dNome.trim(), descricao: dDescricao.trim() || null, hotel_id: usuario.hotel_id, criado_por_id: usuario.id });
      setSalvando(false);
      if (error) { setErroFormDep('Não foi possível cadastrar. Detalhe técnico: ' + error.message); return; }
      mostrarAviso('Depósito cadastrado!');
    }
    setMostrarFormDep(false);
    carregarTudo(usuario);
  }
  async function alternarAtivoDeposito(d) {
    const { error } = await supabase.from('estoque_depositos').update({ ativo: !d.ativo }).eq('id', d.id);
    if (error) { setErro('Não foi possível atualizar. Detalhe técnico: ' + error.message); return; }
    mostrarAviso(d.ativo ? `Depósito "${d.nome}" inativado.` : `Depósito "${d.nome}" reativado.`);
    carregarTudo(usuario);
  }

  // ---- Filtros ----
  const termoBaixa = buscaBaixa.trim().toLowerCase();
  const produtosBaixa = produtos.filter((p) =>
    !termoBaixa ||
    (p.nome || '').toLowerCase().includes(termoBaixa) ||
    (p.codigo || '').toLowerCase().includes(termoBaixa)
  );

  const termoGer = buscaGer.trim().toLowerCase();
  const produtosGer = produtos.filter((p) =>
    !termoGer ||
    (p.nome || '').toLowerCase().includes(termoGer) ||
    (p.codigo || '').toLowerCase().includes(termoGer)
  );

  const termoHist = buscaHist.trim().toLowerCase();
  const historicoFiltrado = historico
    .filter((h) => (filtroTipo === 'TODOS' ? true : h.tipo === filtroTipo))
    .filter((h) =>
      !termoHist ||
      (h.produto_nome || '').toLowerCase().includes(termoHist) ||
      (h.observacao || '').toLowerCase().includes(termoHist) ||
      nomeDe(h.usuario_id).toLowerCase().includes(termoHist)
    );

  const totalCarrinho = carrinho.reduce((s, i) => s + i.quantidade, 0);

  if (verificandoLogin) {
    return (
      <main className="conteudo">
        <p className="texto-suave">Verificando seu acesso…</p>
      </main>
    );
  }

  return (
    <main className="conteudo">
      <EstilosEstoque />

      <span className="olho">Almoxarifado</span>
      <h1 style={{ marginBottom: 10 }}>Estoque</h1>

      {aviso && <div className="aviso-sucesso">{aviso}</div>}
      {erro && <div className="aviso-erro">{erro}</div>}

      {/* Sub-abas (Gerenciar, Depósitos e Histórico só para ADMIN) */}
      <nav className="es-abas" aria-label="Seções">
        <button type="button" className={subAba === 'baixa' ? 'es-aba es-aba-ativa' : 'es-aba'}
          onClick={() => setSubAba('baixa')}>
          Dar Baixa (Saída)
        </button>
        <button type="button" className={subAba === 'transferencia' ? 'es-aba es-aba-ativa' : 'es-aba'}
          onClick={() => setSubAba('transferencia')}>
          🔁 Transferência
        </button>
        {souAdmin && (
          <button type="button" className={subAba === 'gerenciar' ? 'es-aba es-aba-ativa' : 'es-aba'}
            onClick={() => setSubAba('gerenciar')}>
            Gerenciar Estoque
          </button>
        )}
        {souAdmin && (
          <button type="button" className={subAba === 'depositos' ? 'es-aba es-aba-ativa' : 'es-aba'}
            onClick={() => setSubAba('depositos')}>
            🏭 Depósitos
          </button>
        )}
        {souAdmin && (
          <button type="button" className={subAba === 'historico' ? 'es-aba es-aba-ativa' : 'es-aba'}
            onClick={() => setSubAba('historico')}>
            Histórico de Lançamentos
          </button>
        )}
      </nav>

      {carregando && <p className="texto-suave">Carregando…</p>}

      {/* ================= DAR BAIXA ================= */}
      {!carregando && subAba === 'baixa' && (
        <section>
          <label className="rotulo">Depósito de onde vai sair *</label>
          <select className="campo" value={depositoFiltro}
            onChange={(e) => { setDepositoFiltro(e.target.value); setCarrinho([]); setErroBaixa(''); }}
            style={{ marginBottom: 10 }}>
            <option value="GERAL">👁️ Visão Geral (escolha um depósito para dar baixa)</option>
            {depositos.filter((d) => d.ativo).map((d) => <option key={d.id} value={String(d.id)}>{d.nome}</option>)}
          </select>

          {depositoFiltro === 'GERAL' ? (
            <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
              Escolha um depósito específico no seletor acima para começar a dar baixa.
            </div>
          ) : (
            <>
              <p className="texto-suave" style={{ fontSize: 13 }}>
                Toque nos produtos que vai retirar de <strong>{nomeDeposito(Number(depositoFiltro))}</strong>, ajuste as quantidades e confirme tudo de uma vez.
              </p>

              <input className="campo" type="search" value={buscaBaixa}
                onChange={(e) => setBuscaBaixa(e.target.value)}
                placeholder="Buscar produto por nome ou código…" style={{ marginBottom: 12 }} />

              {/* Carrinho */}
              {carrinho.length > 0 && (
                <div className="cartao es-carrinho">
                  <strong>Itens selecionados ({carrinho.length})</strong>
                  <div className="es-carrinho-lista">
                    {carrinho.map((i) => (
                      <div key={i.produtoId} className="es-carrinho-item">
                        <div className="es-carrinho-nome">{i.nome}</div>
                        <div className="es-carrinho-controles">
                          <input className="campo es-qtd-input" type="number" min="1" max={i.disponivel}
                            value={i.quantidade} onChange={(e) => mudarQtdCarrinho(i.produtoId, e.target.value)} />
                          <span className="texto-suave" style={{ fontSize: 12 }}>de {qtd(i.disponivel)}</span>
                          <button type="button" className="es-remover" onClick={() => removerDoCarrinho(i.produtoId)} aria-label="Remover">✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <label className="rotulo">Observação (motivo da retirada)</label>
                  <input className="campo" type="text" value={obsBaixa}
                    onChange={(e) => setObsBaixa(e.target.value)} placeholder="Ex.: Uso na reforma do quarto 210" />
                  {erroBaixa && <div className="aviso-erro">{erroBaixa}</div>}
                  <button type="button" className="botao botao-principal" onClick={confirmarSaida}
                    disabled={salvando} style={{ marginTop: 12 }}>
                    {salvando ? 'Registrando…' : `Confirmar Saída (${totalCarrinho} un.)`}
                  </button>
                </div>
              )}
              {carrinho.length === 0 && erroBaixa && <div className="aviso-erro">{erroBaixa}</div>}

              {/* Lista de produtos para selecionar */}
              {produtosBaixa.length === 0 ? (
                <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
                  {produtos.length === 0 ? 'Nenhum produto cadastrado ainda.' : 'Nenhum produto encontrado.'}
                </div>
              ) : (
                <div className="es-grade-produtos">
                  {produtosBaixa.map((p) => {
                    const disponivelAqui = saldoDe(p.id, depositoFiltro);
                    const st = statusProduto(disponivelAqui, minimoDe(p, depositoFiltro));
                    const noCarrinho = carrinho.some((i) => i.produtoId === p.id);
                    const semEstoque = disponivelAqui <= 0;
                    return (
                      <button key={p.id} type="button"
                        className={`es-produto-botao ${noCarrinho ? 'es-produto-selecionado' : ''}`}
                        onClick={() => adicionarAoCarrinho(p)} disabled={semEstoque || noCarrinho}>
                        <div className="es-produto-nome">{p.nome}</div>
                        <div className="es-produto-info">
                          <span className="es-badge" style={{ background: st.fundo, color: st.cor }}>{st.rotulo}</span>
                          <span className="texto-suave" style={{ fontSize: 12 }}>{qtd(disponivelAqui)} disponível</span>
                        </div>
                        {noCarrinho && <div className="es-produto-marca">✓ no carrinho</div>}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* ================= TRANSFERÊNCIA INTERNA ================= */}
      {!carregando && subAba === 'transferencia' && (
        <section>
          <p className="texto-suave" style={{ fontSize: 13 }}>
            Move uma quantidade de um produto de um depósito para outro — os dois saldos são ajustados na hora.
          </p>
          <div className="cartao" style={{ maxWidth: 560 }}>
            <label className="rotulo">Produto *</label>
            <select className="campo" value={transfProdutoId} onChange={(e) => setTransfProdutoId(e.target.value)}>
              <option value="">Selecione o produto</option>
              {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>

            <div className="es-duas">
              <div>
                <label className="rotulo">De (origem) *</label>
                <select className="campo" value={transfOrigemId} onChange={(e) => setTransfOrigemId(e.target.value)}>
                  <option value="">Selecione</option>
                  {depositos.filter((d) => d.ativo).map((d) => (
                    <option key={d.id} value={String(d.id)}>
                      {d.nome}{transfProdutoId ? ` (${qtd(saldoDe(Number(transfProdutoId), d.id))} disponível)` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="rotulo">Para (destino) *</label>
                <select className="campo" value={transfDestinoId} onChange={(e) => setTransfDestinoId(e.target.value)}>
                  <option value="">Selecione</option>
                  {depositos.filter((d) => d.ativo).map((d) => (
                    <option key={d.id} value={String(d.id)}>{d.nome}</option>
                  ))}
                </select>
              </div>
            </div>

            <label className="rotulo">Quantidade *</label>
            <input className="campo" type="number" min="0.01" step="0.01" value={transfQtd}
              onChange={(e) => setTransfQtd(e.target.value)} placeholder="0" />

            <label className="rotulo">Observação</label>
            <input className="campo" type="text" value={transfObs}
              onChange={(e) => setTransfObs(e.target.value)} placeholder="Ex.: Reposição semanal da Conveniência" />

            {erroTransf && <div className="aviso-erro">{erroTransf}</div>}
            <button type="button" className="botao botao-principal" onClick={confirmarTransferencia}
              disabled={salvando} style={{ marginTop: 14 }}>
              {salvando ? 'Transferindo…' : '🔁 Confirmar Transferência'}
            </button>
          </div>
        </section>
      )}

      {/* ================= GERENCIAR (admin) ================= */}
      {!carregando && subAba === 'gerenciar' && souAdmin && (
        <section>
          <label className="rotulo">Ver saldo de</label>
          <select className="campo" value={depositoFiltro} onChange={(e) => setDepositoFiltro(e.target.value)} style={{ marginBottom: 10 }}>
            <option value="GERAL">👁️ Visão Geral (todos os depósitos somados)</option>
            {depositos.filter((d) => d.ativo).map((d) => <option key={d.id} value={String(d.id)}>{d.nome}</option>)}
          </select>

          <div className="es-barra">
            <input className="campo" type="search" value={buscaGer}
              onChange={(e) => setBuscaGer(e.target.value)} placeholder="Buscar por nome ou código…" />
            <button type="button" className="botao botao-principal" onClick={abrirNovo}>
              + Novo Produto
            </button>
          </div>

          {mostrarForm && (
            <form className="cartao" style={{ marginBottom: 16 }} onSubmit={salvarProduto}>
              <h2 style={{ fontSize: '1.15rem', marginBottom: 4 }}>{editandoId ? 'Editar produto' : 'Novo produto'}</h2>

              <label className="rotulo">Nome do produto *</label>
              <input className="campo" type="text" value={gNome} onChange={(e) => setGNome(e.target.value)} placeholder="Ex.: Papel higiênico" />

              <div className="es-duas">
                <div>
                  <label className="rotulo">Código de barras / interno</label>
                  <input className="campo" type="text" value={gCodigo} onChange={(e) => setGCodigo(e.target.value)} placeholder="Opcional" />
                </div>
                <div>
                  <label className="rotulo">Localização (detalhe dentro do depósito)</label>
                  <input className="campo" type="text" value={gLocal} onChange={(e) => setGLocal(e.target.value)} placeholder="Ex.: Prateleira 3" />
                </div>
              </div>

              <label className="rotulo">Descrição</label>
              <input className="campo" type="text" value={gDescricao} onChange={(e) => setGDescricao(e.target.value)} placeholder="Opcional" />

              {!editandoId && (
                <div className="es-duas">
                  <div>
                    <label className="rotulo">Quantidade inicial</label>
                    <input className="campo" type="number" min="0" step="0.01" value={gQuantidade} onChange={(e) => setGQuantidade(e.target.value)} placeholder="0" />
                  </div>
                  <div>
                    <label className="rotulo">Depósito dessa quantidade{Number(gQuantidade) > 0 ? ' *' : ''}</label>
                    <select className="campo" value={gDepositoInicial} onChange={(e) => setGDepositoInicial(e.target.value)}>
                      <option value="">Selecione</option>
                      {depositos.filter((d) => d.ativo).map((d) => <option key={d.id} value={String(d.id)}>{d.nome}</option>)}
                    </select>
                  </div>
                </div>
              )}

              <div className="es-duas">
                <div>
                  <label className="rotulo">Estoque mínimo padrão (alerta)</label>
                  <input className="campo" type="number" min="0" step="0.01" value={gMinima} onChange={(e) => setGMinima(e.target.value)} placeholder="0" />
                </div>
                <div>
                  <label className="rotulo">Valor unitário (R$)</label>
                  <input className="campo" type="number" min="0" step="0.01" value={gValor} onChange={(e) => setGValor(e.target.value)} placeholder="0,00" />
                </div>
              </div>

              {editandoId && (
                <p className="texto-suave" style={{ fontSize: 12, marginTop: 8 }}>
                  Dica: pra somar itens que chegaram, use o botão "Entrada" na lista, ou "Transferência" pra mover entre depósitos — não dá mais pra editar a quantidade aqui diretamente, assim o histórico fica sempre correto.
                </p>
              )}
              {erroForm && <div className="aviso-erro">{erroForm}</div>}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
                <button type="submit" className="botao botao-principal" disabled={salvando}>
                  {salvando ? 'Salvando…' : editandoId ? 'Salvar alterações' : 'Cadastrar produto'}
                </button>
                <button type="button" className="botao botao-suave" onClick={() => setMostrarForm(false)}>Cancelar</button>
              </div>
            </form>
          )}

          {produtosGer.length === 0 ? (
            <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
              {produtos.length === 0 ? 'Nenhum produto cadastrado. Clique em "+ Novo Produto".' : 'Nenhum produto encontrado.'}
            </div>
          ) : (
            <div className="es-lista">
              {produtosGer.map((p) => {
                const st = statusProduto(quantidadeExibida(p), minimoDe(p, depositoFiltro));
                return (
                  <div key={p.id} className="cartao es-item-ger">
                    <div className="es-item-ger-esq">
                      <div className="es-item-ger-topo">
                        <strong>{p.nome}</strong>
                        <span className="es-badge" style={{ background: st.fundo, color: st.cor }}>{st.rotulo}</span>
                      </div>
                      <div className="es-item-ger-meta">
                        {qtd(quantidadeExibida(p))} {depositoFiltro === 'GERAL' ? 'no total' : `em ${nomeDeposito(Number(depositoFiltro))}`} · mín. padrão {qtd(p.qtd_minima)} · {dinheiro(p.valor)}/un
                        {p.localizacao ? ` · 📍 ${p.localizacao}` : ''}
                        {p.codigo ? ` · cód. ${p.codigo}` : ''}
                      </div>
                      {p.descricao && <div className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>{p.descricao}</div>}

                      {depositoFiltro === 'GERAL' && depositos.filter((d) => d.ativo).length > 0 && (
                        <div className="es-saldos-deposito">
                          {depositos.filter((d) => d.ativo).map((d) => {
                            const chave = `${p.id}:${d.id}`;
                            const editandoEsse = minimoEditando === chave;
                            return (
                              <div key={d.id} className="es-saldo-linha">
                                <span>{d.nome}: <strong>{qtd(saldoDe(p.id, d.id))}</strong></span>
                                {editandoEsse ? (
                                  <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                    <input className="campo" type="number" min="0" step="0.01" value={minimoValor}
                                      onChange={(e) => setMinimoValor(e.target.value)}
                                      style={{ width: 70, padding: '2px 6px', fontSize: 12 }} autoFocus />
                                    <button type="button" className="botao botao-suave" style={{ fontSize: 11, padding: '2px 8px' }}
                                      onClick={() => salvarMinimoDeposito(p.id, d.id, minimoValor)}>✓</button>
                                    <button type="button" className="botao botao-suave" style={{ fontSize: 11, padding: '2px 8px' }}
                                      onClick={() => setMinimoEditando(null)}>✕</button>
                                  </span>
                                ) : (
                                  <button type="button" className="es-minimo-botao"
                                    onClick={() => { setMinimoEditando(chave); setMinimoValor(String(minimoDe(p, String(d.id)))); }}>
                                    mín. {qtd(minimoDe(p, String(d.id)))} ✏️
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="es-item-ger-acoes">
                      <button type="button" className="botao botao-principal"
                        onClick={() => {
                          setEntradaProduto(p); setEntradaQtd(''); setEntradaObs('');
                          setEntradaDepositoId(depositoFiltro !== 'GERAL' ? depositoFiltro : '');
                        }}>
                        Entrada
                      </button>
                      <button type="button" className="botao botao-suave" onClick={() => abrirEdicao(p)}>Editar</button>
                      {excluindoId === p.id ? (
                        <span className="es-confirmar">
                          Excluir?
                          <button type="button" className="botao botao-perigo" onClick={() => excluirProduto(p)}>Sim</button>
                          <button type="button" className="botao botao-suave" onClick={() => setExcluindoId(null)}>Não</button>
                        </span>
                      ) : (
                        <button type="button" className="botao botao-suave" onClick={() => setExcluindoId(p.id)}>Excluir</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ================= DEPÓSITOS (admin) ================= */}
      {!carregando && subAba === 'depositos' && souAdmin && (
        <section>
          <div className="es-barra">
            <p className="texto-suave" style={{ fontSize: 13, margin: 0 }}>
              Um depósito inativado some dos seletores de novas movimentações, mas o histórico dele continua registrado.
            </p>
            <button type="button" className="botao botao-principal" onClick={abrirNovoDeposito}>
              + Novo Depósito
            </button>
          </div>

          {mostrarFormDep && (
            <form className="cartao" style={{ marginBottom: 16 }} onSubmit={salvarDeposito}>
              <h2 style={{ fontSize: '1.15rem', marginBottom: 4 }}>{editandoDepId ? 'Editar depósito' : 'Novo depósito'}</h2>
              <label className="rotulo">Nome *</label>
              <input className="campo" type="text" value={dNome} onChange={(e) => setDNome(e.target.value)} placeholder="Ex.: Estoque da Conveniência" />
              <label className="rotulo">Descrição</label>
              <input className="campo" type="text" value={dDescricao} onChange={(e) => setDDescricao(e.target.value)} placeholder="Opcional" />
              {erroFormDep && <div className="aviso-erro">{erroFormDep}</div>}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
                <button type="submit" className="botao botao-principal" disabled={salvando}>
                  {salvando ? 'Salvando…' : editandoDepId ? 'Salvar alterações' : 'Cadastrar depósito'}
                </button>
                <button type="button" className="botao botao-suave" onClick={() => setMostrarFormDep(false)}>Cancelar</button>
              </div>
            </form>
          )}

          {depositos.length === 0 ? (
            <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
              Nenhum depósito cadastrado ainda.
            </div>
          ) : (
            <div className="es-lista">
              {depositos.map((d) => {
                const totalNoDeposito = saldos.filter((s) => s.deposito_id === d.id).reduce((s, x) => s + Number(x.quantidade), 0);
                return (
                  <div key={d.id} className="cartao es-item-ger">
                    <div className="es-item-ger-esq">
                      <div className="es-item-ger-topo">
                        <strong>{d.nome}</strong>
                        {!d.ativo && <span className="es-badge" style={{ background: '#EFEFEF', color: '#666' }}>Inativo</span>}
                      </div>
                      <div className="es-item-ger-meta">{qtd(totalNoDeposito)} unidades no total, somando todos os produtos</div>
                      {d.descricao && <div className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>{d.descricao}</div>}
                    </div>
                    <div className="es-item-ger-acoes">
                      <button type="button" className="botao botao-suave" onClick={() => abrirEdicaoDeposito(d)}>Editar</button>
                      <button type="button" className={d.ativo ? 'botao botao-perigo' : 'botao botao-principal'} onClick={() => alternarAtivoDeposito(d)}>
                        {d.ativo ? 'Inativar' : 'Reativar'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ================= HISTÓRICO (admin) ================= */}
      {!carregando && subAba === 'historico' && souAdmin && (
        <section>
          <div className="es-hist-filtros">
            <div className="es-tipos">
              {['TODOS', 'CADASTRO', 'ENTRADA', 'SAIDA', 'TRANSFERENCIA', 'EDICAO', 'EXCLUSAO'].map((t) => (
                <button key={t} type="button"
                  className={filtroTipo === t ? 'es-tipo-botao es-tipo-ativo' : 'es-tipo-botao'}
                  onClick={() => setFiltroTipo(t)}>
                  {t === 'TODOS' ? 'Todos' : TIPO_LABEL[t]}
                </button>
              ))}
            </div>
            <input className="campo" type="search" value={buscaHist}
              onChange={(e) => setBuscaHist(e.target.value)} placeholder="Buscar por produto, responsável ou observação…" />
          </div>

          <p className="texto-suave" style={{ fontSize: 13 }}>{historicoFiltrado.length} registro(s)</p>

          {historicoFiltrado.length === 0 ? (
            <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
              Nenhum lançamento encontrado.
            </div>
          ) : (
            <div className="es-lista">
              {historicoFiltrado.map((h) => (
                <div key={h.id} className="cartao es-hist-item">
                  <div className="es-hist-topo">
                    <span className="es-badge" style={{ background: TIPO_COR[h.tipo].fundo, color: TIPO_COR[h.tipo].texto }}>
                      {TIPO_LABEL[h.tipo]}
                    </span>
                    <strong>{h.produto_nome}</strong>
                    {h.quantidade != null && <span className="es-hist-qtd">{qtd(h.quantidade)} un.</span>}
                  </div>
                  {(h.deposito_origem_id || h.deposito_destino_id) && (
                    <div className="texto-suave" style={{ fontSize: 12, marginTop: 2 }}>
                      {h.tipo === 'TRANSFERENCIA'
                        ? `${nomeDeposito(h.deposito_origem_id)} → ${nomeDeposito(h.deposito_destino_id)}`
                        : h.deposito_origem_id ? `Depósito: ${nomeDeposito(h.deposito_origem_id)}` : `Depósito: ${nomeDeposito(h.deposito_destino_id)}`}
                    </div>
                  )}
                  {h.observacao && <div style={{ fontSize: 14, marginTop: 4 }}>{h.observacao}</div>}
                  <div className="texto-suave" style={{ fontSize: 12, marginTop: 2 }}>
                    {nomeDe(h.usuario_id)} · {formatarDataHora(h.data_hora)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ================= MODAL DE ENTRADA ================= */}
      {entradaProduto && (
        <div className="es-overlay" role="dialog" aria-modal="true">
          <div className="es-modal">
            <div className="es-modal-topo">
              <h2 style={{ fontSize: '1.15rem', margin: 0 }}>Registrar entrada</h2>
              <button type="button" className="es-fechar" onClick={() => setEntradaProduto(null)} aria-label="Fechar">✕</button>
            </div>
            <p className="texto-suave" style={{ fontSize: 14 }}>
              <strong>{entradaProduto.nome}</strong> — {qtd(entradaProduto.quantidade)} no total (todos os depósitos)
            </p>
            <label className="rotulo">Depósito que está recebendo *</label>
            <select className="campo" value={entradaDepositoId} onChange={(e) => setEntradaDepositoId(e.target.value)}>
              <option value="">Selecione o depósito</option>
              {depositos.filter((d) => d.ativo).map((d) => (
                <option key={d.id} value={String(d.id)}>{d.nome} ({qtd(saldoDe(entradaProduto.id, d.id))} atual)</option>
              ))}
            </select>
            <label className="rotulo">Quantidade que chegou *</label>
            <input className="campo" type="number" min="0.01" step="0.01" value={entradaQtd}
              onChange={(e) => setEntradaQtd(e.target.value)} placeholder="0" />
            <label className="rotulo">Observação</label>
            <input className="campo" type="text" value={entradaObs}
              onChange={(e) => setEntradaObs(e.target.value)} placeholder="Ex.: Compra semanal" />
            <div className="es-modal-botoes">
              <button type="button" className="botao botao-principal" onClick={confirmarEntrada}
                disabled={salvando || !(Number(entradaQtd) > 0) || !entradaDepositoId}>
                {salvando ? 'Salvando…' : 'Confirmar Entrada'}
              </button>
              <button type="button" className="botao botao-suave" onClick={() => setEntradaProduto(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// ---- Estilos específicos deste módulo ---------------------------------------

function EstilosEstoque() {
  return (
    <style>{`
      .es-abas { display: flex; gap: 6px; overflow-x: auto; margin: 14px 0 16px; padding-bottom: 4px; }
      .es-aba {
        border: 1px solid var(--borda); background: var(--branco); color: var(--tinta);
        border-radius: 999px; padding: 10px 16px; font-size: 14px; font-weight: 600;
        cursor: pointer; white-space: nowrap; min-height: 42px;
      }
      .es-aba-ativa { background: var(--marca); border-color: var(--marca); color: var(--branco); }

      .es-duas { display: grid; grid-template-columns: 1fr; gap: 0 14px; }
      .es-tres { display: grid; grid-template-columns: 1fr; gap: 0 14px; }

      .es-barra { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }

      /* Dar Baixa */
      .es-grade-produtos { display: grid; grid-template-columns: 1fr; gap: 10px; }
      .es-produto-botao {
        text-align: left; border: 1px solid var(--borda); background: var(--branco);
        border-radius: 12px; padding: 14px; cursor: pointer; font-family: inherit; color: inherit;
        box-shadow: var(--sombra);
      }
      .es-produto-botao:hover:not(:disabled) { border-color: var(--marca); }
      .es-produto-botao:disabled { opacity: 0.6; cursor: not-allowed; }
      .es-produto-selecionado { border-color: var(--marca); background: var(--marca-clara); }
      .es-produto-nome { font-weight: 700; font-size: 15px; }
      .es-produto-info { display: flex; align-items: center; gap: 10px; margin-top: 6px; flex-wrap: wrap; }
      .es-produto-marca { font-size: 12px; color: var(--marca); font-weight: 700; margin-top: 6px; }
      .es-badge { display: inline-block; font-size: 12px; font-weight: 700; border-radius: 999px; padding: 3px 10px; }

      .es-carrinho { margin-bottom: 16px; }
      .es-carrinho-lista { display: flex; flex-direction: column; gap: 8px; margin: 10px 0; }
      .es-carrinho-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; border-bottom: 1px solid var(--borda); padding-bottom: 8px; }
      .es-carrinho-nome { font-weight: 600; font-size: 14px; flex: 1; min-width: 120px; }
      .es-carrinho-controles { display: flex; align-items: center; gap: 8px; }
      .es-qtd-input { width: 74px; }
      .es-remover { border: none; background: var(--erro-fundo); color: var(--erro-texto); border-radius: 999px; width: 30px; height: 30px; cursor: pointer; }

      /* Gerenciar */
      .es-lista { display: flex; flex-direction: column; gap: 12px; }
      .es-item-ger { display: flex; flex-direction: column; gap: 10px; padding: 16px; }
      .es-item-ger-topo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .es-item-ger-topo strong { font-size: 16px; }
      .es-item-ger-meta { font-size: 13px; color: var(--texto-suave); margin-top: 4px; }
      .es-saldos-deposito {
        display: flex; flex-direction: column; gap: 4px; margin-top: 10px;
        background: #F7F8F6; border-radius: 8px; padding: 8px 10px;
      }
      .es-saldo-linha { display: flex; justify-content: space-between; align-items: center; font-size: 13px; gap: 8px; flex-wrap: wrap; }
      .es-minimo-botao {
        border: none; background: none; color: var(--texto-suave); font-size: 12px;
        cursor: pointer; font-family: inherit; padding: 2px 4px;
      }
      .es-minimo-botao:hover { color: var(--marca); text-decoration: underline; }
      .es-item-ger-acoes { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
      .es-confirmar { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--erro-texto); flex-wrap: wrap; }

      /* Histórico */
      .es-hist-filtros { display: flex; flex-direction: column; gap: 10px; margin-bottom: 8px; }
      .es-tipos { display: flex; gap: 6px; flex-wrap: wrap; }
      .es-tipo-botao {
        border: 1px solid var(--borda); background: var(--branco); color: var(--tinta);
        border-radius: 999px; padding: 7px 13px; font-size: 13px; font-weight: 600; cursor: pointer;
      }
      .es-tipo-ativo { background: var(--marca); border-color: var(--marca); color: var(--branco); }
      .es-hist-item { padding: 14px 16px; }
      .es-hist-topo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .es-hist-topo strong { font-size: 15px; }
      .es-hist-qtd { font-size: 13px; font-weight: 700; color: var(--marca); }

      /* Modal */
      .es-overlay {
        position: fixed; inset: 0; background: rgba(15, 25, 22, 0.45);
        display: flex; align-items: flex-end; justify-content: center; z-index: 70;
      }
      .es-modal {
        background: var(--branco); width: 100%; max-height: 92vh; overflow-y: auto;
        border-radius: 18px 18px 0 0; padding: 18px;
      }
      .es-modal-topo { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 6px; }
      .es-fechar { border: none; background: #E9ECE8; border-radius: 999px; width: 40px; height: 40px; font-size: 16px; cursor: pointer; flex-shrink: 0; }
      .es-modal-botoes { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }

      @media (min-width: 640px) {
        .es-duas { grid-template-columns: 1fr 1fr; }
        .es-tres { grid-template-columns: 1fr 1fr 1fr; }
        .es-barra { flex-direction: row; align-items: center; }
        .es-barra .campo { flex: 1; }
        .es-grade-produtos { grid-template-columns: 1fr 1fr; }
        .es-item-ger { flex-direction: row; justify-content: space-between; align-items: flex-start; }
        .es-item-ger-acoes { flex-shrink: 0; }
        .es-hist-filtros { flex-direction: row; align-items: center; justify-content: space-between; }
        .es-hist-filtros .campo { width: auto; min-width: 240px; }
        .es-overlay { align-items: center; padding: 24px; }
        .es-modal { max-width: 480px; border-radius: 18px; padding: 24px; }
      }
      @media (min-width: 900px) {
        .es-grade-produtos { grid-template-columns: 1fr 1fr 1fr; }
      }
    `}</style>
  );
}
