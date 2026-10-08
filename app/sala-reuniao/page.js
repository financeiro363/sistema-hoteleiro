'use client';

// ============================================================================
// SALA DE REUNIÃO (com contrato de locação)
// - Calendário semanal: linhas = salas, colunas = dias da semana, com
//   navegação "← Semana anterior / Próxima semana →"
// - Reserva com responsável, CPF/CNPJ (obrigatório e conferido de verdade),
//   valor da locação e motivo
// - Detecção de conflito de horário (vale também na edição)
// - CONTRATO DE LOCAÇÃO abre automaticamente a cada reserva, imprimível,
//   com LOCADOR (hotel) e LOCATÁRIO, cláusulas e assinaturas
// - PAGAMENTOS da locação (opcionais): pode pagar tudo de uma vez ou em
//   várias parcelas, em dias diferentes. Cada pagamento tem forma (Pix,
//   dinheiro, cartão de crédito/débito), recibo numerado com reimpressão,
//   e entra no Fechamento de Caixa do dia em que foi pago. Erro de
//   lançamento não se apaga: o ADMIN anula (fica registrado quem e por quê).
// - Busca de reservas; Salas gerenciadas pelo ADMIN; Log de auditoria
//   imutável (Criou/Editou/Cancelou Reserva, Lançou/Anulou Pagamento...)
// ============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { bloquearSeNaoPermitido } from '../../lib/restricaoAcesso';
import { formatarDocumento, validarDocumento, mensagemErroDocumento } from '../../lib/validarDocumento';

// ---- Constantes -------------------------------------------------------------

const CORES_SALAS = ['#0E5A4E', '#1D4E89', '#A34E00', '#5B3A8E', '#8A6100', '#A31212'];
const DIAS_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const FUSO_HOTEL = 'America/Fortaleza';

// Formas de pagamento aceitas (o código à esquerda é o que vai pro banco)
const FORMAS_PAGAMENTO = {
  PIX: 'Pix',
  DINHEIRO: 'Dinheiro',
  CARTAO_CREDITO: 'Cartão de crédito',
  CARTAO_DEBITO: 'Cartão de débito',
};
const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

// ---- Funções de apoio -------------------------------------------------------

function dinheiro(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(valor || 0));
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
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch (e) { return String(valor); }
}

function hora(valor) {
  return String(valor || '').slice(0, 5); // "09:00:00" -> "09:00"
}

// "Hoje" no horário de Fortaleza/Paraíba, igual ao do servidor e do banco
function hojeFortaleza() {
  return new Date().toLocaleDateString('en-CA', { timeZone: FUSO_HOTEL });
}

// 2026-10-08 -> "8 de outubro de 2026" (sem sofrer desvio de fuso)
function dataISOPorExtenso(iso) {
  const [ano, mes, dia] = String(iso || '').slice(0, 10).split('-').map(Number);
  if (!ano) return '';
  return `${dia} de ${MESES[mes - 1]} de ${ano}`;
}

function dataISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Segunda-feira da semana (com deslocamento em semanas)
function segundaDaSemana(deslocamento) {
  const hoje = new Date();
  const diaSemana = (hoje.getDay() + 6) % 7; // 0 = segunda
  const segunda = new Date(hoje);
  segunda.setDate(hoje.getDate() - diaSemana + deslocamento * 7);
  segunda.setHours(0, 0, 0, 0);
  return segunda;
}


// Valor por extenso (mesma função validada no módulo Recibos)
function valorPorExtenso(valor) {
  const unidades = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
  const dezA19 = ['dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const dezenas = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const centenas = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
  function ate999(n) {
    if (n === 0) return '';
    if (n === 100) return 'cem';
    const partes = [];
    const c = Math.floor(n / 100);
    const resto = n % 100;
    if (c > 0) partes.push(centenas[c]);
    if (resto > 0) {
      if (partes.length) partes.push('e');
      if (resto < 10) partes.push(unidades[resto]);
      else if (resto < 20) partes.push(dezA19[resto - 10]);
      else {
        const d = Math.floor(resto / 10);
        const u = resto % 10;
        partes.push(u > 0 ? `${dezenas[d]} e ${unidades[u]}` : dezenas[d]);
      }
    }
    return partes.join(' ');
  }
  function completo(n) {
    if (n === 0) return 'zero';
    const milhoes = Math.floor(n / 1000000);
    const milhares = Math.floor((n % 1000000) / 1000);
    const resto = n % 1000;
    const partes = [];
    if (milhoes > 0) partes.push(milhoes === 1 ? 'um milhão' : `${ate999(milhoes)} milhões`);
    if (milhares > 0) partes.push(milhares === 1 ? 'mil' : `${ate999(milhares)} mil`);
    if (resto > 0) partes.push(ate999(resto));
    return partes.join(' e ');
  }
  const numero = Math.floor(Math.abs(valor));
  const centavos = Math.round((Math.abs(valor) - numero) * 100);
  let resultado;
  if (numero === 0 && centavos > 0) resultado = '';
  else {
    const ehMilhaoRedondo = numero >= 1000000 && numero % 1000000 === 0;
    resultado = `${completo(numero)} ${ehMilhaoRedondo ? 'de ' : ''}${numero === 1 ? 'real' : 'reais'}`;
  }
  if (centavos > 0) resultado += `${resultado ? ' e ' : ''}${completo(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`;
  return resultado || 'zero reais';
}

const FORM_VAZIO = {
  editandoId: null, salaId: '', data: '', horaInicio: '09:00', horaFim: '10:00',
  responsavel: '', documento: '', valor: '', motivo: '',
  pagValor: '', pagForma: '', // pagamento já na reserva (opcional)
  telefone: '', temTelefoneSalvo: false,
  observacoes: '', temObservacaoSalva: false,
};

// Taxa cobrada por hora (ou fração) que passar do horário contratado — Cláusula Sexta, "a"
const TAXA_HORA_EXCEDENTE = 60;

// (83) 99629-9481 / (83) 3222-1234, formatado enquanto digita
function formatarTelefone(texto) {
  const d = String(texto || '').replace(/\D/g, '').slice(0, 11);
  if (d.length === 0) return '';
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

// 2026-10-08 -> "08 de outubro de 2026" (dia com dois dígitos, como no modelo do contrato)
function dataContrato(iso) {
  const [ano, mes, dia] = String(iso || '').slice(0, 10).split('-').map(Number);
  if (!ano) return '________________';
  return `${String(dia).padStart(2, '0')} de ${MESES[mes - 1]} de ${ano}`;
}

// Regras de letra/espaçamento do contrato impresso numa folha A4. Usadas na
// impressão de verdade E na medição que escolhe o tamanho da letra para o
// texto caber inteiro em uma única folha.
function regrasContratoA4(seletor) {
  return `
    ${seletor} {
      font-family: 'Times New Roman', Times, serif; color: #000; text-align: justify;
      font-size: var(--contrato-fs, 9pt); line-height: 1.3;
    }
    ${seletor} h3 { font-size: 1.25em; text-align: center; margin: 0 0 7pt; letter-spacing: 0.03em; }
    ${seletor} p { margin: 0 0 3.5pt; }
    ${seletor} .contrato-clausula { margin: 6pt 0 1.5pt; font-weight: 700; }
    ${seletor} .contrato-assinaturas { margin-top: 30pt; gap: 28pt; }
    ${seletor} .contrato-linha-ass { margin-bottom: 3pt; }
  `;
}

const PAG_FORM_VAZIO = { valor: '', forma: '', data: '', observacao: '' };

// Arredonda em 2 casas (evita 0,1 + 0,2 = 0,30000000000000004)
function centavos(valor) {
  return Math.round(Number(valor || 0) * 100) / 100;
}

// ---- Componente principal ---------------------------------------------------

export default function SalaReuniao() {
  const router = useRouter();

  const [verificandoLogin, setVerificandoLogin] = useState(true);
  const [usuario, setUsuario] = useState(null);
  const [nomesUsuarios, setNomesUsuarios] = useState({});
  const [hotel, setHotel] = useState(null);

  const [subAba, setSubAba] = useState('calendario'); // 'calendario' | 'salas' | 'log'
  const [salas, setSalas] = useState([]);
  const [reservas, setReservas] = useState([]);
  const [logs, setLogs] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);

  const [semanaOffset, setSemanaOffset] = useState(0);
  const [busca, setBusca] = useState('');

  // Formulário de reserva (novo ou edição)
  const [form, setForm] = useState(null); // null = fechado; objeto = aberto
  const [erroForm, setErroForm] = useState('');

  // Modais
  const [detalhe, setDetalhe] = useState(null);
  const [contrato, setContrato] = useState(null);
  const [confirmCancelar, setConfirmCancelar] = useState(false);

  // Pagamentos
  const [pagamentos, setPagamentos] = useState([]);
  const [pagamentosIndisponiveis, setPagamentosIndisponiveis] = useState('');
  const [pagForm, setPagForm] = useState(null); // null = fechado
  const [erroPag, setErroPag] = useState('');
  const [reciboAberto, setReciboAberto] = useState(null); // { pagamento, reimpressao }
  const [contratoDepois, setContratoDepois] = useState(null); // abre ao fechar o recibo
  const [anulando, setAnulando] = useState(null); // { id, motivo }

  // Gestão de salas (admin)
  const [novaSalaNome, setNovaSalaNome] = useState('');
  const [novaSalaCapacidade, setNovaSalaCapacidade] = useState('');
  const [capacidadesEditadas, setCapacidadesEditadas] = useState({}); // { idDaSala: 'texto' }
  const [excluindoSalaId, setExcluindoSalaId] = useState(null);

  // Endereço do hotel (admin preenche se faltar)
  const [enderecoNovo, setEnderecoNovo] = useState('');
  const [cidadeNova, setCidadeNova] = useState('');

  const souAdmin = usuario?.papel === 'ADMIN';
  const podeLancarPagamento = usuario?.papel === 'ADMIN' || usuario?.papel === 'COLABORADOR';

  function mostrarAviso(texto) {
    setAviso(texto);
    setTimeout(() => setAviso(''), 5000);
  }

  const nomeDe = useCallback(
    (id) => (id ? nomesUsuarios[id] || `Usuário #${id}` : '—'),
    [nomesUsuarios]
  );

  function corDaSala(salaId) {
    const indice = salas.findIndex((s) => s.id === salaId);
    return CORES_SALAS[(indice >= 0 ? indice : 0) % CORES_SALAS.length];
  }

  function nomeDaSala(salaId) {
    return salas.find((s) => s.id === salaId)?.nome || `Sala #${salaId}`;
  }

  // ---- Resumo financeiro de uma reserva (só conta pagamento NÃO anulado) ----
  function resumoPagamento(reserva) {
    const total = centavos(reserva?.valor_locacao);
    const lista = pagamentos.filter((p) => p.reserva_id === reserva?.id);
    const ativos = lista.filter((p) => !p.anulado_em);
    const pago = centavos(ativos.reduce((soma, p) => soma + Number(p.valor), 0));
    const saldo = centavos(total - pago);
    let status = 'SEM_PAGAMENTO';
    if (total <= 0) status = 'SEM_VALOR';
    else if (pago >= total) status = 'QUITADO';
    else if (pago > 0) status = 'PARCIAL';
    return { total, pago, saldo, status, lista };
  }

  const ROTULO_STATUS = {
    QUITADO: 'Pago', PARCIAL: 'Parcial', SEM_PAGAMENTO: 'A pagar', SEM_VALOR: '',
  };

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

    const { data: h } = await supabase.from('hoteis').select('*').eq('id', u.hotel_id).single();
    if (h) setHotel(h);

    let { data: listaSalas } = await supabase
      .from('salas_reuniao').select('*').order('criado_em', { ascending: true });
    // Se não existe nenhuma sala e quem entrou é ADMIN, cria a sala padrão
    if ((listaSalas || []).length === 0 && u.papel === 'ADMIN') {
      await supabase.from('salas_reuniao').insert({ nome: 'Sala de Reunião Principal', hotel_id: u.hotel_id });
      const nova = await supabase.from('salas_reuniao').select('*').order('criado_em', { ascending: true });
      listaSalas = nova.data;
    }
    setSalas(listaSalas || []);

    const { data: listaReservas, error: e1 } = await supabase
      .from('reservas_sala').select('*')
      .order('data', { ascending: true }).order('hora_inicio', { ascending: true });
    if (e1) setErro('Não foi possível carregar as reservas. Detalhe técnico: ' + e1.message);
    else setReservas(listaReservas || []);

    const { data: listaPagamentos, error: e2 } = await supabase
      .from('reservas_sala_pagamentos').select('*')
      .order('data_pagamento', { ascending: true }).order('id', { ascending: true });
    if (e2) {
      setPagamentos([]);
      setPagamentosIndisponiveis(
        /does not exist|schema cache|relation/i.test(e2.message)
          ? 'Os pagamentos da Sala de Reunião ainda não foram ativados no banco de dados (falta rodar o script SQL). As reservas funcionam normalmente.'
          : 'Não foi possível carregar os pagamentos. Detalhe técnico: ' + e2.message
      );
    } else {
      setPagamentos(listaPagamentos || []);
      setPagamentosIndisponiveis('');
    }

    if (u.papel === 'ADMIN') {
      const { data: ls } = await supabase
        .from('salas_reuniao_log').select('*')
        .order('data_hora', { ascending: false }).limit(300);
      setLogs(ls || []);
    }
    setCarregando(false);
  }, []);

  useEffect(() => {
    if (usuario) carregarTudo(usuario);
  }, [usuario, carregarTudo]);

  // Ao abrir/fechar o pop-up de uma reserva, limpa formulários de pagamento abertos
  useEffect(() => {
    setPagForm(null);
    setAnulando(null);
    setErroPag('');
  }, [detalhe]);

  async function registrarLog(acao, detalhe) {
    await supabase.from('salas_reuniao_log').insert({
      usuario_id: usuario.id, acao, detalhe, hotel_id: usuario.hotel_id,
    });
  }

  // ---- Endereço/cidade do hotel (admin) ----
  async function salvarDadosHotel() {
    if (salvando) return;
    const dados = {};
    if (enderecoNovo.trim()) dados.endereco = enderecoNovo.trim();
    if (cidadeNova.trim()) dados.cidade = cidadeNova.trim();
    if (Object.keys(dados).length === 0) return;
    setSalvando(true);
    const { error } = await supabase.from('hoteis').update(dados).eq('id', usuario.hotel_id);
    setSalvando(false);
    if (error) { setErro('Não foi possível salvar. Detalhe técnico: ' + error.message); return; }
    setHotel({ ...hotel, ...dados });
    setEnderecoNovo(''); setCidadeNova('');
    mostrarAviso('Dados do hotel salvos! Eles aparecem no contrato.');
  }

  // ---- Conflito de horário ----
  function verificarConflito(salaId, data, horaInicio, horaFim, ignorarId) {
    return reservas.find((r) =>
      r.id !== ignorarId &&
      r.sala_id === Number(salaId) &&
      String(r.data).slice(0, 10) === data &&
      horaInicio < hora(r.hora_fim) &&
      horaFim > hora(r.hora_inicio)
    );
  }

  // ---- Abrir formulário ----
  function novaReserva(salaId, data) {
    setErroForm('');
    setForm({
      ...FORM_VAZIO,
      salaId: salaId || (salas[0]?.id ?? ''),
      data: data || dataISO(new Date()),
    });
  }

  function editarReserva(r) {
    setErroForm('');
    setDetalhe(null);
    setForm({
      editandoId: r.id,
      salaId: r.sala_id,
      data: String(r.data).slice(0, 10),
      horaInicio: hora(r.hora_inicio),
      horaFim: hora(r.hora_fim),
      responsavel: r.responsavel || '',
      documento: r.documento_locatario || '',
      valor: r.valor_locacao || '',
      motivo: r.motivo || '',
      pagValor: '', pagForma: '',
      telefone: formatarTelefone(r.telefone_locatario || ''),
      temTelefoneSalvo: !!r.telefone_locatario,
      observacoes: r.observacoes || '',
      temObservacaoSalva: !!r.observacoes,
    });
  }

  // ---- Salvar reserva (novo ou edição) ----
  async function salvarReserva(evento) {
    evento.preventDefault();
    if (salvando || !form) return;
    setErroForm('');

    if (!form.salaId) { setErroForm('Escolha a sala.'); return; }
    if (!form.data) { setErroForm('Escolha a data.'); return; }
    if (!form.horaInicio || !form.horaFim || form.horaFim <= form.horaInicio) {
      setErroForm('O horário de término precisa ser depois do horário de início.');
      return;
    }
    if (!form.responsavel.trim()) { setErroForm('Informe o nome de quem vai usar a sala.'); return; }
    // CPF/CNPJ é obrigatório e precisa ser válido de verdade (dígitos verificadores)
    const mensagemDocumento = mensagemErroDocumento(form.documento);
    if (mensagemDocumento) { setErroForm(mensagemDocumento); return; }

    const valorLocacao = centavos(form.valor);
    if (form.editandoId) {
      const jaPago = resumoPagamento({ id: form.editandoId, valor_locacao: 0 }).pago;
      if (valorLocacao < jaPago) {
        setErroForm(`O valor da locação não pode ser menor do que o já pago (${dinheiro(jaPago)}).`);
        return;
      }
    }

    // Pagamento já na criação da reserva (opcional)
    const pagValor = centavos(form.pagValor);
    const querPagarAgora = !form.editandoId && (String(form.pagValor).trim() !== '' || form.pagForma);
    if (querPagarAgora) {
      if (!(pagValor > 0)) { setErroForm('Informe o valor do pagamento (ou deixe os dois campos de pagamento vazios).'); return; }
      if (!form.pagForma) { setErroForm('Escolha a forma de pagamento (Pix, dinheiro, cartão de crédito ou débito).'); return; }
      if (!(valorLocacao > 0)) { setErroForm('Para lançar um pagamento, informe antes o valor da locação.'); return; }
      if (pagValor > valorLocacao) { setErroForm(`O pagamento (${dinheiro(pagValor)}) não pode ser maior que o valor da locação (${dinheiro(valorLocacao)}).`); return; }
    }

    const conflito = verificarConflito(form.salaId, form.data, form.horaInicio, form.horaFim, form.editandoId);
    if (conflito) {
      setErroForm(
        `Já existe uma reserva nesse horário para esta sala: ${hora(conflito.hora_inicio)}–${hora(conflito.hora_fim)} (${conflito.responsavel}). Escolha outro horário.`
      );
      return;
    }

    const registro = {
      sala_id: Number(form.salaId),
      data: form.data,
      hora_inicio: form.horaInicio,
      hora_fim: form.horaFim,
      responsavel: form.responsavel.trim(),
      documento_locatario: form.documento.trim() || null,
      valor_locacao: valorLocacao,
      motivo: form.motivo.trim() || null,
      hotel_id: usuario.hotel_id,
    };
    // O telefone só vai junto quando foi preenchido (ou quando já existia e foi
    // apagado) — assim o cadastro de reservas continua funcionando mesmo que o
    // script SQL do telefone ainda não tenha sido rodado.
    if (form.telefone.trim() || form.temTelefoneSalvo) {
      registro.telefone_locatario = form.telefone.trim() || null;
    }
    // Observações: mesma regra (só vai junto se preenchida, ou se já existia e foi apagada)
    if (form.observacoes.trim() || form.temObservacaoSalva) {
      registro.observacoes = form.observacoes.trim() || null;
    }

    setSalvando(true);
    let salvo = null;
    let pagamentoNovo = null;
    if (form.editandoId) {
      const { data, error } = await supabase
        .from('reservas_sala').update(registro).eq('id', form.editandoId).select().single();
      if (error) { setSalvando(false); setErroForm('Não foi possível salvar. Detalhe técnico: ' + error.message); return; }
      salvo = data;
      await registrarLog('Editou Reserva',
        `${nomeDaSala(salvo.sala_id)} · ${formatarData(salvo.data)} ${hora(salvo.hora_inicio)}–${hora(salvo.hora_fim)} · Responsável: ${salvo.responsavel}.`);
      mostrarAviso('Reserva atualizada!');
    } else {
      const { data, error } = await supabase
        .from('reservas_sala').insert({ ...registro, criado_por_id: usuario.id }).select().single();
      if (error) { setSalvando(false); setErroForm('Não foi possível reservar. Detalhe técnico: ' + error.message); return; }
      salvo = data;
      await registrarLog('Criou Reserva',
        `${nomeDaSala(salvo.sala_id)} · ${formatarData(salvo.data)} ${hora(salvo.hora_inicio)}–${hora(salvo.hora_fim)} · Responsável: ${salvo.responsavel} · Valor: ${dinheiro(salvo.valor_locacao)}.`);
      mostrarAviso('Reserva criada! O contrato de locação foi aberto para impressão.');

      if (querPagarAgora) {
        const { data: pagNovo, error: erroPagNovo } = await supabase.rpc('lancar_pagamento_sala', {
          p_reserva_id: salvo.id, p_valor: pagValor, p_forma: form.pagForma,
          p_data: null, p_observacao: null,
        });
        if (erroPagNovo) {
          setErro(`A reserva foi criada, mas o pagamento NÃO foi lançado: ${erroPagNovo.message} Abra a reserva e lance o pagamento por lá.`);
        } else {
          pagamentoNovo = pagNovo;
          await registrarLog('Lançou Pagamento',
            `${nomeDaSala(salvo.sala_id)} · ${formatarData(salvo.data)} · ${salvo.responsavel} · ${dinheiro(pagNovo.valor)} em ${FORMAS_PAGAMENTO[pagNovo.forma_pagamento]} · Recibo ${pagNovo.numero_recibo}.`);
          mostrarAviso(`Reserva criada e pagamento lançado! Recibo ${pagNovo.numero_recibo} aberto para impressão.`);
        }
      }
    }
    setSalvando(false);
    setForm(null);
    await carregarTudo(usuario);
    if (!registro || !salvo) return;
    // Contrato obrigatório: abre automaticamente para reservas novas.
    // Se houve pagamento, o recibo aparece primeiro e o contrato logo depois.
    if (!form.editandoId) {
      if (pagamentoNovo) {
        setReciboAberto({ pagamento: pagamentoNovo, reimpressao: false });
        setContratoDepois(salvo);
      } else {
        setContrato(salvo);
      }
    }
  }

  // ---- Cancelar reserva ----
  async function cancelarReserva() {
    if (!detalhe || salvando) return;
    if (resumoPagamento(detalhe).pago > 0) {
      setConfirmCancelar(false);
      setErro('Esta reserva tem pagamento lançado e não pode ser cancelada. Peça ao administrador para anular o(s) pagamento(s) primeiro.');
      return;
    }
    setSalvando(true);
    const { error } = await supabase.from('reservas_sala').delete().eq('id', detalhe.id);
    setSalvando(false);
    if (error) { setErro('Não foi possível cancelar. Detalhe técnico: ' + error.message); return; }
    await registrarLog('Cancelou Reserva',
      `${nomeDaSala(detalhe.sala_id)} · ${formatarData(detalhe.data)} ${hora(detalhe.hora_inicio)}–${hora(detalhe.hora_fim)} · Responsável: ${detalhe.responsavel}.`);
    setDetalhe(null);
    setConfirmCancelar(false);
    mostrarAviso('Reserva cancelada.');
    carregarTudo(usuario);
  }

  // ---- Pagamentos ----
  function abrirLancarPagamento() {
    const { saldo } = resumoPagamento(detalhe);
    setErroPag('');
    setPagForm({ ...PAG_FORM_VAZIO, valor: saldo > 0 ? String(saldo.toFixed(2)) : '', data: hojeFortaleza() });
  }

  async function lancarPagamento(evento) {
    evento.preventDefault();
    if (salvando || !pagForm || !detalhe) return;
    setErroPag('');
    const resumo = resumoPagamento(detalhe);
    const valorPag = centavos(pagForm.valor);

    if (!(resumo.total > 0)) { setErroPag('Esta reserva está sem valor de locação. Edite a reserva e informe o valor antes.'); return; }
    if (!(valorPag > 0)) { setErroPag('Informe um valor de pagamento maior que zero.'); return; }
    if (!pagForm.forma) { setErroPag('Escolha a forma de pagamento.'); return; }
    if (valorPag > resumo.saldo) { setErroPag(`O valor (${dinheiro(valorPag)}) é maior que o saldo a pagar (${dinheiro(resumo.saldo)}).`); return; }
    if (pagForm.data > hojeFortaleza()) { setErroPag('A data do pagamento não pode ser no futuro.'); return; }

    setSalvando(true);
    const { data: pagNovo, error } = await supabase.rpc('lancar_pagamento_sala', {
      p_reserva_id: detalhe.id,
      p_valor: valorPag,
      p_forma: pagForm.forma,
      // Colaborador sempre lança com a data de hoje; só o ADMIN escolhe outra
      p_data: souAdmin ? pagForm.data : null,
      p_observacao: pagForm.observacao.trim() || null,
    });
    setSalvando(false);
    if (error) { setErroPag(error.message); return; }

    await registrarLog('Lançou Pagamento',
      `${nomeDaSala(detalhe.sala_id)} · ${formatarData(detalhe.data)} · ${detalhe.responsavel} · ${dinheiro(pagNovo.valor)} em ${FORMAS_PAGAMENTO[pagNovo.forma_pagamento]} · Recibo ${pagNovo.numero_recibo}.`);
    setPagForm(null);
    mostrarAviso(`Pagamento lançado! Recibo ${pagNovo.numero_recibo} aberto para impressão.`);
    await carregarTudo(usuario);
    setReciboAberto({ pagamento: pagNovo, reimpressao: false });
  }

  async function reimprimirRecibo(pagamento) {
    const { data: atualizado, error } = await supabase.rpc('registrar_reimpressao_pagamento_sala', {
      p_pagamento_id: pagamento.id,
    });
    if (error) { setErro('Não foi possível abrir a reimpressão. Detalhe técnico: ' + error.message); return; }
    setPagamentos(pagamentos.map((p) => (p.id === atualizado.id ? atualizado : p)));
    setReciboAberto({ pagamento: atualizado, reimpressao: true });
  }

  async function anularPagamento() {
    if (!anulando || salvando) return;
    if (anulando.motivo.trim().length < 3) { setErroPag('Informe o motivo da anulação.'); return; }
    setSalvando(true);
    const { data: anulado, error } = await supabase.rpc('anular_pagamento_sala', {
      p_pagamento_id: anulando.id, p_motivo: anulando.motivo.trim(),
    });
    setSalvando(false);
    if (error) { setErroPag(error.message); return; }
    await registrarLog('Anulou Pagamento',
      `Recibo ${anulado.numero_recibo} · ${dinheiro(anulado.valor)} em ${FORMAS_PAGAMENTO[anulado.forma_pagamento]} · ${anulado.pagador_nome} · Motivo: ${anulado.motivo_anulacao}.`);
    setAnulando(null);
    setErroPag('');
    mostrarAviso(`Pagamento ${anulado.numero_recibo} anulado.`);
    carregarTudo(usuario);
  }

  // Imprime o contrato em UMA folha A4: mede o texto na largura útil da folha e
  // diminui a letra, se preciso, até caber inteiro (nunca passa de 9,5 pt).
  function imprimirContrato() {
    const folha = document.querySelector('.contrato-folha');
    if (!folha) { window.print(); return; }
    const clone = folha.cloneNode(true);
    clone.classList.add('contrato-medida');
    document.body.appendChild(clone);
    const alturaUtilPx = (277 / 25.4) * 96; // A4 (297 mm) menos 10 mm de margem em cima e embaixo
    let tamanho = 9.5;
    while (tamanho > 6.5) {
      clone.style.fontSize = `${tamanho}pt`;
      if (clone.scrollHeight <= alturaUtilPx * 0.97) break;
      tamanho -= 0.1;
    }
    document.body.removeChild(clone);
    folha.style.setProperty('--contrato-fs', `${tamanho.toFixed(1)}pt`);
    window.print();
  }

  function fecharRecibo() {
    setReciboAberto(null);
    if (contratoDepois) {
      setContrato(contratoDepois);
      setContratoDepois(null);
    }
  }

  // ---- Salas (admin) ----
  async function cadastrarSala() {
    if (!novaSalaNome.trim() || salvando) return;
    setSalvando(true);
    const novaSala = { nome: novaSalaNome.trim(), hotel_id: usuario.hotel_id };
    if (Number(novaSalaCapacidade) > 0) novaSala.capacidade_pessoas = Math.floor(Number(novaSalaCapacidade));
    const { error } = await supabase.from('salas_reuniao').insert(novaSala);
    setSalvando(false);
    if (error) { setErro('Não foi possível cadastrar a sala. Detalhe técnico: ' + error.message); return; }
    await registrarLog('Cadastrou Sala', `Sala "${novaSalaNome.trim()}".`);
    setNovaSalaNome('');
    setNovaSalaCapacidade('');
    mostrarAviso('Sala cadastrada!');
    carregarTudo(usuario);
  }

  // Capacidade máxima de pessoas da sala (vai escrita no contrato)
  async function salvarCapacidade(sala) {
    const texto = capacidadesEditadas[sala.id];
    const capacidade = Math.floor(Number(texto));
    if (!(capacidade > 0)) { setErro('Informe uma capacidade maior que zero.'); return; }
    setSalvando(true);
    const { error } = await supabase
      .from('salas_reuniao').update({ capacidade_pessoas: capacidade }).eq('id', sala.id);
    setSalvando(false);
    if (error) {
      setErro(
        /capacidade_pessoas|schema cache|column/i.test(error.message)
          ? 'A capacidade ainda não foi ativada no banco de dados (falta rodar o script SQL do contrato).'
          : 'Não foi possível salvar a capacidade. Detalhe técnico: ' + error.message
      );
      return;
    }
    await registrarLog('Editou Sala', `Sala "${sala.nome}" · capacidade ${capacidade} pessoas.`);
    setCapacidadesEditadas((atual) => { const novo = { ...atual }; delete novo[sala.id]; return novo; });
    mostrarAviso('Capacidade salva! Ela aparece no contrato.');
    carregarTudo(usuario);
  }

  async function excluirSala(sala) {
    setExcluindoSalaId(null);
    const { error } = await supabase.from('salas_reuniao').delete().eq('id', sala.id);
    if (error) {
      setErro(
        /foreign key|violates/i.test(error.message)
          ? `A sala "${sala.nome}" tem reservas registradas — cancele as reservas dela antes de excluir.`
          : 'Não foi possível excluir. Detalhe técnico: ' + error.message
      );
      return;
    }
    await registrarLog('Excluiu Sala', `Sala "${sala.nome}".`);
    mostrarAviso('Sala excluída.');
    carregarTudo(usuario);
  }

  // ---- Semana e busca ----
  const segunda = segundaDaSemana(semanaOffset);
  const diasDaSemana = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(segunda);
    d.setDate(segunda.getDate() + i);
    return d;
  });
  const hojeISO = dataISO(new Date());

  const termo = busca.trim().toLowerCase();
  const resultadosBusca = termo
    ? reservas.filter((r) =>
        (r.responsavel || '').toLowerCase().includes(termo) ||
        (r.motivo || '').toLowerCase().includes(termo) ||
        (r.observacoes || '').toLowerCase().includes(termo) ||
        nomeDaSala(r.sala_id).toLowerCase().includes(termo) ||
        formatarData(r.data).includes(termo)
      )
    : [];

  if (verificandoLogin) {
    return (
      <main className="conteudo">
        <p className="texto-suave">Verificando seu acesso…</p>
      </main>
    );
  }

  const faltaEndereco = hotel && (!hotel.endereco || !hotel.cidade);

  return (
    <main className="conteudo">
      <EstilosSala />

      <span className="olho">Eventos e locações</span>
      <div className="barra-pagina">
        <h1 style={{ margin: 0 }}>Sala de Reunião</h1>
        {subAba === 'calendario' && salas.length > 0 && (
          <button type="button" className="botao botao-principal" onClick={() => novaReserva()}>
            + Nova Reserva
          </button>
        )}
      </div>

      {aviso && <div className="aviso-sucesso">{aviso}</div>}
      {erro && <div className="aviso-erro">{erro}</div>}
      {pagamentosIndisponiveis && <div className="aviso-erro">{pagamentosIndisponiveis}</div>}

      {/* Dados do hotel faltando (aparecem no contrato) */}
      {faltaEndereco && (
        <div className="aviso-erro">
          O contrato de locação usa o <strong>endereço e a cidade do hotel</strong>
          {!hotel.endereco && !hotel.cidade ? ', que ainda não estão cadastrados.' :
            !hotel.endereco ? ' — o endereço ainda não está cadastrado.' : ' — a cidade ainda não está cadastrada.'}{' '}
          {souAdmin ? (
            <span className="sr-hotel-form">
              {!hotel.endereco && (
                <input className="campo" type="text" value={enderecoNovo}
                  onChange={(e) => setEnderecoNovo(e.target.value)}
                  placeholder="Endereço (ex.: Av. Beira Mar, 100, Centro)" />
              )}
              {!hotel.cidade && (
                <input className="campo" type="text" value={cidadeNova}
                  onChange={(e) => setCidadeNova(e.target.value)}
                  placeholder="Cidade (ex.: João Pessoa - PB)" />
              )}
              <button type="button" className="botao botao-principal" onClick={salvarDadosHotel} disabled={salvando}>
                Salvar
              </button>
            </span>
          ) : 'Peça ao administrador para preencher.'}
        </div>
      )}

      {/* Sub-abas */}
      <nav className="sr-abas" aria-label="Seções">
        <button type="button" className={subAba === 'calendario' ? 'sr-aba sr-aba-ativa' : 'sr-aba'}
          onClick={() => setSubAba('calendario')}>
          Calendário
        </button>
        {souAdmin && (
          <button type="button" className={subAba === 'salas' ? 'sr-aba sr-aba-ativa' : 'sr-aba'}
            onClick={() => setSubAba('salas')}>
            Salas
          </button>
        )}
        {souAdmin && (
          <button type="button" className={subAba === 'log' ? 'sr-aba sr-aba-ativa' : 'sr-aba'}
            onClick={() => setSubAba('log')}>
            Log de Auditoria
          </button>
        )}
      </nav>

      {/* ================= CALENDÁRIO ================= */}
      {subAba === 'calendario' && (
        <section>
          {/* Busca de reservas */}
          <input className="campo" type="search" value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Pesquisar reserva (responsável, motivo, observação, sala ou data)…"
            aria-label="Pesquisar reservas" style={{ marginBottom: 12 }} />

          {termo && (
            <div className="cartao" style={{ marginBottom: 14 }}>
              <strong style={{ fontSize: 14 }}>
                {resultadosBusca.length} reserva(s) encontrada(s)
              </strong>
              <div className="sr-busca-lista">
                {resultadosBusca.map((r) => (
                  <button key={r.id} type="button" className="sr-busca-item"
                    onClick={() => { setDetalhe(r); setConfirmCancelar(false); }}>
                    <span className="sr-bolinha" style={{ background: corDaSala(r.sala_id) }} />
                    {formatarData(r.data)} · {hora(r.hora_inicio)}–{hora(r.hora_fim)} · {nomeDaSala(r.sala_id)} · <strong>{r.responsavel}</strong>
                    {r.motivo ? ` · ${r.motivo}` : ''}
                    {ROTULO_STATUS[resumoPagamento(r).status] && (
                      <span className={`sr-status sr-status-${resumoPagamento(r).status}`}>{ROTULO_STATUS[resumoPagamento(r).status]}</span>
                    )}
                  </button>
                ))}
                {resultadosBusca.length === 0 && (
                  <p className="texto-suave" style={{ fontSize: 13, margin: 0 }}>Nada encontrado com essa busca.</p>
                )}
              </div>
            </div>
          )}

          {salas.length === 0 ? (
            <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
              {souAdmin
                ? 'Nenhuma sala cadastrada. Recarregue a página ou cadastre uma na aba "Salas".'
                : 'Nenhuma sala cadastrada ainda — peça ao administrador para cadastrar.'}
            </div>
          ) : (
            <>
              {/* Navegação de semana */}
              <div className="sr-semana-nav">
                <button type="button" className="botao botao-suave" onClick={() => setSemanaOffset(semanaOffset - 1)}>
                  ← Semana anterior
                </button>
                <strong style={{ fontSize: 14 }}>
                  {formatarData(dataISO(diasDaSemana[0]))} a {formatarData(dataISO(diasDaSemana[6]))}
                </strong>
                <button type="button" className="botao botao-suave" onClick={() => setSemanaOffset(semanaOffset + 1)}>
                  Próxima semana →
                </button>
              </div>

              {/* Grade semanal */}
              <div className="sr-grade-envelope">
                <div className="sr-grade" style={{ gridTemplateColumns: `130px repeat(7, minmax(96px, 1fr))` }}>
                  <div className="sr-celula sr-cabecalho-celula"></div>
                  {diasDaSemana.map((d, i) => (
                    <div key={i} className={`sr-celula sr-cabecalho-celula ${dataISO(d) === hojeISO ? 'sr-hoje' : ''}`}>
                      <div>{DIAS_SEMANA[i]}</div>
                      <div style={{ fontSize: 12, fontWeight: 400 }}>{formatarData(dataISO(d)).slice(0, 5)}</div>
                    </div>
                  ))}

                  {salas.map((sala) => (
                    <FragmentoLinhaSala
                      key={sala.id}
                      sala={sala}
                      cor={corDaSala(sala.id)}
                      dias={diasDaSemana}
                      hojeISO={hojeISO}
                      reservas={reservas}
                      statusDe={(r) => ROTULO_STATUS[resumoPagamento(r).status]}
                      aoClicarReserva={(r) => { setDetalhe(r); setConfirmCancelar(false); }}
                      aoCriar={(dataDia) => novaReserva(sala.id, dataDia)}
                    />
                  ))}
                </div>
              </div>

              {/* Legenda */}
              <div className="sr-legenda">
                <span className="sr-legenda-item" style={{ color: 'var(--texto-suave)' }}>
                  Situação do pagamento em cada reserva: Pago · Parcial · A pagar
                </span>
                {salas.map((s) => (
                  <span key={s.id} className="sr-legenda-item">
                    <span className="sr-bolinha" style={{ background: corDaSala(s.id) }} /> {s.nome}
                  </span>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {/* ================= SALAS (admin) ================= */}
      {subAba === 'salas' && souAdmin && (
        <section>
          <div className="cartao" style={{ marginBottom: 14 }}>
            <label className="rotulo" style={{ marginTop: 0 }}>Nova sala</label>
            <div className="sr-nova-sala">
              <input className="campo" type="text" value={novaSalaNome}
                onChange={(e) => setNovaSalaNome(e.target.value)} placeholder="Sala de Reunião Térrea" />
              <input className="campo sr-capacidade" type="number" min="1" step="1" value={novaSalaCapacidade}
                onChange={(e) => setNovaSalaCapacidade(e.target.value)} placeholder="Capacidade (pessoas)"
                aria-label="Capacidade máxima de pessoas" />
              <button type="button" className="botao botao-principal" onClick={cadastrarSala} disabled={salvando}>
                Salvar
              </button>
            </div>
          </div>

          <div className="sr-lista">
            {salas.map((s) => (
              <div key={s.id} className="cartao sr-sala-item">
                <span className="sr-bolinha" style={{ background: corDaSala(s.id), width: 16, height: 16 }} />
                <strong style={{ flex: 1 }}>{s.nome}</strong>
                <span className="texto-suave" style={{ fontSize: 13 }}>
                  {reservas.filter((r) => r.sala_id === s.id).length} reserva(s)
                </span>
                <span className="sr-capacidade-item">
                  <input className="campo sr-capacidade" type="number" min="1" step="1"
                    value={capacidadesEditadas[s.id] ?? s.capacidade_pessoas ?? ''}
                    onChange={(e) => setCapacidadesEditadas({ ...capacidadesEditadas, [s.id]: e.target.value })}
                    placeholder="Capacidade" aria-label={`Capacidade máxima de pessoas — ${s.nome}`} />
                  <span className="texto-suave" style={{ fontSize: 12 }}>pessoas</span>
                  {capacidadesEditadas[s.id] !== undefined && (
                    <button type="button" className="botao botao-suave" onClick={() => salvarCapacidade(s)} disabled={salvando}>
                      Salvar
                    </button>
                  )}
                </span>
                {excluindoSalaId === s.id ? (
                  <span className="sr-confirmar">
                    Excluir mesmo?
                    <button type="button" className="botao botao-perigo" onClick={() => excluirSala(s)}>Sim</button>
                    <button type="button" className="botao botao-suave" onClick={() => setExcluindoSalaId(null)}>Não</button>
                  </span>
                ) : (
                  <button type="button" className="botao botao-suave" onClick={() => setExcluindoSalaId(s.id)}>
                    Excluir
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ================= LOG (admin) ================= */}
      {subAba === 'log' && souAdmin && (
        <section className="sr-lista">
          {logs.length === 0 ? (
            <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
              Nenhum registro no log ainda.
            </div>
          ) : (
            logs.map((l) => (
              <div key={l.id} className="cartao" style={{ padding: '12px 16px' }}>
                <div>
                  <strong>{nomeDe(l.usuario_id)}</strong>{' '}
                  <span className="sr-log-acao">{l.acao}</span>
                </div>
                {l.detalhe && <div style={{ fontSize: 14, marginTop: 3 }}>{l.detalhe}</div>}
                <div className="texto-suave" style={{ fontSize: 12 }}>{formatarDataHora(l.data_hora)}</div>
              </div>
            ))
          )}
        </section>
      )}

      {/* ================= FORMULÁRIO DE RESERVA ================= */}
      {form && (
        <div className="sr-overlay" role="dialog" aria-modal="true">
          <form className="sr-modal" onSubmit={salvarReserva}>
            <div className="sr-modal-topo">
              <h2 style={{ fontSize: '1.15rem', margin: 0 }}>
                {form.editandoId ? 'Editar reserva' : 'Nova reserva'}
              </h2>
              <button type="button" className="sr-fechar" onClick={() => setForm(null)} aria-label="Fechar">✕</button>
            </div>

            <label className="rotulo">Sala *</label>
            <select className="campo" value={form.salaId}
              onChange={(e) => setForm({ ...form, salaId: e.target.value })}>
              {salas.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>

            <div className="sr-tres">
              <div>
                <label className="rotulo">Data *</label>
                <input className="campo" type="date" value={form.data}
                  onChange={(e) => setForm({ ...form, data: e.target.value })} />
              </div>
              <div>
                <label className="rotulo">Início *</label>
                <input className="campo" type="time" value={form.horaInicio}
                  onChange={(e) => setForm({ ...form, horaInicio: e.target.value })} />
              </div>
              <div>
                <label className="rotulo">Término *</label>
                <input className="campo" type="time" value={form.horaFim}
                  onChange={(e) => setForm({ ...form, horaFim: e.target.value })} />
              </div>
            </div>

            <label className="rotulo">Responsável (locatário) *</label>
            <input className="campo" type="text" value={form.responsavel}
              onChange={(e) => setForm({ ...form, responsavel: e.target.value })}
              placeholder="Nome de quem vai usar a sala" />

            <div className="sr-duas">
              <div>
                <label className="rotulo">CPF ou CNPJ *</label>
                <input className="campo" type="text" inputMode="text" autoCapitalize="characters"
                  autoComplete="off" maxLength={18} value={form.documento}
                  onChange={(e) => setForm({ ...form, documento: formatarDocumento(e.target.value) })}
                  placeholder="000.000.000-00" aria-required="true" />
                {(() => {
                  if (!form.documento.trim()) return <p className="sr-doc-dica">Obrigatório — vai no contrato e no recibo.</p>;
                  const status = validarDocumento(form.documento);
                  if (status === true) return <p className="sr-doc-ok">✓ documento válido</p>;
                  if (status === false) return <p className="sr-doc-erro">✗ documento inválido — confira os números</p>;
                  return <p className="sr-doc-dica">Continue digitando…</p>;
                })()}
              </div>
              <div>
                <label className="rotulo">Valor da locação (R$)</label>
                <input className="campo" type="number" min="0" step="0.01" value={form.valor}
                  onChange={(e) => setForm({ ...form, valor: e.target.value })} placeholder="0,00" />
              </div>
            </div>

            <label className="rotulo">Motivo</label>
            <input className="campo" type="text" value={form.motivo}
              onChange={(e) => setForm({ ...form, motivo: e.target.value })}
              placeholder="Ex: Reunião comercial" />

            <label className="rotulo">Telefone / WhatsApp de contato (opcional)</label>
            <input className="campo" type="tel" inputMode="tel" autoComplete="off" value={form.telefone}
              onChange={(e) => setForm({ ...form, telefone: formatarTelefone(e.target.value) })}
              placeholder="(83) 99999-9999" />
            <p className="sr-doc-dica">Aparece no contrato, junto com o motivo do evento.</p>

            <label className="rotulo">Observações (opcional)</label>
            <textarea className="campo" rows={3} maxLength={1000} value={form.observacoes}
              onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              placeholder="Ex.: precisa de projetor, café às 15h, montagem em formato de auditório…"
              style={{ resize: 'vertical', minHeight: 72, fontFamily: 'inherit' }} />
            <p className="sr-doc-dica">Anotação interna da equipe — não vai no contrato nem no recibo.</p>

            {/* Pagamento: opcional na criação; depois, pela própria reserva */}
            {!form.editandoId && podeLancarPagamento && !pagamentosIndisponiveis && (
              <div className="sr-pag-novo">
                <strong>Pagamento (opcional)</strong>
                <p className="texto-suave" style={{ fontSize: 12.5, margin: '2px 0 8px' }}>
                  Se o cliente já vai pagar agora, informe aqui — o recibo sai na hora. Pode pagar tudo ou só uma parte;
                  o restante é lançado depois, abrindo a reserva no calendário.
                </p>
                <div className="sr-duas">
                  <div>
                    <label className="rotulo" style={{ marginTop: 0 }}>Valor pago agora (R$)</label>
                    <input className="campo" type="number" min="0" step="0.01" value={form.pagValor}
                      onChange={(e) => setForm({ ...form, pagValor: e.target.value })} placeholder="0,00" />
                  </div>
                  <div>
                    <label className="rotulo" style={{ marginTop: 0 }}>Forma de pagamento</label>
                    <select className="campo" value={form.pagForma}
                      onChange={(e) => setForm({ ...form, pagForma: e.target.value })}>
                      <option value="">— escolha —</option>
                      {Object.entries(FORMAS_PAGAMENTO).map(([codigo, nome]) => (
                        <option key={codigo} value={codigo}>{nome}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}
            {form.editandoId && (() => {
              const r = resumoPagamento({ id: form.editandoId, valor_locacao: 0 });
              return r.pago > 0 ? (
                <p className="sr-doc-dica" style={{ marginTop: 10 }}>
                  Já foram pagos {dinheiro(r.pago)} desta locação — o valor não pode ficar abaixo disso.
                  Para lançar outro pagamento, feche esta tela e use “Lançar pagamento” na reserva.
                </p>
              ) : null;
            })()}

            {erroForm && <div className="aviso-erro">{erroForm}</div>}

            <div className="sr-modal-botoes">
              <button type="submit" className="botao botao-principal" disabled={salvando}>
                {salvando ? 'Salvando…' : form.editandoId ? 'Salvar alterações' : 'Reservar'}
              </button>
              <button type="button" className="botao botao-suave" onClick={() => setForm(null)}>Cancelar</button>
            </div>
          </form>
        </div>
      )}

      {/* ================= DETALHES DA RESERVA ================= */}
      {detalhe && (
        <div className="sr-overlay" role="dialog" aria-modal="true">
          <div className="sr-modal">
            <div className="sr-modal-topo">
              <h2 style={{ fontSize: '1.15rem', margin: 0 }}>
                <span className="sr-bolinha" style={{ background: corDaSala(detalhe.sala_id) }} /> Reserva — {nomeDaSala(detalhe.sala_id)}
              </h2>
              <button type="button" className="sr-fechar" onClick={() => setDetalhe(null)} aria-label="Fechar">✕</button>
            </div>

            <div className="sr-ficha">
              <Linha rotulo="Data" valor={formatarData(detalhe.data)} />
              <Linha rotulo="Horário" valor={`${hora(detalhe.hora_inicio)} às ${hora(detalhe.hora_fim)}`} />
              <Linha rotulo="Responsável" valor={detalhe.responsavel} />
              <Linha rotulo="CPF/CNPJ" valor={detalhe.documento_locatario} />
              <Linha rotulo="Valor da locação" valor={dinheiro(detalhe.valor_locacao)} />
              <Linha rotulo="Motivo" valor={detalhe.motivo} />
              <Linha rotulo="Telefone" valor={detalhe.telefone_locatario} />
              <Linha rotulo="Observações"
                valor={detalhe.observacoes ? <span style={{ whiteSpace: 'pre-wrap', fontWeight: 400 }}>{detalhe.observacoes}</span> : null} />
              <Linha rotulo="Reservado por" valor={`${nomeDe(detalhe.criado_por_id)} em ${formatarDataHora(detalhe.criado_em)}`} />
            </div>

            {/* ---------- PAGAMENTOS ---------- */}
            {(() => {
              const r = resumoPagamento(detalhe);
              return (
                <div className="sr-pag-bloco">
                  <div className="sr-pag-topo">
                    <strong style={{ fontSize: 15 }}>Pagamentos</strong>
                    {ROTULO_STATUS[r.status] && (
                      <span className={`sr-status sr-status-${r.status}`}>
                        {r.status === 'QUITADO' ? 'Locação paga' : r.status === 'PARCIAL' ? 'Pago em parte' : 'Nada pago ainda'}
                      </span>
                    )}
                  </div>

                  <div className="sr-pag-resumo">
                    <div><span>Valor da locação</span><strong>{dinheiro(r.total)}</strong></div>
                    <div><span>Já pago</span><strong>{dinheiro(r.pago)}</strong></div>
                    <div><span>Falta pagar</span><strong style={{ color: r.saldo > 0 ? 'var(--erro-texto)' : 'var(--sucesso-texto)' }}>{dinheiro(r.saldo)}</strong></div>
                  </div>

                  {pagamentosIndisponiveis ? (
                    <p className="texto-suave" style={{ fontSize: 13 }}>Pagamentos indisponíveis (veja o aviso no topo da página).</p>
                  ) : r.lista.length === 0 ? (
                    <p className="texto-suave" style={{ fontSize: 13, margin: '8px 0' }}>
                      Nenhum pagamento lançado para esta reserva.
                    </p>
                  ) : (
                    <div className="sr-pag-lista">
                      {r.lista.map((p) => (
                        <div key={p.id} className={`sr-pag-item ${p.anulado_em ? 'sr-pag-anulado' : ''}`}>
                          <div className="sr-pag-item-topo">
                            <span>
                              <strong>{dinheiro(p.valor)}</strong> · {FORMAS_PAGAMENTO[p.forma_pagamento] || p.forma_pagamento}
                            </span>
                            <span className="sr-pag-recibo">{p.numero_recibo}</span>
                          </div>
                          <div className="texto-suave" style={{ fontSize: 12.5 }}>
                            Pago em {formatarData(p.data_pagamento)} · lançado por {nomeDe(p.criado_por_id)} em {formatarDataHora(p.criado_em)}
                            {p.observacao ? ` · ${p.observacao}` : ''}
                          </div>
                          {p.reimpressoes > 0 && (
                            <div className="texto-suave" style={{ fontSize: 12 }}>
                              Recibo reimpresso {p.reimpressoes}x · última por {nomeDe(p.reimpresso_por_id)} em {formatarDataHora(p.reimpresso_em)}
                            </div>
                          )}
                          {p.anulado_em && (
                            <div className="sr-pag-anulado-aviso">
                              ANULADO em {formatarDataHora(p.anulado_em)} por {nomeDe(p.anulado_por_id)} — {p.motivo_anulacao}
                            </div>
                          )}
                          <div className="sr-pag-acoes">
                            <button type="button" className="botao botao-suave" onClick={() => reimprimirRecibo(p)}>
                              🖨️ Reimprimir recibo
                            </button>
                            {souAdmin && !p.anulado_em && anulando?.id !== p.id && (
                              <button type="button" className="botao botao-suave"
                                onClick={() => { setErroPag(''); setAnulando({ id: p.id, motivo: '' }); }}>
                                Anular pagamento
                              </button>
                            )}
                          </div>
                          {anulando?.id === p.id && (
                            <div className="sr-pag-anular-form">
                              <label className="rotulo" style={{ marginTop: 0 }}>Motivo da anulação *</label>
                              <input className="campo" type="text" value={anulando.motivo}
                                onChange={(e) => setAnulando({ ...anulando, motivo: e.target.value })}
                                placeholder="Ex.: valor digitado errado" />
                              <div className="sr-modal-botoes" style={{ marginTop: 8 }}>
                                <button type="button" className="botao botao-perigo" onClick={anularPagamento} disabled={salvando}>
                                  {salvando ? 'Anulando…' : 'Confirmar anulação'}
                                </button>
                                <button type="button" className="botao botao-suave" onClick={() => { setAnulando(null); setErroPag(''); }}>
                                  Voltar
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {erroPag && !pagForm && <div className="aviso-erro" style={{ marginTop: 8 }}>{erroPag}</div>}

                  {/* Lançar novo pagamento */}
                  {podeLancarPagamento && !pagamentosIndisponiveis && !pagForm && r.status !== 'QUITADO' && (
                    r.total > 0 ? (
                      <button type="button" className="botao botao-principal" style={{ marginTop: 10 }} onClick={abrirLancarPagamento}>
                        + Lançar pagamento
                      </button>
                    ) : (
                      <p className="texto-suave" style={{ fontSize: 13, marginTop: 8 }}>
                        Para lançar pagamento, edite a reserva e informe o valor da locação.
                      </p>
                    )
                  )}

                  {pagForm && (
                    <form className="sr-pag-form" onSubmit={lancarPagamento}>
                      <strong style={{ fontSize: 14 }}>Novo pagamento</strong>
                      <div className="sr-duas">
                        <div>
                          <label className="rotulo">Valor (R$) *</label>
                          <input className="campo" type="number" min="0" step="0.01" value={pagForm.valor}
                            onChange={(e) => setPagForm({ ...pagForm, valor: e.target.value })} placeholder="0,00" />
                        </div>
                        <div>
                          <label className="rotulo">Forma de pagamento *</label>
                          <select className="campo" value={pagForm.forma}
                            onChange={(e) => setPagForm({ ...pagForm, forma: e.target.value })}>
                            <option value="">— escolha —</option>
                            {Object.entries(FORMAS_PAGAMENTO).map(([codigo, nome]) => (
                              <option key={codigo} value={codigo}>{nome}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="sr-duas">
                        <div>
                          <label className="rotulo">Data do pagamento</label>
                          {souAdmin ? (
                            <input className="campo" type="date" value={pagForm.data} max={hojeFortaleza()}
                              onChange={(e) => setPagForm({ ...pagForm, data: e.target.value })} />
                          ) : (
                            <input className="campo" type="text" value={`Hoje (${formatarData(pagForm.data)})`} disabled />
                          )}
                        </div>
                        <div>
                          <label className="rotulo">Observação (opcional)</label>
                          <input className="campo" type="text" value={pagForm.observacao}
                            onChange={(e) => setPagForm({ ...pagForm, observacao: e.target.value })}
                            placeholder="Ex.: sinal de 50%" />
                        </div>
                      </div>
                      <p className="texto-suave" style={{ fontSize: 12.5, margin: '8px 0 0' }}>
                        Este valor entra no Fechamento de Caixa do dia {formatarData(souAdmin ? pagForm.data : hojeFortaleza())}, como “Sala de Reunião”.
                      </p>
                      {erroPag && <div className="aviso-erro" style={{ marginTop: 8 }}>{erroPag}</div>}
                      <div className="sr-modal-botoes" style={{ marginTop: 10 }}>
                        <button type="submit" className="botao botao-principal" disabled={salvando}>
                          {salvando ? 'Lançando…' : 'Lançar e gerar recibo'}
                        </button>
                        <button type="button" className="botao botao-suave" onClick={() => { setPagForm(null); setErroPag(''); }}>
                          Cancelar
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              );
            })()}

            <div className="sr-modal-botoes">
              <button type="button" className="botao botao-contorno" onClick={() => setContrato(detalhe)}>
                Ver Contrato
              </button>
              <button type="button" className="botao botao-suave" onClick={() => editarReserva(detalhe)}>
                Editar
              </button>
              {confirmCancelar ? (
                <span className="sr-confirmar">
                  Cancelar mesmo?
                  <button type="button" className="botao botao-perigo" onClick={cancelarReserva} disabled={salvando}>
                    Sim, cancelar
                  </button>
                  <button type="button" className="botao botao-suave" onClick={() => setConfirmCancelar(false)}>Não</button>
                </span>
              ) : (
                <button type="button" className="botao botao-perigo" onClick={() => setConfirmCancelar(true)}>
                  Cancelar Reserva
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================= CONTRATO DE LOCAÇÃO ================= */}
      {contrato && (
        <div className="sr-overlay" role="dialog" aria-modal="true">
          <div className="sr-modal" style={{ maxWidth: 700 }}>
            <div className="sr-modal-topo sr-nao-imprimir">
              <h2 style={{ fontSize: '1.15rem', margin: 0 }}>Contrato de Locação</h2>
              <button type="button" className="sr-fechar" onClick={() => setContrato(null)} aria-label="Fechar">✕</button>
            </div>

            {faltaEndereco && (
              <div className="aviso-erro sr-nao-imprimir" style={{ fontSize: 13 }}>
                Endereço/cidade do hotel incompletos — complete no aviso do topo da página para o contrato sair completo.
              </div>
            )}
            {!salas.find((x) => x.id === contrato.sala_id)?.capacidade_pessoas && (
              <div className="aviso-erro sr-nao-imprimir" style={{ fontSize: 13 }}>
                A capacidade máxima desta sala ainda não está cadastrada, então o contrato sai com um espaço em branco
                (“____ pessoas”).{' '}
                {souAdmin ? 'Informe na aba “Salas”.' : 'Peça ao administrador para informar na aba “Salas”.'}
              </div>
            )}

            {(() => {
              const sala = salas.find((x) => x.id === contrato.sala_id);
              const capacidade = sala?.capacidade_pessoas;
              const razaoSocial = hotel?.razao_social || hotel?.nome_fantasia || 'Hotel';
              const cnpjHotel = hotel?.documento ? formatarDocumento(hotel.documento) : '________________';
              const enderecoHotel = hotel?.endereco || '[endereço não cadastrado]';
              const cidadeHotel = hotel?.cidade || '[cidade não cadastrada]';
              const nomeLocatario = String(contrato.responsavel || '').toLocaleUpperCase('pt-BR');
              const docLocatario = contrato.documento_locatario || '________________';
              const valorLocacao = Number(contrato.valor_locacao) || 0;
              const evento = contrato.motivo || 'reunião';
              const contato = contrato.telefone_locatario ? ` - Contato/Ref: ${contrato.telefone_locatario}` : '';
              return (
                <div className="contrato-folha">
                  <h3>CONTRATO DE LOCAÇÃO DE ESPAÇO PARA EVENTOS E SALA DE REUNIÃO</h3>

                  <p>
                    Pelo presente instrumento particular, de um lado <strong>{razaoSocial}</strong>, pessoa jurídica de
                    direito privado, inscrita no CNPJ sob o nº {cnpjHotel}, com sede na {enderecoHotel}, {cidadeHotel},
                    doravante denominado simplesmente <strong>LOCADOR</strong> e, de outro lado, <strong>{nomeLocatario}</strong>,
                    inscrito(a) no CPF/CNPJ sob o nº {docLocatario}, doravante denominado(a) simplesmente{' '}
                    <strong>LOCATÁRIO(A)</strong>, celebram o presente Contrato de Locação de Espaço, que se regerá pelas
                    cláusulas e condições a seguir:
                  </p>

                  <p className="contrato-clausula">CLÁUSULA PRIMEIRA - DO OBJETO E DA CAPACIDADE</p>
                  <p>
                    O LOCADOR cede ao(à) LOCATÁRIO(A), a título de locação temporária, a {nomeDaSala(contrato.sala_id)} do
                    hotel, para a realização do evento descrito como: {evento}{contato}, no dia {dataContrato(contrato.data)},
                    estritamente no horário das {hora(contrato.hora_inicio)} às {hora(contrato.hora_fim)}.
                  </p>
                  <p>
                    <strong>Parágrafo Único:</strong> Em obediência às normas do Corpo de Bombeiros e para garantir a
                    segurança, a sala possui capacidade máxima de {capacidade || '______'} pessoas.
                    O descumprimento deste limite autoriza o LOCADOR a impedir a entrada de excedentes ou a suspender o evento.
                  </p>

                  <p className="contrato-clausula">CLÁUSULA SEGUNDA - DO VALOR, FORMA DE PAGAMENTO E ARRAS</p>
                  <p>
                    Pela locação ora ajustada, o(a) LOCATÁRIO(A) pagará ao LOCADOR a quantia de{' '}
                    <strong>{dinheiro(valorLocacao)} ({valorPorExtenso(valorLocacao)})</strong>. O pagamento deverá ser
                    realizado de forma antecipada para garantir a reserva do espaço.
                  </p>
                  <p>
                    <strong>Parágrafo Único:</strong> O valor antecipado tem expressa natureza de Arras/Sinal, nos termos dos
                    Arts. 417 a 420 do Código Civil Brasileiro, servindo como princípio de pagamento e garantia de execução
                    do contrato.
                  </p>

                  <p className="contrato-clausula">CLÁUSULA TERCEIRA - DA FINALIDADE DO EVENTO E INDEPENDÊNCIA DAS PARTES</p>
                  <p>
                    O LOCADOR atua exclusivamente como locador da infraestrutura física. Fica expressamente acordado que:
                  </p>
                  <p>
                    a) Inexiste qualquer vínculo associativo, societário, de parceria ou responsabilidade solidária do
                    LOCADOR quanto ao conteúdo, organização, produtos, serviços ou promessas oferecidas no evento pelo(a)
                    LOCATÁRIO(A).
                  </p>
                  <p>
                    b) O(A) LOCATÁRIO(A) assume integral e exclusiva responsabilidade civil e penal perante seus convidados e
                    participantes, especialmente em eventuais casos de propagandas enganosas, fraudes ou promessas ilícitas.
                  </p>
                  <p>
                    c) Constatada a utilização do espaço para fins ilícitos, imorais ou que violem os bons costumes e a
                    ordem pública, o LOCADOR reserva-se o direito de rescindir o contrato imediatamente, interrompendo o
                    evento e acionando as autoridades competentes, sem direito a reembolso ao LOCATÁRIO(A).
                  </p>

                  <p className="contrato-clausula">CLÁUSULA QUARTA - DA GUARDA DE BENS E CONTROLE DE ACESSO</p>
                  <p>
                    Durante o período de locação, a gestão e o controle de acesso de pessoas ao interior da Sala de Reunião
                    são de responsabilidade exclusiva do(a) LOCATÁRIO(A).
                  </p>
                  <p>
                    <strong>Parágrafo Único:</strong> O LOCADOR não presta serviço de guarda, depósito ou custódia de bens.
                    Por não possuir gerência sobre os participantes convidados pelo(a) LOCATÁRIO(A), o LOCADOR não se
                    responsabiliza por perdas, furtos ou danos a equipamentos (notebooks, celulares, etc.) e pertences
                    pessoais ocorridos no interior da sala durante a realização do evento, cabendo ao(à) LOCATÁRIO(A)
                    orientar seus convidados sobre a vigilância de seus próprios bens.
                  </p>

                  <p className="contrato-clausula">CLÁUSULA QUINTA - DA CONSERVAÇÃO E DOS DANOS AO PATRIMÔNIO</p>
                  <p>
                    O(A) LOCATÁRIO(A) declara receber o espaço e seus equipamentos em perfeito estado de conservação,
                    conforme vistoria inicial.
                  </p>
                  <p>
                    <strong>Parágrafo Único:</strong> O(A) LOCATÁRIO(A) obriga-se a reparar, de forma integral, qualquer dano
                    material causado à estrutura física, mobiliário ou equipamentos do hotel, seja provocado por si próprio,
                    por sua equipe ou por seus convidados (Arts. 186 e 927 do Código Civil). O ressarcimento ocorrerá
                    mediante apresentação de orçamento ou nota fiscal pelo LOCADOR, com prazo de pagamento de até 5 (cinco)
                    dias úteis.
                  </p>

                  <p className="contrato-clausula">CLÁUSULA SEXTA - DO HORÁRIO E DO SOSSEGO (LEI DO SILÊNCIO)</p>
                  <p>O horário estipulado na Cláusula Primeira deve ser cumprido.</p>
                  <p>
                    a) A permanência na sala após o horário contratado implicará na cobrança de taxa extra de{' '}
                    {dinheiro(TAXA_HORA_EXCEDENTE)} por hora ou fração de hora excedente.
                  </p>
                  <p>
                    b) O evento deverá respeitar o direito ao sossego dos demais hóspedes do hotel (Art. 1.277 do Código
                    Civil). O LOCADOR reserva-se o direito de exigir a imediata adequação do volume sonoro, podendo
                    interromper o evento caso as advertências não sejam acatadas.
                  </p>

                  <p className="contrato-clausula">CLÁUSULA SÉTIMA - DA POLÍTICA DE CANCELAMENTO</p>
                  <p>
                    O cancelamento da locação pelo(a) LOCATÁRIO(A) deverá ser comunicado com antecedência mínima de 24
                    (vinte e quatro) horas do horário de início do evento, situação em que haverá a devolução integral do
                    valor ou sua conversão em crédito.
                  </p>
                  <p>
                    <strong>Parágrafo Único:</strong> O cancelamento realizado com prazo inferior a 24 horas, ou o não
                    comparecimento injustificado (no-show), implicará na retenção total do sinal pago (Cláusula Segunda), a
                    título de indenização por lucros cessantes e bloqueio de agenda, conforme autoriza o Art. 418 do Código
                    Civil.
                  </p>

                  <p className="contrato-clausula">CLÁUSULA OITAVA - DO FORO</p>
                  <p>
                    As partes elegem o foro da Comarca de {cidadeHotel} para dirimir quaisquer controvérsias oriundas deste
                    contrato, ressalvada a prerrogativa legal do(a) LOCATÁRIO(A) de optar pelo foro de seu domicílio caso
                    reste configurada relação de consumo e esta exigência dificulte o seu direito de defesa, nos estritos
                    termos do Código de Defesa do Consumidor.
                  </p>

                  <p style={{ marginTop: 8 }}>
                    E, por estarem assim justos e contratados, firmam o presente instrumento em 02 (duas) vias de igual teor
                    e forma.
                  </p>
                  <p>{cidadeHotel}, {dataContrato(hojeFortaleza())}.</p>

                  <div className="contrato-assinaturas">
                    <div>
                      <div className="contrato-linha-ass"></div>
                      <div style={{ fontWeight: 700 }}>{razaoSocial}</div>
                      <div>LOCADOR</div>
                      <div>CNPJ: {cnpjHotel}</div>
                    </div>
                    <div>
                      <div className="contrato-linha-ass"></div>
                      <div style={{ fontWeight: 700 }}>{nomeLocatario}</div>
                      <div>LOCATÁRIO(A)</div>
                      <div>CPF/CNPJ: {docLocatario}</div>
                    </div>
                  </div>
                </div>
              );
            })()}

            <div className="sr-modal-botoes sr-nao-imprimir">
              <button type="button" className="botao botao-principal" onClick={imprimirContrato}>
                🖨️ Imprimir Contrato (1 folha A4)
              </button>
              <button type="button" className="botao botao-suave" onClick={() => setContrato(null)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= RECIBO DE PAGAMENTO ================= */}
      {reciboAberto && (() => {
        const p = reciboAberto.pagamento;
        const quitou = Number(p.saldo_apos) <= 0;
        const tipoPagamento = quitou && Number(p.valor) >= Number(p.total_locacao)
          ? 'pagamento integral' : quitou ? 'pagamento final (quitação)' : 'pagamento parcial';
        return (
          <div className="sr-overlay" role="dialog" aria-modal="true">
            <div className="sr-modal" style={{ maxWidth: 700 }}>
              <div className="sr-modal-topo sr-nao-imprimir">
                <h2 style={{ fontSize: '1.15rem', margin: 0 }}>Recibo de pagamento</h2>
                <button type="button" className="sr-fechar" onClick={fecharRecibo} aria-label="Fechar">✕</button>
              </div>

              <div className="sr-recibo-folha">
                <div className="sr-recibo-cabecalho">
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 17 }}>{hotel?.nome_fantasia || 'Hotel'}</div>
                    {hotel?.razao_social && <div style={{ fontSize: 11, color: '#555' }}>{hotel.razao_social}</div>}
                    {hotel?.documento && <div style={{ fontSize: 11, color: '#555' }}>C.N.P.J: {hotel.documento}</div>}
                  </div>
                  <div className="sr-recibo-caixa">
                    <div style={{ fontSize: 11, color: '#555' }}>RECIBO Nº</div>
                    <div style={{ fontWeight: 700 }}>{p.numero_recibo}</div>
                    <div style={{ fontSize: 11, color: '#555', marginTop: 6 }}>VALOR</div>
                    <div style={{ fontWeight: 700 }}>{dinheiro(p.valor)}</div>
                  </div>
                </div>

                <h3 style={{ textAlign: 'center', margin: '18px 0 14px', fontSize: 15, letterSpacing: '0.08em' }}>
                  RECIBO DE PAGAMENTO — SALA DE REUNIÃO
                </h3>

                {p.anulado_em && (
                  <div className="sr-recibo-anulado">
                    RECIBO ANULADO em {formatarDataHora(p.anulado_em)} — {p.motivo_anulacao}. Não tem valor como comprovante.
                  </div>
                )}

                <p style={{ fontSize: 13, lineHeight: 1.8, textAlign: 'justify' }}>
                  Recebemos de <strong>{p.pagador_nome}</strong>
                  {p.pagador_documento ? <>, C.P.F/C.N.P.J nº <strong>{p.pagador_documento}</strong></> : null}, a importância de{' '}
                  <strong>{dinheiro(p.valor)} ({valorPorExtenso(Number(p.valor))})</strong>, referente a{' '}
                  <strong>{tipoPagamento}</strong> da locação da <strong>{p.sala_nome || 'Sala de Reunião'}</strong>
                  {p.data_reserva ? <>, no dia <strong>{formatarData(p.data_reserva)}</strong>
                  {p.hora_inicio ? <>, das <strong>{p.hora_inicio}</strong> às <strong>{p.hora_fim}</strong></> : null}</> : null},
                  paga por meio de <strong>{FORMAS_PAGAMENTO[p.forma_pagamento] || p.forma_pagamento}</strong> em{' '}
                  <strong>{formatarData(p.data_pagamento)}</strong>.
                </p>

                <table className="sr-recibo-tabela">
                  <tbody>
                    <tr><td>Valor total da locação</td><td>{dinheiro(p.total_locacao)}</td></tr>
                    <tr><td>Valor deste pagamento</td><td>{dinheiro(p.valor)}</td></tr>
                    <tr>
                      <td><strong>{quitou ? 'Situação' : 'Saldo restante a pagar'}</strong></td>
                      <td><strong>{quitou ? 'Locação totalmente paga' : dinheiro(p.saldo_apos)}</strong></td>
                    </tr>
                  </tbody>
                </table>

                {p.observacao && <p style={{ fontSize: 12.5 }}>Observação: {p.observacao}</p>}

                <p style={{ fontSize: 13, marginTop: 20 }}>
                  {hotel?.cidade || '[cidade não cadastrada]'}, {dataISOPorExtenso(p.data_pagamento)}.
                </p>

                <div style={{ marginTop: 48, textAlign: 'center' }}>
                  <div style={{ borderTop: '1px solid #333', width: '70%', margin: '0 auto', paddingTop: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{hotel?.nome_fantasia || 'Hotel'}</div>
                    <div style={{ fontSize: 11, color: '#555' }}>
                      C.N.P.J: {hotel?.documento || '________________________'}
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: 10.5, color: '#666', marginTop: 18, textAlign: 'center' }}>
                  Emitido por {nomeDe(p.criado_por_id)} em {formatarDataHora(p.criado_em)}
                  {reciboAberto.reimpressao ? ` · REIMPRESSÃO em ${formatarDataHora(p.reimpresso_em)} por ${nomeDe(p.reimpresso_por_id)}` : ''}
                </div>
              </div>

              <div className="sr-modal-botoes sr-nao-imprimir">
                <button type="button" className="botao botao-principal" onClick={() => window.print()}>
                  🖨️ Imprimir recibo
                </button>
                <button type="button" className="botao botao-suave" onClick={fecharRecibo}>
                  {contratoDepois ? 'Fechar e ver o contrato' : 'Fechar'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </main>
  );
}

// Linha da grade para uma sala (nome + 7 células de dias)
function FragmentoLinhaSala({ sala, cor, dias, hojeISO, reservas, statusDe, aoClicarReserva, aoCriar }) {
  return (
    <>
      <div className="sr-celula sr-sala-nome">
        <span className="sr-bolinha" style={{ background: cor }} /> {sala.nome}
      </div>
      {dias.map((d, i) => {
        const dia = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const doDia = reservas
          .filter((r) => r.sala_id === sala.id && String(r.data).slice(0, 10) === dia)
          .sort((a, b) => String(a.hora_inicio).localeCompare(String(b.hora_inicio)));
        return (
          <div key={i} className={`sr-celula sr-dia ${dia === hojeISO ? 'sr-hoje' : ''}`}>
            {doDia.map((r) => (
              <button key={r.id} type="button" className="sr-bloco"
                style={{ background: cor }}
                onClick={() => aoClicarReserva(r)}>
                {String(r.hora_inicio).slice(0, 5)}–{String(r.hora_fim).slice(0, 5)}
                <span className="sr-bloco-nome">{r.responsavel}</span>
                {statusDe(r) && <span className="sr-bloco-pago">{statusDe(r)}</span>}
              </button>
            ))}
            <button type="button" className="sr-mais" onClick={() => aoCriar(dia)} aria-label={`Reservar ${sala.nome} em ${dia}`}>
              +
            </button>
          </div>
        );
      })}
    </>
  );
}

function Linha({ rotulo, valor }) {
  return (
    <div className="sr-linha">
      <span className="sr-linha-rotulo">{rotulo}</span>
      <span className="sr-linha-valor">{valor || '—'}</span>
    </div>
  );
}

// ---- Estilos específicos deste módulo ---------------------------------------

function EstilosSala() {
  return (
    <style>{`
      .sr-abas { display: flex; gap: 6px; margin: 14px 0 16px; }
      .sr-aba {
        border: 1px solid var(--borda); background: var(--branco); color: var(--tinta);
        border-radius: 999px; padding: 10px 16px; font-size: 14px; font-weight: 600;
        cursor: pointer; min-height: 42px;
      }
      .sr-aba-ativa { background: var(--marca); border-color: var(--marca); color: var(--branco); }

      .sr-hotel-form { display: inline-flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; width: 100%; }
      .sr-hotel-form .campo { width: auto; flex: 1; min-width: 200px; }

      .sr-semana-nav {
        display: flex; align-items: center; justify-content: space-between;
        gap: 10px; margin-bottom: 12px; flex-wrap: wrap;
      }

      .sr-grade-envelope { overflow-x: auto; border: 1px solid var(--borda); border-radius: 12px; background: var(--branco); }
      .sr-grade { display: grid; min-width: 820px; }
      .sr-celula {
        border-bottom: 1px solid var(--borda); border-right: 1px solid var(--borda);
        padding: 8px; min-height: 64px; font-size: 13px;
      }
      .sr-cabecalho-celula {
        background: var(--fundo); font-weight: 700; text-align: center; min-height: auto;
        position: sticky; top: 0;
      }
      .sr-sala-nome {
        font-weight: 700; display: flex; align-items: center; gap: 8px;
        background: var(--fundo);
      }
      .sr-hoje { background: var(--marca-clara); }
      .sr-dia { display: flex; flex-direction: column; gap: 5px; }

      .sr-bloco {
        border: none; border-radius: 8px; color: #FFFFFF; cursor: pointer;
        padding: 5px 8px; font-size: 11.5px; font-weight: 700; text-align: left;
        font-family: inherit; line-height: 1.3;
      }
      .sr-bloco-nome { display: block; font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 120px; }
      .sr-bloco:hover { filter: brightness(1.1); }
      .sr-mais {
        border: 1px dashed var(--borda); background: none; border-radius: 8px;
        color: var(--texto-suave); cursor: pointer; font-size: 14px; padding: 2px;
        margin-top: auto;
      }
      .sr-mais:hover { border-color: var(--marca); color: var(--marca); }

      .sr-legenda { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 10px; font-size: 13px; }
      .sr-legenda-item { display: inline-flex; align-items: center; gap: 6px; }
      .sr-bolinha { display: inline-block; width: 12px; height: 12px; border-radius: 999px; flex-shrink: 0; }

      .sr-busca-lista { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
      .sr-busca-item {
        display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        border: 1px solid var(--borda); background: var(--fundo); border-radius: 10px;
        padding: 10px 12px; font-size: 13.5px; cursor: pointer; text-align: left;
        font-family: inherit; color: var(--tinta);
      }
      .sr-busca-item:hover { border-color: var(--marca); }

      .sr-lista { display: flex; flex-direction: column; gap: 12px; }
      .sr-sala-item { display: flex; align-items: center; gap: 12px; padding: 14px 16px; flex-wrap: wrap; }
      .sr-nova-sala { display: flex; gap: 8px; flex-wrap: wrap; }
      .sr-nova-sala .campo { width: auto; flex: 1; min-width: 200px; }
      .sr-nova-sala .sr-capacidade { flex: 0 0 190px; min-width: 150px; }
      .sr-capacidade-item { display: inline-flex; align-items: center; gap: 6px; }
      .sr-capacidade-item .sr-capacidade { width: 110px; min-width: 0; }
      .sr-confirmar { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; color: var(--erro-texto); flex-wrap: wrap; }

      .sr-log-acao {
        font-size: 12px; font-weight: 700; color: var(--marca);
        background: var(--marca-clara); border-radius: 999px; padding: 2px 9px; margin-left: 6px;
      }

      .sr-overlay {
        position: fixed; inset: 0; background: rgba(15, 25, 22, 0.45);
        display: flex; align-items: flex-end; justify-content: center; z-index: 70;
      }
      .sr-modal {
        background: var(--branco); width: 100%; max-height: 92vh; overflow-y: auto;
        border-radius: 18px 18px 0 0; padding: 18px;
      }
      .sr-modal-topo { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
      .sr-fechar {
        border: none; background: #E9ECE8; border-radius: 999px;
        width: 40px; height: 40px; font-size: 16px; cursor: pointer; flex-shrink: 0;
      }
      .sr-modal-botoes { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }

      .sr-duas { display: grid; grid-template-columns: 1fr; gap: 0 14px; }
      .sr-tres { display: grid; grid-template-columns: 1fr; gap: 0 14px; }
      .sr-doc-ok { color: var(--sucesso-texto); font-weight: 700; font-size: 13px; margin: 6px 0 0; }
      .sr-doc-erro { color: var(--erro-texto); font-weight: 700; font-size: 13px; margin: 6px 0 0; }
      .sr-doc-dica { color: var(--texto-suave); font-size: 12.5px; margin: 6px 0 0; }

      .sr-bloco-pago {
        display: inline-block; margin-top: 2px; font-size: 10px; font-weight: 700;
        background: rgba(255,255,255,0.25); border-radius: 999px; padding: 0 7px;
      }
      .sr-status {
        display: inline-block; font-size: 11.5px; font-weight: 700; border-radius: 999px;
        padding: 2px 9px; margin-left: 8px;
      }
      .sr-status-QUITADO { background: var(--sucesso-fundo, #DDF1E4); color: var(--sucesso-texto); }
      .sr-status-PARCIAL { background: #F4ECD7; color: var(--latao-texto, #8A6100); }
      .sr-status-SEM_PAGAMENTO { background: var(--erro-fundo, #FBE3E3); color: var(--erro-texto); }

      .sr-pag-novo {
        margin-top: 14px; padding: 12px 14px; border: 1px solid var(--borda);
        border-radius: 12px; background: var(--fundo);
      }
      .sr-pag-bloco {
        margin-top: 16px; padding: 14px; border: 1px solid var(--borda);
        border-radius: 12px; background: var(--fundo);
      }
      .sr-pag-topo { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
      .sr-pag-resumo { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin: 10px 0; }
      .sr-pag-resumo div {
        background: var(--branco); border: 1px solid var(--borda); border-radius: 10px;
        padding: 8px 10px; display: flex; flex-direction: column; gap: 2px;
      }
      .sr-pag-resumo span { font-size: 11.5px; color: var(--texto-suave); }
      .sr-pag-resumo strong { font-size: 14px; }
      .sr-pag-lista { display: flex; flex-direction: column; gap: 8px; }
      .sr-pag-item {
        background: var(--branco); border: 1px solid var(--borda); border-radius: 10px;
        padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; font-size: 14px;
      }
      .sr-pag-item-topo { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
      .sr-pag-recibo { font-size: 12px; font-weight: 700; color: var(--texto-suave); }
      .sr-pag-anulado { opacity: 0.85; }
      .sr-pag-anulado .sr-pag-item-topo { text-decoration: line-through; color: var(--erro-texto); }
      .sr-pag-anulado-aviso {
        font-size: 12.5px; font-weight: 700; color: var(--erro-texto);
        background: var(--erro-fundo, #FBE3E3); border-radius: 8px; padding: 5px 9px;
      }
      .sr-pag-acoes { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
      .sr-pag-anular-form { margin-top: 6px; }
      .sr-pag-form { margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--borda); }

      .sr-recibo-folha {
        border: 1px solid var(--borda); border-radius: 12px; padding: 22px;
        background: #FFFFFF; color: #1a1a1a;
      }
      .sr-recibo-cabecalho { display: flex; justify-content: space-between; gap: 14px; align-items: flex-start; }
      .sr-recibo-caixa {
        border: 1px solid #333; border-radius: 8px; padding: 8px 14px; text-align: center;
        font-size: 14px; flex-shrink: 0;
      }
      .sr-recibo-tabela { width: 100%; border-collapse: collapse; margin: 14px 0 6px; font-size: 13px; }
      .sr-recibo-tabela td { border: 1px solid #bbb; padding: 6px 10px; }
      .sr-recibo-tabela td:last-child { text-align: right; white-space: nowrap; }
      .sr-recibo-anulado {
        border: 2px solid #A31212; color: #A31212; font-weight: 700; font-size: 12.5px;
        border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; text-align: center;
      }

      .sr-ficha { margin-top: 8px; }
      .sr-linha { display: flex; justify-content: space-between; gap: 14px; padding: 7px 0; border-bottom: 1px dashed var(--borda); font-size: 14px; }
      .sr-linha-rotulo { color: var(--texto-suave); flex-shrink: 0; }
      .sr-linha-valor { text-align: right; font-weight: 600; overflow-wrap: anywhere; }

      .contrato-folha {
        border: 1px solid var(--borda); border-radius: 12px; padding: 22px;
        background: #FFFFFF; color: #1a1a1a; font-size: 13px; line-height: 1.5;
        text-align: justify; font-family: 'Times New Roman', Times, serif;
      }
      .contrato-folha h3 { text-align: center; font-size: 15px; margin: 0 0 14px; letter-spacing: 0.03em; }
      .contrato-folha p { margin: 0 0 8px; }
      .contrato-folha .contrato-clausula { margin-top: 14px; font-weight: 700; }
      .contrato-assinaturas {
        display: grid; grid-template-columns: 1fr 1fr; gap: 24px;
        margin-top: 56px; text-align: center; font-size: 0.92em;
      }
      .contrato-linha-ass { border-top: 1px solid #333; margin-bottom: 6px; }

      /* Cópia invisível usada só para medir se o contrato cabe em 1 folha A4 */
      .contrato-medida {
        position: absolute !important; left: -10000px; top: 0; width: 190mm;
        border: none; border-radius: 0; padding: 0; visibility: hidden;
      }
      ${regrasContratoA4('.contrato-medida')}

      @media (min-width: 640px) {
        .sr-duas { grid-template-columns: 1fr 1fr; }
        .sr-tres { grid-template-columns: 1fr 1fr 1fr; }
        .sr-overlay { align-items: center; padding: 24px; }
        .sr-modal { max-width: 580px; border-radius: 18px; padding: 24px; }
      }

      /* Impressão: só o contrato ou o recibo aberto sai no papel */
      @page { size: A4; margin: 10mm; }
      @media print {
        body * { visibility: hidden; }
        .contrato-folha, .contrato-folha *, .sr-recibo-folha, .sr-recibo-folha * { visibility: visible; }
        .contrato-medida, .contrato-medida * { visibility: hidden !important; }
        .contrato-folha, .sr-recibo-folha { position: fixed; top: 0; left: 0; width: 100%; border: none; padding: 24px; }
        .contrato-folha { padding: 0; border-radius: 0; }
        ${regrasContratoA4('.contrato-folha')}
        .sr-nao-imprimir { display: none !important; }
      }
    `}</style>
  );
}
