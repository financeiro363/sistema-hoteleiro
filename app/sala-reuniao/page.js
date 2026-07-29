'use client';

// ============================================================================
// SALA DE REUNIÃO (com contrato de locação)
// - Calendário semanal: linhas = salas, colunas = dias da semana, com
//   navegação "← Semana anterior / Próxima semana →"
// - Reserva com responsável, CPF/CNPJ, valor da locação e motivo
// - Detecção de conflito de horário (vale também na edição)
// - CONTRATO DE LOCAÇÃO abre automaticamente a cada reserva, imprimível,
//   com LOCADOR (hotel) e LOCATÁRIO, cláusulas e assinaturas
// - Busca de reservas; Salas gerenciadas pelo ADMIN; Log de auditoria
//   imutável (Criou/Editou/Cancelou Reserva, Cadastrou/Excluiu Sala)
// ============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

// ---- Constantes -------------------------------------------------------------

const CORES_SALAS = ['#0E5A4E', '#1D4E89', '#A34E00', '#5B3A8E', '#8A6100', '#A31212'];
const DIAS_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
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

function dataPorExtenso(data) {
  const d = data ? new Date(data) : new Date();
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

// CPF (11) ou CNPJ (14) com formatação automática
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
};

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

  // Gestão de salas (admin)
  const [novaSalaNome, setNovaSalaNome] = useState('');
  const [excluindoSalaId, setExcluindoSalaId] = useState(null);

  // Endereço do hotel (admin preenche se faltar)
  const [enderecoNovo, setEnderecoNovo] = useState('');
  const [cidadeNova, setCidadeNova] = useState('');

  const souAdmin = usuario?.papel === 'ADMIN';

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
      valor_locacao: Number(form.valor) || 0,
      motivo: form.motivo.trim() || null,
      hotel_id: usuario.hotel_id,
    };

    setSalvando(true);
    let salvo = null;
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
    }
    setSalvando(false);
    setForm(null);
    await carregarTudo(usuario);
    if (!registro || !salvo) return;
    // Contrato obrigatório: abre automaticamente para reservas novas
    if (!form.editandoId) setContrato(salvo);
  }

  // ---- Cancelar reserva ----
  async function cancelarReserva() {
    if (!detalhe || salvando) return;
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

  // ---- Salas (admin) ----
  async function cadastrarSala() {
    if (!novaSalaNome.trim() || salvando) return;
    setSalvando(true);
    const { error } = await supabase
      .from('salas_reuniao').insert({ nome: novaSalaNome.trim(), hotel_id: usuario.hotel_id });
    setSalvando(false);
    if (error) { setErro('Não foi possível cadastrar a sala. Detalhe técnico: ' + error.message); return; }
    await registrarLog('Cadastrou Sala', `Sala "${novaSalaNome.trim()}".`);
    setNovaSalaNome('');
    mostrarAviso('Sala cadastrada!');
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
            placeholder="Pesquisar reserva (responsável, motivo, sala ou data)…"
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
                      aoClicarReserva={(r) => { setDetalhe(r); setConfirmCancelar(false); }}
                      aoCriar={(dataDia) => novaReserva(sala.id, dataDia)}
                    />
                  ))}
                </div>
              </div>

              {/* Legenda */}
              <div className="sr-legenda">
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
                <label className="rotulo">CPF ou CNPJ</label>
                <input className="campo" type="text" inputMode="numeric" value={form.documento}
                  onChange={(e) => setForm({ ...form, documento: formatarDocumento(e.target.value) })}
                  placeholder="000.000.000-00" />
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
              <Linha rotulo="Reservado por" valor={`${nomeDe(detalhe.criado_por_id)} em ${formatarDataHora(detalhe.criado_em)}`} />
            </div>

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

            <div className="contrato-folha">
              <h3 style={{ textAlign: 'center', fontSize: 16, margin: '0 0 16px', letterSpacing: '0.06em' }}>
                CONTRATO DE LOCAÇÃO
              </h3>

              <p>
                Pelo presente instrumento, de um lado <strong>{hotel?.nome_fantasia || 'Hotel'}</strong>
                {hotel?.documento ? <>, portador do CNPJ {hotel.documento}</> : null}
                {hotel?.endereco ? <>, localizado na {hotel.endereco}{hotel?.cidade ? `, ${hotel.cidade}` : ''}</> : null},
                aqui denominado de <strong>LOCADOR</strong>, e de outro{' '}
                <strong>{contrato.responsavel}</strong>, portador(a) do CPF/CNPJ{' '}
                {contrato.documento_locatario || '________________'}, aqui denominado(a) de{' '}
                <strong>LOCATÁRIO(A)</strong>, têm acordado o presente contrato com as cláusulas abaixo.
              </p>

              <p>
                <strong>1. OBJETO DO CONTRATO:</strong> Locação da {nomeDaSala(contrato.sala_id)} para
                evento de {contrato.motivo || 'reunião'}, no dia {formatarData(contrato.data)}, das{' '}
                {hora(contrato.hora_inicio)} às {hora(contrato.hora_fim)}.
              </p>

              <p>
                <strong>2. VALOR DA LOCAÇÃO:</strong> Pela locação, será paga a importância de{' '}
                <strong>{dinheiro(contrato.valor_locacao)}{Number(contrato.valor_locacao) > 0 ? ` (${valorPorExtenso(Number(contrato.valor_locacao))})` : ''}</strong>,
                mediante pagamento antecipado.
              </p>

              <p>
                <strong>3. DAS OBRIGAÇÕES DO LOCATÁRIO:</strong> O LOCATÁRIO se compromete a zelar pelo
                espaço e pelos equipamentos disponibilizados, a devolvê-los nas mesmas condições em que
                foram recebidos, e a responsabilizar-se por quaisquer danos causados durante o período
                de uso.
              </p>

              <p>
                <strong>4. DA RESCISÃO:</strong> O cancelamento da locação deverá ser comunicado com
                antecedência mínima de 24 (vinte e quatro) horas. Em caso de não comparecimento sem
                comunicação prévia, o valor pago não será devolvido.
              </p>

              <p>
                <strong>5. DO FORO:</strong> Fica eleito o foro da comarca de{' '}
                {hotel?.cidade || '[cidade não cadastrada]'} para dirimir quaisquer dúvidas oriundas
                do presente contrato.
              </p>

              <p style={{ marginTop: 20 }}>
                {hotel?.cidade || '[cidade não cadastrada]'}, {dataPorExtenso()}.
              </p>

              <div className="contrato-assinaturas">
                <div>
                  <div className="contrato-linha-ass"></div>
                  <div style={{ fontWeight: 700 }}>{hotel?.nome_fantasia || 'Hotel'}</div>
                  <div style={{ fontSize: 11, color: '#555' }}>LOCADOR</div>
                </div>
                <div>
                  <div className="contrato-linha-ass"></div>
                  <div style={{ fontWeight: 700 }}>{contrato.responsavel}</div>
                  <div style={{ fontSize: 11, color: '#555' }}>LOCATÁRIO(A)</div>
                </div>
              </div>
            </div>

            <div className="sr-modal-botoes sr-nao-imprimir">
              <button type="button" className="botao botao-principal" onClick={() => window.print()}>
                🖨️ Imprimir Contrato
              </button>
              <button type="button" className="botao botao-suave" onClick={() => setContrato(null)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// Linha da grade para uma sala (nome + 7 células de dias)
function FragmentoLinhaSala({ sala, cor, dias, hojeISO, reservas, aoClicarReserva, aoCriar }) {
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

      .sr-ficha { margin-top: 8px; }
      .sr-linha { display: flex; justify-content: space-between; gap: 14px; padding: 7px 0; border-bottom: 1px dashed var(--borda); font-size: 14px; }
      .sr-linha-rotulo { color: var(--texto-suave); flex-shrink: 0; }
      .sr-linha-valor { text-align: right; font-weight: 600; overflow-wrap: anywhere; }

      .contrato-folha {
        border: 1px solid var(--borda); border-radius: 12px; padding: 22px;
        background: #FFFFFF; color: #1a1a1a; font-size: 12.5px; line-height: 1.7;
        text-align: justify;
      }
      .contrato-assinaturas {
        display: grid; grid-template-columns: 1fr 1fr; gap: 24px;
        margin-top: 56px; text-align: center;
      }
      .contrato-linha-ass { border-top: 1px solid #333; margin-bottom: 6px; }

      @media (min-width: 640px) {
        .sr-duas { grid-template-columns: 1fr 1fr; }
        .sr-tres { grid-template-columns: 1fr 1fr 1fr; }
        .sr-overlay { align-items: center; padding: 24px; }
        .sr-modal { max-width: 580px; border-radius: 18px; padding: 24px; }
      }

      /* Impressão: só o contrato sai no papel */
      @media print {
        body * { visibility: hidden; }
        .contrato-folha, .contrato-folha * { visibility: visible; }
        .contrato-folha { position: fixed; top: 0; left: 0; width: 100%; border: none; padding: 24px; }
        .sr-nao-imprimir { display: none !important; }
      }
    `}</style>
  );
}
