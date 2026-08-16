'use client';

// ============================================================================
// PDV E GESTÃO DE CONVENIÊNCIA (Fase 1 — Núcleo)
// - Aba "Vender": tela rápida de venda, com leitor de código de barras
// - Aba "Preços e Estoque": só ADMIN ou quem tiver a permissão especial
// ============================================================================

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

function formatarMoeda(valor) {
  return (Number(valor) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function formatarDataHora(valor) {
  if (!valor) return '—';
  try {
    return new Date(valor).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) { return String(valor); }
}

export default function PDV() {
  const router = useRouter();
  const [verificandoLogin, setVerificandoLogin] = useState(true);
  const [usuario, setUsuario] = useState(null);
  const [subAba, setSubAba] = useState('vender');

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

  if (verificandoLogin) {
    return <main className="conteudo"><p className="texto-suave">Verificando seu acesso…</p></main>;
  }

  const souGestor = usuario.papel === 'ADMIN' || usuario.pode_gerenciar_pdv === true;

  return (
    <main className="conteudo">
      <EstilosPDV />
      <span className="olho">Conveniência</span>
      <h1 style={{ marginBottom: 6 }}>PDV — Ponto de Venda</h1>
      <p className="texto-suave" style={{ fontSize: 13, marginTop: -4 }}>Venda rápida de produtos da conveniência.</p>

      <nav className="pdv-abas" aria-label="Seções">
        <button type="button" className={subAba === 'vender' ? 'pdv-aba pdv-aba-ativa' : 'pdv-aba'} onClick={() => setSubAba('vender')}>💳 Vender</button>
        {souGestor && (
          <button type="button" className={subAba === 'estoque' ? 'pdv-aba pdv-aba-ativa' : 'pdv-aba'} onClick={() => setSubAba('estoque')}>📦 Preços e Estoque</button>
        )}
      </nav>

      {subAba === 'vender' && <PainelVender usuario={usuario} />}
      {subAba === 'estoque' && souGestor && <PainelEstoque usuario={usuario} />}
    </main>
  );
}

// ============================================================================
// ABA VENDER
// ============================================================================

function PainelVender({ usuario }) {
  const [turno, setTurno] = useState(null);
  const [carregandoTurno, setCarregandoTurno] = useState(true);
  const [abrindoTurno, setAbrindoTurno] = useState(false);

  const [produtos, setProdutos] = useState([]);
  const [busca, setBusca] = useState('');
  const [sugestoes, setSugestoes] = useState([]);
  const [carrinho, setCarrinho] = useState([]); // [{ produto, quantidade }]
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [mostrarCheckout, setMostrarCheckout] = useState(false);
  const [vendasPendentes, setVendasPendentes] = useState([]);
  const [reenviando, setReenviando] = useState(null);
  const inputBuscaRef = useRef(null);

  function mostrarAviso(texto) { setAviso(texto); setTimeout(() => setAviso(''), 5000); }

  const carregarTurno = useCallback(async () => {
    setCarregandoTurno(true);
    const { data } = await supabase.from('pdv_turnos').select('*')
      .eq('usuario_abertura_id', usuario.id).eq('status', 'ABERTO')
      .order('aberto_em', { ascending: false }).limit(1).maybeSingle();
    setTurno(data || null);
    setCarregandoTurno(false);
  }, [usuario.id]);

  const carregarProdutos = useCallback(async () => {
    const { data } = await supabase.from('pdv_produtos').select('*').eq('ativo', true).order('nome', { ascending: true });
    setProdutos(data || []);
  }, []);

  const carregarVendasPendentes = useCallback(async () => {
    const { data } = await supabase.from('pdv_vendas').select('*')
      .in('cloudbeds_status', ['FALHOU', 'PENDENTE']).order('criado_em', { ascending: false }).limit(20);
    setVendasPendentes(data || []);
  }, []);

  async function reenviarParaCloudbeds(venda) {
    setReenviando(venda.id);
    const { data: sessao } = await supabase.auth.getSession();
    try {
      const resposta = await fetch('/api/pdv-lancar-cloudbeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.session.access_token}` },
        body: JSON.stringify({ vendaId: venda.id }),
      });
      const resultado = await resposta.json();
      setReenviando(null);
      if (!resposta.ok || resultado.erro) { mostrarAviso(`Ainda não foi dessa vez: ${resultado.erro || 'erro desconhecido'}`); }
      else { mostrarAviso(`Venda #${venda.numero_venda} lançada na Cloudbeds com sucesso!`); }
      carregarVendasPendentes();
    } catch (e) {
      setReenviando(null);
      mostrarAviso('Falha de conexão. Tente de novo em instantes.');
    }
  }

  useEffect(() => { carregarTurno(); carregarProdutos(); carregarVendasPendentes(); }, [carregarTurno, carregarProdutos, carregarVendasPendentes]);
  useEffect(() => { if (turno && inputBuscaRef.current) inputBuscaRef.current.focus(); }, [turno]);

  async function abrirTurno() {
    setAbrindoTurno(true);
    const { error } = await supabase.from('pdv_turnos').insert({
      hotel_id: usuario.hotel_id, usuario_abertura_id: usuario.id, status: 'ABERTO',
    });
    setAbrindoTurno(false);
    if (error) { setErro('Não foi possível abrir o turno. Detalhe técnico: ' + error.message); return; }
    carregarTurno();
  }

  // Busca por código de barras (leitor USB/Bluetooth digita rápido e
  // manda Enter) OU por nome/SKU (mostra sugestões)
  function aoDigitarBusca(valor) {
    setBusca(valor);
    if (!valor.trim()) { setSugestoes([]); return; }
    const termo = valor.trim().toLowerCase();
    const encontrados = produtos.filter((p) =>
      (p.codigo_barras && p.codigo_barras === valor.trim()) ||
      p.nome.toLowerCase().includes(termo) ||
      (p.sku && p.sku.toLowerCase().includes(termo))
    );
    setSugestoes(encontrados.slice(0, 6));
  }

  function aoTeclarBusca(evento) {
    if (evento.key !== 'Enter') return;
    evento.preventDefault();
    // Leitor de código de barras: bate exato com um código -> adiciona direto
    const porCodigoExato = produtos.find((p) => p.codigo_barras && p.codigo_barras === busca.trim());
    if (porCodigoExato) { adicionarAoCarrinho(porCodigoExato); return; }
    // Senão, se só tiver 1 sugestão, adiciona ela
    if (sugestoes.length === 1) { adicionarAoCarrinho(sugestoes[0]); return; }
    if (sugestoes.length === 0) setErro(`Nenhum produto encontrado para "${busca}".`);
  }

  function adicionarAoCarrinho(produto) {
    setErro('');
    setCarrinho((atual) => {
      const existente = atual.find((i) => i.produto.id === produto.id);
      if (existente) {
        return atual.map((i) => i.produto.id === produto.id ? { ...i, quantidade: i.quantidade + 1 } : i);
      }
      return [...atual, { produto, quantidade: 1 }];
    });
    setBusca(''); setSugestoes([]);
    if (inputBuscaRef.current) inputBuscaRef.current.focus();
  }

  function mudarQuantidade(produtoId, delta) {
    setCarrinho((atual) => atual
      .map((i) => i.produto.id === produtoId ? { ...i, quantidade: Math.max(0, i.quantidade + delta) } : i)
      .filter((i) => i.quantidade > 0));
  }

  function removerDoCarrinho(produtoId) {
    setCarrinho((atual) => atual.filter((i) => i.produto.id !== produtoId));
  }

  const total = carrinho.reduce((soma, i) => soma + i.quantidade * i.produto.preco_venda, 0);

  async function finalizarVenda({ tipoPagamento, formaPagamentoAvulso, reservationId, nomeHospede }) {
    if (carrinho.length === 0) { setErro('O carrinho está vazio.'); return; }
    setErro('');

    const { data: numeroVenda } = await supabase.rpc('proximo_numero_venda', { p_hotel_id: usuario.hotel_id });

    const { data: venda, error: erroVenda } = await supabase.from('pdv_vendas').insert({
      hotel_id: usuario.hotel_id,
      numero_venda: numeroVenda,
      turno_id: turno.id,
      tipo_pagamento: tipoPagamento,
      forma_pagamento_avulso: tipoPagamento === 'AVULSO' ? formaPagamentoAvulso : null,
      cloudbeds_reservation_id: tipoPagamento === 'QUARTO' ? reservationId.trim() : null,
      nome_hospede: tipoPagamento === 'QUARTO' ? nomeHospede.trim() : null,
      valor_total: total,
      vendido_por_id: usuario.id,
      cloudbeds_status: tipoPagamento === 'QUARTO' ? 'PENDENTE' : 'NAO_APLICAVEL',
    }).select().single();

    if (erroVenda || !venda) {
      setErro('Não foi possível registrar a venda. Detalhe técnico: ' + erroVenda?.message);
      return;
    }

    const itensParaInserir = carrinho.map((i) => ({
      venda_id: venda.id, produto_id: i.produto.id, nome_produto: i.produto.nome,
      quantidade: i.quantidade, preco_unitario: i.produto.preco_venda,
      custo_unitario: i.produto.custo_aquisicao, subtotal: i.quantidade * i.produto.preco_venda,
      cloudbeds_item_id: i.produto.cloudbeds_item_id || null,
    }));
    const { error: erroItens } = await supabase.from('pdv_venda_itens').insert(itensParaInserir);
    if (erroItens) {
      setErro('A venda foi criada, mas houve um problema ao salvar os itens: ' + erroItens.message);
      return;
    }

    // Se for lançamento no quarto, chama a Cloudbeds
    if (tipoPagamento === 'QUARTO') {
      const { data: sessao } = await supabase.auth.getSession();
      try {
        const resposta = await fetch('/api/pdv-lancar-cloudbeds', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.session.access_token}` },
          body: JSON.stringify({ vendaId: venda.id }),
        });
        const resultado = await resposta.json();
        if (!resposta.ok || resultado.erro) {
          mostrarAviso(`Venda #${numeroVenda} registrada, mas a Cloudbeds recusou: ${resultado.erro || 'erro desconhecido'}. Você pode tentar lançar de novo depois.`);
        } else {
          mostrarAviso(`Venda #${numeroVenda} concluída e lançada na Cloudbeds!`);
        }
      } catch (e) {
        mostrarAviso(`Venda #${numeroVenda} registrada, mas houve falha de conexão ao enviar para a Cloudbeds. Você pode tentar de novo depois.`);
      }
    } else {
      mostrarAviso(`Venda #${numeroVenda} concluída!`);
    }

    setCarrinho([]); setMostrarCheckout(false);
    carregarProdutos(); // atualiza os estoques na tela
    carregarVendasPendentes();
  }

  if (carregandoTurno) return <p className="texto-suave">Carregando…</p>;

  if (!turno) {
    return (
      <div className="cartao" style={{ textAlign: 'center', padding: 32 }}>
        <h2 style={{ marginTop: 0 }}>Nenhum turno de caixa aberto</h2>
        <p className="texto-suave">Abra um turno para começar a vender.</p>
        <button type="button" className="botao botao-principal" onClick={abrirTurno} disabled={abrindoTurno}>
          {abrindoTurno ? 'Abrindo…' : '▶️ Abrir turno'}
        </button>
      </div>
    );
  }

  return (
    <section>
      {aviso && <div className="aviso-sucesso">{aviso}</div>}
      {erro && <div className="aviso-erro">{erro}</div>}

      <p className="texto-suave" style={{ fontSize: 12 }}>Turno aberto em {formatarDataHora(turno.aberto_em)}</p>

      <div className="pdv-busca-area">
        <input
          ref={inputBuscaRef} className="campo pdv-busca" type="text" autoFocus
          placeholder="🔎 Bipe o código de barras ou digite o nome do produto…"
          value={busca} onChange={(e) => aoDigitarBusca(e.target.value)} onKeyDown={aoTeclarBusca}
        />
        {sugestoes.length > 0 && (
          <div className="pdv-sugestoes">
            {sugestoes.map((p) => (
              <button key={p.id} type="button" className="pdv-sugestao" onClick={() => adicionarAoCarrinho(p)}>
                <span>{p.nome}</span>
                <span className="texto-suave">{formatarMoeda(p.preco_venda)} · estoque: {p.estoque_atual}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="pdv-carrinho">
        {carrinho.length === 0 ? (
          <p className="texto-suave" style={{ textAlign: 'center', padding: 24 }}>Carrinho vazio — bipe ou busque um produto acima.</p>
        ) : (
          carrinho.map((i) => (
            <div key={i.produto.id} className="pdv-item-carrinho">
              <div className="pdv-item-nome">
                <strong>{i.produto.nome}</strong>
                <span className="texto-suave" style={{ fontSize: 12 }}>{formatarMoeda(i.produto.preco_venda)} cada</span>
              </div>
              <div className="pdv-item-qtd">
                <button type="button" className="pdv-qtd-botao" onClick={() => mudarQuantidade(i.produto.id, -1)}>−</button>
                <span>{i.quantidade}</span>
                <button type="button" className="pdv-qtd-botao" onClick={() => mudarQuantidade(i.produto.id, 1)}>+</button>
              </div>
              <div className="pdv-item-subtotal">{formatarMoeda(i.quantidade * i.produto.preco_venda)}</div>
              <button type="button" className="pdv-remover" onClick={() => removerDoCarrinho(i.produto.id)} aria-label="Remover">✕</button>
            </div>
          ))
        )}
      </div>

      {vendasPendentes.length > 0 && (
        <div className="pdv-pendentes">
          <strong style={{ fontSize: 13 }}>⚠️ Vendas aguardando envio para a Cloudbeds</strong>
          {vendasPendentes.map((v) => (
            <div key={v.id} className="pdv-pendente-item">
              <div>
                <span>Venda #{v.numero_venda} · {v.nome_hospede || 'Hóspede'} · reserva {v.cloudbeds_reservation_id}</span>
                {v.cloudbeds_erro && <div className="texto-suave" style={{ fontSize: 11 }}>Erro: {v.cloudbeds_erro}</div>}
              </div>
              <button type="button" className="botao botao-suave" onClick={() => reenviarParaCloudbeds(v)} disabled={reenviando === v.id}>
                {reenviando === v.id ? 'Enviando…' : '🔄 Tentar de novo'}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="pdv-rodape">
        <div className="pdv-total">Total: <strong>{formatarMoeda(total)}</strong></div>
        <button type="button" className="botao botao-principal pdv-botao-finalizar" disabled={carrinho.length === 0} onClick={() => setMostrarCheckout(true)}>
          Finalizar Venda
        </button>
      </div>

      {mostrarCheckout && (
        <ModalCheckout total={total} carrinho={carrinho} onFechar={() => setMostrarCheckout(false)} onConfirmar={finalizarVenda} />
      )}
    </section>
  );
}

function ModalCheckout({ total, carrinho, onFechar, onConfirmar }) {
  const [tipoPagamento, setTipoPagamento] = useState('AVULSO');
  const [formaPagamentoAvulso, setFormaPagamentoAvulso] = useState('DINHEIRO');
  const [reservationId, setReservationId] = useState('');
  const [nomeHospede, setNomeHospede] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [erroLocal, setErroLocal] = useState('');

  const itensSemIdCloudbeds = (carrinho || []).filter((i) => !i.produto.cloudbeds_item_id).map((i) => i.produto.nome);

  async function confirmar() {
    setErroLocal('');
    if (tipoPagamento === 'QUARTO' && (!reservationId.trim() || !nomeHospede.trim())) {
      setErroLocal('Informe o número da reserva e o nome do hóspede.'); return;
    }
    setConfirmando(true);
    await onConfirmar({ tipoPagamento, formaPagamentoAvulso, reservationId, nomeHospede });
    setConfirmando(false);
  }

  return (
    <div className="pdv-overlay" role="dialog" aria-modal="true">
      <div className="pdv-modal">
        <h2 style={{ marginTop: 0 }}>Finalizar venda</h2>
        <p className="pdv-total-modal">{formatarMoeda(total)}</p>

        <div className="pdv-tipo-pagamento">
          <button type="button" className={tipoPagamento === 'AVULSO' ? 'pdv-tipo-botao pdv-tipo-ativo' : 'pdv-tipo-botao'} onClick={() => setTipoPagamento('AVULSO')}>
            💵 Pagamento Avulso
          </button>
          <button type="button" className={tipoPagamento === 'QUARTO' ? 'pdv-tipo-botao pdv-tipo-ativo' : 'pdv-tipo-botao'} onClick={() => setTipoPagamento('QUARTO')}>
            🏨 Lançar no Quarto
          </button>
        </div>

        {tipoPagamento === 'AVULSO' ? (
          <div className="pdv-formas">
            {['DINHEIRO', 'PIX', 'CARTAO'].map((forma) => (
              <button key={forma} type="button" className={formaPagamentoAvulso === forma ? 'pdv-forma-botao pdv-forma-ativa' : 'pdv-forma-botao'} onClick={() => setFormaPagamentoAvulso(forma)}>
                {forma === 'DINHEIRO' ? 'Dinheiro' : forma === 'PIX' ? 'Pix' : 'Cartão'}
              </button>
            ))}
          </div>
        ) : (
          <div>
            <label className="rotulo">Número da reserva na Cloudbeds</label>
            <input className="campo" type="text" value={reservationId} onChange={(e) => setReservationId(e.target.value)} placeholder="Ex.: 6927275007856" />
            <label className="rotulo">Nome do hóspede</label>
            <input className="campo" type="text" value={nomeHospede} onChange={(e) => setNomeHospede(e.target.value)} placeholder="Nome de quem retirou os itens" />
            {itensSemIdCloudbeds.length > 0 && (
              <div className="aviso-erro" style={{ fontSize: 12 }}>
                ⚠️ {itensSemIdCloudbeds.join(', ')} ainda não {itensSemIdCloudbeds.length > 1 ? 'têm' : 'tem'} o "ID do item na Cloudbeds" cadastrado — a venda será registrada aqui, mas pode não conseguir ser lançada na conta do quarto até isso ser configurado (aba Preços e Estoque).
              </div>
            )}
          </div>
        )}

        {erroLocal && <div className="aviso-erro">{erroLocal}</div>}

        <div className="pdv-modal-botoes">
          <button type="button" className="botao botao-principal" onClick={confirmar} disabled={confirmando} style={{ flex: 1 }}>
            {confirmando ? 'Confirmando…' : '✓ Confirmar Venda'}
          </button>
          <button type="button" className="botao botao-suave" onClick={onFechar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// ABA PREÇOS E ESTOQUE (só gestores)
// ============================================================================

function PainelEstoque({ usuario }) {
  const [produtos, setProdutos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [editando, setEditando] = useState(null); // produto sendo editado, ou {} para novo
  const [busca, setBusca] = useState('');

  function mostrarAviso(texto) { setAviso(texto); setTimeout(() => setAviso(''), 5000); }

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase.from('pdv_produtos').select('*').order('nome', { ascending: true });
    if (error) setErro('Não foi possível carregar. Detalhe técnico: ' + error.message);
    setProdutos(data || []);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  async function salvarProduto(dados) {
    setErro('');
    const payload = {
      hotel_id: usuario.hotel_id,
      nome: dados.nome.trim(),
      sku: dados.sku.trim() || null,
      codigo_barras: dados.codigo_barras.trim() || null,
      categoria: dados.categoria.trim() || null,
      cloudbeds_item_id: dados.cloudbeds_item_id.trim() || null,
      preco_venda: Number(dados.preco_venda) || 0,
      custo_aquisicao: Number(dados.custo_aquisicao) || 0,
      estoque_atual: Number(dados.estoque_atual) || 0,
      estoque_minimo: Number(dados.estoque_minimo) || 0,
      ativo: dados.ativo,
      atualizado_em: new Date().toISOString(),
    };
    const resultado = dados.id
      ? await supabase.from('pdv_produtos').update(payload).eq('id', dados.id)
      : await supabase.from('pdv_produtos').insert(payload);
    if (resultado.error) { setErro('Não foi possível salvar. Detalhe técnico: ' + resultado.error.message); return; }
    mostrarAviso(dados.id ? 'Produto atualizado!' : 'Produto cadastrado!');
    setEditando(null);
    carregar();
  }

  const termo = busca.trim().toLowerCase();
  const filtrados = produtos.filter((p) => !termo || p.nome.toLowerCase().includes(termo) || (p.sku || '').toLowerCase().includes(termo) || (p.codigo_barras || '').includes(termo));

  return (
    <section>
      {aviso && <div className="aviso-sucesso">{aviso}</div>}
      {erro && <div className="aviso-erro">{erro}</div>}

      <div className="pdv-barra">
        <input className="campo" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, SKU ou código de barras…" />
        <button type="button" className="botao botao-principal" onClick={() => setEditando({})}>+ Novo Produto</button>
      </div>

      {carregando ? <p className="texto-suave">Carregando…</p> : (
        <div className="pdv-tabela-wrap">
          <table className="pdv-tabela">
            <thead>
              <tr><th>Produto</th><th>Categoria</th><th>Preço</th><th>Custo</th><th>Estoque</th><th></th></tr>
            </thead>
            <tbody>
              {filtrados.map((p) => (
                <tr key={p.id} style={p.estoque_atual <= p.estoque_minimo ? { background: '#FDF3D7' } : undefined}>
                  <td>
                    <strong>{p.nome}</strong>
                    {p.sku && <div className="texto-suave" style={{ fontSize: 11 }}>SKU: {p.sku}</div>}
                    <div style={{ fontSize: 11 }}>{p.cloudbeds_item_id ? <span style={{ color: 'var(--sucesso-texto)' }}>✓ Cloudbeds OK</span> : <span style={{ color: 'var(--aviso-texto)' }}>⚠️ sem ID Cloudbeds</span>}</div>
                  </td>
                  <td>{p.categoria || '—'}</td>
                  <td>{formatarMoeda(p.preco_venda)}</td>
                  <td>{formatarMoeda(p.custo_aquisicao)}</td>
                  <td>{p.estoque_atual}{p.estoque_atual <= p.estoque_minimo && ' ⚠️'}</td>
                  <td><button type="button" className="botao botao-suave" onClick={() => setEditando(p)}>Editar</button></td>
                </tr>
              ))}
              {filtrados.length === 0 && <tr><td colSpan={6} className="texto-suave" style={{ textAlign: 'center', padding: 20 }}>Nenhum produto encontrado.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {editando && <ModalProduto produto={editando} onFechar={() => setEditando(null)} onSalvar={salvarProduto} />}
    </section>
  );
}

function ModalProduto({ produto, onFechar, onSalvar }) {
  const [nome, setNome] = useState(produto.nome || '');
  const [sku, setSku] = useState(produto.sku || '');
  const [codigoBarras, setCodigoBarras] = useState(produto.codigo_barras || '');
  const [categoria, setCategoria] = useState(produto.categoria || '');
  const [cloudbedsItemId, setCloudbedsItemId] = useState(produto.cloudbeds_item_id || '');
  const [precoVenda, setPrecoVenda] = useState(produto.preco_venda ?? '');
  const [custoAquisicao, setCustoAquisicao] = useState(produto.custo_aquisicao ?? '');
  const [estoqueAtual, setEstoqueAtual] = useState(produto.estoque_atual ?? '');
  const [estoqueMinimo, setEstoqueMinimo] = useState(produto.estoque_minimo ?? '');
  const [ativo, setAtivo] = useState(produto.ativo ?? true);
  const [salvando, setSalvando] = useState(false);
  const [erroLocal, setErroLocal] = useState('');

  async function salvar() {
    if (!nome.trim()) { setErroLocal('Informe o nome do produto.'); return; }
    setSalvando(true);
    await onSalvar({ id: produto.id, nome, sku, codigo_barras: codigoBarras, categoria, cloudbeds_item_id: cloudbedsItemId, preco_venda: precoVenda, custo_aquisicao: custoAquisicao, estoque_atual: estoqueAtual, estoque_minimo: estoqueMinimo, ativo });
    setSalvando(false);
  }

  return (
    <div className="pdv-overlay" role="dialog" aria-modal="true">
      <div className="pdv-modal">
        <h2 style={{ marginTop: 0 }}>{produto.id ? 'Editar produto' : 'Novo produto'}</h2>

        <label className="rotulo">Nome *</label>
        <input className="campo" type="text" value={nome} onChange={(e) => setNome(e.target.value)} />

        <div className="pdv-duas">
          <div><label className="rotulo">SKU</label><input className="campo" type="text" value={sku} onChange={(e) => setSku(e.target.value)} /></div>
          <div><label className="rotulo">Código de barras</label><input className="campo" type="text" value={codigoBarras} onChange={(e) => setCodigoBarras(e.target.value)} /></div>
        </div>

        <label className="rotulo">Categoria</label>
        <input className="campo" type="text" value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Ex.: Bebidas, Snacks..." />

        <label className="rotulo">ID do item na Cloudbeds</label>
        <input className="campo" type="text" value={cloudbedsItemId} onChange={(e) => setCloudbedsItemId(e.target.value)} placeholder="Ex.: 123456" />
        <p className="texto-suave" style={{ fontSize: 12, marginTop: -6, marginBottom: 12 }}>
          Cadastre esse produto primeiro na Cloudbeds (Configurações → Itens/Point of Sale) e cole aqui o ID que ela gerar. Sem isso, esse produto não pode ser lançado na conta do quarto.
        </p>

        <div className="pdv-duas">
          <div><label className="rotulo">Preço de venda (R$)</label><input className="campo" type="number" step="0.01" min="0" value={precoVenda} onChange={(e) => setPrecoVenda(e.target.value)} /></div>
          <div><label className="rotulo">Custo de aquisição (R$)</label><input className="campo" type="number" step="0.01" min="0" value={custoAquisicao} onChange={(e) => setCustoAquisicao(e.target.value)} /></div>
        </div>

        <div className="pdv-duas">
          <div><label className="rotulo">Estoque atual</label><input className="campo" type="number" step="1" value={estoqueAtual} onChange={(e) => setEstoqueAtual(e.target.value)} /></div>
          <div><label className="rotulo">Estoque mínimo (alerta)</label><input className="campo" type="number" step="1" value={estoqueMinimo} onChange={(e) => setEstoqueMinimo(e.target.value)} /></div>
        </div>

        <label className="pdv-checkbox">
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Produto ativo (aparece na tela de venda)
        </label>

        {erroLocal && <div className="aviso-erro">{erroLocal}</div>}

        <div className="pdv-modal-botoes">
          <button type="button" className="botao botao-principal" onClick={salvar} disabled={salvando} style={{ flex: 1 }}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
          <button type="button" className="botao botao-suave" onClick={onFechar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function EstilosPDV() {
  return (
    <style>{`
      .pdv-abas { display: flex; gap: 6px; overflow-x: auto; margin: 14px 0 16px; padding-bottom: 4px; }
      .pdv-aba { border: 1px solid var(--borda); background: var(--branco); color: var(--tinta); border-radius: 999px; padding: 10px 16px; font-size: 14px; font-weight: 600; cursor: pointer; white-space: nowrap; min-height: 42px; }
      .pdv-aba-ativa { background: var(--marca); border-color: var(--marca); color: var(--branco); }

      .pdv-busca-area { position: relative; margin-bottom: 16px; }
      .pdv-busca { font-size: 16px; padding: 14px 16px; }
      .pdv-sugestoes { position: absolute; top: 100%; left: 0; right: 0; background: var(--branco); border: 1px solid var(--borda); border-radius: 10px; margin-top: 4px; overflow: hidden; z-index: 10; box-shadow: 0 4px 14px rgba(0,0,0,0.1); }
      .pdv-sugestao { display: flex; justify-content: space-between; width: 100%; text-align: left; padding: 10px 14px; border: none; background: var(--branco); border-bottom: 1px solid var(--borda); cursor: pointer; font-family: inherit; font-size: 14px; }
      .pdv-sugestao:last-child { border-bottom: none; }
      .pdv-sugestao:hover { background: var(--marca-clara); }

      .pdv-carrinho { display: flex; flex-direction: column; gap: 8px; min-height: 120px; margin-bottom: 16px; }
      .pdv-item-carrinho { display: grid; grid-template-columns: 1fr auto auto auto; align-items: center; gap: 12px; background: var(--branco); border: 1px solid var(--borda); border-radius: 10px; padding: 10px 14px; }
      .pdv-item-nome { display: flex; flex-direction: column; }
      .pdv-item-qtd { display: flex; align-items: center; gap: 8px; }
      .pdv-qtd-botao { width: 28px; height: 28px; border-radius: 999px; border: 1px solid var(--borda); background: var(--fundo); font-size: 16px; cursor: pointer; }
      .pdv-item-subtotal { font-weight: 700; min-width: 80px; text-align: right; }
      .pdv-remover { border: none; background: none; color: var(--erro-texto); font-size: 16px; cursor: pointer; padding: 4px; }

      .pdv-pendentes { background: #FDF3D7; border-radius: 10px; padding: 12px 14px; margin-bottom: 14px; display: flex; flex-direction: column; gap: 8px; }
      .pdv-pendente-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; background: var(--branco); border-radius: 8px; padding: 8px 12px; font-size: 13px; }
      .pdv-rodape { position: sticky; bottom: 0; background: var(--fundo); padding: 12px 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-top: 1px solid var(--borda); }
      .pdv-total { font-size: 18px; }
      .pdv-botao-finalizar { font-size: 16px; padding: 14px 24px; }

      .pdv-overlay { position: fixed; inset: 0; background: rgba(15,25,22,0.55); display: flex; align-items: center; justify-content: center; z-index: 80; padding: 16px; }
      .pdv-modal { background: var(--branco); width: 100%; max-width: 480px; border-radius: 16px; padding: 24px; max-height: 90vh; overflow-y: auto; }
      .pdv-modal-botoes { display: flex; gap: 10px; margin-top: 16px; }
      .pdv-total-modal { font-size: 28px; font-weight: 700; text-align: center; margin: 8px 0 20px; }
      .pdv-tipo-pagamento { display: flex; gap: 8px; margin-bottom: 16px; }
      .pdv-tipo-botao { flex: 1; padding: 14px 8px; border: 1px solid var(--borda); background: var(--branco); border-radius: 10px; font-weight: 600; cursor: pointer; }
      .pdv-tipo-ativo { background: var(--marca); border-color: var(--marca); color: var(--branco); }
      .pdv-formas { display: flex; gap: 8px; margin-bottom: 12px; }
      .pdv-forma-botao { flex: 1; padding: 10px; border: 1px solid var(--borda); background: var(--branco); border-radius: 8px; cursor: pointer; }
      .pdv-forma-ativa { background: var(--marca-clara); border-color: var(--marca); font-weight: 700; }

      .pdv-barra { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
      .pdv-duas { display: grid; grid-template-columns: 1fr; gap: 0 14px; }
      .pdv-checkbox { display: flex; align-items: center; gap: 8px; font-size: 14px; margin: 12px 0; cursor: pointer; }
      .pdv-checkbox input { width: 18px; height: 18px; }

      .pdv-tabela-wrap { overflow-x: auto; }
      .pdv-tabela { width: 100%; border-collapse: collapse; background: var(--branco); border-radius: 10px; overflow: hidden; }
      .pdv-tabela th { text-align: left; font-size: 12px; color: var(--texto-suave); padding: 10px 12px; border-bottom: 2px solid var(--borda); }
      .pdv-tabela td { padding: 10px 12px; border-bottom: 1px solid var(--borda); font-size: 14px; }

      @media (min-width: 640px) {
        .pdv-barra { flex-direction: row; align-items: center; }
        .pdv-barra .campo { flex: 1; }
        .pdv-duas { grid-template-columns: 1fr 1fr; }
      }
    `}</style>
  );
}