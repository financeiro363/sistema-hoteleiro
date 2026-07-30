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

// ---- Constantes -------------------------------------------------------------

const TIPO_LABEL = {
  CADASTRO: 'Cadastro', ENTRADA: 'Entrada', SAIDA: 'Saída', EDICAO: 'Edição', EXCLUSAO: 'Exclusão',
};
const TIPO_COR = {
  CADASTRO: { fundo: '#DCEBFA', texto: '#1D4E89' },
  ENTRADA: { fundo: '#DDF2E4', texto: '#1E6B3C' },
  SAIDA: { fundo: '#FBDDDD', texto: '#A31212' },
  EDICAO: { fundo: '#FDF3D7', texto: '#8A6100' },
  EXCLUSAO: { fundo: '#EFEFEF', texto: '#666666' },
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

// Status do produto pela quantidade x mínimo
function statusProduto(p) {
  const q = Number(p.quantidade || 0);
  const min = Number(p.qtd_minima || 0);
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

  const [subAba, setSubAba] = useState('baixa'); // baixa | gerenciar | historico

  // Dar Baixa — busca e carrinho
  const [buscaBaixa, setBuscaBaixa] = useState('');
  const [carrinho, setCarrinho] = useState([]); // [{produtoId, nome, disponivel, quantidade}]
  const [obsBaixa, setObsBaixa] = useState('');
  const [erroBaixa, setErroBaixa] = useState('');

  // Gerenciar — busca, formulário, entrada rápida
  const [buscaGer, setBuscaGer] = useState('');
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [gNome, setGNome] = useState('');
  const [gCodigo, setGCodigo] = useState('');
  const [gDescricao, setGDescricao] = useState('');
  const [gQuantidade, setGQuantidade] = useState('');
  const [gMinima, setGMinima] = useState('');
  const [gValor, setGValor] = useState('');
  const [gLocal, setGLocal] = useState('');
  const [erroForm, setErroForm] = useState('');
  const [entradaProduto, setEntradaProduto] = useState(null); // {produto}
  const [entradaQtd, setEntradaQtd] = useState('');
  const [entradaObs, setEntradaObs] = useState('');
  const [excluindoId, setExcluindoId] = useState(null);

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
      setVerificandoLogin(false);
    }
    verificar();
    return () => { ativo = false; };
  }, [router]);

  const carregarTudo = useCallback(async (u) => {
    setCarregando(true);
    setErro('');

    const { data: pessoas } = await supabase.from('usuarios').select('id, nome');
    if (pessoas) {
      const mapa = {};
      pessoas.forEach((p) => { mapa[p.id] = p.nome; });
      setNomesUsuarios(mapa);
    }

    const { data: prods, error: e1 } = await supabase
      .from('estoque_produtos').select('*').order('nome', { ascending: true });
    if (e1) setErro('Não foi possível carregar os produtos. Detalhe técnico: ' + e1.message);
    else setProdutos(prods || []);

    const { data: hist } = await supabase
      .from('estoque_historico').select('*')
      .order('data_hora', { ascending: false }).limit(500);
    setHistorico(hist || []);

    setCarregando(false);
  }, []);

  useEffect(() => {
    if (usuario) carregarTudo(usuario);
  }, [usuario, carregarTudo]);

  async function registrarHistorico(tipo, produtoNome, quantidade, observacao) {
    await supabase.from('estoque_historico').insert({
      tipo, produto_nome: produtoNome,
      quantidade: quantidade != null ? Number(quantidade) : null,
      usuario_id: usuario.id, observacao: observacao || null, hotel_id: usuario.hotel_id,
    });
  }

  // ================= DAR BAIXA (carrinho) =================

  function adicionarAoCarrinho(produto) {
    setErroBaixa('');
    if (carrinho.some((i) => i.produtoId === produto.id)) return; // já está
    if (Number(produto.quantidade) <= 0) {
      setErroBaixa(`"${produto.nome}" está sem estoque.`);
      return;
    }
    setCarrinho([...carrinho, {
      produtoId: produto.id, nome: produto.nome,
      disponivel: Number(produto.quantidade), quantidade: 1,
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
    if (salvando || carrinho.length === 0) return;
    setErroBaixa('');

    // Revalida disponibilidade (o estoque pode ter mudado)
    for (const item of carrinho) {
      const atual = produtos.find((p) => p.id === item.produtoId);
      if (!atual || Number(atual.quantidade) < item.quantidade) {
        setErroBaixa(`Estoque insuficiente de "${item.nome}". Disponível agora: ${qtd(atual?.quantidade || 0)}.`);
        return;
      }
    }

    setSalvando(true);
    try {
      for (const item of carrinho) {
        const atual = produtos.find((p) => p.id === item.produtoId);
        const novaQtd = Number(atual.quantidade) - item.quantidade;
        const { error } = await supabase
          .from('estoque_produtos').update({ quantidade: novaQtd }).eq('id', item.produtoId);
        if (error) throw new Error(`Falha ao dar baixa em "${item.nome}": ${error.message}`);
        await registrarHistorico('SAIDA', item.nome, item.quantidade, obsBaixa.trim() || null);
      }
      const qtdProdutos = carrinho.length;
      setCarrinho([]);
      setObsBaixa('');
      mostrarAviso(`Saída registrada: ${qtdProdutos} produto(s).`);
      await carregarTudo(usuario);
    } catch (e) {
      setErroBaixa(e.message);
    } finally {
      setSalvando(false);
    }
  }

  // ================= GERENCIAR (admin) =================

  function abrirNovo() {
    setEditandoId(null);
    setGNome(''); setGCodigo(''); setGDescricao(''); setGQuantidade('');
    setGMinima(''); setGValor(''); setGLocal('');
    setErroForm('');
    setMostrarForm(true);
  }

  function abrirEdicao(p) {
    setEditandoId(p.id);
    setGNome(p.nome); setGCodigo(p.codigo || ''); setGDescricao(p.descricao || '');
    setGQuantidade(String(p.quantidade)); setGMinima(String(p.qtd_minima));
    setGValor(String(p.valor)); setGLocal(p.localizacao || '');
    setErroForm('');
    setMostrarForm(true);
  }

  async function salvarProduto(evento) {
    evento.preventDefault();
    if (salvando) return;
    setErroForm('');
    if (!gNome.trim()) { setErroForm('Informe o nome do produto.'); return; }

    const dados = {
      nome: gNome.trim(),
      codigo: gCodigo.trim() || null,
      descricao: gDescricao.trim() || null,
      quantidade: Number(gQuantidade) || 0,
      qtd_minima: Number(gMinima) || 0,
      valor: Number(gValor) || 0,
      localizacao: gLocal.trim() || null,
    };

    setSalvando(true);
    if (editandoId) {
      const { error } = await supabase.from('estoque_produtos').update(dados).eq('id', editandoId);
      setSalvando(false);
      if (error) { setErroForm('Não foi possível salvar. Detalhe técnico: ' + error.message); return; }
      await registrarHistorico('EDICAO', dados.nome, null, 'Produto editado.');
      mostrarAviso('Produto atualizado!');
    } else {
      const { error } = await supabase.from('estoque_produtos')
        .insert({ ...dados, criado_por_id: usuario.id, hotel_id: usuario.hotel_id });
      setSalvando(false);
      if (error) { setErroForm('Não foi possível cadastrar. Detalhe técnico: ' + error.message); return; }
      await registrarHistorico('CADASTRO', dados.nome, dados.quantidade, 'Produto cadastrado.');
      mostrarAviso('Produto cadastrado!');
    }
    setMostrarForm(false);
    carregarTudo(usuario);
  }

  async function confirmarEntrada() {
    if (!entradaProduto || salvando) return;
    const q = Number(entradaQtd);
    if (!(q > 0)) return;
    setSalvando(true);
    const nova = Number(entradaProduto.quantidade) + q;
    const { error } = await supabase
      .from('estoque_produtos').update({ quantidade: nova }).eq('id', entradaProduto.id);
    setSalvando(false);
    if (error) { setErro('Não foi possível registrar a entrada. Detalhe técnico: ' + error.message); return; }
    await registrarHistorico('ENTRADA', entradaProduto.nome, q, entradaObs.trim() || 'Entrada de estoque.');
    setEntradaProduto(null); setEntradaQtd(''); setEntradaObs('');
    mostrarAviso('Entrada registrada!');
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

      {/* Sub-abas (Gerenciar e Histórico só para ADMIN) */}
      <nav className="es-abas" aria-label="Seções">
        <button type="button" className={subAba === 'baixa' ? 'es-aba es-aba-ativa' : 'es-aba'}
          onClick={() => setSubAba('baixa')}>
          Dar Baixa (Saída)
        </button>
        {souAdmin && (
          <button type="button" className={subAba === 'gerenciar' ? 'es-aba es-aba-ativa' : 'es-aba'}
            onClick={() => setSubAba('gerenciar')}>
            Gerenciar Estoque
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
          <p className="texto-suave" style={{ fontSize: 13 }}>
            Toque nos produtos que vai retirar, ajuste as quantidades e confirme tudo de uma vez.
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
                const st = statusProduto(p);
                const noCarrinho = carrinho.some((i) => i.produtoId === p.id);
                const semEstoque = Number(p.quantidade) <= 0;
                return (
                  <button key={p.id} type="button"
                    className={`es-produto-botao ${noCarrinho ? 'es-produto-selecionado' : ''}`}
                    onClick={() => adicionarAoCarrinho(p)} disabled={semEstoque || noCarrinho}>
                    <div className="es-produto-nome">{p.nome}</div>
                    <div className="es-produto-info">
                      <span className="es-badge" style={{ background: st.fundo, color: st.cor }}>{st.rotulo}</span>
                      <span className="texto-suave" style={{ fontSize: 12 }}>{qtd(p.quantidade)} disponível</span>
                    </div>
                    {noCarrinho && <div className="es-produto-marca">✓ no carrinho</div>}
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ================= GERENCIAR (admin) ================= */}
      {!carregando && subAba === 'gerenciar' && souAdmin && (
        <section>
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
                  <label className="rotulo">Localização</label>
                  <input className="campo" type="text" value={gLocal} onChange={(e) => setGLocal(e.target.value)} placeholder="Ex.: Almoxarifado, Prateleira 3" />
                </div>
              </div>

              <label className="rotulo">Descrição</label>
              <input className="campo" type="text" value={gDescricao} onChange={(e) => setGDescricao(e.target.value)} placeholder="Opcional" />

              <div className="es-tres">
                <div>
                  <label className="rotulo">Quantidade {editandoId ? 'atual' : 'inicial'}</label>
                  <input className="campo" type="number" min="0" step="0.01" value={gQuantidade} onChange={(e) => setGQuantidade(e.target.value)} placeholder="0" />
                </div>
                <div>
                  <label className="rotulo">Estoque mínimo (alerta)</label>
                  <input className="campo" type="number" min="0" step="0.01" value={gMinima} onChange={(e) => setGMinima(e.target.value)} placeholder="0" />
                </div>
                <div>
                  <label className="rotulo">Valor unitário (R$)</label>
                  <input className="campo" type="number" min="0" step="0.01" value={gValor} onChange={(e) => setGValor(e.target.value)} placeholder="0,00" />
                </div>
              </div>

              {editandoId && (
                <p className="texto-suave" style={{ fontSize: 12, marginTop: 8 }}>
                  Dica: para somar itens que chegaram, use o botão "Entrada" na lista — não altere a quantidade aqui manualmente, assim o histórico fica correto.
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
                const st = statusProduto(p);
                return (
                  <div key={p.id} className="cartao es-item-ger">
                    <div className="es-item-ger-esq">
                      <div className="es-item-ger-topo">
                        <strong>{p.nome}</strong>
                        <span className="es-badge" style={{ background: st.fundo, color: st.cor }}>{st.rotulo}</span>
                      </div>
                      <div className="es-item-ger-meta">
                        {qtd(p.quantidade)} em estoque · mín. {qtd(p.qtd_minima)} · {dinheiro(p.valor)}/un
                        {p.localizacao ? ` · 📍 ${p.localizacao}` : ''}
                        {p.codigo ? ` · cód. ${p.codigo}` : ''}
                      </div>
                      {p.descricao && <div className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>{p.descricao}</div>}
                    </div>
                    <div className="es-item-ger-acoes">
                      <button type="button" className="botao botao-principal"
                        onClick={() => { setEntradaProduto(p); setEntradaQtd(''); setEntradaObs(''); }}>
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

      {/* ================= HISTÓRICO (admin) ================= */}
      {!carregando && subAba === 'historico' && souAdmin && (
        <section>
          <div className="es-hist-filtros">
            <div className="es-tipos">
              {['TODOS', 'CADASTRO', 'ENTRADA', 'SAIDA', 'EDICAO', 'EXCLUSAO'].map((t) => (
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
              <strong>{entradaProduto.nome}</strong> — {qtd(entradaProduto.quantidade)} em estoque agora
            </p>
            <label className="rotulo">Quantidade que chegou *</label>
            <input className="campo" type="number" min="0.01" step="0.01" value={entradaQtd}
              onChange={(e) => setEntradaQtd(e.target.value)} placeholder="0" autoFocus />
            <label className="rotulo">Observação</label>
            <input className="campo" type="text" value={entradaObs}
              onChange={(e) => setEntradaObs(e.target.value)} placeholder="Ex.: Compra semanal" />
            <div className="es-modal-botoes">
              <button type="button" className="botao botao-principal" onClick={confirmarEntrada}
                disabled={salvando || !(Number(entradaQtd) > 0)}>
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
