'use client';

// ============================================================================
// PONTO (Folha de Ponto e Banco de Horas — CCT Sindhotel-PB)
// Módulo inteiro SÓ PARA ADMIN (folha de pagamento / cálculo trabalhista).
//
// Motor de cálculo portado e RE-VALIDADO contra os mesmos números que já
// bateram com contracheques reais de hotéis (valor da hora, hora extra,
// adicional noturno, quebra de caixa, DSR sobre variáveis).
//
// 5 telas: Funcionários · Lançamento Diário · Painel de Ocorrências ·
// Espelho de Ponto · Relatório Gerencial de RH.
//
// ATENÇÃO: este é um motor de cálculo trabalhista. Os valores e regras foram
// conferidos contra a CCT e contracheques reais, mas mudanças na convenção
// coletiva (dissídios/aditivos anuais) podem exigir ajustes nas constantes
// abaixo (objeto CCT). Em caso de dúvida jurídica, consulte um contador ou
// advogado trabalhista antes de usar os valores para fechar folha oficial.
// ============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

// ============================================================================
// CONSTANTES DA CCT SINDHOTEL-PB
// ============================================================================

const CCT = {
  PISO_SALARIAL: 1665.0,
  VALE_ALIMENTACAO_DIA: 17.0,
  ADICIONAL_NOTURNO_PERC: 0.2,
  FATOR_REDUCAO_NOTURNA: 1.142857, // 60min ÷ 52,5min (hora noturna reduzida)
  HORA_EXTRA_50: 0.5,
  HORA_EXTRA_100: 1.0,
  DIVISOR_MENSAL: 220,
  QUEBRA_CAIXA_PERC: 0.1,
  BENEFICIO_ODONTOLOGICO: 18.0,
  INTERVALO_MINIMO_MINUTOS: 60,
  DIVISOR_DSR: 20,
  BANCO_HORAS_ALERTA_HORAS: 20,
};

const STATUS_LABEL = {
  TRABALHADO: 'Dia Trabalhado Regular',
  DSR: 'Folga Semanal (DSR)',
  COMPENSACAO: 'Compensação / Folga de Banco',
  ATESTADO: 'Atestado Médico/Odontológico',
  FALTA_JUSTIFICADA: 'Falta Justificada',
  FALTA_INJUSTIFICADA: 'Falta Injustificada',
  FERIAS: 'Férias',
};
const STATUS_COR = {
  TRABALHADO: '#0E7C66', DSR: '#1D4E89', COMPENSACAO: '#5B3A8E', ATESTADO: '#8A6100',
  FALTA_JUSTIFICADA: '#8A6100', FALTA_INJUSTIFICADA: '#A31212', FERIAS: '#0E7C9E',
};
const GENERO_LABEL = { M: 'Masculino', F: 'Feminino' };
const ESCALA_LABEL = { COMUM: 'Comum (44h semanais)', DOZE_TRINTA_SEIS: '12x36' };

// ============================================================================
// FUNÇÕES DE APOIO GERAIS
// ============================================================================

function dinheiro(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(valor || 0));
}
function formatarData(valor) {
  if (!valor) return '—';
  const [ano, mes, dia] = String(valor).slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}
function hoje() { return new Date().toISOString().slice(0, 10); }
function hh(valor) { return String(valor || '').slice(0, 5); } // "08:00:00" -> "08:00"

function paraMinutos(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}
function cargaHorariaParaDecimal(hhmm) {
  const min = paraMinutos(hhmm);
  return min === null ? 8 : min / 60;
}
function formatarHoras(h) {
  if (h === undefined || h === null || Number.isNaN(h)) return '—';
  const sinal = h < 0 ? '-' : '';
  const abs = Math.abs(h);
  const horasInt = Math.floor(abs);
  const minutos = Math.round((abs - horasInt) * 60);
  return `${sinal}${String(horasInt).padStart(2, '0')}:${String(minutos).padStart(2, '0')}`;
}

// ============================================================================
// MOTOR DE CÁLCULO — jornada trabalhada (virada de turno, hora noturna,
// extras, banco de horas, intervalo reduzido)
// ============================================================================

function calcularJornadaTrabalhada(funcionario, lancamento) {
  const entrada = paraMinutos(lancamento.hora_entrada);
  const saida = paraMinutos(lancamento.hora_saida);
  const semIntervalo = !!lancamento.sem_intervalo;

  if (entrada === null || saida === null) return { erro: 'Preencha entrada e saída.' };

  let tEntrada, tIniInt, tFimInt, tSaida;
  if (semIntervalo) {
    tEntrada = entrada;
    tSaida = saida < tEntrada ? saida + 1440 : saida;
    tIniInt = tSaida; tFimInt = tSaida;
  } else {
    const iniInt = paraMinutos(lancamento.inicio_intervalo);
    const fimInt = paraMinutos(lancamento.fim_intervalo);
    if (iniInt === null || fimInt === null) return { erro: 'Preencha todos os horários (ou marque "sem intervalo").' };
    tEntrada = entrada;
    tIniInt = iniInt < tEntrada ? iniInt + 1440 : iniInt;
    tFimInt = fimInt < tIniInt ? fimInt + 1440 : fimInt;
    tSaida = saida < tFimInt ? saida + 1440 : saida;
    if (tFimInt <= tIniInt) return { erro: 'O fim do intervalo deve ser depois do início do intervalo.' };
  }

  const duracaoTotal = tSaida - tEntrada;
  if (duracaoTotal <= 0) return { erro: 'O horário de saída deve ser depois do horário de entrada.' };
  if (duracaoTotal > 16 * 60) return { erro: 'Turno maior que 16h — confira os horários lançados.' };

  const minutosIntervalo = tFimInt - tIniInt;
  const minutosTrabalhados = duracaoTotal - minutosIntervalo;

  // Janelas noturnas (22h-05h, 7h) cobrindo os dias ao redor da jornada
  const janelasNoturnas = [-1, 0, 1].map((k) => ({ inicio: 22 * 60 + k * 1440, fim: 22 * 60 + k * 1440 + 420 }));
  function sobreposicaoNoturna(segInicio, segFim) {
    return janelasNoturnas.reduce((acc, j) => acc + Math.max(0, Math.min(segFim, j.fim) - Math.max(segInicio, j.inicio)), 0);
  }
  const minutosNoturnosFisicos = sobreposicaoNoturna(tEntrada, tIniInt) + sobreposicaoNoturna(tFimInt, tSaida);

  const escala12x36 = funcionario.escala === 'DOZE_TRINTA_SEIS';
  const horasNoturnasReduzidas = escala12x36
    ? minutosNoturnosFisicos / 60
    : (minutosNoturnosFisicos / 60) * CCT.FATOR_REDUCAO_NOTURNA;

  const minutosDiurnos = minutosTrabalhados - minutosNoturnosFisicos;
  const horasNormaisDiurnas = minutosDiurnos / 60;
  const totalHorasComputadas = horasNormaisDiurnas + horasNoturnasReduzidas;

  const cargaPadrao = cargaHorariaParaDecimal(funcionario.carga_horaria);
  const excedente = Math.max(0, totalHorasComputadas - cargaPadrao);

  // Escala 12x36 não tem hora extra de feriado a 100% (já embutido no salário fixo)
  const feriado100 = !escala12x36 && !!lancamento.feriado_sem_compensacao;
  const horasExtras50 = feriado100 ? 0 : excedente;
  const horasExtras100 = feriado100 ? excedente : 0;

  const saldoBancoHorasDia = totalHorasComputadas - cargaPadrao;

  const valorHoraNormal = Number(funcionario.salario || CCT.PISO_SALARIAL) / CCT.DIVISOR_MENSAL;
  const custoAdicionalNoturno = horasNoturnasReduzidas * valorHoraNormal * CCT.ADICIONAL_NOTURNO_PERC;
  const custoHorasExtras =
    horasExtras50 * valorHoraNormal * (1 + CCT.HORA_EXTRA_50) +
    horasExtras100 * valorHoraNormal * (1 + CCT.HORA_EXTRA_100);

  let alertaIntervaloReduzido = false, minutosIntervaloSuprimido = 0, indenizacaoIntervalo = 0;
  if (minutosTrabalhados > 6 * 60 && minutosIntervalo < CCT.INTERVALO_MINIMO_MINUTOS) {
    alertaIntervaloReduzido = true;
    minutosIntervaloSuprimido = CCT.INTERVALO_MINIMO_MINUTOS - minutosIntervalo;
    indenizacaoIntervalo = (minutosIntervaloSuprimido / 60) * valorHoraNormal * (1 + CCT.HORA_EXTRA_50);
  }

  return {
    erro: null, minutosTrabalhados, horasNormaisDecimal: horasNormaisDiurnas, minutosNoturnosFisicos,
    horasNoturnasReduzidas, horasExtras50, horasExtras100, saldoBancoHorasDia, valorHoraNormal,
    custoAdicionalNoturno, custoHorasExtras, minutosIntervalo, alertaIntervaloReduzido,
    minutosIntervaloSuprimido, indenizacaoIntervalo,
  };
}

const SEM_IMPACTO_BANCO = {
  erro: null, saldoBancoHorasDia: 0, horasNormaisDecimal: 0, horasNoturnasReduzidas: 0,
  horasExtras50: 0, horasExtras100: 0, custoAdicionalNoturno: 0, custoHorasExtras: 0,
  alertaIntervaloReduzido: false, indenizacaoIntervalo: 0,
};

// Aplica a regra de cada status do dia no banco de horas e no vale-alimentação
function calcularDia(funcionario, lancamento, forneceAlimentacaoCompleta) {
  const cargaPadrao = cargaHorariaParaDecimal(funcionario.carga_horaria);

  if (lancamento.status === 'TRABALHADO') {
    const calc = calcularJornadaTrabalhada(funcionario, lancamento);
    if (calc.erro) return { ...SEM_IMPACTO_BANCO, erro: calc.erro, valeAlimentacao: 0 };
    return { ...calc, valeAlimentacao: forneceAlimentacaoCompleta ? 0 : CCT.VALE_ALIMENTACAO_DIA };
  }
  if (lancamento.status === 'COMPENSACAO' || lancamento.status === 'FALTA_INJUSTIFICADA') {
    return { ...SEM_IMPACTO_BANCO, saldoBancoHorasDia: -cargaPadrao, valeAlimentacao: 0 };
  }
  // DSR, Atestado, Falta Justificada, Férias: neutros para banco de horas
  return { ...SEM_IMPACTO_BANCO, valeAlimentacao: 0 };
}

// ============================================================================
// ALERTAS JURÍDICOS
// ============================================================================

// Ponto Britânico (Súmula 338 TST): 3+ dias seguidos com os 4 horários idênticos
function detectarPontoBritanico(funcionarioId, dataStr, lancamentos) {
  const doFuncionario = lancamentos
    .filter((l) => l.funcionario_id === funcionarioId && l.status === 'TRABALHADO')
    .sort((a, b) => a.data.localeCompare(b.data));
  const idx = doFuncionario.findIndex((l) => l.data === dataStr);
  if (idx === -1) return false;
  const atual = doFuncionario[idx];
  function mesmoHorario(a, b) {
    return hh(a.hora_entrada) === hh(b.hora_entrada) && hh(a.inicio_intervalo) === hh(b.inicio_intervalo) &&
           hh(a.fim_intervalo) === hh(b.fim_intervalo) && hh(a.hora_saida) === hh(b.hora_saida);
  }
  function diaSeguinte(dataA, dataB) {
    return (new Date(dataB + 'T00:00:00') - new Date(dataA + 'T00:00:00')) === 86400000;
  }
  let seq = 1;
  for (let i = idx - 1; i >= 0; i--) {
    if (mesmoHorario(doFuncionario[i], atual) && diaSeguinte(doFuncionario[i].data, doFuncionario[i + 1].data)) seq++;
    else break;
  }
  for (let i = idx + 1; i < doFuncionario.length; i++) {
    if (mesmoHorario(doFuncionario[i], atual) && diaSeguinte(doFuncionario[i - 1].data, doFuncionario[i].data)) seq++;
    else break;
  }
  return seq >= 3;
}

function ehDomingo(dataStr) {
  return new Date(dataStr + 'T00:00:00').getDay() === 0;
}

// Regra geral (Cláusula 24ª, §4º): folga dominical mensal — não se aplica à escala 12x36
function alertaDomingoFolgaMensal(funcionario, funcionarioId, dataStr, lancamentos) {
  if (funcionario.escala === 'DOZE_TRINTA_SEIS') return false;
  if (!ehDomingo(dataStr)) return false;
  const mesCivil = dataStr.slice(0, 7);
  const domingosDoMes = lancamentos.filter((l) =>
    l.funcionario_id === funcionarioId && l.data.slice(0, 7) === mesCivil && ehDomingo(l.data)
  );
  return domingosDoMes.length > 0 && domingosDoMes.every((l) => l.status === 'TRABALHADO');
}

// Proteção adicional só para mulheres (Art. 386 CLT): 3º domingo seguido trabalhado
function alertaDomingoFeminino(funcionarioId, dataStr, lancamentos) {
  if (!ehDomingo(dataStr)) return false;
  const domingosTrabalhados = lancamentos
    .filter((l) => l.funcionario_id === funcionarioId && l.status === 'TRABALHADO' && ehDomingo(l.data))
    .map((l) => l.data).sort();
  const idx = domingosTrabalhados.indexOf(dataStr);
  if (idx === -1) return false;
  let seguidos = 1;
  for (let i = idx - 1; i >= 0; i--) {
    const anterior = new Date(domingosTrabalhados[i] + 'T00:00:00');
    const atual = new Date(domingosTrabalhados[i + 1] + 'T00:00:00');
    if ((atual - anterior) === 7 * 86400000) seguidos++;
    else break;
  }
  return seguidos >= 3;
}

// ============================================================================
// DSR SOBRE VARIÁVEIS e QUEBRA DE CAIXA PROPORCIONAL
// ============================================================================

function contarDomingosNoMes(anoMesStr) {
  const [ano, mes] = anoMesStr.split('-').map(Number);
  const ultimoDia = new Date(ano, mes, 0).getDate();
  let contador = 0;
  for (let dia = 1; dia <= ultimoDia; dia++) if (new Date(ano, mes - 1, dia).getDay() === 0) contador++;
  return contador;
}
function calcularDSRVariaveis(totalVerbaNoMes, anoMesStr) {
  return (totalVerbaNoMes / CCT.DIVISOR_DSR) * contarDomingosNoMes(anoMesStr);
}
function calcularQuebraCaixaProporcional(salario, diasTrabalhadosNoMes, diasNoMesQtd) {
  if (!diasNoMesQtd) return 0;
  return CCT.QUEBRA_CAIXA_PERC * Number(salario) * (diasTrabalhadosNoMes / diasNoMesQtd);
}
function diasNoMes(anoMesStr) {
  const [ano, mes] = anoMesStr.split('-').map(Number);
  return new Date(ano, mes, 0).getDate();
}

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================

export default function Ponto() {
  const router = useRouter();

  const [verificandoLogin, setVerificandoLogin] = useState(true);
  const [usuario, setUsuario] = useState(null);
  const [usuarios, setUsuarios] = useState([]);

  const [subAba, setSubAba] = useState('funcionarios');
  const [funcionarios, setFuncionarios] = useState([]);
  const [lancamentos, setLancamentos] = useState([]);
  const [config, setConfig] = useState({ fornece_alimentacao_completa: false });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);

  function mostrarAviso(texto) { setAviso(texto); setTimeout(() => setAviso(''), 5000); }

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
    }
    verificar();
    return () => { ativo = false; };
  }, [router]);

  const carregarTudo = useCallback(async (u) => {
    setCarregando(true);
    setErro('');
    const [f, l, c, us] = await Promise.all([
      supabase.from('funcionarios').select('*').order('nome', { ascending: true }),
      supabase.from('ponto_lancamentos').select('*').order('data', { ascending: false }),
      supabase.from('ponto_config').select('*').eq('hotel_id', u.hotel_id).maybeSingle(),
      supabase.from('usuarios').select('id, nome').eq('hotel_id', u.hotel_id).order('nome', { ascending: true }),
    ]);
    if (f.error) setErro('Não foi possível carregar. Detalhe técnico: ' + f.error.message);
    setFuncionarios(f.data || []);
    setLancamentos(l.data || []);
    setConfig(c.data || { fornece_alimentacao_completa: false });
    setUsuarios(us.data || []);
    setCarregando(false);
  }, []);

  useEffect(() => { if (usuario) carregarTudo(usuario); }, [usuario, carregarTudo]);

  async function alternarAlimentacaoCompleta() {
    const novo = !config.fornece_alimentacao_completa;
    const { error } = await supabase.from('ponto_config').upsert({
      hotel_id: usuario.hotel_id, fornece_alimentacao_completa: novo, atualizado_em: new Date().toISOString(),
    });
    if (error) { setErro('Não foi possível salvar. Detalhe técnico: ' + error.message); return; }
    setConfig({ ...config, fornece_alimentacao_completa: novo });
    mostrarAviso(novo ? 'Vale-alimentação diário desativado (hotel fornece alimentação completa).' : 'Vale-alimentação diário reativado.');
  }

  const nomeFuncionario = useCallback((id) => funcionarios.find((f) => f.id === id)?.nome || '—', [funcionarios]);

  if (verificandoLogin) {
    return <main className="conteudo"><p className="texto-suave">Verificando seu acesso…</p></main>;
  }

  return (
    <main className="conteudo">
      <EstilosPonto />

      <span className="olho">Recursos Humanos</span>
      <h1 style={{ marginBottom: 6 }}>Ponto e Banco de Horas</h1>
      <p className="texto-suave" style={{ fontSize: 13, marginTop: -4 }}>
        Módulo visível só para administradores — cálculo conforme a CCT Sindhotel-PB.
      </p>

      {aviso && <div className="aviso-sucesso">{aviso}</div>}
      {erro && <div className="aviso-erro">{erro}</div>}

      <div className="pt-config-topo">
        <label className="pt-toggle">
          <input type="checkbox" checked={!!config.fornece_alimentacao_completa} onChange={alternarAlimentacaoCompleta} />
          O hotel fornece alimentação completa (desativa o vale-alimentação diário de R$ {CCT.VALE_ALIMENTACAO_DIA.toFixed(2)})
        </label>
      </div>

      <nav className="pt-abas" aria-label="Seções">
        {[
          ['funcionarios', 'Funcionários'], ['lancamento', 'Lançamento Diário'],
          ['ocorrencias', 'Painel de Ocorrências'], ['espelho', 'Espelho de Ponto'],
          ['relatorio', 'Relatório Gerencial'],
        ].map(([chave, rotulo]) => (
          <button key={chave} type="button" className={subAba === chave ? 'pt-aba pt-aba-ativa' : 'pt-aba'}
            onClick={() => setSubAba(chave)}>{rotulo}</button>
        ))}
      </nav>

      {carregando ? <p className="texto-suave">Carregando…</p> : (
        <>
          {subAba === 'funcionarios' && (
            <PainelFuncionarios
              funcionarios={funcionarios} usuarios={usuarios} usuario={usuario}
              salvando={salvando} setSalvando={setSalvando} mostrarAviso={mostrarAviso} setErro={setErro}
              recarregar={() => carregarTudo(usuario)}
            />
          )}
          {subAba === 'lancamento' && (
            <PainelLancamento
              funcionarios={funcionarios} lancamentos={lancamentos} config={config} usuario={usuario}
              salvando={salvando} setSalvando={setSalvando} mostrarAviso={mostrarAviso} setErro={setErro}
              recarregar={() => carregarTudo(usuario)}
            />
          )}
          {subAba === 'ocorrencias' && (
            <PainelOcorrencias funcionarios={funcionarios} lancamentos={lancamentos} nomeFuncionario={nomeFuncionario} />
          )}
          {subAba === 'espelho' && (
            <PainelEspelho funcionarios={funcionarios} lancamentos={lancamentos} config={config} />
          )}
          {subAba === 'relatorio' && (
            <PainelRelatorioGerencial funcionarios={funcionarios} lancamentos={lancamentos} config={config} />
          )}
        </>
      )}
    </main>
  );
}

// ============================================================================
// TELA 1 — CADASTRO DE FUNCIONÁRIOS
// ============================================================================

function PainelFuncionarios({ funcionarios, usuarios, usuario, salvando, setSalvando, mostrarAviso, setErro, recarregar }) {
  const [busca, setBusca] = useState('');
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [vincularUsuarioId, setVincularUsuarioId] = useState('');
  const [nome, setNome] = useState('');
  const [matricula, setMatricula] = useState('');
  const [cargo, setCargo] = useState('');
  const [setor, setSetor] = useState('');
  const [genero, setGenero] = useState('M');
  const [escala, setEscala] = useState('COMUM');
  const [cargaHoraria, setCargaHoraria] = useState('08:00');
  const [salario, setSalario] = useState(String(CCT.PISO_SALARIAL));
  const [quebraCaixa, setQuebraCaixa] = useState(false);
  const [erroForm, setErroForm] = useState('');
  const [excluindoId, setExcluindoId] = useState(null);

  const idsJaVinculados = new Set(funcionarios.filter((f) => f.usuario_id).map((f) => f.usuario_id));
  const usuariosDisponiveis = usuarios.filter((u) => !idsJaVinculados.has(u.id));

  function abrirNovo() {
    setEditandoId(null); setVincularUsuarioId(''); setNome(''); setMatricula(''); setCargo(''); setSetor('');
    setGenero('M'); setEscala('COMUM'); setCargaHoraria('08:00'); setSalario(String(CCT.PISO_SALARIAL));
    setQuebraCaixa(false); setErroForm(''); setMostrarForm(true);
  }
  function abrirEdicao(f) {
    setEditandoId(f.id); setVincularUsuarioId(f.usuario_id ? String(f.usuario_id) : '');
    setNome(f.nome); setMatricula(f.matricula || ''); setCargo(f.cargo || ''); setSetor(f.setor || '');
    setGenero(f.genero || 'M'); setEscala(f.escala); setCargaHoraria(f.carga_horaria);
    setSalario(String(f.salario)); setQuebraCaixa(f.quebra_caixa); setErroForm(''); setMostrarForm(true);
  }
  function escolherUsuario(id) {
    setVincularUsuarioId(id);
    if (id) {
      const u = usuarios.find((x) => String(x.id) === String(id));
      if (u && !nome.trim()) setNome(u.nome);
    }
  }

  async function salvar(evento) {
    evento.preventDefault();
    if (salvando) return;
    setErroForm('');
    if (!nome.trim()) { setErroForm('Informe o nome do funcionário.'); return; }
    if (!(Number(salario) > 0)) { setErroForm('Informe um salário válido.'); return; }

    const dados = {
      nome: nome.trim(), matricula: matricula.trim() || null, cargo: cargo.trim() || null,
      setor: setor.trim() || null, genero, escala, carga_horaria: cargaHoraria,
      salario: Number(salario), quebra_caixa: quebraCaixa,
      usuario_id: vincularUsuarioId ? Number(vincularUsuarioId) : null,
    };

    setSalvando(true);
    if (editandoId) {
      const { error } = await supabase.from('funcionarios').update(dados).eq('id', editandoId);
      setSalvando(false);
      if (error) { setErroForm('Não foi possível salvar. Detalhe técnico: ' + error.message); return; }
      mostrarAviso('Funcionário atualizado!');
    } else {
      const { error } = await supabase.from('funcionarios').insert({ ...dados, hotel_id: usuario.hotel_id });
      setSalvando(false);
      if (error) { setErroForm('Não foi possível cadastrar. Detalhe técnico: ' + error.message); return; }
      mostrarAviso('Funcionário cadastrado!');
    }
    setMostrarForm(false);
    recarregar();
  }

  async function alternarAtivo(f) {
    const { error } = await supabase.from('funcionarios').update({ ativo: !f.ativo }).eq('id', f.id);
    if (error) { setErro('Não foi possível atualizar. Detalhe técnico: ' + error.message); return; }
    mostrarAviso(f.ativo ? 'Funcionário marcado como inativo.' : 'Funcionário reativado.');
    recarregar();
  }

  async function excluir(f) {
    setExcluindoId(null);
    const { error } = await supabase.from('funcionarios').delete().eq('id', f.id);
    if (error) { setErro('Não foi possível excluir. Detalhe técnico: ' + error.message); return; }
    mostrarAviso('Funcionário excluído (junto com todos os lançamentos de ponto dele).');
    recarregar();
  }

  const termo = busca.trim().toLowerCase();
  const filtrados = funcionarios.filter((f) =>
    !termo || f.nome.toLowerCase().includes(termo) || (f.matricula || '').toLowerCase().includes(termo) ||
    (f.cargo || '').toLowerCase().includes(termo) || (f.setor || '').toLowerCase().includes(termo)
  );

  return (
    <section>
      <div className="pt-barra">
        <input className="campo" type="search" value={busca} onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, matrícula, cargo ou setor…" />
        <button type="button" className="botao botao-principal" onClick={abrirNovo}>+ Novo Funcionário</button>
      </div>

      {mostrarForm && (
        <form className="cartao" style={{ marginBottom: 16 }} onSubmit={salvar}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: 4 }}>{editandoId ? 'Editar' : 'Novo'} funcionário</h2>

          {!editandoId && usuariosDisponiveis.length > 0 && (
            <>
              <label className="rotulo">Vincular a um usuário do sistema (opcional)</label>
              <select className="campo" value={vincularUsuarioId} onChange={(e) => escolherUsuario(e.target.value)}>
                <option value="">— Cadastrar sem login no sistema —</option>
                {usuariosDisponiveis.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </select>
              <p className="texto-suave" style={{ fontSize: 12, marginTop: 4 }}>
                Vincular preenche o nome automaticamente e evita cadastro duplicado. Deixe em branco para
                cadastrar alguém sem acesso ao sistema (ex.: cozinha, terceirizados).
              </p>
            </>
          )}

          <label className="rotulo">Nome completo *</label>
          <input className="campo" type="text" value={nome} onChange={(e) => setNome(e.target.value)} />

          <div className="pt-duas">
            <div>
              <label className="rotulo">Matrícula</label>
              <input className="campo" type="text" value={matricula} onChange={(e) => setMatricula(e.target.value)} placeholder="Opcional" />
            </div>
            <div>
              <label className="rotulo">Gênero</label>
              <select className="campo" value={genero} onChange={(e) => setGenero(e.target.value)}>
                <option value="M">Masculino</option>
                <option value="F">Feminino</option>
              </select>
            </div>
          </div>

          <div className="pt-duas">
            <div>
              <label className="rotulo">Cargo</label>
              <input className="campo" type="text" value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="Ex.: Camareira" />
            </div>
            <div>
              <label className="rotulo">Setor</label>
              <input className="campo" type="text" value={setor} onChange={(e) => setSetor(e.target.value)} placeholder="Ex.: Governança" />
            </div>
          </div>

          <div className="pt-tres">
            <div>
              <label className="rotulo">Escala</label>
              <select className="campo" value={escala} onChange={(e) => setEscala(e.target.value)}>
                <option value="COMUM">Comum (44h semanais)</option>
                <option value="DOZE_TRINTA_SEIS">12x36</option>
              </select>
            </div>
            <div>
              <label className="rotulo">Carga horária diária padrão</label>
              <input className="campo" type="time" value={cargaHoraria} onChange={(e) => setCargaHoraria(e.target.value)} />
            </div>
            <div>
              <label className="rotulo">Salário (R$) *</label>
              <input className="campo" type="number" min="0.01" step="0.01" value={salario} onChange={(e) => setSalario(e.target.value)} />
            </div>
          </div>

          <label className="pt-toggle" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={quebraCaixa} onChange={(e) => setQuebraCaixa(e.target.checked)} />
            Recebe quebra de caixa (10% do salário, proporcional aos dias trabalhados no mês)
          </label>

          {erroForm && <div className="aviso-erro">{erroForm}</div>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
            <button type="submit" className="botao botao-principal" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
            <button type="button" className="botao botao-suave" onClick={() => setMostrarForm(false)}>Cancelar</button>
          </div>
        </form>
      )}

      {filtrados.length === 0 ? (
        <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
          {funcionarios.length === 0 ? 'Nenhum funcionário cadastrado ainda.' : 'Nenhum funcionário encontrado.'}
        </div>
      ) : (
        <div className="pt-lista">
          {filtrados.map((f) => (
            <div key={f.id} className="cartao pt-item-func" style={!f.ativo ? { opacity: 0.6 } : undefined}>
              <div className="pt-item-func-esq">
                <div className="pt-item-func-topo">
                  <strong>{f.nome}</strong>
                  {!f.ativo && <span className="pt-badge" style={{ background: '#EFEFEF', color: '#666' }}>Inativo</span>}
                  {f.usuario_id && <span className="pt-badge" style={{ background: 'var(--marca-clara)', color: 'var(--marca)' }}>Tem login</span>}
                </div>
                <div className="texto-suave" style={{ fontSize: 13 }}>
                  {f.matricula ? `Matrícula ${f.matricula} · ` : ''}{f.cargo || '—'} · {f.setor || '—'}
                </div>
                <div className="texto-suave" style={{ fontSize: 13 }}>
                  {GENERO_LABEL[f.genero] || '—'} · {ESCALA_LABEL[f.escala]} · {hh(f.carga_horaria)}h padrão
                </div>
                <div className="texto-suave" style={{ fontSize: 13 }}>
                  {dinheiro(f.salario)} {f.quebra_caixa ? '· Quebra de caixa ativa' : ''}
                </div>
              </div>
              <div className="pt-item-func-acoes">
                <button type="button" className="botao botao-suave" onClick={() => alternarAtivo(f)}>
                  {f.ativo ? 'Marcar inativo' : 'Reativar'}
                </button>
                <button type="button" className="botao botao-suave" onClick={() => abrirEdicao(f)}>Editar</button>
                {excluindoId === f.id ? (
                  <span className="pt-confirmar">
                    Excluir (e todos os lançamentos dele)?
                    <button type="button" className="botao botao-perigo" onClick={() => excluir(f)}>Sim</button>
                    <button type="button" className="botao botao-suave" onClick={() => setExcluindoId(null)}>Não</button>
                  </span>
                ) : (
                  <button type="button" className="botao botao-suave" onClick={() => setExcluindoId(f.id)}>Excluir</button>
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
// TELA 2 — LANÇAMENTO DIÁRIO
// ============================================================================

function PainelLancamento({ funcionarios, lancamentos, config, usuario, salvando, setSalvando, mostrarAviso, setErro, recarregar }) {
  const ativos = funcionarios.filter((f) => f.ativo);
  const [funcionarioId, setFuncionarioId] = useState(ativos[0]?.id || '');
  const [data, setData] = useState(hoje());
  const [status, setStatus] = useState('TRABALHADO');
  const [horaEntrada, setHoraEntrada] = useState('');
  const [inicioIntervalo, setInicioIntervalo] = useState('');
  const [fimIntervalo, setFimIntervalo] = useState('');
  const [horaSaida, setHoraSaida] = useState('');
  const [semIntervalo, setSemIntervalo] = useState(false);
  const [feriadoSemCompensacao, setFeriadoSemCompensacao] = useState(false);
  const [erroForm, setErroForm] = useState('');
  const [lancamentoExistenteId, setLancamentoExistenteId] = useState(null);

  const funcionarioAtual = funcionarios.find((f) => f.id === Number(funcionarioId));

  // Carrega automaticamente se já existe lançamento para esse funcionário+data
  useEffect(() => {
    if (!funcionarioId || !data) return;
    const existente = lancamentos.find((l) => l.funcionario_id === Number(funcionarioId) && l.data === data);
    if (existente) {
      setLancamentoExistenteId(existente.id);
      setStatus(existente.status);
      setHoraEntrada(hh(existente.hora_entrada)); setInicioIntervalo(hh(existente.inicio_intervalo));
      setFimIntervalo(hh(existente.fim_intervalo)); setHoraSaida(hh(existente.hora_saida));
      setSemIntervalo(existente.sem_intervalo); setFeriadoSemCompensacao(existente.feriado_sem_compensacao);
    } else {
      setLancamentoExistenteId(null);
      setStatus('TRABALHADO'); setHoraEntrada(''); setInicioIntervalo(''); setFimIntervalo('');
      setHoraSaida(''); setSemIntervalo(false); setFeriadoSemCompensacao(false);
    }
    setErroForm('');
  }, [funcionarioId, data, lancamentos]);

  async function salvar(evento) {
    evento.preventDefault();
    if (salvando || !funcionarioId || !funcionarioAtual) return;
    setErroForm('');

    const registro = {
      funcionario_id: Number(funcionarioId), data, status,
      hora_entrada: status === 'TRABALHADO' ? (horaEntrada || null) : null,
      inicio_intervalo: (status === 'TRABALHADO' && !semIntervalo) ? (inicioIntervalo || null) : null,
      fim_intervalo: (status === 'TRABALHADO' && !semIntervalo) ? (fimIntervalo || null) : null,
      hora_saida: status === 'TRABALHADO' ? (horaSaida || null) : null,
      sem_intervalo: status === 'TRABALHADO' ? semIntervalo : false,
      feriado_sem_compensacao: status === 'TRABALHADO' ? feriadoSemCompensacao : false,
      hotel_id: usuario.hotel_id,
    };

    if (status === 'TRABALHADO') {
      const teste = calcularJornadaTrabalhada(funcionarioAtual, registro);
      if (teste.erro) { setErroForm(teste.erro); return; }
    }

    setSalvando(true);
    let resultado;
    if (lancamentoExistenteId) {
      resultado = await supabase.from('ponto_lancamentos').update(registro).eq('id', lancamentoExistenteId);
    } else {
      resultado = await supabase.from('ponto_lancamentos').insert({ ...registro, criado_por_id: usuario.id });
    }
    setSalvando(false);
    if (resultado.error) { setErroForm('Não foi possível salvar. Detalhe técnico: ' + resultado.error.message); return; }
    mostrarAviso('Lançamento salvo!');
    recarregar();
  }

  // Prévia em tempo real
  let previa = null;
  if (status === 'TRABALHADO' && funcionarioAtual && horaEntrada && horaSaida && (semIntervalo || (inicioIntervalo && fimIntervalo))) {
    previa = calcularJornadaTrabalhada(funcionarioAtual, {
      hora_entrada: horaEntrada, inicio_intervalo: inicioIntervalo, fim_intervalo: fimIntervalo,
      hora_saida: horaSaida, sem_intervalo: semIntervalo, feriado_sem_compensacao: feriadoSemCompensacao,
    });
  }
  const lancamentosComAtual = funcionarioId
    ? [...lancamentos.filter((l) => !(l.funcionario_id === Number(funcionarioId) && l.data === data)),
       { funcionario_id: Number(funcionarioId), data, status, hora_entrada: horaEntrada, inicio_intervalo: inicioIntervalo, fim_intervalo: fimIntervalo, hora_saida: horaSaida }]
    : lancamentos;
  const alertaBritanico = status === 'TRABALHADO' && previa && !previa.erro
    ? detectarPontoBritanico(Number(funcionarioId), data, lancamentosComAtual) : false;
  const alertaDomingoArt386 = status === 'TRABALHADO' && funcionarioAtual?.genero === 'F'
    ? alertaDomingoFeminino(Number(funcionarioId), data, lancamentosComAtual) : false;
  const alertaDomingoGeral = status === 'TRABALHADO' && funcionarioAtual
    ? alertaDomingoFolgaMensal(funcionarioAtual, Number(funcionarioId), data, lancamentosComAtual) : false;

  const historico = funcionarioId
    ? lancamentos.filter((l) => l.funcionario_id === Number(funcionarioId)).sort((a, b) => b.data.localeCompare(a.data)).slice(0, 15)
    : [];

  if (ativos.length === 0) {
    return <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
      Cadastre um funcionário ativo antes de lançar o ponto.
    </div>;
  }

  return (
    <section>
      <form className="cartao" onSubmit={salvar}>
        <div className="pt-duas">
          <div>
            <label className="rotulo">Funcionário *</label>
            <select className="campo" value={funcionarioId} onChange={(e) => setFuncionarioId(e.target.value)}>
              {ativos.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="rotulo">Data *</label>
            <input className="campo" type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </div>
        </div>
        {lancamentoExistenteId && (
          <p className="texto-suave" style={{ fontSize: 12 }}>Já existe um lançamento neste dia — os dados foram carregados para edição.</p>
        )}

        <label className="rotulo">Status do dia</label>
        <select className="campo" value={status} onChange={(e) => setStatus(e.target.value)}>
          {Object.entries(STATUS_LABEL).map(([chave, rotulo]) => <option key={chave} value={chave}>{rotulo}</option>)}
        </select>

        {status === 'TRABALHADO' && (
          <>
            <div className="pt-duas">
              <div>
                <label className="rotulo">Hora de entrada *</label>
                <input className="campo" type="time" value={horaEntrada} onChange={(e) => setHoraEntrada(e.target.value)} />
              </div>
              <div>
                <label className="rotulo">Hora de saída *</label>
                <input className="campo" type="time" value={horaSaida} onChange={(e) => setHoraSaida(e.target.value)} />
              </div>
            </div>
            <label className="pt-toggle">
              <input type="checkbox" checked={semIntervalo} onChange={(e) => setSemIntervalo(e.target.checked)} />
              Sem intervalo intrajornada
            </label>
            {!semIntervalo && (
              <div className="pt-duas">
                <div>
                  <label className="rotulo">Início do intervalo *</label>
                  <input className="campo" type="time" value={inicioIntervalo} onChange={(e) => setInicioIntervalo(e.target.value)} />
                </div>
                <div>
                  <label className="rotulo">Fim do intervalo *</label>
                  <input className="campo" type="time" value={fimIntervalo} onChange={(e) => setFimIntervalo(e.target.value)} />
                </div>
              </div>
            )}
            {funcionarioAtual?.escala !== 'DOZE_TRINTA_SEIS' && (
              <label className="pt-toggle">
                <input type="checkbox" checked={feriadoSemCompensacao} onChange={(e) => setFeriadoSemCompensacao(e.target.checked)} />
                Feriado trabalhado sem compensação (hora extra a 100%)
              </label>
            )}
          </>
        )}

        {erroForm && <div className="aviso-erro">{erroForm}</div>}

        {/* Prévia em tempo real */}
        {status === 'TRABALHADO' && previa && (
          previa.erro ? <div className="aviso-erro">{previa.erro}</div> : (
            <div className="pt-previa">
              <strong style={{ fontSize: 14 }}>Prévia do cálculo</strong>
              <div className="pt-previa-grade">
                <span>Horas normais: <b>{formatarHoras(previa.horasNormaisDecimal)}</b></span>
                <span>Horas noturnas: <b>{formatarHoras(previa.horasNoturnasReduzidas)}</b></span>
                <span>Extra 50%: <b>{formatarHoras(previa.horasExtras50)}</b></span>
                <span>Extra 100%: <b>{formatarHoras(previa.horasExtras100)}</b></span>
                <span>Saldo do dia: <b style={{ color: previa.saldoBancoHorasDia < 0 ? 'var(--erro-texto)' : 'var(--sucesso-texto)' }}>{formatarHoras(previa.saldoBancoHorasDia)}</b></span>
                <span>Vale-alimentação: <b>{dinheiro(config.fornece_alimentacao_completa ? 0 : CCT.VALE_ALIMENTACAO_DIA)}</b></span>
                <span>Custo adicional noturno: <b>{dinheiro(previa.custoAdicionalNoturno)}</b></span>
                <span>Custo horas extras: <b>{dinheiro(previa.custoHorasExtras)}</b></span>
              </div>
              {previa.alertaIntervaloReduzido && (
                <div className="pt-alerta">⚠️ Intervalo reduzido — indenização de {dinheiro(previa.indenizacaoIntervalo)} (Cláusula 23ª).</div>
              )}
              {alertaBritanico && <div className="pt-alerta">⚠️ Ponto britânico: 3+ dias seguidos com os mesmos horários (Súmula 338 TST).</div>}
              {alertaDomingoArt386 && <div className="pt-alerta pt-alerta-critico">🚨 3º domingo seguido trabalhado — exige folga quinzenal (Art. 386 CLT).</div>}
              {alertaDomingoGeral && <div className="pt-alerta">⚠️ Sem folga dominical registrada neste mês (Cláusula 24ª, §4º).</div>}
            </div>
          )
        )}

        <button type="submit" className="botao botao-principal" disabled={salvando} style={{ marginTop: 14 }}>
          {salvando ? 'Salvando…' : 'Salvar Lançamento'}
        </button>
      </form>

      {historico.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h3 style={{ fontSize: '1rem' }}>Histórico recente — {funcionarioAtual?.nome}</h3>
          <div className="pt-tabela-envelope">
            <table className="pt-tabela">
              <thead><tr><th>Data</th><th>Status</th><th>Horário</th><th>Saldo</th></tr></thead>
              <tbody>
                {historico.map((l) => {
                  const calc = funcionarioAtual ? calcularDia(funcionarioAtual, {
                    status: l.status, hora_entrada: hh(l.hora_entrada), inicio_intervalo: hh(l.inicio_intervalo),
                    fim_intervalo: hh(l.fim_intervalo), hora_saida: hh(l.hora_saida), sem_intervalo: l.sem_intervalo,
                    feriado_sem_compensacao: l.feriado_sem_compensacao,
                  }, config.fornece_alimentacao_completa) : SEM_IMPACTO_BANCO;
                  return (
                    <tr key={l.id}>
                      <td>{formatarData(l.data)}</td>
                      <td><span className="pt-badge" style={{ background: '#F0F0F0', color: STATUS_COR[l.status] }}>{STATUS_LABEL[l.status]}</span></td>
                      <td>{l.status === 'TRABALHADO' ? `${hh(l.hora_entrada)}–${hh(l.hora_saida)}` : '—'}</td>
                      <td style={{ color: calc.saldoBancoHorasDia < 0 ? 'var(--erro-texto)' : 'var(--sucesso-texto)' }}>
                        {formatarHoras(calc.saldoBancoHorasDia)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

// ============================================================================
// TELA 3 — PAINEL DE OCORRÊNCIAS
// ============================================================================

function PainelOcorrencias({ funcionarios, lancamentos, nomeFuncionario }) {
  const ocorrencias = [];
  const trabalhados = lancamentos.filter((l) => l.status === 'TRABALHADO');

  trabalhados.forEach((l) => {
    const f = funcionarios.find((x) => x.id === l.funcionario_id);
    if (!f) return;
    const calc = calcularJornadaTrabalhada(f, {
      hora_entrada: hh(l.hora_entrada), inicio_intervalo: hh(l.inicio_intervalo), fim_intervalo: hh(l.fim_intervalo),
      hora_saida: hh(l.hora_saida), sem_intervalo: l.sem_intervalo, feriado_sem_compensacao: l.feriado_sem_compensacao,
    });
    if (calc.erro) return;

    if (calc.alertaIntervaloReduzido) {
      ocorrencias.push({ tipo: 'Intervalo Reduzido', cor: '#8A6100', funcionario: f.nome, data: l.data,
        texto: `Intervalo suprimido — indenização de ${dinheiro(calc.indenizacaoIntervalo)} (Cláusula 23ª).` });
    }
    if (detectarPontoBritanico(f.id, l.data, lancamentos)) {
      ocorrencias.push({ tipo: 'Ponto Britânico', cor: '#A31212', funcionario: f.nome, data: l.data,
        texto: '3+ dias seguidos com os mesmos horários (Súmula 338 TST).' });
    }
    if (f.genero === 'F' && alertaDomingoFeminino(f.id, l.data, lancamentos)) {
      ocorrencias.push({ tipo: 'Escala de Domingos', cor: '#A31212', funcionario: f.nome, data: l.data,
        texto: '3º domingo seguido trabalhado — exige folga quinzenal (Art. 386 CLT).' });
    }
    if (alertaDomingoFolgaMensal(f, f.id, l.data, lancamentos)) {
      ocorrencias.push({ tipo: 'Escala de Domingos', cor: '#8A6100', funcionario: f.nome, data: l.data,
        texto: 'Sem folga dominical registrada neste mês (Cláusula 24ª, §4º). Não se aplica à escala 12x36.' });
    }
  });

  ocorrencias.sort((a, b) => b.data.localeCompare(a.data));
  const contadores = {
    'Ponto Britânico': ocorrencias.filter((o) => o.tipo === 'Ponto Britânico').length,
    'Intervalo Reduzido': ocorrencias.filter((o) => o.tipo === 'Intervalo Reduzido').length,
    'Escala de Domingos': ocorrencias.filter((o) => o.tipo === 'Escala de Domingos').length,
  };

  return (
    <section>
      <div className="pt-numeros">
        <div className="cartao pt-numero"><div className="pt-numero-valor">{contadores['Ponto Britânico']}</div><div className="pt-numero-rot">Ponto Britânico</div></div>
        <div className="cartao pt-numero"><div className="pt-numero-valor">{contadores['Intervalo Reduzido']}</div><div className="pt-numero-rot">Intervalo Reduzido</div></div>
        <div className="cartao pt-numero"><div className="pt-numero-valor">{contadores['Escala de Domingos']}</div><div className="pt-numero-rot">Escala de Domingos</div></div>
      </div>

      {ocorrencias.length === 0 ? (
        <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)', marginTop: 14 }}>
          Nenhuma ocorrência identificada. 🎉
        </div>
      ) : (
        <div className="pt-lista" style={{ marginTop: 14 }}>
          {ocorrencias.map((o, i) => (
            <div key={i} className="cartao" style={{ borderLeft: `4px solid ${o.cor}`, padding: '12px 16px' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="pt-badge" style={{ background: '#F0F0F0', color: o.cor }}>{o.tipo}</span>
                <strong>{o.funcionario}</strong>
                <span className="texto-suave" style={{ fontSize: 13 }}>{formatarData(o.data)}</span>
              </div>
              <div style={{ fontSize: 14, marginTop: 4 }}>{o.texto}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ============================================================================
// TELA 4 — ESPELHO DE PONTO
// ============================================================================

function PainelEspelho({ funcionarios, lancamentos, config }) {
  const ativos = funcionarios.filter((f) => f.ativo);
  const [funcionarioId, setFuncionarioId] = useState(ativos[0]?.id || '');
  const [tipoPeriodo, setTipoPeriodo] = useState('MES'); // MES | ANO | DIA
  const [mesRef, setMesRef] = useState(hoje().slice(0, 7));
  const [anoRef, setAnoRef] = useState(hoje().slice(0, 4));
  const [diaRef, setDiaRef] = useState(hoje());

  const funcionario = funcionarios.find((f) => f.id === Number(funcionarioId));

  function dentroDoPeriodo(dataStr) {
    if (tipoPeriodo === 'MES') return dataStr.slice(0, 7) === mesRef;
    if (tipoPeriodo === 'ANO') return dataStr.slice(0, 4) === anoRef;
    return dataStr === diaRef;
  }

  const doFuncionario = lancamentos
    .filter((l) => l.funcionario_id === Number(funcionarioId) && dentroDoPeriodo(l.data))
    .sort((a, b) => a.data.localeCompare(b.data));

  const linhas = doFuncionario.map((l) => {
    const calc = funcionario ? calcularDia(funcionario, {
      status: l.status, hora_entrada: hh(l.hora_entrada), inicio_intervalo: hh(l.inicio_intervalo),
      fim_intervalo: hh(l.fim_intervalo), hora_saida: hh(l.hora_saida), sem_intervalo: l.sem_intervalo,
      feriado_sem_compensacao: l.feriado_sem_compensacao,
    }, config.fornece_alimentacao_completa) : SEM_IMPACTO_BANCO;
    const alertas = [];
    if (calc.alertaIntervaloReduzido) alertas.push('Intervalo reduzido');
    if (l.status === 'TRABALHADO' && detectarPontoBritanico(l.funcionario_id, l.data, lancamentos)) alertas.push('Ponto britânico');
    if (l.status === 'TRABALHADO' && ehDomingo(l.data)) alertas.push('Domingo trabalhado');
    return { l, calc, alertas };
  });

  const totais = linhas.reduce((acc, { calc }) => ({
    horasNormais: acc.horasNormais + (calc.horasNormaisDecimal || 0),
    horasNoturnas: acc.horasNoturnas + (calc.horasNoturnasReduzidas || 0),
    extras50: acc.extras50 + (calc.horasExtras50 || 0),
    extras100: acc.extras100 + (calc.horasExtras100 || 0),
    saldoBanco: acc.saldoBanco + (calc.saldoBancoHorasDia || 0),
    valeAlimentacao: acc.valeAlimentacao + (calc.valeAlimentacao || 0),
    custoAdicionalNoturno: acc.custoAdicionalNoturno + (calc.custoAdicionalNoturno || 0),
    custoHorasExtras: acc.custoHorasExtras + (calc.custoHorasExtras || 0),
    indenizacaoIntervalo: acc.indenizacaoIntervalo + (calc.indenizacaoIntervalo || 0),
  }), { horasNormais: 0, horasNoturnas: 0, extras50: 0, extras100: 0, saldoBanco: 0, valeAlimentacao: 0, custoAdicionalNoturno: 0, custoHorasExtras: 0, indenizacaoIntervalo: 0 });

  // DSR sobre variáveis só faz sentido no contexto de um mês fechado
  const dsrHoraExtra = tipoPeriodo === 'MES' ? calcularDSRVariaveis(totais.custoHorasExtras, mesRef) : 0;
  const dsrAdicionalNoturno = tipoPeriodo === 'MES' ? calcularDSRVariaveis(totais.custoAdicionalNoturno, mesRef) : 0;

  return (
    <section>
      <div className="pt-filtros">
        <select className="campo" value={funcionarioId} onChange={(e) => setFuncionarioId(e.target.value)}>
          {ativos.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
        </select>
        <div className="mn-periodo">
          {[['MES', 'Mês'], ['ANO', 'Ano'], ['DIA', 'Um dia']].map(([chave, rotulo]) => (
            <button key={chave} type="button" className={tipoPeriodo === chave ? 'pt-periodo-botao pt-periodo-ativo' : 'pt-periodo-botao'}
              onClick={() => setTipoPeriodo(chave)}>{rotulo}</button>
          ))}
        </div>
        {tipoPeriodo === 'MES' && <input className="campo" type="month" value={mesRef} onChange={(e) => setMesRef(e.target.value)} />}
        {tipoPeriodo === 'ANO' && <input className="campo" type="number" value={anoRef} onChange={(e) => setAnoRef(e.target.value)} style={{ maxWidth: 120 }} />}
        {tipoPeriodo === 'DIA' && <input className="campo" type="date" value={diaRef} onChange={(e) => setDiaRef(e.target.value)} />}
      </div>

      {linhas.length === 0 ? (
        <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>Nenhum lançamento no período.</div>
      ) : (
        <div className="pt-tabela-envelope">
          <table className="pt-tabela">
            <thead>
              <tr><th>Data</th><th>Status</th><th>Horário</th><th>Normais</th><th>Noturnas</th><th>Extra 50%</th><th>Extra 100%</th><th>Saldo</th><th>Alertas</th></tr>
            </thead>
            <tbody>
              {linhas.map(({ l, calc, alertas }) => (
                <tr key={l.id}>
                  <td>{formatarData(l.data)}</td>
                  <td>{STATUS_LABEL[l.status]}</td>
                  <td>{l.status === 'TRABALHADO' ? `${hh(l.hora_entrada)}–${hh(l.hora_saida)}` : '—'}</td>
                  <td>{formatarHoras(calc.horasNormaisDecimal)}</td>
                  <td>{formatarHoras(calc.horasNoturnasReduzidas)}</td>
                  <td>{formatarHoras(calc.horasExtras50)}</td>
                  <td>{formatarHoras(calc.horasExtras100)}</td>
                  <td style={{ color: calc.saldoBancoHorasDia < 0 ? 'var(--erro-texto)' : 'var(--sucesso-texto)' }}>{formatarHoras(calc.saldoBancoHorasDia)}</td>
                  <td style={{ fontSize: 12, color: 'var(--erro-texto)' }}>{alertas.join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700 }}>
                <td colSpan={3}>Totais do período</td>
                <td>{formatarHoras(totais.horasNormais)}</td>
                <td>{formatarHoras(totais.horasNoturnas)}</td>
                <td>{formatarHoras(totais.extras50)}</td>
                <td>{formatarHoras(totais.extras100)}</td>
                <td style={{ color: totais.saldoBanco < 0 ? 'var(--erro-texto)' : 'var(--sucesso-texto)' }}>{formatarHoras(totais.saldoBanco)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="pt-numeros" style={{ marginTop: 14 }}>
        <div className="cartao pt-numero"><div className="pt-numero-valor" style={{ fontSize: 18 }}>{dinheiro(totais.valeAlimentacao)}</div><div className="pt-numero-rot">Vale-alimentação</div></div>
        <div className="cartao pt-numero"><div className="pt-numero-valor" style={{ fontSize: 18 }}>{dinheiro(totais.custoAdicionalNoturno)}</div><div className="pt-numero-rot">Adicional noturno</div></div>
        <div className="cartao pt-numero"><div className="pt-numero-valor" style={{ fontSize: 18 }}>{dinheiro(totais.custoHorasExtras)}</div><div className="pt-numero-rot">Custo horas extras</div></div>
        <div className="cartao pt-numero"><div className="pt-numero-valor" style={{ fontSize: 18 }}>{dinheiro(totais.indenizacaoIntervalo)}</div><div className="pt-numero-rot">Indenização intervalo</div></div>
        {tipoPeriodo === 'MES' && (
          <>
            <div className="cartao pt-numero"><div className="pt-numero-valor" style={{ fontSize: 18 }}>{dinheiro(dsrHoraExtra)}</div><div className="pt-numero-rot">DSR s/ Horas Extras</div></div>
            <div className="cartao pt-numero"><div className="pt-numero-valor" style={{ fontSize: 18 }}>{dinheiro(dsrAdicionalNoturno)}</div><div className="pt-numero-rot">DSR s/ Adicional Noturno</div></div>
          </>
        )}
      </div>
    </section>
  );
}

// ============================================================================
// TELA 5 — RELATÓRIO GERENCIAL DE RH
// ============================================================================

function PainelRelatorioGerencial({ funcionarios, lancamentos, config }) {
  const ativos = funcionarios.filter((f) => f.ativo);
  const [mesRef, setMesRef] = useState(hoje().slice(0, 7));

  if (ativos.length === 0) {
    return <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>Cadastre funcionários ativos para gerar o relatório.</div>;
  }

  // ---- Banco de Horas analítico (saldo acumulado desde o início dos registros) ----
  const bancoHoras = ativos.map((f) => {
    const doFuncionario = lancamentos.filter((l) => l.funcionario_id === f.id);
    const saldo = doFuncionario.reduce((soma, l) => {
      const calc = calcularDia(f, {
        status: l.status, hora_entrada: hh(l.hora_entrada), inicio_intervalo: hh(l.inicio_intervalo),
        fim_intervalo: hh(l.fim_intervalo), hora_saida: hh(l.hora_saida), sem_intervalo: l.sem_intervalo,
        feriado_sem_compensacao: l.feriado_sem_compensacao,
      }, config.fornece_alimentacao_completa);
      return soma + (calc.saldoBancoHorasDia || 0);
    }, 0);
    return { funcionario: f, saldo };
  }).sort((a, b) => Math.abs(b.saldo) - Math.abs(a.saldo));

  // ---- Impacto Financeiro Consolidado (mês escolhido) ----
  const totalDiasNoMes = diasNoMes(mesRef);
  const linhasFinanceiro = ativos.map((f) => {
    const doMes = lancamentos.filter((l) => l.funcionario_id === f.id && l.data.slice(0, 7) === mesRef);
    const diasTrabalhados = doMes.filter((l) => l.status === 'TRABALHADO').length;
    let valeAlimentacao = 0, custoAdicionalNoturno = 0, custoHorasExtras = 0, indenizacaoIntervalo = 0;
    doMes.forEach((l) => {
      const calc = calcularDia(f, {
        status: l.status, hora_entrada: hh(l.hora_entrada), inicio_intervalo: hh(l.inicio_intervalo),
        fim_intervalo: hh(l.fim_intervalo), hora_saida: hh(l.hora_saida), sem_intervalo: l.sem_intervalo,
        feriado_sem_compensacao: l.feriado_sem_compensacao,
      }, config.fornece_alimentacao_completa);
      valeAlimentacao += calc.valeAlimentacao || 0;
      custoAdicionalNoturno += calc.custoAdicionalNoturno || 0;
      custoHorasExtras += calc.custoHorasExtras || 0;
      indenizacaoIntervalo += calc.indenizacaoIntervalo || 0;
    });
    const quebraCaixa = f.quebra_caixa ? calcularQuebraCaixaProporcional(f.salario, diasTrabalhados, totalDiasNoMes) : 0;
    const dsrHoraExtra = calcularDSRVariaveis(custoHorasExtras, mesRef);
    const dsrAdicionalNoturno = calcularDSRVariaveis(custoAdicionalNoturno, mesRef);
    const odontologico = CCT.BENEFICIO_ODONTOLOGICO;
    const total = Number(f.salario) + quebraCaixa + odontologico + custoAdicionalNoturno + custoHorasExtras +
      valeAlimentacao + indenizacaoIntervalo + dsrHoraExtra + dsrAdicionalNoturno;
    return { funcionario: f, quebraCaixa, odontologico, custoAdicionalNoturno, custoHorasExtras, valeAlimentacao, indenizacaoIntervalo, dsrHoraExtra, dsrAdicionalNoturno, total };
  });
  const totalGeral = linhasFinanceiro.reduce((s, l) => s + l.total, 0);

  return (
    <section>
      <h3 className="pt-subtitulo">Banco de Horas Analítico</h3>
      <div className="pt-tabela-envelope">
        <table className="pt-tabela">
          <thead><tr><th>Funcionário</th><th>Cargo</th><th>Saldo acumulado</th></tr></thead>
          <tbody>
            {bancoHoras.map(({ funcionario, saldo }) => (
              <tr key={funcionario.id}>
                <td>{funcionario.nome}</td>
                <td>{funcionario.cargo || '—'}</td>
                <td style={{ color: Math.abs(saldo) > CCT.BANCO_HORAS_ALERTA_HORAS ? 'var(--erro-texto)' : 'var(--sucesso-texto)', fontWeight: 700 }}>
                  {formatarHoras(saldo)} {Math.abs(saldo) > CCT.BANCO_HORAS_ALERTA_HORAS ? '⚠️' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="texto-suave" style={{ fontSize: 12, marginTop: 6 }}>
        ⚠️ em vermelho: saldo acima de {CCT.BANCO_HORAS_ALERTA_HORAS}h (positivo ou negativo) — considere programar folga compensatória.
      </p>

      <h3 className="pt-subtitulo" style={{ marginTop: 24 }}>Impacto Financeiro Consolidado</h3>
      <input className="campo" type="month" value={mesRef} onChange={(e) => setMesRef(e.target.value)} style={{ maxWidth: 200, marginBottom: 12 }} />
      <div className="pt-tabela-envelope">
        <table className="pt-tabela">
          <thead>
            <tr>
              <th>Funcionário</th><th>Salário base</th><th>Quebra caixa</th><th>Odontológico</th>
              <th>Ad. Noturno</th><th>Horas Extras</th><th>Vale-alim.</th><th>Indeniz.</th>
              <th>DSR HE</th><th>DSR AN</th><th>Total</th>
            </tr>
          </thead>
          <tbody>
            {linhasFinanceiro.map((l) => (
              <tr key={l.funcionario.id}>
                <td>{l.funcionario.nome}</td>
                <td>{dinheiro(l.funcionario.salario)}</td>
                <td>{dinheiro(l.quebraCaixa)}</td>
                <td>{dinheiro(l.odontologico)}</td>
                <td>{dinheiro(l.custoAdicionalNoturno)}</td>
                <td>{dinheiro(l.custoHorasExtras)}</td>
                <td>{dinheiro(l.valeAlimentacao)}</td>
                <td>{dinheiro(l.indenizacaoIntervalo)}</td>
                <td>{dinheiro(l.dsrHoraExtra)}</td>
                <td>{dinheiro(l.dsrAdicionalNoturno)}</td>
                <td style={{ fontWeight: 700 }}>{dinheiro(l.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 700 }}>
              <td colSpan={10}>Total geral da folha do mês</td>
              <td>{dinheiro(totalGeral)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="texto-suave" style={{ fontSize: 12, marginTop: 8 }}>
        Este relatório soma as verbas calculadas pelo motor de Ponto. Não substitui a folha de pagamento
        completa (INSS, FGTS, IRRF, adiantamentos, vale-transporte, comissões etc. não entram aqui).
      </p>
    </section>
  );
}

// ============================================================================
// ESTILOS
// ============================================================================

function EstilosPonto() {
  return (
    <style>{`
      .pt-config-topo { background: var(--fundo); border-radius: 10px; padding: 10px 14px; margin: 10px 0 14px; }
      .pt-toggle { display: flex; align-items: center; gap: 10px; font-size: 14px; cursor: pointer; padding: 6px 0; }
      .pt-toggle input { width: 20px; height: 20px; flex-shrink: 0; }

      .pt-abas { display: flex; gap: 6px; overflow-x: auto; margin: 0 0 16px; padding-bottom: 4px; }
      .pt-aba {
        border: 1px solid var(--borda); background: var(--branco); color: var(--tinta);
        border-radius: 999px; padding: 10px 16px; font-size: 14px; font-weight: 600;
        cursor: pointer; white-space: nowrap; min-height: 42px;
      }
      .pt-aba-ativa { background: var(--marca); border-color: var(--marca); color: var(--branco); }

      .pt-barra { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
      .pt-duas { display: grid; grid-template-columns: 1fr; gap: 0 14px; }
      .pt-tres { display: grid; grid-template-columns: 1fr; gap: 0 14px; }

      .pt-lista { display: flex; flex-direction: column; gap: 12px; }
      .pt-item-func { display: flex; flex-direction: column; gap: 10px; padding: 16px; }
      .pt-item-func-topo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .pt-item-func-topo strong { font-size: 16px; }
      .pt-badge { display: inline-block; font-size: 12px; font-weight: 700; border-radius: 999px; padding: 3px 10px; }
      .pt-item-func-acoes { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
      .pt-confirmar { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--erro-texto); flex-wrap: wrap; }

      .pt-previa { background: var(--fundo); border-radius: 12px; padding: 14px; margin-top: 14px; }
      .pt-previa-grade { display: grid; grid-template-columns: 1fr; gap: 6px; font-size: 13px; margin-top: 8px; }
      .pt-alerta {
        background: var(--erro-fundo); color: var(--erro-texto); border-radius: 8px;
        padding: 8px 10px; font-size: 13px; margin-top: 8px; font-weight: 600;
      }
      .pt-alerta-critico { background: #A31212; color: #FFFFFF; }

      .pt-tabela-envelope { overflow-x: auto; }
      .pt-tabela { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 640px; }
      .pt-tabela th { text-align: left; border-bottom: 2px solid var(--borda); padding: 6px 8px; font-size: 12px; white-space: nowrap; }
      .pt-tabela td { border-bottom: 1px solid var(--borda); padding: 6px 8px; white-space: nowrap; }
      .pt-tabela tfoot td { border-top: 2px solid var(--borda); border-bottom: none; }

      .pt-numeros { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .pt-numero { text-align: center; padding: 14px 8px; }
      .pt-numero-valor { font-family: var(--fonte-titulo); font-weight: 700; font-size: 26px; color: var(--marca); }
      .pt-numero-rot { font-size: 12px; color: var(--texto-suave); margin-top: 4px; }

      .pt-filtros { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
      .pt-periodo-botao {
        border: 1px solid var(--borda); background: var(--branco); color: var(--tinta);
        border-radius: 999px; padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer;
      }
      .pt-periodo-ativo { background: var(--marca); border-color: var(--marca); color: var(--branco); }

      .pt-subtitulo { font-size: 1rem; margin-bottom: 10px; }

      @media (min-width: 640px) {
        .pt-barra { flex-direction: row; align-items: center; }
        .pt-barra .campo { flex: 1; }
        .pt-duas { grid-template-columns: 1fr 1fr; }
        .pt-tres { grid-template-columns: 1fr 1fr 1fr; }
        .pt-item-func { flex-direction: row; justify-content: space-between; align-items: flex-start; }
        .pt-previa-grade { grid-template-columns: 1fr 1fr; }
        .pt-numeros { grid-template-columns: repeat(4, 1fr); }
        .pt-filtros { flex-direction: row; align-items: center; }
      }
    `}</style>
  );
}
