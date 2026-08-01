'use client';

// ============================================================================
// FINANCEIRO
// Módulo inteiro visível e utilizável SÓ PELO ADMIN (é dinheiro do hotel).
// - Dashboard: métricas do período, saldo, gráfico de fluxo de caixa
//   (HTML/CSS puro, sem dependências)
// - Contas a Receber / Contas a Pagar: lançamento, categorização (Centro de
//   Custo + Plano de Contas), anexo de comprovante (Storage), status
//   calculado (Pendente / Recebido-Pago / Atrasado), cobrança por WhatsApp
// - Clientes / Fornecedores: cadastro simples com busca
// - Categorias: Centro de Custo + Plano de Contas (Receita/Despesa)
// ============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

// ---- Funções de apoio -------------------------------------------------------

function dinheiro(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(valor || 0));
}
function formatarData(valor) {
  if (!valor) return '—';
  const [ano, mes, dia] = String(valor).slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}
function hojeISO() { return new Date().toISOString().slice(0, 10); }

// Status calculado (não fica gravado no banco — sempre atual)
function statusConta(dataPagamentoOuRecebimento, dataVencimento) {
  if (dataPagamentoOuRecebimento) return 'OK';
  if (String(dataVencimento) < hojeISO()) return 'ATRASADO';
  return 'PENDENTE';
}

const STATUS_LABEL_RECEBER = { OK: 'Recebido', PENDENTE: 'A receber', ATRASADO: 'Atrasado' };
const STATUS_LABEL_PAGAR = { OK: 'Pago', PENDENTE: 'A pagar', ATRASADO: 'Atrasado' };
const STATUS_COR = {
  OK: { fundo: '#DDF2E4', texto: '#1E6B3C' },
  PENDENTE: { fundo: '#FDF3D7', texto: '#8A6100' },
  ATRASADO: { fundo: '#FBDDDD', texto: '#A31212' },
};

function formatarDocumento(texto) {
  const d = String(texto || '').replace(/\D/g, '').slice(0, 14);
  if (d.length <= 11) {
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function apenasNumeros(texto) { return String(texto || '').replace(/\D/g, ''); }

// ---- Componente principal ---------------------------------------------------

export default function Financeiro() {
  const router = useRouter();

  const [verificandoLogin, setVerificandoLogin] = useState(true);
  const [usuario, setUsuario] = useState(null);
  const [nomeHotel, setNomeHotel] = useState('');

  const [subAba, setSubAba] = useState('dashboard');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);

  const [clientes, setClientes] = useState([]);
  const [fornecedores, setFornecedores] = useState([]);
  const [centrosCusto, setCentrosCusto] = useState([]);
  const [planoContas, setPlanoContas] = useState([]);
  const [contasReceber, setContasReceber] = useState([]);
  const [contasPagar, setContasPagar] = useState([]);

  function mostrarAviso(texto) { setAviso(texto); setTimeout(() => setAviso(''), 5000); }

  // ---- Login (só ADMIN pode ficar) ----
  useEffect(() => {
    let ativo = true;
    async function verificar() {
      const { data: sessao } = await supabase.auth.getSession();
      if (!sessao?.session) { router.push('/login'); return; }
      const { data: dadosUsuario, error } = await supabase
        .from('usuarios').select('*').eq('auth_id', sessao.session.user.id).single();
      if (error || !dadosUsuario) { router.push('/login'); return; }
      if (dadosUsuario.papel !== 'ADMIN') { router.push('/'); return; }
      if (!ativo) return;
      setUsuario(dadosUsuario);
      setVerificandoLogin(false);

      const { data: h } = await supabase.from('hoteis').select('nome_fantasia').eq('id', dadosUsuario.hotel_id).single();
      if (ativo && h?.nome_fantasia) setNomeHotel(h.nome_fantasia);
    }
    verificar();
    return () => { ativo = false; };
  }, [router]);

  const carregarTudo = useCallback(async (u) => {
    setCarregando(true);
    setErro('');
    const [c, f, cc, pc, cr, cp] = await Promise.all([
      supabase.from('clientes').select('*').order('nome', { ascending: true }),
      supabase.from('fornecedores').select('*').order('nome', { ascending: true }),
      supabase.from('centros_custo').select('*').order('nome', { ascending: true }),
      supabase.from('plano_contas').select('*').order('nome', { ascending: true }),
      supabase.from('contas_receber').select('*').order('data_vencimento', { ascending: true }),
      supabase.from('contas_pagar').select('*').order('data_vencimento', { ascending: true }),
    ]);
    if (cr.error) setErro('Não foi possível carregar. Detalhe técnico: ' + cr.error.message);
    setClientes(c.data || []);
    setFornecedores(f.data || []);
    setCentrosCusto(cc.data || []);
    setPlanoContas(pc.data || []);
    setContasReceber(cr.data || []);
    setContasPagar(cp.data || []);
    setCarregando(false);
  }, []);

  useEffect(() => { if (usuario) carregarTudo(usuario); }, [usuario, carregarTudo]);

  async function registrarLog(area, acao, detalhe) {
    await supabase.from('financeiro_log').insert({
      usuario_id: usuario.id, area, acao, detalhe: detalhe || null, hotel_id: usuario.hotel_id,
    });
  }

  const nomeCliente = useCallback((id) => clientes.find((c) => c.id === id)?.nome || '—', [clientes]);
  const nomeFornecedor = useCallback((id) => fornecedores.find((f) => f.id === id)?.nome || '—', [fornecedores]);

  if (verificandoLogin) {
    return <main className="conteudo"><p className="texto-suave">Verificando seu acesso…</p></main>;
  }

  return (
    <main className="conteudo">
      <EstilosFinanceiro />

      <span className="olho">Gestão financeira</span>
      <h1 style={{ marginBottom: 10 }}>Financeiro</h1>
      <p className="texto-suave" style={{ fontSize: 13, marginTop: -6 }}>
        Este módulo é visível só para administradores.
      </p>

      {aviso && <div className="aviso-sucesso">{aviso}</div>}
      {erro && <div className="aviso-erro">{erro}</div>}

      <nav className="fn-abas" aria-label="Seções">
        {[
          ['dashboard', 'Dashboard'], ['receber', 'Contas a Receber'], ['pagar', 'Contas a Pagar'],
          ['clientes', 'Clientes'], ['fornecedores', 'Fornecedores'], ['categorias', 'Categorias'],
        ].map(([chave, rotulo]) => (
          <button key={chave} type="button" className={subAba === chave ? 'fn-aba fn-aba-ativa' : 'fn-aba'}
            onClick={() => setSubAba(chave)}>
            {rotulo}
          </button>
        ))}
      </nav>

      {carregando ? <p className="texto-suave">Carregando…</p> : (
        <>
          {subAba === 'dashboard' && (
            <PainelDashboard contasReceber={contasReceber} contasPagar={contasPagar} />
          )}
          {subAba === 'receber' && (
            <PainelContasReceber
              contas={contasReceber} clientes={clientes} centrosCusto={centrosCusto} planoContas={planoContas}
              nomeCliente={nomeCliente} usuario={usuario} salvando={salvando} setSalvando={setSalvando}
              mostrarAviso={mostrarAviso} setErro={setErro} registrarLog={registrarLog}
              recarregar={() => carregarTudo(usuario)} nomeHotel={nomeHotel}
            />
          )}
          {subAba === 'pagar' && (
            <PainelContasPagar
              contas={contasPagar} fornecedores={fornecedores} centrosCusto={centrosCusto} planoContas={planoContas}
              nomeFornecedor={nomeFornecedor} usuario={usuario} salvando={salvando} setSalvando={setSalvando}
              mostrarAviso={mostrarAviso} setErro={setErro} registrarLog={registrarLog}
              recarregar={() => carregarTudo(usuario)}
            />
          )}
          {subAba === 'clientes' && (
            <PainelCadastroSimples
              titulo="Clientes" tabela="clientes" registros={clientes} area="Clientes"
              usuario={usuario} salvando={salvando} setSalvando={setSalvando}
              mostrarAviso={mostrarAviso} setErro={setErro} registrarLog={registrarLog}
              recarregar={() => carregarTudo(usuario)}
            />
          )}
          {subAba === 'fornecedores' && (
            <PainelCadastroSimples
              titulo="Fornecedores" tabela="fornecedores" registros={fornecedores} area="Fornecedores"
              usuario={usuario} salvando={salvando} setSalvando={setSalvando}
              mostrarAviso={mostrarAviso} setErro={setErro} registrarLog={registrarLog}
              recarregar={() => carregarTudo(usuario)}
            />
          )}
          {subAba === 'categorias' && (
            <PainelCategorias
              centrosCusto={centrosCusto} planoContas={planoContas}
              usuario={usuario} salvando={salvando} setSalvando={setSalvando}
              mostrarAviso={mostrarAviso} setErro={setErro} registrarLog={registrarLog}
              recarregar={() => carregarTudo(usuario)}
            />
          )}
        </>
      )}
    </main>
  );
}

// ============================================================================
// DASHBOARD
// ============================================================================

function PainelDashboard({ contasReceber, contasPagar }) {
  const [periodo, setPeriodo] = useState('MES');

  function dentroDoPeriodo(dataIso) {
    if (!dataIso) return false;
    if (periodo === 'TUDO') return true;
    const d = new Date(dataIso + 'T00:00:00');
    const agora = new Date();
    if (periodo === 'MES') return d.getMonth() === agora.getMonth() && d.getFullYear() === agora.getFullYear();
    if (periodo === 'ANO') return d.getFullYear() === agora.getFullYear();
    return true;
  }

  const receberPeriodo = contasReceber.filter((c) => dentroDoPeriodo(c.data_vencimento));
  const pagarPeriodo = contasPagar.filter((c) => dentroDoPeriodo(c.data_vencimento));

  const faturamentoBruto = receberPeriodo.reduce((s, c) => s + Number(c.valor), 0);
  const totalRecebido = receberPeriodo.filter((c) => c.data_recebimento).reduce((s, c) => s + Number(c.valor), 0);
  const totalAReceber = faturamentoBruto - totalRecebido;
  const atrasadas = receberPeriodo.filter((c) => statusConta(c.data_recebimento, c.data_vencimento) === 'ATRASADO');
  const taxaInadimplencia = receberPeriodo.length > 0 ? (atrasadas.length / receberPeriodo.length) * 100 : 0;

  const totalPago = pagarPeriodo.filter((c) => c.data_pagamento).reduce((s, c) => s + Number(c.valor), 0);
  const totalAPagar = pagarPeriodo.reduce((s, c) => s + Number(c.valor), 0) - totalPago;

  const saldoPeriodo = totalRecebido - totalPago;

  // Gráfico simples: por mês (se ANO/TUDO) ou por dia (se MES)
  const porBucket = {};
  function bucketDe(dataIso) {
    const d = new Date(dataIso + 'T00:00:00');
    if (periodo === 'MES') return String(d.getDate()).padStart(2, '0');
    return `${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`;
  }
  receberPeriodo.filter((c) => c.data_recebimento).forEach((c) => {
    const b = bucketDe(c.data_recebimento);
    porBucket[b] = porBucket[b] || { entradas: 0, saidas: 0 };
    porBucket[b].entradas += Number(c.valor);
  });
  pagarPeriodo.filter((c) => c.data_pagamento).forEach((c) => {
    const b = bucketDe(c.data_pagamento);
    porBucket[b] = porBucket[b] || { entradas: 0, saidas: 0 };
    porBucket[b].saidas += Number(c.valor);
  });
  const buckets = Object.entries(porBucket).sort((a, b) => a[0].localeCompare(b[0], 'pt-BR', { numeric: true }));
  const maiorValor = Math.max(1, ...buckets.map(([, v]) => Math.max(v.entradas, v.saidas)));

  return (
    <section>
      <div className="mn-periodo" style={{ marginBottom: 14 }}>
        {[['MES', 'Este mês'], ['ANO', 'Este ano'], ['TUDO', 'Tudo']].map(([chave, rotulo]) => (
          <button key={chave} type="button" className={periodo === chave ? 'fn-periodo-botao fn-periodo-ativo' : 'fn-periodo-botao'}
            onClick={() => setPeriodo(chave)}>{rotulo}</button>
        ))}
      </div>

      <h3 className="fn-subtitulo">Contas a Receber</h3>
      <div className="fn-numeros">
        <Numero valor={dinheiro(faturamentoBruto)} rotulo="Faturamento bruto" />
        <Numero valor={dinheiro(totalRecebido)} rotulo="Total recebido" cor="var(--sucesso-texto)" />
        <Numero valor={dinheiro(totalAReceber)} rotulo="Total a receber" cor="var(--latao-texto)" />
        <Numero valor={`${taxaInadimplencia.toFixed(1)}%`} rotulo="Inadimplência" cor={taxaInadimplencia > 15 ? 'var(--erro-texto)' : undefined} />
      </div>

      <h3 className="fn-subtitulo">Contas a Pagar</h3>
      <div className="fn-numeros">
        <Numero valor={dinheiro(totalPago)} rotulo="Total pago" cor="var(--sucesso-texto)" />
        <Numero valor={dinheiro(totalAPagar)} rotulo="Total a pagar" cor="var(--latao-texto)" />
      </div>

      <div className={`cartao fn-saldo ${saldoPeriodo >= 0 ? 'fn-saldo-pos' : 'fn-saldo-neg'}`}>
        <div>
          <div className="texto-suave" style={{ fontSize: 13 }}>Saldo do período (recebido − pago)</div>
          <div className="fn-saldo-valor">{saldoPeriodo >= 0 ? '▲' : '▼'} {dinheiro(Math.abs(saldoPeriodo))}</div>
        </div>
      </div>

      <div className="cartao" style={{ marginTop: 14 }}>
        <h3 style={{ fontSize: '1rem', marginTop: 0 }}>Fluxo de Caixa (Entradas × Saídas)</h3>
        {buckets.length === 0 ? (
          <p className="texto-suave" style={{ fontSize: 14 }}>Sem movimentações confirmadas no período.</p>
        ) : (
          <div className="fn-grafico">
            {buckets.map(([b, v]) => (
              <div key={b} className="fn-grafico-coluna">
                <div className="fn-grafico-barras">
                  <div className="fn-barra fn-barra-entrada" style={{ height: `${(v.entradas / maiorValor) * 100}%` }} title={`Entradas: ${dinheiro(v.entradas)}`} />
                  <div className="fn-barra fn-barra-saida" style={{ height: `${(v.saidas / maiorValor) * 100}%` }} title={`Saídas: ${dinheiro(v.saidas)}`} />
                </div>
                <div className="fn-grafico-rotulo">{b}</div>
              </div>
            ))}
          </div>
        )}
        <div className="fn-legenda">
          <span><i className="fn-legenda-cor fn-legenda-entrada" /> Entradas</span>
          <span><i className="fn-legenda-cor fn-legenda-saida" /> Saídas</span>
        </div>
      </div>
    </section>
  );
}

function Numero({ valor, rotulo, cor }) {
  return (
    <div className="cartao fn-numero">
      <div className="fn-numero-valor" style={cor ? { color: cor } : undefined}>{valor}</div>
      <div className="fn-numero-rot">{rotulo}</div>
    </div>
  );
}

// ============================================================================
// CONTAS A RECEBER
// ============================================================================

function PainelContasReceber({ contas, clientes, centrosCusto, planoContas, nomeCliente, usuario, salvando, setSalvando, mostrarAviso, setErro, registrarLog, recarregar, nomeHotel }) {
  const [mostrarForm, setMostrarForm] = useState(false);
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('TODOS');

  const [fCliente, setFCliente] = useState('');
  const [fDescricao, setFDescricao] = useState('');
  const [fValor, setFValor] = useState('');
  const [fVencimento, setFVencimento] = useState('');
  const [fCentro, setFCentro] = useState('');
  const [fPlano, setFPlano] = useState('');
  const [erroForm, setErroForm] = useState('');

  const [receberBaixa, setReceberBaixa] = useState(null);
  const [dataRecebimento, setDataRecebimento] = useState(hojeISO());
  const [formaRecebimento, setFormaRecebimento] = useState('Pix');
  const [comprovanteArquivo, setComprovanteArquivo] = useState(null);

  const planoReceita = planoContas.filter((p) => p.tipo === 'RECEITA');

  async function lancar(evento) {
    evento.preventDefault();
    if (salvando) return;
    setErroForm('');
    if (!fDescricao.trim()) { setErroForm('Descreva a cobrança.'); return; }
    if (!(Number(fValor) > 0)) { setErroForm('Informe um valor maior que zero.'); return; }
    if (!fVencimento) { setErroForm('Informe a data de vencimento.'); return; }

    setSalvando(true);
    const { error } = await supabase.from('contas_receber').insert({
      cliente_id: fCliente ? Number(fCliente) : null,
      descricao: fDescricao.trim(), valor: Number(fValor), data_vencimento: fVencimento,
      centro_custo_id: fCentro ? Number(fCentro) : null, plano_contas_id: fPlano ? Number(fPlano) : null,
      criado_por_id: usuario.id, hotel_id: usuario.hotel_id,
    });
    setSalvando(false);
    if (error) { setErroForm('Não foi possível lançar. Detalhe técnico: ' + error.message); return; }
    await registrarLog('Contas a Receber', 'Lançamento criado', `${fDescricao.trim()} — ${dinheiro(fValor)}, vence em ${formatarData(fVencimento)}.`);
    setFCliente(''); setFDescricao(''); setFValor(''); setFVencimento(''); setFCentro(''); setFPlano('');
    setMostrarForm(false);
    mostrarAviso('Cobrança lançada!');
    recarregar();
  }

  async function confirmarRecebimento() {
    if (!receberBaixa || salvando) return;
    setSalvando(true);
    let caminho = null, nomeArq = null;
    if (comprovanteArquivo) {
      const p = `${usuario.hotel_id}/financeiro/${Date.now()}_${comprovanteArquivo.name}`;
      const { error: upErr } = await supabase.storage.from('anexos').upload(p, comprovanteArquivo);
      if (upErr) { setSalvando(false); setErro('Não foi possível anexar o comprovante. Detalhe técnico: ' + upErr.message); return; }
      caminho = p; nomeArq = comprovanteArquivo.name;
    }
    const { error } = await supabase.from('contas_receber').update({
      data_recebimento: dataRecebimento, forma_recebimento: formaRecebimento,
      ...(caminho ? { comprovante_caminho: caminho, comprovante_nome: nomeArq } : {}),
    }).eq('id', receberBaixa.id);
    setSalvando(false);
    if (error) { setErro('Não foi possível confirmar. Detalhe técnico: ' + error.message); return; }
    await registrarLog('Contas a Receber', 'Recebimento confirmado', `${receberBaixa.descricao} — ${dinheiro(receberBaixa.valor)} recebido em ${formatarData(dataRecebimento)}.`);
    setReceberBaixa(null); setComprovanteArquivo(null);
    mostrarAviso('Recebimento confirmado!');
    recarregar();
  }

  function enviarWhatsapp(conta) {
    const cliente = clientes.find((c) => c.id === conta.cliente_id);
    if (!cliente?.telefone) { mostrarAviso('Este cliente não tem telefone cadastrado.'); return; }
    const numero = apenasNumeros(cliente.telefone);
    const numeroCompleto = numero.length <= 11 ? `55${numero}` : numero;
    const msg = `Olá, ${cliente.nome}! Aqui é da ${nomeHotel || 'nossa equipe'}.\n\nCobrança referente a: ${conta.descricao}\nValor: ${dinheiro(conta.valor)}\nVencimento: ${formatarData(conta.data_vencimento)}\n\nQualquer dúvida, estamos à disposição!`;
    window.open(`https://wa.me/${numeroCompleto}?text=${encodeURIComponent(msg)}`, '_blank');
  }

  const termo = busca.trim().toLowerCase();
  const filtradas = contas
    .filter((c) => !termo || (c.descricao || '').toLowerCase().includes(termo) || nomeCliente(c.cliente_id).toLowerCase().includes(termo))
    .filter((c) => filtroStatus === 'TODOS' ? true : statusConta(c.data_recebimento, c.data_vencimento) === filtroStatus);

  return (
    <section>
      <div className="fn-barra">
        <input className="campo" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por descrição ou cliente…" />
        <select className="campo" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
          <option value="TODOS">Todos os status</option>
          <option value="PENDENTE">A receber</option>
          <option value="ATRASADO">Atrasado</option>
          <option value="OK">Recebido</option>
        </select>
        <button type="button" className="botao botao-principal" onClick={() => { setMostrarForm(!mostrarForm); setErroForm(''); }}>
          {mostrarForm ? 'Fechar' : '+ Nova Cobrança'}
        </button>
      </div>

      {mostrarForm && (
        <form className="cartao" style={{ marginBottom: 16 }} onSubmit={lancar}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: 4 }}>Nova cobrança</h2>
          <label className="rotulo">Cliente</label>
          <select className="campo" value={fCliente} onChange={(e) => setFCliente(e.target.value)}>
            <option value="">— Sem cliente vinculado —</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
          <label className="rotulo">Descrição *</label>
          <input className="campo" type="text" value={fDescricao} onChange={(e) => setFDescricao(e.target.value)} placeholder="Ex.: Diária extra apto 204" />
          <div className="fn-duas">
            <div>
              <label className="rotulo">Valor (R$) *</label>
              <input className="campo" type="number" min="0.01" step="0.01" value={fValor} onChange={(e) => setFValor(e.target.value)} placeholder="0,00" />
            </div>
            <div>
              <label className="rotulo">Vencimento *</label>
              <input className="campo" type="date" value={fVencimento} onChange={(e) => setFVencimento(e.target.value)} />
            </div>
          </div>
          <div className="fn-duas">
            <div>
              <label className="rotulo">Centro de Custo</label>
              <select className="campo" value={fCentro} onChange={(e) => setFCentro(e.target.value)}>
                <option value="">— Opcional —</option>
                {centrosCusto.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="rotulo">Plano de Contas</label>
              <select className="campo" value={fPlano} onChange={(e) => setFPlano(e.target.value)}>
                <option value="">— Opcional —</option>
                {planoReceita.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </div>
          </div>
          {erroForm && <div className="aviso-erro">{erroForm}</div>}
          <button type="submit" className="botao botao-principal" disabled={salvando} style={{ marginTop: 12 }}>
            {salvando ? 'Lançando…' : 'Lançar Cobrança'}
          </button>
        </form>
      )}

      <ListaContas
        contas={filtradas} tipoLabel={STATUS_LABEL_RECEBER} nomeEntidade={nomeCliente}
        campoEntidade="cliente_id" campoData="data_recebimento"
        onBaixar={(c) => { setReceberBaixa(c); setDataRecebimento(hojeISO()); setFormaRecebimento('Pix'); setComprovanteArquivo(null); }}
        onWhatsapp={enviarWhatsapp}
        rotuloBaixa="Confirmar Recebimento"
      />

      {receberBaixa && (
        <div className="fn-overlay" role="dialog" aria-modal="true">
          <div className="fn-modal">
            <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>Confirmar recebimento</h2>
            <p className="texto-suave" style={{ fontSize: 14 }}>{receberBaixa.descricao} — {dinheiro(receberBaixa.valor)}</p>
            <label className="rotulo">Data do recebimento</label>
            <input className="campo" type="date" value={dataRecebimento} onChange={(e) => setDataRecebimento(e.target.value)} />
            <label className="rotulo">Forma de recebimento</label>
            <select className="campo" value={formaRecebimento} onChange={(e) => setFormaRecebimento(e.target.value)}>
              {['Pix', 'Dinheiro', 'Cartão', 'Transferência', 'Boleto'].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <label className="rotulo">Comprovante (opcional)</label>
            <input className="campo" type="file" accept=".pdf,image/*" onChange={(e) => setComprovanteArquivo(e.target.files?.[0] || null)} />
            <div className="fn-modal-botoes">
              <button type="button" className="botao botao-principal" onClick={confirmarRecebimento} disabled={salvando}>
                {salvando ? 'Salvando…' : 'Confirmar'}
              </button>
              <button type="button" className="botao botao-suave" onClick={() => setReceberBaixa(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ============================================================================
// CONTAS A PAGAR
// ============================================================================

function PainelContasPagar({ contas, fornecedores, centrosCusto, planoContas, nomeFornecedor, usuario, salvando, setSalvando, mostrarAviso, setErro, registrarLog, recarregar }) {
  const [mostrarForm, setMostrarForm] = useState(false);
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('TODOS');

  const [fFornecedor, setFFornecedor] = useState('');
  const [fDescricao, setFDescricao] = useState('');
  const [fValor, setFValor] = useState('');
  const [fVencimento, setFVencimento] = useState('');
  const [fCentro, setFCentro] = useState('');
  const [fPlano, setFPlano] = useState('');
  const [boletoArquivo, setBoletoArquivo] = useState(null);
  const [erroForm, setErroForm] = useState('');

  const [pagarBaixa, setPagarBaixa] = useState(null);
  const [dataPagamento, setDataPagamento] = useState(hojeISO());
  const [formaPagamento, setFormaPagamento] = useState('Pix');
  const [comprovanteArquivo, setComprovanteArquivo] = useState(null);

  const planoDespesa = planoContas.filter((p) => p.tipo === 'DESPESA');

  async function lancar(evento) {
    evento.preventDefault();
    if (salvando) return;
    setErroForm('');
    if (!fDescricao.trim()) { setErroForm('Descreva a despesa.'); return; }
    if (!(Number(fValor) > 0)) { setErroForm('Informe um valor maior que zero.'); return; }
    if (!fVencimento) { setErroForm('Informe a data de vencimento.'); return; }

    setSalvando(true);
    let caminho = null, nomeArq = null;
    if (boletoArquivo) {
      const p = `${usuario.hotel_id}/financeiro/${Date.now()}_${boletoArquivo.name}`;
      const { error: upErr } = await supabase.storage.from('anexos').upload(p, boletoArquivo);
      if (upErr) { setSalvando(false); setErroForm('Não foi possível anexar o boleto. Detalhe técnico: ' + upErr.message); return; }
      caminho = p; nomeArq = boletoArquivo.name;
    }
    const { error } = await supabase.from('contas_pagar').insert({
      fornecedor_id: fFornecedor ? Number(fFornecedor) : null,
      descricao: fDescricao.trim(), valor: Number(fValor), data_vencimento: fVencimento,
      centro_custo_id: fCentro ? Number(fCentro) : null, plano_contas_id: fPlano ? Number(fPlano) : null,
      ...(caminho ? { comprovante_caminho: caminho, comprovante_nome: nomeArq } : {}),
      criado_por_id: usuario.id, hotel_id: usuario.hotel_id,
    });
    setSalvando(false);
    if (error) { setErroForm('Não foi possível lançar. Detalhe técnico: ' + error.message); return; }
    await registrarLog('Contas a Pagar', 'Lançamento criado', `${fDescricao.trim()} — ${dinheiro(fValor)}, vence em ${formatarData(fVencimento)}.`);
    setFFornecedor(''); setFDescricao(''); setFValor(''); setFVencimento(''); setFCentro(''); setFPlano(''); setBoletoArquivo(null);
    setMostrarForm(false);
    mostrarAviso('Conta lançada!');
    recarregar();
  }

  async function confirmarPagamento() {
    if (!pagarBaixa || salvando) return;
    setSalvando(true);
    let caminho = pagarBaixa.comprovante_caminho, nomeArq = pagarBaixa.comprovante_nome;
    if (comprovanteArquivo) {
      const p = `${usuario.hotel_id}/financeiro/${Date.now()}_${comprovanteArquivo.name}`;
      const { error: upErr } = await supabase.storage.from('anexos').upload(p, comprovanteArquivo);
      if (upErr) { setSalvando(false); setErro('Não foi possível anexar o comprovante. Detalhe técnico: ' + upErr.message); return; }
      caminho = p; nomeArq = comprovanteArquivo.name;
    }
    const { error } = await supabase.from('contas_pagar').update({
      data_pagamento: dataPagamento, forma_pagamento: formaPagamento,
      comprovante_caminho: caminho, comprovante_nome: nomeArq,
    }).eq('id', pagarBaixa.id);
    setSalvando(false);
    if (error) { setErro('Não foi possível confirmar. Detalhe técnico: ' + error.message); return; }
    await registrarLog('Contas a Pagar', 'Pagamento confirmado', `${pagarBaixa.descricao} — ${dinheiro(pagarBaixa.valor)} pago em ${formatarData(dataPagamento)}.`);
    setPagarBaixa(null); setComprovanteArquivo(null);
    mostrarAviso('Pagamento confirmado!');
    recarregar();
  }

  const termo = busca.trim().toLowerCase();
  const filtradas = contas
    .filter((c) => !termo || (c.descricao || '').toLowerCase().includes(termo) || nomeFornecedor(c.fornecedor_id).toLowerCase().includes(termo))
    .filter((c) => filtroStatus === 'TODOS' ? true : statusConta(c.data_pagamento, c.data_vencimento) === filtroStatus);

  return (
    <section>
      <div className="fn-barra">
        <input className="campo" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por descrição ou fornecedor…" />
        <select className="campo" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
          <option value="TODOS">Todos os status</option>
          <option value="PENDENTE">A pagar</option>
          <option value="ATRASADO">Atrasado</option>
          <option value="OK">Pago</option>
        </select>
        <button type="button" className="botao botao-principal" onClick={() => { setMostrarForm(!mostrarForm); setErroForm(''); }}>
          {mostrarForm ? 'Fechar' : '+ Nova Conta'}
        </button>
      </div>

      {mostrarForm && (
        <form className="cartao" style={{ marginBottom: 16 }} onSubmit={lancar}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: 4 }}>Nova conta a pagar</h2>
          <label className="rotulo">Fornecedor</label>
          <select className="campo" value={fFornecedor} onChange={(e) => setFFornecedor(e.target.value)}>
            <option value="">— Sem fornecedor vinculado —</option>
            {fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
          <label className="rotulo">Descrição *</label>
          <input className="campo" type="text" value={fDescricao} onChange={(e) => setFDescricao(e.target.value)} placeholder="Ex.: Conta de energia" />
          <div className="fn-duas">
            <div>
              <label className="rotulo">Valor (R$) *</label>
              <input className="campo" type="number" min="0.01" step="0.01" value={fValor} onChange={(e) => setFValor(e.target.value)} placeholder="0,00" />
            </div>
            <div>
              <label className="rotulo">Vencimento *</label>
              <input className="campo" type="date" value={fVencimento} onChange={(e) => setFVencimento(e.target.value)} />
            </div>
          </div>
          <div className="fn-duas">
            <div>
              <label className="rotulo">Centro de Custo</label>
              <select className="campo" value={fCentro} onChange={(e) => setFCentro(e.target.value)}>
                <option value="">— Opcional —</option>
                {centrosCusto.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="rotulo">Plano de Contas</label>
              <select className="campo" value={fPlano} onChange={(e) => setFPlano(e.target.value)}>
                <option value="">— Opcional —</option>
                {planoDespesa.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </div>
          </div>
          <label className="rotulo">Boleto (opcional)</label>
          <input className="campo" type="file" accept=".pdf,image/*" onChange={(e) => setBoletoArquivo(e.target.files?.[0] || null)} />
          {erroForm && <div className="aviso-erro">{erroForm}</div>}
          <button type="submit" className="botao botao-principal" disabled={salvando} style={{ marginTop: 12 }}>
            {salvando ? 'Lançando…' : 'Lançar Conta'}
          </button>
        </form>
      )}

      <ListaContas
        contas={filtradas} tipoLabel={STATUS_LABEL_PAGAR} nomeEntidade={nomeFornecedor}
        campoEntidade="fornecedor_id" campoData="data_pagamento"
        onBaixar={(c) => { setPagarBaixa(c); setDataPagamento(hojeISO()); setFormaPagamento('Pix'); setComprovanteArquivo(null); }}
        rotuloBaixa="Confirmar Pagamento"
      />

      {pagarBaixa && (
        <div className="fn-overlay" role="dialog" aria-modal="true">
          <div className="fn-modal">
            <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>Confirmar pagamento</h2>
            <p className="texto-suave" style={{ fontSize: 14 }}>{pagarBaixa.descricao} — {dinheiro(pagarBaixa.valor)}</p>
            <label className="rotulo">Data do pagamento</label>
            <input className="campo" type="date" value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} />
            <label className="rotulo">Forma de pagamento</label>
            <select className="campo" value={formaPagamento} onChange={(e) => setFormaPagamento(e.target.value)}>
              {['Pix', 'Dinheiro', 'Cartão', 'Transferência', 'Boleto'].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <label className="rotulo">Comprovante de pagamento (opcional)</label>
            <input className="campo" type="file" accept=".pdf,image/*" onChange={(e) => setComprovanteArquivo(e.target.files?.[0] || null)} />
            <div className="fn-modal-botoes">
              <button type="button" className="botao botao-principal" onClick={confirmarPagamento} disabled={salvando}>
                {salvando ? 'Salvando…' : 'Confirmar'}
              </button>
              <button type="button" className="botao botao-suave" onClick={() => setPagarBaixa(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ---- Lista reutilizada por Receber e Pagar ----
function ListaContas({ contas, tipoLabel, nomeEntidade, campoEntidade, campoData, onBaixar, onWhatsapp, rotuloBaixa }) {
  if (contas.length === 0) {
    return <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>Nenhum lançamento encontrado.</div>;
  }
  return (
    <div className="fn-lista">
      {contas.map((c) => {
        const status = statusConta(c[campoData], c.data_vencimento);
        const entidade = nomeEntidade(c[campoEntidade]);
        return (
          <div key={c.id} className="cartao fn-item">
            <div className="fn-item-esq">
              <div className="fn-item-topo">
                <strong>{c.descricao}</strong>
                <span className="fn-badge" style={{ background: STATUS_COR[status].fundo, color: STATUS_COR[status].texto }}>
                  {tipoLabel[status]}
                </span>
              </div>
              <div className="texto-suave" style={{ fontSize: 13 }}>
                {entidade !== '—' ? `${entidade} · ` : ''}Vencimento: {formatarData(c.data_vencimento)}
                {c[campoData] ? ` · confirmado em ${formatarData(c[campoData])}` : ''}
                {c.comprovante_nome ? ` · 📎 ${c.comprovante_nome}` : ''}
              </div>
            </div>
            <div className="fn-item-dir">
              <div className="fn-valor">{dinheiro(c.valor)}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {status !== 'OK' && (
                  <button type="button" className="botao botao-principal" onClick={() => onBaixar(c)}>{rotuloBaixa}</button>
                )}
                {onWhatsapp && status !== 'OK' && (
                  <button type="button" className="botao botao-contorno" onClick={() => onWhatsapp(c)}>💬 Cobrar</button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// CLIENTES / FORNECEDORES (cadastro simples e idêntico)
// ============================================================================

function PainelCadastroSimples({ titulo, tabela, registros, area, usuario, salvando, setSalvando, mostrarAviso, setErro, registrarLog, recarregar }) {
  const [busca, setBusca] = useState('');
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [nome, setNome] = useState('');
  const [documento, setDocumento] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [erroForm, setErroForm] = useState('');
  const [excluindoId, setExcluindoId] = useState(null);

  function abrirNovo() {
    setEditandoId(null); setNome(''); setDocumento(''); setEmail(''); setTelefone(''); setErroForm('');
    setMostrarForm(true);
  }
  function abrirEdicao(r) {
    setEditandoId(r.id); setNome(r.nome); setDocumento(r.documento || ''); setEmail(r.email || ''); setTelefone(r.telefone || '');
    setErroForm(''); setMostrarForm(true);
  }

  async function salvar(evento) {
    evento.preventDefault();
    if (salvando) return;
    setErroForm('');
    if (!nome.trim()) { setErroForm('Informe o nome.'); return; }
    const dados = { nome: nome.trim(), documento: documento.trim() || null, email: email.trim() || null, telefone: telefone.trim() || null };

    setSalvando(true);
    if (editandoId) {
      const { error } = await supabase.from(tabela).update(dados).eq('id', editandoId);
      setSalvando(false);
      if (error) { setErroForm('Não foi possível salvar. Detalhe técnico: ' + error.message); return; }
      await registrarLog(area, 'Cadastro atualizado', dados.nome);
      mostrarAviso('Atualizado!');
    } else {
      const { error } = await supabase.from(tabela).insert({ ...dados, hotel_id: usuario.hotel_id });
      setSalvando(false);
      if (error) { setErroForm('Não foi possível cadastrar. Detalhe técnico: ' + error.message); return; }
      await registrarLog(area, 'Cadastro criado', dados.nome);
      mostrarAviso('Cadastrado!');
    }
    setMostrarForm(false);
    recarregar();
  }

  async function excluir(r) {
    setExcluindoId(null);
    const { error } = await supabase.from(tabela).delete().eq('id', r.id);
    if (error) {
      setErro(/foreign key|violates/i.test(error.message)
        ? `Não é possível excluir "${r.nome}" porque existem lançamentos vinculados a ele.`
        : 'Não foi possível excluir. Detalhe técnico: ' + error.message);
      return;
    }
    await registrarLog(area, 'Cadastro excluído', r.nome);
    mostrarAviso('Excluído.');
    recarregar();
  }

  const termo = busca.trim().toLowerCase();
  const filtrados = registros.filter((r) => !termo || r.nome.toLowerCase().includes(termo) || (r.documento || '').includes(termo));

  return (
    <section>
      <div className="fn-barra">
        <input className="campo" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={`Buscar ${titulo.toLowerCase()}…`} />
        <button type="button" className="botao botao-principal" onClick={abrirNovo}>+ Novo</button>
      </div>

      {mostrarForm && (
        <form className="cartao" style={{ marginBottom: 16 }} onSubmit={salvar}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: 4 }}>{editandoId ? 'Editar' : 'Novo'} {titulo === 'Clientes' ? 'cliente' : 'fornecedor'}</h2>
          <label className="rotulo">Nome / Razão social *</label>
          <input className="campo" type="text" value={nome} onChange={(e) => setNome(e.target.value)} />
          <div className="fn-duas">
            <div>
              <label className="rotulo">CPF ou CNPJ</label>
              <input className="campo" type="text" value={documento} onChange={(e) => setDocumento(formatarDocumento(e.target.value))} placeholder="000.000.000-00" />
            </div>
            <div>
              <label className="rotulo">Telefone</label>
              <input className="campo" type="text" value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="(83) 90000-0000" />
            </div>
          </div>
          <label className="rotulo">E-mail</label>
          <input className="campo" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          {erroForm && <div className="aviso-erro">{erroForm}</div>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
            <button type="submit" className="botao botao-principal" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
            <button type="button" className="botao botao-suave" onClick={() => setMostrarForm(false)}>Cancelar</button>
          </div>
        </form>
      )}

      {filtrados.length === 0 ? (
        <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>Nenhum registro encontrado.</div>
      ) : (
        <div className="fn-lista">
          {filtrados.map((r) => (
            <div key={r.id} className="cartao fn-item-cad">
              <div>
                <strong>{r.nome}</strong>
                <div className="texto-suave" style={{ fontSize: 13 }}>
                  {r.documento || '—'} {r.telefone ? `· ${r.telefone}` : ''} {r.email ? `· ${r.email}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="botao botao-suave" onClick={() => abrirEdicao(r)}>Editar</button>
                {excluindoId === r.id ? (
                  <span className="fn-confirmar">
                    Excluir?
                    <button type="button" className="botao botao-perigo" onClick={() => excluir(r)}>Sim</button>
                    <button type="button" className="botao botao-suave" onClick={() => setExcluindoId(null)}>Não</button>
                  </span>
                ) : (
                  <button type="button" className="botao botao-suave" onClick={() => setExcluindoId(r.id)}>Excluir</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ============================================================================
// CATEGORIAS (Centro de Custo + Plano de Contas)
// ============================================================================

function PainelCategorias({ centrosCusto, planoContas, usuario, salvando, setSalvando, mostrarAviso, setErro, registrarLog, recarregar }) {
  const [novoCentro, setNovoCentro] = useState('');
  const [novoPlanoNome, setNovoPlanoNome] = useState('');
  const [novoPlanoTipo, setNovoPlanoTipo] = useState('DESPESA');

  async function addCentro() {
    if (!novoCentro.trim() || salvando) return;
    setSalvando(true);
    const { error } = await supabase.from('centros_custo').insert({ nome: novoCentro.trim(), hotel_id: usuario.hotel_id });
    setSalvando(false);
    if (error) { setErro('Não foi possível cadastrar. Detalhe técnico: ' + error.message); return; }
    await registrarLog('Categorias', 'Centro de custo criado', novoCentro.trim());
    setNovoCentro(''); mostrarAviso('Centro de custo cadastrado!'); recarregar();
  }

  async function excluirCentro(c) {
    const { error } = await supabase.from('centros_custo').delete().eq('id', c.id);
    if (error) { setErro(/foreign key|violates/i.test(error.message) ? `"${c.nome}" está em uso em algum lançamento.` : error.message); return; }
    await registrarLog('Categorias', 'Centro de custo excluído', c.nome);
    mostrarAviso('Excluído.'); recarregar();
  }

  async function addPlano() {
    if (!novoPlanoNome.trim() || salvando) return;
    setSalvando(true);
    const { error } = await supabase.from('plano_contas').insert({ nome: novoPlanoNome.trim(), tipo: novoPlanoTipo, hotel_id: usuario.hotel_id });
    setSalvando(false);
    if (error) { setErro('Não foi possível cadastrar. Detalhe técnico: ' + error.message); return; }
    await registrarLog('Categorias', 'Plano de contas criado', `${novoPlanoNome.trim()} (${novoPlanoTipo})`);
    setNovoPlanoNome(''); mostrarAviso('Plano de contas cadastrado!'); recarregar();
  }

  async function excluirPlano(p) {
    const { error } = await supabase.from('plano_contas').delete().eq('id', p.id);
    if (error) { setErro(/foreign key|violates/i.test(error.message) ? `"${p.nome}" está em uso em algum lançamento.` : error.message); return; }
    await registrarLog('Categorias', 'Plano de contas excluído', p.nome);
    mostrarAviso('Excluído.'); recarregar();
  }

  return (
    <section className="fn-duas-colunas">
      <div className="cartao">
        <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>Centro de Custo</h2>
        <div className="fn-add-linha">
          <input className="campo" type="text" value={novoCentro} onChange={(e) => setNovoCentro(e.target.value)} placeholder="Ex.: Operacional" />
          <button type="button" className="botao botao-principal" onClick={addCentro} disabled={salvando}>+ Adicionar</button>
        </div>
        <div className="fn-lista" style={{ marginTop: 12 }}>
          {centrosCusto.length === 0 && <p className="texto-suave" style={{ fontSize: 13 }}>Nenhum ainda.</p>}
          {centrosCusto.map((c) => (
            <div key={c.id} className="fn-tag-linha">
              <span>{c.nome}</span>
              <button type="button" className="fn-x" onClick={() => excluirCentro(c)} aria-label="Excluir">✕</button>
            </div>
          ))}
        </div>
      </div>

      <div className="cartao">
        <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>Plano de Contas</h2>
        <div className="fn-add-linha">
          <input className="campo" type="text" value={novoPlanoNome} onChange={(e) => setNovoPlanoNome(e.target.value)} placeholder="Ex.: Diárias" />
          <select className="campo" value={novoPlanoTipo} onChange={(e) => setNovoPlanoTipo(e.target.value)} style={{ maxWidth: 130 }}>
            <option value="RECEITA">Receita</option>
            <option value="DESPESA">Despesa</option>
          </select>
          <button type="button" className="botao botao-principal" onClick={addPlano} disabled={salvando}>+ Adicionar</button>
        </div>
        <div className="fn-lista" style={{ marginTop: 12 }}>
          {planoContas.length === 0 && <p className="texto-suave" style={{ fontSize: 13 }}>Nenhum ainda.</p>}
          {planoContas.map((p) => (
            <div key={p.id} className="fn-tag-linha">
              <span>{p.nome} <em className="texto-suave" style={{ fontStyle: 'normal', fontSize: 12 }}>({p.tipo === 'RECEITA' ? 'Receita' : 'Despesa'})</em></span>
              <button type="button" className="fn-x" onClick={() => excluirPlano(p)} aria-label="Excluir">✕</button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---- Estilos específicos deste módulo ---------------------------------------

function EstilosFinanceiro() {
  return (
    <style>{`
      .fn-abas { display: flex; gap: 6px; overflow-x: auto; margin: 14px 0 16px; padding-bottom: 4px; }
      .fn-aba {
        border: 1px solid var(--borda); background: var(--branco); color: var(--tinta);
        border-radius: 999px; padding: 10px 16px; font-size: 14px; font-weight: 600;
        cursor: pointer; white-space: nowrap; min-height: 42px;
      }
      .fn-aba-ativa { background: var(--marca); border-color: var(--marca); color: var(--branco); }

      .fn-barra { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
      .fn-duas { display: grid; grid-template-columns: 1fr; gap: 0 14px; }
      .fn-duas-colunas { display: grid; grid-template-columns: 1fr; gap: 16px; }

      .fn-subtitulo { font-size: 14px; color: var(--texto-suave); margin: 18px 0 8px; text-transform: uppercase; letter-spacing: 0.04em; }
      .fn-numeros { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .fn-numero { text-align: center; padding: 14px 8px; }
      .fn-numero-valor { font-family: var(--fonte-titulo); font-weight: 700; font-size: 22px; color: var(--marca); }
      .fn-numero-rot { font-size: 12px; color: var(--texto-suave); margin-top: 4px; }

      .fn-saldo { margin-top: 16px; padding: 18px; }
      .fn-saldo-valor { font-family: var(--fonte-titulo); font-weight: 700; font-size: 26px; margin-top: 4px; }
      .fn-saldo-pos .fn-saldo-valor { color: var(--sucesso-texto); }
      .fn-saldo-neg .fn-saldo-valor { color: var(--erro-texto); }

      .fn-grafico { display: flex; align-items: flex-end; gap: 10px; height: 160px; overflow-x: auto; padding-top: 10px; }
      .fn-grafico-coluna { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 40px; height: 100%; }
      .fn-grafico-barras { display: flex; align-items: flex-end; gap: 3px; flex: 1; }
      .fn-barra { width: 12px; border-radius: 4px 4px 0 0; min-height: 2px; }
      .fn-barra-entrada { background: var(--marca); }
      .fn-barra-saida { background: #A34E00; }
      .fn-grafico-rotulo { font-size: 11px; color: var(--texto-suave); }
      .fn-legenda { display: flex; gap: 16px; margin-top: 10px; font-size: 12px; color: var(--texto-suave); }
      .fn-legenda-cor { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; }
      .fn-legenda-entrada { background: var(--marca); }
      .fn-legenda-saida { background: #A34E00; }

      .fn-periodo-botao {
        border: 1px solid var(--borda); background: var(--branco); color: var(--tinta);
        border-radius: 999px; padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer;
      }
      .fn-periodo-ativo { background: var(--marca); border-color: var(--marca); color: var(--branco); }

      .fn-lista { display: flex; flex-direction: column; gap: 10px; }
      .fn-item { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; }
      .fn-item-topo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .fn-badge { display: inline-block; font-size: 12px; font-weight: 700; border-radius: 999px; padding: 3px 10px; }
      .fn-valor { font-family: var(--fonte-titulo); font-weight: 700; font-size: 19px; color: var(--marca); }

      .fn-item-cad { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 14px 16px; }

      .fn-add-linha { display: flex; gap: 8px; flex-wrap: wrap; }
      .fn-add-linha .campo { flex: 1; min-width: 120px; }
      .fn-tag-linha {
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
        background: var(--fundo); border-radius: 10px; padding: 8px 12px; font-size: 14px;
      }
      .fn-x { border: none; background: var(--erro-fundo); color: var(--erro-texto); border-radius: 999px; width: 26px; height: 26px; cursor: pointer; font-size: 12px; }

      .fn-confirmar { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--erro-texto); flex-wrap: wrap; }

      .fn-overlay {
        position: fixed; inset: 0; background: rgba(15, 25, 22, 0.45);
        display: flex; align-items: flex-end; justify-content: center; z-index: 70;
      }
      .fn-modal { background: var(--branco); width: 100%; max-height: 92vh; overflow-y: auto; border-radius: 18px 18px 0 0; padding: 18px; }
      .fn-modal-botoes { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }

      @media (min-width: 640px) {
        .fn-barra { flex-direction: row; align-items: center; }
        .fn-barra .campo { flex: 1; }
        .fn-duas { grid-template-columns: 1fr 1fr; }
        .fn-numeros { grid-template-columns: repeat(4, 1fr); }
        .fn-item { flex-direction: row; justify-content: space-between; }
        .fn-item-dir { text-align: right; }
        .fn-overlay { align-items: center; padding: 24px; }
        .fn-modal { max-width: 480px; border-radius: 18px; padding: 24px; }
      }
      @media (min-width: 900px) {
        .fn-duas-colunas { grid-template-columns: 1fr 1fr; }
      }
    `}</style>
  );
}
