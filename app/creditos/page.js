'use client';

// ============================================================================
// CRÉDITOS E DEVOLUÇÕES
// - Créditos Disponíveis: pagamentos antecipados guardados para uso futuro.
//   Toda a equipe vê; só o ADMIN cadastra, registra a utilização e edita.
// - Solicitações de Devolução: Depósito Bancário, Cancelamento de Cartão ou
//   Pix. Toda a equipe vê e solicita (com e-mail automático ao admin);
//   só o ADMIN marca como processada.
// - Link do comprovante (Google Drive) ao encerrar/processar — ou depois.
// - Log de Auditoria (visível só para o ADMIN).
// Segurança garantida no banco via RLS (as regras acima valem mesmo se
// alguém tentar burlar a tela).
// ============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { bloquearSeNaoPermitido } from '../../lib/restricaoAcesso';

// ---- Constantes (mesmos rótulos do protótipo) -------------------------------

const TIPO_DEVOLUCAO_LABEL = {
  DEPOSITO: 'Devolução por Depósito Bancário',
  CARTAO: 'Cancelamento de Cartão',
  PIX: 'Devolução de Pix',
};
const TIPO_DEVOLUCAO_COR = {
  DEPOSITO: { fundo: '#DCEBFA', texto: '#1D4E89' },
  CARTAO: { fundo: '#FBDDDD', texto: '#A31212' },
  PIX: { fundo: '#DDF2E4', texto: '#1E6B3C' },
};
const STATUS_DEVOLUCAO_LABEL = { PENDENTE: 'Pendente', PROCESSADA: 'Processada' };
const STATUS_DEVOLUCAO_COR = {
  PENDENTE: { fundo: '#FDF3D7', texto: '#8A6100' },
  PROCESSADA: { fundo: '#DDF2E4', texto: '#1E6B3C' },
};
const STATUS_CREDITO_LABEL = { DISPONIVEL: 'Disponível', UTILIZADO: 'Utilizado/Devolvido' };
const STATUS_CREDITO_COR = {
  DISPONIVEL: { fundo: '#DDF2E4', texto: '#1E6B3C' },
  UTILIZADO: { fundo: '#EFEFEF', texto: '#666666' },
};
const FORMA_ENCERRAMENTO_LABEL = {
  PIX: 'Pix',
  DEPOSITO: 'Depósito Bancário',
  CARTAO: 'Estorno em Cartão',
  NOVA_RESERVA: 'Abatido em Nova Reserva',
};
const FORMAS_PAGAMENTO_HOTEL = ['Pix', 'Cartão', 'Depósito', 'Dinheiro', 'Transferência'];

// ---- Funções de apoio -------------------------------------------------------

function dinheiro(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    Number(valor || 0)
  );
}

function formatarData(valor) {
  if (!valor) return '—';
  const [ano, mes, dia] = String(valor).slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

function formatarDataHora(valor) {
  if (!valor) return '—';
  try {
    return new Date(valor).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch (e) {
    return String(valor);
  }
}

function linkValido(texto) {
  const t = String(texto || '').trim();
  return t === '' || t.startsWith('http://') || t.startsWith('https://');
}

// Estado inicial do formulário de devolução (todos os tipos)
const DEV_VAZIO = {
  nomePax: '', dataCheckout: '', faturaReserva: '', nomeEmpresa: '',
  formaPagamento: 'Pix',
  nomeBanco: '', tipoConta: 'Conta Corrente', agencia: '', numeroConta: '', nomeTitular: '',
  ultimosDigitos: '', valorPassadoCartao: '', dataVendaCartao: '',
  nomeDepositante: '', dataDeposito: '', valorDepositado: '',
  valorDevolver: '', valorEstornar: '',
};

// ---- Componente principal ---------------------------------------------------

export default function CreditosDevolucoes() {
  const router = useRouter();

  const [verificandoLogin, setVerificandoLogin] = useState(true);
  const [usuario, setUsuario] = useState(null);
  const [nomesUsuarios, setNomesUsuarios] = useState({}); // id -> nome
  const [adminHotel, setAdminHotel] = useState(null);     // { nome, email }

  const [subAba, setSubAba] = useState('creditos');
  const [creditos, setCreditos] = useState([]);
  const [devolucoes, setDevolucoes] = useState([]);
  const [logs, setLogs] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);

  // Créditos — formulário e filtros
  const [mostrarFormCredito, setMostrarFormCredito] = useState(false);
  const [cNomePax, setCNomePax] = useState('');
  const [cValor, setCValor] = useState('');
  const [cEmpresa, setCEmpresa] = useState('');
  const [cFatura, setCFatura] = useState('');
  const [cObs, setCObs] = useState('');
  const [buscaCred, setBuscaCred] = useState('');
  const [filtroCred, setFiltroCred] = useState('TODOS');

  // Devoluções — escolha de tipo, formulário e filtros
  const [escolhendoTipo, setEscolhendoTipo] = useState(false);
  const [tipoForm, setTipoForm] = useState(null); // 'DEPOSITO' | 'CARTAO' | 'PIX'
  const [dev, setDevEstado] = useState(DEV_VAZIO);
  const [buscaDev, setBuscaDev] = useState('');
  const [filtroDev, setFiltroDev] = useState('TODOS');

  // Modais
  const [modalHistorico, setModalHistorico] = useState(null); // {tipo:'CREDITO'|'DEVOLUCAO', item}
  const [modalEncerrar, setModalEncerrar] = useState(null);   // crédito
  const [encForma, setEncForma] = useState('PIX');
  const [encObs, setEncObs] = useState('');
  const [encLink, setEncLink] = useState('');
  const [modalProcessar, setModalProcessar] = useState(null); // devolução
  const [procLink, setProcLink] = useState('');
  const [modalLink, setModalLink] = useState(null);           // {tabela, item}
  const [linkTemp, setLinkTemp] = useState('');
  const [erroModal, setErroModal] = useState('');

  const souAdmin = usuario?.papel === 'ADMIN';

  function setDev(campo, valor) {
    setDevEstado((atual) => ({ ...atual, [campo]: valor }));
  }

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
      if (!sessao?.session) {
        router.push('/login');
        return;
      }
      const { data: dadosUsuario, error } = await supabase
        .from('usuarios')
        .select('*')
        .eq('auth_id', sessao.session.user.id)
        .single();
      if (error || !dadosUsuario) {
        router.push('/login');
        return;
      }
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

    // Nomes de todos os usuários do hotel (para mostrar "quem fez")
    const { data: pessoas } = await supabase.from('usuarios').select('id, nome, email, papel').eq('hotel_id', u.hotel_id);
    if (pessoas) {
      const mapa = {};
      pessoas.forEach((p) => { mapa[p.id] = p.nome; });
      setNomesUsuarios(mapa);
      const admin = pessoas.find((p) => p.papel === 'ADMIN');
      if (admin) setAdminHotel({ nome: admin.nome, email: admin.email });
    }

    const { data: cs, error: e1 } = await supabase
      .from('creditos_hospedes')
      .select('*')
      .order('criado_em', { ascending: false });
    if (e1) setErro('Não foi possível carregar os créditos. Detalhe técnico: ' + e1.message);
    else setCreditos(cs || []);

    const { data: ds, error: e2 } = await supabase
      .from('devolucoes')
      .select('*')
      .order('criado_em', { ascending: false });
    if (e2) setErro('Não foi possível carregar as devoluções. Detalhe técnico: ' + e2.message);
    else setDevolucoes(ds || []);

    if (u.papel === 'ADMIN') {
      const { data: ls } = await supabase
        .from('creditos_devolucoes_log')
        .select('*')
        .order('data_hora', { ascending: false })
        .limit(300);
      setLogs(ls || []);
    }

    setCarregando(false);
  }, []);

  useEffect(() => {
    if (usuario) carregarTudo(usuario);
  }, [usuario, carregarTudo]);

  // ---- Log de auditoria ----
  async function registrarLog(acao, detalhe) {
    await supabase.from('creditos_devolucoes_log').insert({
      usuario_id: usuario.id,
      acao,
      detalhe,
      hotel_id: usuario.hotel_id,
    });
  }

  // ---- CRÉDITOS: cadastrar ----
  async function salvarCredito(evento) {
    evento.preventDefault();
    if (salvando) return;
    setErro('');
    if (!cNomePax.trim()) { setErro('Preencha o nome do pax (hóspede).'); return; }
    if (!(Number(cValor) > 0)) { setErro('Informe um valor maior que zero.'); return; }

    setSalvando(true);
    const { error } = await supabase.from('creditos_hospedes').insert({
      nome_pax: cNomePax.trim(),
      valor: Number(cValor),
      nome_empresa: cEmpresa.trim() || 'Particular',
      fatura_reserva: cFatura.trim() || null,
      observacoes: cObs.trim() || null,
      criado_por_id: usuario.id,
      hotel_id: usuario.hotel_id,
    });
    setSalvando(false);
    if (error) {
      setErro('Não foi possível salvar o crédito. Detalhe técnico: ' + error.message);
      return;
    }
    await registrarLog('Cadastrou Crédito', `Pax: ${cNomePax.trim()}. Valor: ${dinheiro(cValor)}.`);
    setCNomePax(''); setCValor(''); setCEmpresa(''); setCFatura(''); setCObs('');
    setMostrarFormCredito(false);
    mostrarAviso('Crédito cadastrado!');
    carregarTudo(usuario);
  }

  // ---- CRÉDITOS: registrar utilização/devolução ----
  async function confirmarEncerramento() {
    if (!modalEncerrar || salvando) return;
    setErroModal('');
    if (!linkValido(encLink)) {
      setErroModal('O link precisa começar com http:// ou https:// (ou ficar vazio).');
      return;
    }
    setSalvando(true);
    const agora = new Date().toISOString();
    const { error } = await supabase
      .from('creditos_hospedes')
      .update({
        status: 'UTILIZADO',
        forma_encerramento: encForma,
        observacoes_encerramento: encObs.trim() || null,
        encerrado_por_id: usuario.id,
        encerrado_em: agora,
        link_comprovante: encLink.trim() || null,
      })
      .eq('id', modalEncerrar.id);
    setSalvando(false);
    if (error) {
      setErroModal('Não foi possível registrar. Detalhe técnico: ' + error.message);
      return;
    }
    await registrarLog(
      'Utilizou/Devolveu Crédito',
      `Pax: ${modalEncerrar.nome_pax}. Forma: ${FORMA_ENCERRAMENTO_LABEL[encForma]}. Valor: ${dinheiro(modalEncerrar.valor)}.`
    );
    setModalEncerrar(null);
    setEncForma('PIX'); setEncObs(''); setEncLink('');
    mostrarAviso('Utilização registrada!');
    carregarTudo(usuario);
  }

  // ---- DEVOLUÇÕES: cadastrar solicitação ----
  function validarDevolucao() {
    if (!dev.nomePax.trim()) return 'Preencha o nome do pax (hóspede).';
    if (tipoForm === 'DEPOSITO') {
      if (!dev.nomeBanco.trim()) return 'Preencha o nome do banco.';
      if (!dev.numeroConta.trim()) return 'Preencha o número da conta.';
      if (!dev.nomeTitular.trim()) return 'Preencha o nome do titular da conta.';
      if (!(Number(dev.valorDevolver) > 0)) return 'Informe o valor a devolver (maior que zero).';
    }
    if (tipoForm === 'CARTAO') {
      const dig = dev.ultimosDigitos.replace(/\D/g, '');
      if (dig.length !== 4) return 'Informe os 4 últimos dígitos do cartão.';
      if (!(Number(dev.valorEstornar) > 0)) return 'Informe o valor a estornar (maior que zero).';
    }
    if (tipoForm === 'PIX') {
      if (!dev.nomeDepositante.trim()) return 'Preencha o nome do depositante.';
      if (!(Number(dev.valorDevolver) > 0)) return 'Informe o valor a devolver (maior que zero).';
    }
    return '';
  }

  async function cadastrarSolicitacao(evento) {
    evento.preventDefault();
    if (salvando) return;
    setErroModal('');
    const problema = validarDevolucao();
    if (problema) { setErroModal(problema); return; }

    const registro = {
      tipo: tipoForm,
      nome_pax: dev.nomePax.trim(),
      data_checkout: dev.dataCheckout || null,
      fatura_reserva: dev.faturaReserva.trim() || null,
      nome_empresa: dev.nomeEmpresa.trim() || 'Particular',
      forma_pagamento: tipoForm === 'DEPOSITO' ? dev.formaPagamento : null,
      nome_banco: tipoForm === 'DEPOSITO' ? dev.nomeBanco.trim() : null,
      tipo_conta: tipoForm === 'DEPOSITO' ? dev.tipoConta : null,
      agencia: tipoForm === 'DEPOSITO' ? dev.agencia.trim() || null : null,
      numero_conta: tipoForm === 'DEPOSITO' ? dev.numeroConta.trim() : null,
      nome_titular: tipoForm === 'DEPOSITO' ? dev.nomeTitular.trim() : null,
      ultimos_digitos: tipoForm === 'CARTAO' ? dev.ultimosDigitos.replace(/\D/g, '') : null,
      valor_passado_cartao: tipoForm === 'CARTAO' && dev.valorPassadoCartao ? Number(dev.valorPassadoCartao) : null,
      data_venda_cartao: tipoForm === 'CARTAO' ? dev.dataVendaCartao || null : null,
      valor_estornar: tipoForm === 'CARTAO' ? Number(dev.valorEstornar) : null,
      nome_depositante: tipoForm === 'PIX' ? dev.nomeDepositante.trim() : null,
      data_deposito: tipoForm === 'PIX' ? dev.dataDeposito || null : null,
      valor_depositado: tipoForm === 'PIX' && dev.valorDepositado ? Number(dev.valorDepositado) : null,
      valor_devolver: tipoForm !== 'CARTAO' ? Number(dev.valorDevolver) : null,
      solicitado_por_id: usuario.id,
      hotel_id: usuario.hotel_id,
    };

    setSalvando(true);
    const { error } = await supabase.from('devolucoes').insert(registro);
    setSalvando(false);
    if (error) {
      setErroModal('Não foi possível cadastrar. Detalhe técnico: ' + error.message);
      return;
    }

    const valorPrincipal = tipoForm === 'CARTAO' ? registro.valor_estornar : registro.valor_devolver;
    await registrarLog(
      `Solicitou Devolução (${TIPO_DEVOLUCAO_LABEL[tipoForm]})`,
      `Pax: ${registro.nome_pax}. Fatura/reserva: ${registro.fatura_reserva || '—'}. Valor: ${dinheiro(valorPrincipal)}.`
    );

    enviarEmailAdmin(registro);

    setTipoForm(null);
    setEscolhendoTipo(false);
    setDevEstado(DEV_VAZIO);
    mostrarAviso('Solicitação cadastrada! O e-mail para o administrador foi aberto — é só enviar.');
    carregarTudo(usuario);
  }

  // Abre o e-mail para o administrador com todos os dados (mesmo texto do protótipo)
  function enviarEmailAdmin(r) {
    if (!adminHotel?.email) {
      mostrarAviso('Solicitação salva, mas nenhum administrador com e-mail foi encontrado para avisar.');
      return;
    }
    let corpoExtra = '';
    if (r.tipo === 'DEPOSITO') {
      corpoExtra = [
        'Dados da conta para devolução:',
        `Banco: ${r.nome_banco}`,
        `Tipo de conta: ${r.tipo_conta}`,
        `Agência: ${r.agencia || '—'}`,
        `Conta: ${r.numero_conta}`,
        `Titular: ${r.nome_titular}`,
        '',
        `Valor que precisa ser devolvido: ${dinheiro(r.valor_devolver)}`,
      ].join('\n');
    } else if (r.tipo === 'CARTAO') {
      corpoExtra = [
        'Dados do cartão de crédito:',
        `Últimos 4 dígitos: ${r.ultimos_digitos}`,
        `Valor passado no cartão: ${r.valor_passado_cartao ? dinheiro(r.valor_passado_cartao) : '—'}`,
        `Data da venda no cartão: ${formatarData(r.data_venda_cartao)}`,
        '',
        `Valor que precisa ser estornado: ${dinheiro(r.valor_estornar)}`,
      ].join('\n');
    } else {
      corpoExtra = [
        'Dados da conta para devolução (Pix):',
        `Nome do depositante: ${r.nome_depositante}`,
        `Data do depósito: ${formatarData(r.data_deposito)}`,
        `Valor depositado: ${r.valor_depositado ? dinheiro(r.valor_depositado) : '—'}`,
        '',
        `Valor que precisa ser devolvido: ${dinheiro(r.valor_devolver)}`,
      ].join('\n');
    }

    const assunto = `${TIPO_DEVOLUCAO_LABEL[r.tipo]} - ${r.nome_pax}`;
    const corpo = [
      `Solicitação feita por: ${usuario?.nome || '—'}`,
      `Data da solicitação: ${new Date().toLocaleString('pt-BR')}`,
      '='.repeat(20),
      `Nome do pax: ${r.nome_pax}`,
      `Data de check-out: ${formatarData(r.data_checkout)}`,
      `Fatura/reserva: ${r.fatura_reserva || '—'}`,
      `Nome da empresa: ${r.nome_empresa || '—'}`,
      ...(r.tipo === 'DEPOSITO' ? [`Forma de pagamento ao hotel: ${r.forma_pagamento || '—'}`] : []),
      '='.repeat(20),
      corpoExtra,
    ].join('\n');

    window.open(
      `mailto:${adminHotel.email}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`,
      '_self'
    );
  }

  // ---- DEVOLUÇÕES: marcar como processada ----
  async function confirmarProcessada() {
    if (!modalProcessar || salvando) return;
    setErroModal('');
    if (!linkValido(procLink)) {
      setErroModal('O link precisa começar com http:// ou https:// (ou ficar vazio).');
      return;
    }
    setSalvando(true);
    const { error } = await supabase
      .from('devolucoes')
      .update({
        status: 'PROCESSADA',
        processado_por_id: usuario.id,
        processado_em: new Date().toISOString(),
        link_comprovante: procLink.trim() || null,
      })
      .eq('id', modalProcessar.id);
    setSalvando(false);
    if (error) {
      setErroModal('Não foi possível processar. Detalhe técnico: ' + error.message);
      return;
    }
    await registrarLog(
      'Marcou Devolução como Processada',
      `Pax: ${modalProcessar.nome_pax}. Tipo: ${TIPO_DEVOLUCAO_LABEL[modalProcessar.tipo]}.`
    );
    setModalProcessar(null);
    setProcLink('');
    mostrarAviso('Devolução marcada como processada!');
    carregarTudo(usuario);
  }

  // ---- Link do comprovante (adicionar/editar depois) ----
  async function salvarLink() {
    if (!modalLink || salvando) return;
    setErroModal('');
    if (!linkValido(linkTemp)) {
      setErroModal('O link precisa começar com http:// ou https:// (ou ficar vazio para remover).');
      return;
    }
    setSalvando(true);
    const { error } = await supabase
      .from(modalLink.tabela)
      .update({ link_comprovante: linkTemp.trim() || null })
      .eq('id', modalLink.item.id);
    setSalvando(false);
    if (error) {
      setErroModal('Não foi possível salvar o link. Detalhe técnico: ' + error.message);
      return;
    }
    const nomePax = modalLink.item.nome_pax;
    await registrarLog('Atualizou link de comprovante', `Pax: ${nomePax}.`);
    setModalLink(null);
    setLinkTemp('');
    mostrarAviso('Link do comprovante salvo!');
    carregarTudo(usuario);
  }

  // ---- Filtros ----
  const termoCred = buscaCred.trim().toLowerCase();
  const creditosFiltrados = creditos
    .filter((c) => (filtroCred === 'TODOS' ? true : c.status === filtroCred))
    .filter((c) =>
      termoCred
        ? (c.nome_pax || '').toLowerCase().includes(termoCred) ||
          (c.nome_empresa || '').toLowerCase().includes(termoCred) ||
          (c.fatura_reserva || '').toLowerCase().includes(termoCred)
        : true
    );

  const termoDev = buscaDev.trim().toLowerCase();
  const devolucoesFiltradas = devolucoes
    .filter((d) => (filtroDev === 'TODOS' ? true : d.status === filtroDev))
    .filter((d) =>
      termoDev
        ? (d.nome_pax || '').toLowerCase().includes(termoDev) ||
          (d.nome_empresa || '').toLowerCase().includes(termoDev) ||
          (d.fatura_reserva || '').toLowerCase().includes(termoDev)
        : true
    );

  if (verificandoLogin) {
    return (
      <main className="conteudo">
        <p className="texto-suave">Verificando seu acesso…</p>
      </main>
    );
  }

  // ---- Interface -------------------------------------------------------------

  return (
    <main className="conteudo">
      <EstilosCreditos />

      <span className="olho">Financeiro do hóspede</span>
      <h1 style={{ marginBottom: 6 }}>Créditos e Devoluções</h1>
      <p className="texto-suave" style={{ maxWidth: 620 }}>
        Créditos são pagamentos antecipados guardados para uso futuro do hóspede.
        Devoluções são pedidos de reembolso (depósito, cartão ou Pix) que o
        administrador processa.
      </p>

      {aviso && <div className="aviso-sucesso">{aviso}</div>}
      {erro && <div className="aviso-erro">{erro}</div>}

      {/* Sub-abas */}
      <nav className="cd-abas" aria-label="Seções">
        <button
          type="button"
          className={subAba === 'creditos' ? 'cd-aba cd-aba-ativa' : 'cd-aba'}
          onClick={() => setSubAba('creditos')}
        >
          Créditos Disponíveis <span className="cd-contador">{creditos.filter((c) => c.status === 'DISPONIVEL').length}</span>
        </button>
        <button
          type="button"
          className={subAba === 'devolucoes' ? 'cd-aba cd-aba-ativa' : 'cd-aba'}
          onClick={() => setSubAba('devolucoes')}
        >
          Solicitações de Devolução <span className="cd-contador">{devolucoes.filter((d) => d.status === 'PENDENTE').length}</span>
        </button>
        {souAdmin && (
          <button
            type="button"
            className={subAba === 'log' ? 'cd-aba cd-aba-ativa' : 'cd-aba'}
            onClick={() => setSubAba('log')}
          >
            Log de Auditoria
          </button>
        )}
      </nav>

      {/* ================= CRÉDITOS ================= */}
      {subAba === 'creditos' && (
        <section>
          <div className="cd-barra">
            <input
              className="campo"
              type="search"
              value={buscaCred}
              onChange={(e) => setBuscaCred(e.target.value)}
              placeholder="Buscar por pax, empresa ou fatura…"
              aria-label="Buscar créditos"
            />
            <select
              className="campo"
              value={filtroCred}
              onChange={(e) => setFiltroCred(e.target.value)}
              aria-label="Filtrar créditos por status"
            >
              <option value="TODOS">Todos os status</option>
              <option value="DISPONIVEL">Disponível</option>
              <option value="UTILIZADO">Utilizado/Devolvido</option>
            </select>
            {souAdmin && (
              <button
                type="button"
                className="botao botao-principal"
                onClick={() => setMostrarFormCredito(!mostrarFormCredito)}
              >
                {mostrarFormCredito ? 'Fechar' : '+ Novo crédito'}
              </button>
            )}
          </div>

          {!souAdmin && (
            <p className="texto-suave" style={{ fontSize: 13 }}>
              Você pode consultar os créditos. Cadastro e encerramento são feitos pelo administrador.
            </p>
          )}

          {mostrarFormCredito && souAdmin && (
            <form className="cartao" style={{ marginBottom: 16 }} onSubmit={salvarCredito}>
              <h2 style={{ fontSize: '1.15rem', marginBottom: 4 }}>Novo crédito de hóspede</h2>

              <label className="rotulo" htmlFor="c-pax">Nome do pax (hóspede) *</label>
              <input id="c-pax" className="campo" type="text" value={cNomePax}
                onChange={(e) => setCNomePax(e.target.value)} placeholder="Ex.: Alexandre Dias Silva" />

              <div className="cd-duas">
                <div>
                  <label className="rotulo" htmlFor="c-valor">Valor (R$) *</label>
                  <input id="c-valor" className="campo" type="number" min="0.01" step="0.01"
                    value={cValor} onChange={(e) => setCValor(e.target.value)} placeholder="0,00" />
                </div>
                <div>
                  <label className="rotulo" htmlFor="c-fatura">Fatura / reserva</label>
                  <input id="c-fatura" className="campo" type="text" value={cFatura}
                    onChange={(e) => setCFatura(e.target.value)} placeholder="Número da fatura ou reserva" />
                </div>
              </div>

              <label className="rotulo" htmlFor="c-empresa">Empresa / Particular</label>
              <input id="c-empresa" className="campo" type="text" value={cEmpresa}
                onChange={(e) => setCEmpresa(e.target.value)} placeholder='Deixe vazio para "Particular"' />

              <label className="rotulo" htmlFor="c-obs">Observações</label>
              <textarea id="c-obs" className="campo" rows={3} value={cObs}
                onChange={(e) => setCObs(e.target.value)} placeholder="Ex.: Pagamento antecipado da reserva de setembro…" />

              <button type="submit" className="botao botao-principal" disabled={salvando} style={{ marginTop: 16 }}>
                {salvando ? 'Salvando…' : 'Cadastrar crédito'}
              </button>
            </form>
          )}

          {carregando ? (
            <p className="texto-suave">Carregando…</p>
          ) : creditosFiltrados.length === 0 ? (
            <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
              Nenhum crédito {filtroCred !== 'TODOS' || buscaCred ? 'encontrado com esses filtros' : 'cadastrado ainda'}.
            </div>
          ) : (
            <div className="cd-lista">
              {creditosFiltrados.map((c) => (
                <div key={c.id} className="cartao cd-item">
                  <div className="cd-item-topo">
                    <strong>{c.nome_pax}</strong>
                    <span className="cd-tag" style={{ background: STATUS_CREDITO_COR[c.status].fundo, color: STATUS_CREDITO_COR[c.status].texto }}>
                      {STATUS_CREDITO_LABEL[c.status]}
                    </span>
                  </div>
                  <div className="cd-valor">{dinheiro(c.valor)}</div>
                  <div className="cd-detalhes">
                    <span>🏢 {c.nome_empresa || 'Particular'}</span>
                    {c.fatura_reserva && <span>🧾 Fatura/reserva: {c.fatura_reserva}</span>}
                    <span>Cadastrado por {nomeDe(c.criado_por_id)} em {formatarDataHora(c.criado_em)}</span>
                  </div>
                  {c.status === 'UTILIZADO' && (
                    <div className="cd-encerrado">
                      Encerrado via <strong>{FORMA_ENCERRAMENTO_LABEL[c.forma_encerramento] || '—'}</strong> por {nomeDe(c.encerrado_por_id)} em {formatarDataHora(c.encerrado_em)}
                    </div>
                  )}

                  <div className="cd-acoes">
                    {souAdmin && c.status === 'DISPONIVEL' && (
                      <button type="button" className="botao botao-principal"
                        onClick={() => { setModalEncerrar(c); setEncForma('PIX'); setEncObs(''); setEncLink(''); setErroModal(''); }}>
                        Registrar utilização
                      </button>
                    )}
                    <button type="button" className="botao botao-suave"
                      onClick={() => setModalHistorico({ tipo: 'CREDITO', item: c })}>
                      Ver histórico
                    </button>
                    {c.link_comprovante ? (
                      <>
                        <a className="botao botao-contorno" href={c.link_comprovante} target="_blank" rel="noopener noreferrer">
                          Ver comprovante no Drive
                        </a>
                        {souAdmin && (
                          <button type="button" className="botao botao-suave"
                            onClick={() => { setModalLink({ tabela: 'creditos_hospedes', item: c }); setLinkTemp(c.link_comprovante || ''); setErroModal(''); }}>
                            Editar link
                          </button>
                        )}
                      </>
                    ) : (
                      c.status === 'UTILIZADO' && (
                        souAdmin ? (
                          <button type="button" className="botao botao-contorno"
                            onClick={() => { setModalLink({ tabela: 'creditos_hospedes', item: c }); setLinkTemp(''); setErroModal(''); }}>
                            + Adicionar link
                          </button>
                        ) : (
                          <span className="texto-suave" style={{ fontSize: 13 }}>Sem link de comprovante ainda</span>
                        )
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ================= DEVOLUÇÕES ================= */}
      {subAba === 'devolucoes' && (
        <section>
          <div className="cd-barra">
            <input
              className="campo"
              type="search"
              value={buscaDev}
              onChange={(e) => setBuscaDev(e.target.value)}
              placeholder="Buscar por pax, empresa ou fatura…"
              aria-label="Buscar devoluções"
            />
            <select
              className="campo"
              value={filtroDev}
              onChange={(e) => setFiltroDev(e.target.value)}
              aria-label="Filtrar devoluções por status"
            >
              <option value="TODOS">Todos os status</option>
              <option value="PENDENTE">Pendente</option>
              <option value="PROCESSADA">Processada</option>
            </select>
            <button type="button" className="botao botao-principal"
              onClick={() => { setEscolhendoTipo(true); setTipoForm(null); setDevEstado(DEV_VAZIO); setErroModal(''); }}>
              + Nova Solicitação
            </button>
          </div>

          {carregando ? (
            <p className="texto-suave">Carregando…</p>
          ) : devolucoesFiltradas.length === 0 ? (
            <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
              Nenhuma solicitação {filtroDev !== 'TODOS' || buscaDev ? 'encontrada com esses filtros' : 'cadastrada ainda'}.
            </div>
          ) : (
            <div className="cd-lista">
              {devolucoesFiltradas.map((d) => (
                <div key={d.id} className="cartao cd-item">
                  <div className="cd-item-topo">
                    <strong>{d.nome_pax}</strong>
                    <span className="cd-tag" style={{ background: TIPO_DEVOLUCAO_COR[d.tipo].fundo, color: TIPO_DEVOLUCAO_COR[d.tipo].texto }}>
                      {TIPO_DEVOLUCAO_LABEL[d.tipo]}
                    </span>
                    <span className="cd-tag" style={{ background: STATUS_DEVOLUCAO_COR[d.status].fundo, color: STATUS_DEVOLUCAO_COR[d.status].texto }}>
                      {STATUS_DEVOLUCAO_LABEL[d.status]}
                    </span>
                  </div>
                  <div className="cd-valor">
                    {dinheiro(d.tipo === 'CARTAO' ? d.valor_estornar : d.valor_devolver)}
                  </div>
                  <div className="cd-detalhes">
                    <span>🏢 {d.nome_empresa || 'Particular'}</span>
                    {d.fatura_reserva && <span>🧾 Fatura/reserva: {d.fatura_reserva}</span>}
                    <span>Solicitado por {nomeDe(d.solicitado_por_id)} em {formatarDataHora(d.criado_em)}</span>
                    {d.status === 'PROCESSADA' && (
                      <span>Processado por {nomeDe(d.processado_por_id)} em {formatarDataHora(d.processado_em)}</span>
                    )}
                  </div>

                  <div className="cd-acoes">
                    {souAdmin && d.status === 'PENDENTE' && (
                      <button type="button" className="botao botao-principal"
                        onClick={() => { setModalProcessar(d); setProcLink(''); setErroModal(''); }}>
                        Marcar como processada
                      </button>
                    )}
                    <button type="button" className="botao botao-suave"
                      onClick={() => setModalHistorico({ tipo: 'DEVOLUCAO', item: d })}>
                      Ver histórico
                    </button>
                    {d.link_comprovante ? (
                      <>
                        <a className="botao botao-contorno" href={d.link_comprovante} target="_blank" rel="noopener noreferrer">
                          Ver comprovante no Drive
                        </a>
                        {souAdmin && (
                          <button type="button" className="botao botao-suave"
                            onClick={() => { setModalLink({ tabela: 'devolucoes', item: d }); setLinkTemp(d.link_comprovante || ''); setErroModal(''); }}>
                            Editar link
                          </button>
                        )}
                      </>
                    ) : (
                      d.status === 'PROCESSADA' && (
                        souAdmin ? (
                          <button type="button" className="botao botao-contorno"
                            onClick={() => { setModalLink({ tabela: 'devolucoes', item: d }); setLinkTemp(''); setErroModal(''); }}>
                            + Adicionar link
                          </button>
                        ) : (
                          <span className="texto-suave" style={{ fontSize: 13 }}>Sem link de comprovante ainda</span>
                        )
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ================= LOG DE AUDITORIA (só admin) ================= */}
      {subAba === 'log' && souAdmin && (
        <section>
          {logs.length === 0 ? (
            <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
              Nenhum registro no log ainda.
            </div>
          ) : (
            <div className="cd-lista">
              {logs.map((l) => (
                <div key={l.id} className="cartao cd-log-item">
                  <div>
                    <strong>{nomeDe(l.usuario_id)}</strong>{' '}
                    <span className="cd-log-acao">{l.acao}</span>
                  </div>
                  {l.detalhe && <div className="cd-log-detalhe">{l.detalhe}</div>}
                  <div className="texto-suave" style={{ fontSize: 12 }}>{formatarDataHora(l.data_hora)}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ================= MODAIS ================= */}

      {/* Escolher tipo de devolução */}
      {escolhendoTipo && !tipoForm && (
        <div className="cd-overlay" role="dialog" aria-modal="true">
          <div className="cd-modal">
            <div className="cd-modal-topo">
              <h2 style={{ fontSize: '1.15rem', margin: 0 }}>Qual o tipo de devolução?</h2>
              <button type="button" className="cd-fechar" onClick={() => setEscolhendoTipo(false)} aria-label="Fechar">✕</button>
            </div>
            <div className="cd-tipos">
              {['DEPOSITO', 'CARTAO', 'PIX'].map((t) => (
                <button key={t} type="button" className="cd-tipo-botao"
                  style={{ background: TIPO_DEVOLUCAO_COR[t].fundo, color: TIPO_DEVOLUCAO_COR[t].texto }}
                  onClick={() => setTipoForm(t)}>
                  {TIPO_DEVOLUCAO_LABEL[t]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Formulário de devolução (por tipo) */}
      {tipoForm && (
        <div className="cd-overlay" role="dialog" aria-modal="true">
          <form className="cd-modal" onSubmit={cadastrarSolicitacao}>
            <div className="cd-modal-topo">
              <h2 style={{ fontSize: '1.15rem', margin: 0 }}>{TIPO_DEVOLUCAO_LABEL[tipoForm]}</h2>
              <button type="button" className="cd-fechar" onClick={() => { setTipoForm(null); setEscolhendoTipo(false); }} aria-label="Fechar">✕</button>
            </div>

            <label className="rotulo">Nome do pax (hóspede) *</label>
            <input className="campo" type="text" value={dev.nomePax}
              onChange={(e) => setDev('nomePax', e.target.value)} placeholder="Nome do hóspede" />

            <div className="cd-duas">
              <div>
                <label className="rotulo">Data de check-out</label>
                <input className="campo" type="date" value={dev.dataCheckout}
                  onChange={(e) => setDev('dataCheckout', e.target.value)} />
              </div>
              <div>
                <label className="rotulo">Fatura / reserva</label>
                <input className="campo" type="text" value={dev.faturaReserva}
                  onChange={(e) => setDev('faturaReserva', e.target.value)} placeholder="Numero da fatura ou reserva" />
              </div>
            </div>

            <label className="rotulo">Empresa / Particular</label>
            <input className="campo" type="text" value={dev.nomeEmpresa}
              onChange={(e) => setDev('nomeEmpresa', e.target.value)} placeholder="Particular, Nome da empresa…" />

            {tipoForm === 'DEPOSITO' && (
              <>
                <label className="rotulo">Qual a forma que foi feita o pagamento ao hotel?</label>
                <select className="campo" value={dev.formaPagamento}
                  onChange={(e) => setDev('formaPagamento', e.target.value)}>
                  {FORMAS_PAGAMENTO_HOTEL.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>

                <div className="cd-secao">Dados da conta para devolução</div>
                <label className="rotulo">Nome do banco *</label>
                <input className="campo" type="text" value={dev.nomeBanco}
                  onChange={(e) => setDev('nomeBanco', e.target.value)} placeholder="Nome do banco" />
                <div className="cd-duas">
                  <div>
                    <label className="rotulo">Conta corrente ou poupança?</label>
                    <select className="campo" value={dev.tipoConta}
                      onChange={(e) => setDev('tipoConta', e.target.value)}>
                      <option>Conta Corrente</option>
                      <option>Poupança</option>
                    </select>
                  </div>
                  <div>
                    <label className="rotulo">Agência</label>
                    <input className="campo" type="text" value={dev.agencia}
                      onChange={(e) => setDev('agencia', e.target.value)} placeholder="0000" />
                  </div>
                </div>
                <div className="cd-duas">
                  <div>
                    <label className="rotulo">Número da conta *</label>
                    <input className="campo" type="text" value={dev.numeroConta}
                      onChange={(e) => setDev('numeroConta', e.target.value)} placeholder="00000-0" />
                  </div>
                  <div>
                    <label className="rotulo">Nome do titular *</label>
                    <input className="campo" type="text" value={dev.nomeTitular}
                      onChange={(e) => setDev('nomeTitular', e.target.value)} placeholder="Titular da conta" />
                  </div>
                </div>
                <div className="cd-secao">Valor a ser devolvido</div>
                <label className="rotulo">Qual o valor que precisa ser devolvido? (R$) *</label>
                <input className="campo" type="number" min="0.01" step="0.01" value={dev.valorDevolver}
                  onChange={(e) => setDev('valorDevolver', e.target.value)} placeholder="0,00" />
              </>
            )}

            {tipoForm === 'CARTAO' && (
              <>
                <div className="cd-secao">Dados do cartão de crédito</div>
                <div className="cd-duas">
                  <div>
                    <label className="rotulo">Últimos 4 dígitos *</label>
                    <input className="campo" type="text" inputMode="numeric" maxLength={4} value={dev.ultimosDigitos}
                      onChange={(e) => setDev('ultimosDigitos', e.target.value)} placeholder="0000" />
                  </div>
                  <div>
                    <label className="rotulo">Data da venda no cartão</label>
                    <input className="campo" type="date" value={dev.dataVendaCartao}
                      onChange={(e) => setDev('dataVendaCartao', e.target.value)} />
                  </div>
                </div>
                <label className="rotulo">Valor passado no cartão (R$)</label>
                <input className="campo" type="number" min="0" step="0.01" value={dev.valorPassadoCartao}
                  onChange={(e) => setDev('valorPassadoCartao', e.target.value)} placeholder="0,00" />

                <div className="cd-secao">Valor a ser estornado</div>
                <label className="rotulo">Qual o valor que precisa ser estornado? (R$) *</label>
                <input className="campo" type="number" min="0.01" step="0.01" value={dev.valorEstornar}
                  onChange={(e) => setDev('valorEstornar', e.target.value)} placeholder="0,00" />
              </>
            )}

            {tipoForm === 'PIX' && (
              <>
                <div className="cd-secao">Dados da conta para devolução</div>
                <label className="rotulo">Qual é o nome do depositante? *</label>
                <input className="campo" type="text" value={dev.nomeDepositante}
                  onChange={(e) => setDev('nomeDepositante', e.target.value)} placeholder="Nome de quem fez o depósito original" />
                <div className="cd-duas">
                  <div>
                    <label className="rotulo">Data do depósito</label>
                    <input className="campo" type="date" value={dev.dataDeposito}
                      onChange={(e) => setDev('dataDeposito', e.target.value)} />
                  </div>
                  <div>
                    <label className="rotulo">Valor que foi depositado (R$)</label>
                    <input className="campo" type="number" min="0" step="0.01" value={dev.valorDepositado}
                      onChange={(e) => setDev('valorDepositado', e.target.value)} placeholder="0,00" />
                  </div>
                </div>
                <div className="cd-secao">Valor a ser devolvido</div>
                <label className="rotulo">Qual o valor que precisa ser devolvido? (R$) *</label>
                <input className="campo" type="number" min="0.01" step="0.01" value={dev.valorDevolver}
                  onChange={(e) => setDev('valorDevolver', e.target.value)} placeholder="0,00" />
              </>
            )}

            {erroModal && <div className="aviso-erro">{erroModal}</div>}

            <div className="cd-modal-botoes">
              <button type="submit" className="botao botao-principal" disabled={salvando}>
                {salvando ? 'Salvando…' : 'Cadastrar Solicitação'}
              </button>
              <button type="button" className="botao botao-suave"
                onClick={() => { setTipoForm(null); setEscolhendoTipo(true); }}>
                Voltar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Registrar utilização do crédito */}
      {modalEncerrar && (
        <div className="cd-overlay" role="dialog" aria-modal="true">
          <div className="cd-modal">
            <div className="cd-modal-topo">
              <h2 style={{ fontSize: '1.15rem', margin: 0 }}>Registrar utilização / devolução</h2>
              <button type="button" className="cd-fechar" onClick={() => setModalEncerrar(null)} aria-label="Fechar">✕</button>
            </div>
            <p className="texto-suave" style={{ fontSize: 14 }}>
              Crédito de <strong>{modalEncerrar.nome_pax}</strong> — {dinheiro(modalEncerrar.valor)}
            </p>

            <label className="rotulo">Como o crédito foi encerrado? *</label>
            <select className="campo" value={encForma} onChange={(e) => setEncForma(e.target.value)}>
              {Object.entries(FORMA_ENCERRAMENTO_LABEL).map(([chave, rotulo]) => (
                <option key={chave} value={chave}>{rotulo}</option>
              ))}
            </select>

            <label className="rotulo">Observações</label>
            <textarea className="campo" rows={3} value={encObs}
              onChange={(e) => setEncObs(e.target.value)} placeholder="Ex.: Abatido na reserva nº…" />

            <label className="rotulo">Link do comprovante (Google Drive) — opcional</label>
            <input className="campo" type="url" value={encLink}
              onChange={(e) => setEncLink(e.target.value)} placeholder="https://drive.google.com/…" />
            <p className="texto-suave" style={{ fontSize: 12, marginTop: 6 }}>
              Se o comprovante ainda não estiver no Drive, deixe vazio — dá para adicionar depois.
            </p>

            {erroModal && <div className="aviso-erro">{erroModal}</div>}

            <div className="cd-modal-botoes">
              <button type="button" className="botao botao-principal" onClick={confirmarEncerramento} disabled={salvando}>
                {salvando ? 'Salvando…' : 'Confirmar'}
              </button>
              <button type="button" className="botao botao-suave" onClick={() => setModalEncerrar(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Marcar devolução como processada */}
      {modalProcessar && (
        <div className="cd-overlay" role="dialog" aria-modal="true">
          <div className="cd-modal">
            <div className="cd-modal-topo">
              <h2 style={{ fontSize: '1.15rem', margin: 0 }}>Marcar como processada</h2>
              <button type="button" className="cd-fechar" onClick={() => setModalProcessar(null)} aria-label="Fechar">✕</button>
            </div>
            <p className="texto-suave" style={{ fontSize: 14 }}>
              {TIPO_DEVOLUCAO_LABEL[modalProcessar.tipo]} de <strong>{modalProcessar.nome_pax}</strong> —{' '}
              {dinheiro(modalProcessar.tipo === 'CARTAO' ? modalProcessar.valor_estornar : modalProcessar.valor_devolver)}
            </p>

            <label className="rotulo">Link do comprovante (Google Drive) — opcional</label>
            <input className="campo" type="url" value={procLink}
              onChange={(e) => setProcLink(e.target.value)} placeholder="https://drive.google.com/…" />
            <p className="texto-suave" style={{ fontSize: 12, marginTop: 6 }}>
              Se o comprovante ainda não estiver no Drive, deixe vazio — dá para adicionar depois.
            </p>

            {erroModal && <div className="aviso-erro">{erroModal}</div>}

            <div className="cd-modal-botoes">
              <button type="button" className="botao botao-principal" onClick={confirmarProcessada} disabled={salvando}>
                {salvando ? 'Salvando…' : 'Confirmar'}
              </button>
              <button type="button" className="botao botao-suave" onClick={() => setModalProcessar(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Adicionar/editar link do comprovante */}
      {modalLink && (
        <div className="cd-overlay" role="dialog" aria-modal="true">
          <div className="cd-modal">
            <div className="cd-modal-topo">
              <h2 style={{ fontSize: '1.15rem', margin: 0 }}>Link do comprovante</h2>
              <button type="button" className="cd-fechar" onClick={() => setModalLink(null)} aria-label="Fechar">✕</button>
            </div>
            <label className="rotulo">Link do comprovante (Google Drive)</label>
            <input className="campo" type="url" value={linkTemp}
              onChange={(e) => setLinkTemp(e.target.value)} placeholder="https://drive.google.com/…" autoFocus />

            {erroModal && <div className="aviso-erro">{erroModal}</div>}

            <div className="cd-modal-botoes">
              <button type="button" className="botao botao-principal" onClick={salvarLink} disabled={salvando}>
                {salvando ? 'Salvando…' : 'Salvar'}
              </button>
              <button type="button" className="botao botao-suave" onClick={() => setModalLink(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Ver histórico (ficha completa) */}
      {modalHistorico && (
        <div className="cd-overlay" role="dialog" aria-modal="true">
          <div className="cd-modal">
            <div className="cd-modal-topo">
              <h2 style={{ fontSize: '1.15rem', margin: 0 }}>Ficha completa</h2>
              <button type="button" className="cd-fechar" onClick={() => setModalHistorico(null)} aria-label="Fechar">✕</button>
            </div>

            {modalHistorico.tipo === 'CREDITO' ? (
              <div className="cd-ficha">
                <Linha rotulo="Pax" valor={modalHistorico.item.nome_pax} />
                <Linha rotulo="Valor" valor={dinheiro(modalHistorico.item.valor)} />
                <Linha rotulo="Empresa / particular" valor={modalHistorico.item.nome_empresa || 'Particular'} />
                <Linha rotulo="Fatura / reserva" valor={modalHistorico.item.fatura_reserva} />
                <Linha rotulo="Observações" valor={modalHistorico.item.observacoes} />
                <Linha rotulo="Status" valor={STATUS_CREDITO_LABEL[modalHistorico.item.status]} />
                <Linha rotulo="Cadastrado por" valor={`${nomeDe(modalHistorico.item.criado_por_id)} em ${formatarDataHora(modalHistorico.item.criado_em)}`} />
                {modalHistorico.item.status === 'UTILIZADO' && (
                  <>
                    <div className="cd-secao">Utilização / devolução</div>
                    <Linha rotulo="Forma" valor={FORMA_ENCERRAMENTO_LABEL[modalHistorico.item.forma_encerramento]} />
                    <Linha rotulo="Observações" valor={modalHistorico.item.observacoes_encerramento} />
                    <Linha rotulo="Encerrado por" valor={`${nomeDe(modalHistorico.item.encerrado_por_id)} em ${formatarDataHora(modalHistorico.item.encerrado_em)}`} />
                  </>
                )}
                {modalHistorico.item.link_comprovante && (
                  <a className="botao botao-contorno" style={{ marginTop: 12 }} href={modalHistorico.item.link_comprovante} target="_blank" rel="noopener noreferrer">
                    Abrir no Drive
                  </a>
                )}
              </div>
            ) : (
              <div className="cd-ficha">
                <Linha rotulo="Tipo" valor={TIPO_DEVOLUCAO_LABEL[modalHistorico.item.tipo]} />
                <Linha rotulo="Pax" valor={modalHistorico.item.nome_pax} />
                <Linha rotulo="Data de check-out" valor={formatarData(modalHistorico.item.data_checkout)} />
                <Linha rotulo="Fatura / reserva" valor={modalHistorico.item.fatura_reserva} />
                <Linha rotulo="Empresa / particular" valor={modalHistorico.item.nome_empresa || 'Particular'} />
                {modalHistorico.item.tipo === 'DEPOSITO' && (
                  <>
                    <Linha rotulo="Forma de pagamento ao hotel" valor={modalHistorico.item.forma_pagamento} />
                    <div className="cd-secao">Dados da conta para devolução</div>
                    <Linha rotulo="Banco" valor={modalHistorico.item.nome_banco} />
                    <Linha rotulo="Tipo de conta" valor={modalHistorico.item.tipo_conta} />
                    <Linha rotulo="Agência" valor={modalHistorico.item.agencia} />
                    <Linha rotulo="Conta" valor={modalHistorico.item.numero_conta} />
                    <Linha rotulo="Titular" valor={modalHistorico.item.nome_titular} />
                    <Linha rotulo="Valor a devolver" valor={dinheiro(modalHistorico.item.valor_devolver)} />
                  </>
                )}
                {modalHistorico.item.tipo === 'CARTAO' && (
                  <>
                    <div className="cd-secao">Dados do cartão de crédito</div>
                    <Linha rotulo="Últimos 4 dígitos" valor={modalHistorico.item.ultimos_digitos} />
                    <Linha rotulo="Valor passado no cartão" valor={modalHistorico.item.valor_passado_cartao ? dinheiro(modalHistorico.item.valor_passado_cartao) : '—'} />
                    <Linha rotulo="Data da venda" valor={formatarData(modalHistorico.item.data_venda_cartao)} />
                    <Linha rotulo="Valor a estornar" valor={dinheiro(modalHistorico.item.valor_estornar)} />
                  </>
                )}
                {modalHistorico.item.tipo === 'PIX' && (
                  <>
                    <div className="cd-secao">Dados da conta para devolução (Pix)</div>
                    <Linha rotulo="Nome do depositante" valor={modalHistorico.item.nome_depositante} />
                    <Linha rotulo="Data do depósito" valor={formatarData(modalHistorico.item.data_deposito)} />
                    <Linha rotulo="Valor depositado" valor={modalHistorico.item.valor_depositado ? dinheiro(modalHistorico.item.valor_depositado) : '—'} />
                    <Linha rotulo="Valor a devolver" valor={dinheiro(modalHistorico.item.valor_devolver)} />
                  </>
                )}
                <div className="cd-secao">Andamento</div>
                <Linha rotulo="Status" valor={STATUS_DEVOLUCAO_LABEL[modalHistorico.item.status]} />
                <Linha rotulo="Solicitado por" valor={`${nomeDe(modalHistorico.item.solicitado_por_id)} em ${formatarDataHora(modalHistorico.item.criado_em)}`} />
                {modalHistorico.item.status === 'PROCESSADA' && (
                  <Linha rotulo="Processado por" valor={`${nomeDe(modalHistorico.item.processado_por_id)} em ${formatarDataHora(modalHistorico.item.processado_em)}`} />
                )}
                {modalHistorico.item.link_comprovante && (
                  <a className="botao botao-contorno" style={{ marginTop: 12 }} href={modalHistorico.item.link_comprovante} target="_blank" rel="noopener noreferrer">
                    Abrir no Drive
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

// Linha de rótulo + valor usada na ficha completa
function Linha({ rotulo, valor }) {
  return (
    <div className="cd-linha">
      <span className="cd-linha-rotulo">{rotulo}</span>
      <span className="cd-linha-valor">{valor || '—'}</span>
    </div>
  );
}

// ---- Estilos específicos deste módulo ---------------------------------------

function EstilosCreditos() {
  return (
    <style>{`
      .cd-abas { display: flex; gap: 6px; overflow-x: auto; margin: 14px 0 16px; padding-bottom: 4px; }
      .cd-aba {
        border: 1px solid var(--borda); background: var(--branco); color: var(--tinta);
        border-radius: 999px; padding: 10px 16px; font-size: 14px; font-weight: 600;
        cursor: pointer; white-space: nowrap; min-height: 42px;
      }
      .cd-aba-ativa { background: var(--marca); border-color: var(--marca); color: var(--branco); }
      .cd-contador {
        display: inline-block; margin-left: 6px; font-size: 12px;
        background: rgba(0,0,0,0.10); border-radius: 999px; padding: 1px 8px;
      }
      .cd-aba-ativa .cd-contador { background: rgba(255,255,255,0.22); }

      .cd-barra { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }

      .cd-lista { display: flex; flex-direction: column; gap: 12px; }
      .cd-item { padding: 16px; }
      .cd-item-topo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .cd-item-topo strong { font-size: 16px; }
      .cd-tag {
        display: inline-block; font-size: 12px; font-weight: 700;
        border-radius: 999px; padding: 3px 10px;
      }
      .cd-valor {
        font-family: var(--fonte-titulo); font-weight: 700; font-size: 22px;
        color: var(--marca); margin: 6px 0 4px;
      }
      .cd-detalhes { display: flex; flex-wrap: wrap; gap: 4px 18px; font-size: 13px; color: var(--texto-suave); }
      .cd-encerrado {
        font-size: 13px; color: var(--tinta); background: var(--fundo);
        border-radius: 10px; padding: 8px 12px; margin-top: 10px;
      }
      .cd-acoes { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; align-items: center; }

      .cd-duas { display: grid; grid-template-columns: 1fr; gap: 0 14px; }
      .cd-secao {
        font-size: 11px; font-weight: 700; color: var(--texto-suave);
        text-transform: uppercase; letter-spacing: 0.06em; margin: 16px 0 2px;
        border-top: 1px solid var(--borda); padding-top: 12px;
      }

      .cd-overlay {
        position: fixed; inset: 0; background: rgba(15, 25, 22, 0.45);
        display: flex; align-items: flex-end; justify-content: center; z-index: 70;
      }
      .cd-modal {
        background: var(--branco); width: 100%; max-height: 92vh; overflow-y: auto;
        border-radius: 18px 18px 0 0; padding: 18px; margin: 0;
      }
      .cd-modal-topo { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 6px; }
      .cd-fechar {
        border: none; background: #E9ECE8; border-radius: 999px;
        width: 40px; height: 40px; font-size: 16px; cursor: pointer; flex-shrink: 0;
      }
      .cd-modal-botoes { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 18px; }

      .cd-tipos { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }
      .cd-tipo-botao {
        border: none; border-radius: 12px; padding: 16px; font-size: 15px;
        font-weight: 700; cursor: pointer; text-align: left; min-height: 54px;
      }
      .cd-tipo-botao:hover { filter: brightness(0.96); }

      .cd-ficha { margin-top: 8px; }
      .cd-linha { display: flex; justify-content: space-between; gap: 14px; padding: 7px 0; border-bottom: 1px dashed var(--borda); font-size: 14px; }
      .cd-linha-rotulo { color: var(--texto-suave); flex-shrink: 0; }
      .cd-linha-valor { text-align: right; font-weight: 600; overflow-wrap: anywhere; }

      .cd-log-item { padding: 12px 16px; }
      .cd-log-acao {
        font-size: 12px; font-weight: 700; color: var(--marca);
        background: var(--marca-clara); border-radius: 999px; padding: 2px 9px; margin-left: 6px;
      }
      .cd-log-detalhe { font-size: 14px; margin-top: 3px; }

      @media (min-width: 640px) {
        .cd-barra { flex-direction: row; align-items: center; }
        .cd-barra .campo { width: auto; }
        .cd-barra input.campo { flex: 2; min-width: 200px; }
        .cd-barra select.campo { flex: 1; min-width: 170px; }
        .cd-duas { grid-template-columns: 1fr 1fr; }
        .cd-overlay { align-items: center; padding: 24px; }
        .cd-modal { max-width: 620px; border-radius: 18px; padding: 24px; }
      }
    `}</style>
  );
}
