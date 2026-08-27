'use client';

// ============================================================================
// GOVERNANÇA (Housekeeping)
// - Camareira: só vê os quartos SUJOS pré-atribuídos a ela. Clicar num quarto
//   específico JÁ REPRESENTA a leitura do QR físico daquele apartamento —
//   não existe botão genérico de "escanear". Sem cronômetro visível na tela
//   (o tempo só é registrado para os Insights). Checklist de 7 itens.
// - Ao finalizar: pop-up "Detectou problema de manutenção?" (Sim → cria
//   chamado em Manutenção, origem GOVERNANCA) seguido automaticamente do
//   pop-up "Encontrou item esquecido?" (Sim → cadastra em Achados e Perdidos,
//   origem GOVERNANCA, foto obrigatória, local pré-preenchido).
// - Quartos (admin): cadastro, status colorido, camareira responsável,
//   "Marcar sujo" (simula check-out). Quarto sem camareira fica invisível
//   pra todo mundo na tela de arrumação.
// - Insights (admin): limpos x pendentes, ranking de produtividade por
//   camareira, log detalhado (Apartamento | Camareira | Início | Fim | Duração).
// - Configurações (admin): status da integração real com a Cloudbeds
//   (reaproveita a mesma credencial já usada em Fichas de Hóspedes/PDV — não
//   tem chave própria aqui) + botão de testar conexão. O vínculo entre cada
//   apartamento e o quarto correspondente na Cloudbeds é feito na aba
//   "Quartos". Ao marcar um quarto como sujo, ou finalizar a arrumação
//   (fica limpo), o status é enviado de verdade pra Cloudbeds via
//   POST /postHousekeepingStatus (endpoint oficial, API v1.3) — só quando o
//   quarto já tiver esse vínculo configurado.
// ============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { bloquearSeNaoPermitido } from '../../lib/restricaoAcesso';

// ---- Constantes -------------------------------------------------------------

const STATUS_QUARTO_LABEL = {
  LIMPO: 'Limpo', SUJO: 'Sujo', EM_ARRUMACAO: 'Em Arrumação', MANUTENCAO: 'Manutenção',
};
const STATUS_QUARTO_COR = {
  LIMPO: { fundo: '#DDF2E4', texto: '#1E6B3C' },
  SUJO: { fundo: '#FBDDDD', texto: '#A31212' },
  EM_ARRUMACAO: { fundo: '#FDF3D7', texto: '#8A6100' },
  MANUTENCAO: { fundo: '#EFEFEF', texto: '#666666' },
};

// Estado interno detalhado — 8 situações operacionais. Separado do
// STATUS_QUARTO_LABEL acima: aquele controla o fluxo de trabalho da
// camareira (sujo → em arrumação → limpo); este classifica a SITUAÇÃO do
// quarto (é uma saída? tem hóspede ainda? tá interditado?) e é o que
// decide o que mandar pra Cloudbeds quando a arrumação termina.
const ESTADO_APARTAMENTO_LABEL = {
  SAIDA_SUJO: 'Saída / Apt Sujo',
  ARRUMACAO_OCUPADO: 'Arrumação / Apt ocupado',
  VIROU_ARRUMACAO_OCUPADO: 'Virou arrumação / Apt ocupado',
  NAO_DESEJA_ARRUMACAO_OCUPADO: 'Não deseja arrumação / Apt ocupado',
  PREVISAO_SAIDA_OCUPADO: 'Previsão de saída / Apt ocupado',
  LIMPO: 'Limpo / Apt limpo',
  SERVICOS_GERAIS: 'Serviços gerais',
  INTERDITADO: 'Interditado',
};

// Só "Limpo / Apt limpo" libera o quarto na Cloudbeds (manda "clean").
// Todos os outros 7 estados mantêm "dirty" lá — mesmo que a camareira já
// tenha arrumado aqui no nosso sistema — porque ou ainda tem hóspede no
// quarto (não pode vender), ou o quarto está em manutenção/interditado.
function condicaoCloudbedsParaEstado(estado) {
  return estado === 'LIMPO' ? 'clean' : 'dirty';
}

const CHECKLIST_ITENS = [
  { chave: 'trocaEnxoval', rotulo: 'Troca de enxoval' },
  { chave: 'limpezaApartamento', rotulo: 'Limpeza do apartamento' },
  { chave: 'limpezaBanheiro', rotulo: 'Limpeza do banheiro' },
  { chave: 'verificadoTv', rotulo: 'Verificado Televisão' },
  { chave: 'verificadoAr', rotulo: 'Verificado Ar condicionado' },
  { chave: 'verificadoTelefone', rotulo: 'Verificado Telefone' },
  { chave: 'verificadoPorta', rotulo: 'Verificado porta e fechadura' },
];

const PRIORIDADE_LABEL = { BAIXA: 'Baixa', MEDIA: 'Média', ALTA: 'Alta' };

const CATEGORIA_ACHADOS_LABEL = {
  ELETRONICOS: 'Eletrônicos', ROUPAS: 'Roupas', DOCUMENTOS: 'Documentos', JOIAS: 'Joias', OUTROS: 'Outros',
};

// ---- Funções de apoio -------------------------------------------------------

function formatarDataHora(valor) {
  if (!valor) return '—';
  try {
    return new Date(valor).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch (e) { return String(valor); }
}

function duracaoLegivel(minutos) {
  if (!isFinite(minutos) || minutos <= 0) return '—';
  if (minutos < 60) return `${Math.round(minutos)} min`;
  const horas = minutos / 60;
  return `${horas.toFixed(1)} h`;
}

const CHECKLIST_VAZIO = CHECKLIST_ITENS.reduce((acc, item) => ({ ...acc, [item.chave]: false }), {});

// ---- Componente principal ---------------------------------------------------

export default function Governanca() {
  const router = useRouter();

  const [verificandoLogin, setVerificandoLogin] = useState(true);
  const [usuario, setUsuario] = useState(null);
  const [colegas, setColegas] = useState([]);
  const [camareiras, setCamareiras] = useState([]);
  const [nomesUsuarios, setNomesUsuarios] = useState({});

  const [quartos, setQuartos] = useState([]);
  const [sessoes, setSessoes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);

  const [subAba, setSubAba] = useState('camareira'); // camareira | quartos | insights | config

  // ---- Camareira: sessão ativa ----
  const [sessaoAtiva, setSessaoAtiva] = useState(null); // {id, quarto, checklist}
  const [checklist, setChecklist] = useState(CHECKLIST_VAZIO);
  const [msgSync, setMsgSync] = useState('');

  // ---- Pop-ups pós-limpeza ----
  const [popupManutencao, setPopupManutencao] = useState(null); // {quartoNumero}
  const [manutTemProblema, setManutTemProblema] = useState(null); // true/false
  const [manutDescricao, setManutDescricao] = useState('');
  const [manutPrioridade, setManutPrioridade] = useState('MEDIA');

  const [popupAchados, setPopupAchados] = useState(null); // {quartoNumero}
  const [achadosTemItem, setAchadosTemItem] = useState(null);
  const [achadosFoto, setAchadosFoto] = useState(null);
  const [achadosCategoria, setAchadosCategoria] = useState('OUTROS');
  const [achadosDescricao, setAchadosDescricao] = useState('');
  const [erroPopup, setErroPopup] = useState('');

  // ---- Quartos (admin) ----
  const [mostrarFormNovoQuarto, setMostrarFormNovoQuarto] = useState(false);
  const [editandoQuartoId, setEditandoQuartoId] = useState(null);
  const [qNumero, setQNumero] = useState('');
  const [qCamareira, setQCamareira] = useState('');
  const [qEstadoApartamento, setQEstadoApartamento] = useState('SAIDA_SUJO');
  const [erroFormQuarto, setErroFormQuarto] = useState('');
  const [excluindoQuartoId, setExcluindoQuartoId] = useState(null);

  // ---- Insights ----
  const [insightPeriodo, setInsightPeriodo] = useState('MES');

  // ---- Configurações (Cloudbeds) ----
  const [config, setConfig] = useState(null);
  const [quartosCloudbeds, setQuartosCloudbeds] = useState(null); // null = ainda não carregado
  const [carregandoCloudbeds, setCarregandoCloudbeds] = useState(false);
  const [erroCloudbeds, setErroCloudbeds] = useState('');
  const [salvandoVinculo, setSalvandoVinculo] = useState(null); // id do quarto sendo vinculado
  const [importandoCloudbeds, setImportandoCloudbeds] = useState(false);
  const [sincronizandoStatus, setSincronizandoStatus] = useState(false);
  const [configurandoWebhook, setConfigurandoWebhook] = useState(false);
  const [erroWebhook, setErroWebhook] = useState('');
  const [webhookAtivo, setWebhookAtivo] = useState(false);

  const souAdmin = usuario?.papel === 'ADMIN';
  // Quartos: admin e colaborador podem ver e operar (é onde se atribui a
  // camareira de cada apartamento). Insights e Configurações continuam só admin.
  const podeVerQuartos = souAdmin || usuario?.papel === 'COLABORADOR';

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
      if (bloquearSeNaoPermitido(dadosUsuario.papel, router, '/governanca')) return;
      setVerificandoLogin(false);
    }
    verificar();
    return () => { ativo = false; };
  }, [router]);

  const carregarTudo = useCallback(async (u) => {
    setCarregando(true);
    setErro('');

    const { data: pessoas } = await supabase
      .from('usuarios').select('id, nome, papel').eq('hotel_id', u.hotel_id).order('nome', { ascending: true });
    if (pessoas) {
      setColegas(pessoas);
      setCamareiras(pessoas.filter((p) => p.papel === 'CAMAREIRA'));
      const mapa = {};
      pessoas.forEach((p) => { mapa[p.id] = p.nome; });
      setNomesUsuarios(mapa);
    }

    const { data: listaQuartos, error: e1 } = await supabase
      .from('quartos').select('*').order('numero', { ascending: true });
    if (e1) setErro('Não foi possível carregar os quartos. Detalhe técnico: ' + e1.message);
    else setQuartos(listaQuartos || []);

    const { data: listaSessoes } = await supabase
      .from('governanca_sessoes').select('*').order('inicio_em', { ascending: false }).limit(1000);
    setSessoes(listaSessoes || []);

    if (u.papel === 'ADMIN') {
      const { data: cfg } = await supabase
        .from('governanca_config').select('*').eq('hotel_id', u.hotel_id).maybeSingle();
      setConfig(cfg);

      const { data: hotelInfo } = await supabase
        .from('hoteis').select('governanca_webhook_id').eq('id', u.hotel_id).maybeSingle();
      setWebhookAtivo(!!hotelInfo?.governanca_webhook_id);
    }

    setCarregando(false);
  }, []);

  useEffect(() => {
    if (usuario) carregarTudo(usuario);
  }, [usuario, carregarTudo]);

  function mostrarSync(msg) {
    setMsgSync(msg);
    setTimeout(() => setMsgSync(''), 4000);
  }

  // Envia a mudança de status pra Cloudbeds de verdade (via nossa rota de
  // servidor — a chave nunca passa pelo navegador). Se o quarto ainda não
  // tiver vínculo configurado, avisa isso claramente em vez de fingir que
  // sincronizou.
  async function sincronizarComCloudbeds(quarto, roomCondition) {
    try {
      const { data: sessao } = await supabase.auth.getSession();
      const resposta = await fetch('/api/governanca-atualizar-cloudbeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.session.access_token}` },
        body: JSON.stringify({ quartoId: quarto.id, roomCondition }),
      });
      const resultado = await resposta.json();
      if (resultado.naoVinculado) {
        mostrarSync(`Apartamento ${quarto.numero}: status atualizado aqui (esse quarto ainda não está vinculado a um quarto da Cloudbeds — configure em Quartos).`);
        return;
      }
      if (!resposta.ok || resultado.erro) {
        mostrarSync(`⚠️ Apartamento ${quarto.numero}: status atualizado aqui, mas a Cloudbeds recusou — ${resultado.erro || 'erro desconhecido'}`);
        return;
      }
      mostrarSync(`✅ Apartamento ${quarto.numero}: status sincronizado com a Cloudbeds de verdade.`);
    } catch (e) {
      mostrarSync(`⚠️ Apartamento ${quarto.numero}: status atualizado aqui, mas houve falha de conexão ao enviar para a Cloudbeds.`);
    }
  }

  // ================= CAMAREIRA: fluxo de arrumação =================

  // Só os quartos SUJOS atribuídos a ela — sem etapa de "escanear para ver a
  // lista": a lista já é o que aparece, e clicar num quarto específico É a
  // leitura do QR daquele apartamento.
  const meusQuartos = quartos.filter((q) => q.status === 'SUJO' && q.camareira_id === usuario?.id);

  async function iniciarArrumacao(quarto) {
    if (salvando) return;
    setSalvando(true);
    const inicioEm = new Date().toISOString();
    const { data: novaSessao, error } = await supabase
      .from('governanca_sessoes')
      .insert({
        quarto_id: quarto.id,
        quarto_numero: quarto.numero,
        camareira_id: usuario.id,
        camareira_nome: usuario.nome,
        inicio_em: inicioEm,
        checklist: CHECKLIST_VAZIO,
        hotel_id: usuario.hotel_id,
      })
      .select().single();
    if (error) { setSalvando(false); setErro('Não foi possível iniciar. Detalhe técnico: ' + error.message); return; }

    await supabase.from('quartos').update({ status: 'EM_ARRUMACAO' }).eq('id', quarto.id);
    setSalvando(false);
    setChecklist(CHECKLIST_VAZIO);
    setSessaoAtiva({ ...novaSessao, quarto });
    setQuartos(quartos.map((q) => (q.id === quarto.id ? { ...q, status: 'EM_ARRUMACAO' } : q)));
    // Não há status equivalente a "em arrumação" na Cloudbeds (ela só
    // conhece limpo/sujo/inspecionado) — por isso não avisamos nada aqui;
    // a sincronização de verdade acontece quando o quarto fica pronto.
  }

  async function alternarChecklist(chave) {
    const novo = { ...checklist, [chave]: !checklist[chave] };
    setChecklist(novo);
    if (sessaoAtiva) {
      await supabase.from('governanca_sessoes').update({ checklist: novo }).eq('id', sessaoAtiva.id);
    }
  }

  async function finalizarArrumacao() {
    if (!sessaoAtiva || salvando) return;
    setSalvando(true);
    const fimEm = new Date().toISOString();
    const duracaoMinutos = (new Date(fimEm) - new Date(sessaoAtiva.inicio_em)) / 60000;

    const { error } = await supabase
      .from('governanca_sessoes')
      .update({ fim_em: fimEm, duracao_minutos: duracaoMinutos, checklist })
      .eq('id', sessaoAtiva.id);
    if (error) { setSalvando(false); setErro('Não foi possível finalizar. Detalhe técnico: ' + error.message); return; }

    // Se era uma saída (checkout), a arrumação terminando já deixa o
    // quarto pronto pra vender — o estado interno também vira "Limpo". Se
    // era um quarto ocupado (pernoite), o estado interno continua o mesmo
    // (o hóspede segue lá) — só marcamos aqui, localmente, que a arrumação
    // de hoje já foi feita.
    const eraSaidaSuja = sessaoAtiva.quarto.estado_apartamento === 'SAIDA_SUJO';
    const novoEstadoApartamento = eraSaidaSuja ? 'LIMPO' : (sessaoAtiva.quarto.estado_apartamento || 'LIMPO');
    const condicaoCloudbeds = condicaoCloudbedsParaEstado(novoEstadoApartamento);

    await supabase.from('quartos')
      .update({ status: 'LIMPO', estado_apartamento: novoEstadoApartamento, ultima_limpeza: fimEm })
      .eq('id', sessaoAtiva.quarto.id);

    setSalvando(false);
    const numero = sessaoAtiva.quarto.numero;
    setQuartos(quartos.map((q) => (q.id === sessaoAtiva.quarto.id ? { ...q, status: 'LIMPO', estado_apartamento: novoEstadoApartamento, ultima_limpeza: fimEm } : q)));
    sincronizarComCloudbeds(sessaoAtiva.quarto, condicaoCloudbeds);

    setPopupManutencao({ quartoNumero: numero });
    setManutTemProblema(null); setManutDescricao(''); setManutPrioridade('MEDIA'); setErroPopup('');
    setSessaoAtiva(null);
    carregarTudo(usuario);
  }

  // ---- Pop-up 1: Manutenção ----
  async function confirmarPopupManutencao() {
    setErroPopup('');
    if (manutTemProblema === true) {
      if (!manutDescricao.trim()) { setErroPopup('Descreva o problema encontrado.'); return; }
      setSalvando(true);
      const local = `Apartamento ${popupManutencao.quartoNumero}`;
      const { error } = await supabase.from('manutencoes').insert({
        local, descricao: manutDescricao.trim(), prioridade: manutPrioridade,
        origem: 'GOVERNANCA', criado_por_id: usuario.id, hotel_id: usuario.hotel_id,
      });
      if (!error) {
        await supabase.from('manutencoes_log').insert({
          usuario_id: usuario.id, local, acao: 'Chamado aberto',
          detalhe: `Chamado aberto via checklist da governança por ${usuario.nome} (prioridade ${PRIORIDADE_LABEL[manutPrioridade]}).`,
          hotel_id: usuario.hotel_id,
        });
      }
      setSalvando(false);
      if (error) { setErroPopup('Não foi possível abrir o chamado. Detalhe técnico: ' + error.message); return; }
      mostrarAviso('Chamado de manutenção aberto!');
    }
    // Sim OU Não: segue automaticamente para o pop-up de achados e perdidos
    setPopupAchados({ quartoNumero: popupManutencao.quartoNumero });
    setAchadosTemItem(null); setAchadosFoto(null); setAchadosCategoria('OUTROS'); setAchadosDescricao(''); setErroPopup('');
    setPopupManutencao(null);
  }

  // ---- Pop-up 2: Achados e Perdidos ----
  async function confirmarPopupAchados() {
    setErroPopup('');
    if (achadosTemItem === true) {
      if (!achadosFoto) { setErroPopup('A foto do item é obrigatória.'); return; }
      if (!achadosDescricao.trim()) { setErroPopup('Descreva o item encontrado.'); return; }

      setSalvando(true);
      const caminho = `${usuario.hotel_id}/achados/${Date.now()}_${achadosFoto.name}`;
      const { error: erroUpload } = await supabase.storage.from('anexos').upload(caminho, achadosFoto);
      if (erroUpload) {
        setSalvando(false);
        setErroPopup('Não foi possível enviar a foto. Detalhe técnico: ' + erroUpload.message);
        return;
      }

      const local = `Apartamento ${popupAchados.quartoNumero}`;
      const { error } = await supabase.from('achados_perdidos').insert({
        foto_caminho: caminho, foto_nome: achadosFoto.name,
        categoria: achadosCategoria, descricao: achadosDescricao.trim(),
        local_encontrado: local, origem: 'GOVERNANCA', status: 'AGUARDANDO',
        registrado_por_id: usuario.id, hotel_id: usuario.hotel_id,
      });
      if (!error) {
        await supabase.from('achados_perdidos_log').insert({
          usuario_id: usuario.id, acao: 'Cadastrou Item',
          detalhe: `Item encontrado em ${local}, via checklist da governança.`,
          hotel_id: usuario.hotel_id,
        });
      }
      setSalvando(false);
      if (error) { setErroPopup('Não foi possível registrar o item. Detalhe técnico: ' + error.message); return; }
      mostrarAviso('Item registrado em Achados e Perdidos!');
    }
    // Encerra o fluxo, Sim ou Não
    setPopupAchados(null);
  }

  // ================= QUARTOS (admin) =================

  function abrirNovoQuarto() {
    setEditandoQuartoId(null);
    setQNumero(''); setQCamareira(''); setQEstadoApartamento('SAIDA_SUJO'); setErroFormQuarto('');
    setMostrarFormNovoQuarto(true);
  }

  function abrirEdicaoQuarto(q) {
    setMostrarFormNovoQuarto(false);
    setEditandoQuartoId(q.id);
    setQNumero(q.numero); setQCamareira(q.camareira_id ? String(q.camareira_id) : '');
    setQEstadoApartamento(q.estado_apartamento || 'SAIDA_SUJO');
    setErroFormQuarto('');
  }

  async function salvarQuarto(evento) {
    evento.preventDefault();
    if (salvando) return;
    setErroFormQuarto('');
    if (!qNumero.trim()) { setErroFormQuarto('Informe o número do apartamento.'); return; }

    const dados = {
      numero: qNumero.trim(),
      camareira_id: qCamareira ? Number(qCamareira) : null,
      estado_apartamento: qEstadoApartamento,
    };

    setSalvando(true);
    if (editandoQuartoId) {
      const quartoAntes = quartos.find((q) => q.id === editandoQuartoId);
      const estadoMudou = quartoAntes && quartoAntes.estado_apartamento !== qEstadoApartamento;
      const { error } = await supabase.from('quartos').update(dados).eq('id', editandoQuartoId);
      setSalvando(false);
      if (error) { setErroFormQuarto('Não foi possível salvar. Detalhe técnico: ' + error.message); return; }
      mostrarAviso('Quarto atualizado!');
      setEditandoQuartoId(null);
      // Mudou a classificação do apartamento (ex.: virou "Interditado" ou
      // "Não deseja arrumação")? Manda a atualização pra Cloudbeds na
      // hora, sem esperar a próxima arrumação terminar.
      if (estadoMudou && quartoAntes.cloudbeds_room_id) {
        sincronizarComCloudbeds({ ...quartoAntes, ...dados }, condicaoCloudbedsParaEstado(qEstadoApartamento));
      }
    } else {
      const { error } = await supabase.from('quartos')
        .insert({ ...dados, status: 'SUJO', hotel_id: usuario.hotel_id });
      setSalvando(false);
      if (error) { setErroFormQuarto('Não foi possível cadastrar. Detalhe técnico: ' + error.message); return; }
      mostrarAviso('Quarto cadastrado!');
      setMostrarFormNovoQuarto(false);
    }
    carregarTudo(usuario);
  }

  async function marcarSujo(quarto) {
    if (salvando) return;
    setSalvando(true);
    const { error } = await supabase.from('quartos')
      .update({ status: 'SUJO', estado_apartamento: 'SAIDA_SUJO' }).eq('id', quarto.id);
    setSalvando(false);
    if (error) { setErro('Não foi possível atualizar. Detalhe técnico: ' + error.message); return; }
    setQuartos(quartos.map((q) => (q.id === quarto.id ? { ...q, status: 'SUJO', estado_apartamento: 'SAIDA_SUJO' } : q)));
    mostrarAviso(`Quarto ${quarto.numero} marcado como sujo (check-out simulado).`);
    sincronizarComCloudbeds(quarto, 'dirty');
  }

  async function excluirQuarto(q) {
    setExcluindoQuartoId(null);
    const { error } = await supabase.from('quartos').delete().eq('id', q.id);
    if (error) { setErro('Não foi possível excluir. Detalhe técnico: ' + error.message); return; }
    mostrarAviso('Quarto excluído (o histórico de limpezas permanece com o número salvo).');
    carregarTudo(usuario);
  }

  // ================= INSIGHTS (admin) =================

  function dentroDoPeriodo(dataIso) {
    if (insightPeriodo === 'TUDO') return true;
    const d = new Date(dataIso);
    const agora = new Date();
    if (insightPeriodo === 'DIA') return d.toDateString() === agora.toDateString();
    if (insightPeriodo === 'MES') return d.getMonth() === agora.getMonth() && d.getFullYear() === agora.getFullYear();
    if (insightPeriodo === 'ANO') return d.getFullYear() === agora.getFullYear();
    return true;
  }

  const sessoesFinalizadasPeriodo = sessoes.filter((s) => s.fim_em && dentroDoPeriodo(s.fim_em));

  const quartosLimposAgora = quartos.filter((q) => q.status === 'LIMPO').length;
  const quartosPendentesAgora = quartos.filter((q) => q.status === 'SUJO' || q.status === 'EM_ARRUMACAO').length;

  // Ranking de produtividade
  const porCamareira = {};
  sessoesFinalizadasPeriodo.forEach((s) => {
    const chave = s.camareira_id || s.camareira_nome;
    if (!porCamareira[chave]) porCamareira[chave] = { nome: nomeDe(s.camareira_id) || s.camareira_nome, total: 0, somaMinutos: 0 };
    porCamareira[chave].total += 1;
    porCamareira[chave].somaMinutos += Number(s.duracao_minutos || 0);
  });
  const ranking = Object.values(porCamareira)
    .map((c) => ({ ...c, tempoMedio: c.total > 0 ? c.somaMinutos / c.total : 0 }))
    .sort((a, b) => b.total - a.total);

  // ================= CONFIGURAÇÕES / INTEGRAÇÃO REAL COM A CLOUDBEDS =================

  async function carregarQuartosCloudbeds() {
    setCarregandoCloudbeds(true);
    setErroCloudbeds('');
    try {
      const { data: sessao } = await supabase.auth.getSession();
      const resposta = await fetch('/api/governanca-listar-cloudbeds', {
        headers: { Authorization: `Bearer ${sessao.session.access_token}` },
      });
      const resultado = await resposta.json();
      setCarregandoCloudbeds(false);
      if (!resposta.ok || resultado.erro) { setErroCloudbeds(resultado.erro || 'Não foi possível consultar a Cloudbeds.'); return; }
      setQuartosCloudbeds(resultado.quartos || []);
    } catch (e) {
      setCarregandoCloudbeds(false);
      setErroCloudbeds('Falha de conexão ao consultar a Cloudbeds.');
    }
  }

  async function salvarVinculoCloudbeds(quarto, cloudbedsRoomId) {
    setSalvandoVinculo(quarto.id);
    const { error } = await supabase.from('quartos')
      .update({ cloudbeds_room_id: cloudbedsRoomId || null }).eq('id', quarto.id);
    setSalvandoVinculo(null);
    if (error) { setErro('Não foi possível salvar o vínculo. Detalhe técnico: ' + error.message); return; }
    setQuartos(quartos.map((q) => (q.id === quarto.id ? { ...q, cloudbeds_room_id: cloudbedsRoomId || null } : q)));
    mostrarAviso(cloudbedsRoomId ? `Apartamento ${quarto.numero} vinculado à Cloudbeds!` : `Vínculo removido do apartamento ${quarto.numero}.`);
  }

  // Cadastrar quarto por quarto manualmente pra depois vincular seria muito
  // trabalho num hotel com dezenas de quartos. Esse botão faz os dois passos
  // de uma vez: cria o apartamento aqui (usando o nome do quarto da
  // Cloudbeds como número) já com o vínculo pronto. Quartos que já existirem
  // aqui (mesmo número, comparando sem diferenciar maiúsculas/espaços) só
  // recebem o vínculo, sem duplicar.
  // Traduz o status real da Cloudbeds pro nosso — usado na importação e na
  // sincronização manual. roomBlocked (fora de serviço) tem prioridade.
  function mapearCondicaoParaStatus(rc) {
    if (rc.roomBlocked) return 'MANUTENCAO';
    if (rc.roomCondition === 'dirty') return 'SUJO';
    if (rc.roomCondition === 'clean' || rc.roomCondition === 'inspected') return 'LIMPO';
    return 'SUJO';
  }

  async function importarQuartosDaCloudbeds() {
    if (!quartosCloudbeds || quartosCloudbeds.length === 0) return;
    setImportandoCloudbeds(true);
    setErro('');

    const normalizar = (t) => String(t || '').trim().toLowerCase();
    const porNumero = Object.fromEntries(quartos.map((q) => [normalizar(q.numero), q]));

    let criados = 0, vinculados = 0, jaOk = 0;
    for (const rc of quartosCloudbeds) {
      const statusReal = mapearCondicaoParaStatus(rc);
      const existente = porNumero[normalizar(rc.roomName)];
      if (existente) {
        if (existente.cloudbeds_room_id === rc.roomID && existente.status === statusReal) { jaOk++; continue; }
        const { error } = await supabase.from('quartos')
          .update({ cloudbeds_room_id: rc.roomID, status: statusReal }).eq('id', existente.id);
        if (!error) vinculados++;
      } else {
        const { error } = await supabase.from('quartos').insert({
          numero: rc.roomName, cloudbeds_room_id: rc.roomID, status: statusReal, hotel_id: usuario.hotel_id,
        });
        if (!error) criados++;
      }
    }

    setImportandoCloudbeds(false);
    mostrarAviso(`Importação concluída: ${criados} apartamento(s) criado(s), ${vinculados} atualizado(s)/vinculado(s), ${jaOk} já estavam certos.`);
    carregarTudo(usuario);
  }

  // Corrige de uma vez o status de TODOS os quartos já vinculados, puxando
  // o valor real da Cloudbeds agora — útil pra consertar quartos que foram
  // importados errado antes dessa correção, ou sempre que desconfiar que
  // algo está desatualizado.
  async function sincronizarStatusComCloudbeds() {
    if (!quartosCloudbeds || quartosCloudbeds.length === 0) {
      mostrarAviso('Clique em "Carregar quartos da Cloudbeds" primeiro.');
      return;
    }
    setSincronizandoStatus(true);
    const porRoomId = Object.fromEntries(quartosCloudbeds.map((rc) => [rc.roomID, rc]));
    let corrigidos = 0;
    for (const q of quartos) {
      if (!q.cloudbeds_room_id) continue;
      const rc = porRoomId[q.cloudbeds_room_id];
      if (!rc) continue;
      const statusReal = mapearCondicaoParaStatus(rc);
      if (statusReal !== q.status) {
        const { error } = await supabase.from('quartos').update({ status: statusReal }).eq('id', q.id);
        if (!error) corrigidos++;
      }
    }
    setSincronizandoStatus(false);
    mostrarAviso(`Sincronização concluída: ${corrigidos} apartamento(s) corrigido(s) a partir da Cloudbeds.`);
    carregarTudo(usuario);
  }

  // ---- Webhook (notificações em tempo real da Cloudbeds) ----
  async function configurarWebhook(ativar) {
    setConfigurandoWebhook(true);
    setErroWebhook('');
    try {
      const { data: sessao } = await supabase.auth.getSession();
      const resposta = await fetch('/api/governanca-configurar-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.session.access_token}` },
        body: JSON.stringify({ ativar }),
      });
      const resultado = await resposta.json();
      setConfigurandoWebhook(false);
      if (!resposta.ok || resultado.erro) { setErroWebhook(resultado.erro || 'Não foi possível concluir.'); return; }
      mostrarAviso(ativar ? '🔔 Notificações da Cloudbeds ativadas!' : 'Notificações desativadas.');
      carregarTudo(usuario);
    } catch (e) {
      setConfigurandoWebhook(false);
      setErroWebhook('Falha de conexão.');
    }
  }

  if (verificandoLogin) {
    return (
      <main className="conteudo">
        <p className="texto-suave">Verificando seu acesso…</p>
      </main>
    );
  }

  return (
    <main className="conteudo">
      <EstilosGovernanca />

      <span className="olho">Housekeeping</span>
      <h1 style={{ marginBottom: 10 }}>Governança</h1>

      {aviso && <div className="aviso-sucesso">{aviso}</div>}
      {erro && <div className="aviso-erro">{erro}</div>}
      {msgSync && <div className="gv-sync">🔄 {msgSync}</div>}

      {/* Sub-abas */}
      <nav className="gv-abas" aria-label="Seções">
        <button type="button" className={subAba === 'camareira' ? 'gv-aba gv-aba-ativa' : 'gv-aba'}
          onClick={() => setSubAba('camareira')}>
          Camareira
        </button>
        {podeVerQuartos && (
          <button type="button" className={subAba === 'quartos' ? 'gv-aba gv-aba-ativa' : 'gv-aba'}
            onClick={() => setSubAba('quartos')}>
            Quartos
          </button>
        )}
        {souAdmin && (
          <button type="button" className={subAba === 'insights' ? 'gv-aba gv-aba-ativa' : 'gv-aba'}
            onClick={() => setSubAba('insights')}>
            Insights
          </button>
        )}
        {souAdmin && (
          <button type="button" className={subAba === 'config' ? 'gv-aba gv-aba-ativa' : 'gv-aba'}
            onClick={() => setSubAba('config')}>
            Configurações
          </button>
        )}
      </nav>

      {carregando && <p className="texto-suave">Carregando…</p>}

      {/* ================= CAMAREIRA ================= */}
      {!carregando && subAba === 'camareira' && (
        <section style={{ maxWidth: 520, margin: '0 auto' }}>
          {!sessaoAtiva ? (
            <>
              <p className="texto-suave" style={{ fontSize: 13 }}>
                Estes são os apartamentos designados para você. Toque no quarto que for arrumar —
                isso já representa a leitura do QR Code fixado na porta dele.
              </p>
              {meusQuartos.length === 0 ? (
                <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
                  Nenhum apartamento pendente para você no momento. 🎉
                </div>
              ) : (
                <div className="gv-lista-quartos">
                  {meusQuartos.map((q) => (
                    <button key={q.id} type="button" className="cartao gv-quarto-botao"
                      onClick={() => iniciarArrumacao(q)} disabled={salvando}>
                      <span className="gv-quarto-numero">
                        Apartamento {q.numero}
                        <span className="texto-suave" style={{ display: 'block', fontSize: 12, fontWeight: 400 }}>
                          {ESTADO_APARTAMENTO_LABEL[q.estado_apartamento] || ESTADO_APARTAMENTO_LABEL.SAIDA_SUJO}
                        </span>
                      </span>
                      <span className="gv-quarto-seta">→</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="cartao">
              <h2 style={{ fontSize: '1.2rem', marginTop: 0 }}>Apartamento {sessaoAtiva.quarto.numero}</h2>
              <p className="texto-suave" style={{ fontSize: 13 }}>
                {ESTADO_APARTAMENTO_LABEL[sessaoAtiva.quarto.estado_apartamento] || ESTADO_APARTAMENTO_LABEL.SAIDA_SUJO}
                {' · '}Marque cada item conforme for concluindo:
              </p>

              <div className="gv-checklist">
                {CHECKLIST_ITENS.map((item) => (
                  <label key={item.chave} className="gv-check-item">
                    <input type="checkbox" checked={!!checklist[item.chave]}
                      onChange={() => alternarChecklist(item.chave)} />
                    <span>{item.rotulo}</span>
                  </label>
                ))}
              </div>

              <button type="button" className="botao botao-principal" style={{ width: '100%', marginTop: 16 }}
                onClick={finalizarArrumacao} disabled={salvando}>
                {salvando ? 'Finalizando…' : 'Finalizar Arrumação'}
              </button>
            </div>
          )}
        </section>
      )}

      {/* ================= QUARTOS (admin + colaborador) ================= */}
      {!carregando && subAba === 'quartos' && podeVerQuartos && (
        <section>
          {/* Vínculo com a Cloudbeds — só admin. É configuração técnica,
              colaborador não precisa (e não deve) mexer nisso. */}
          {souAdmin && (
          <div className="cartao" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <h2 style={{ fontSize: '1.1rem', margin: 0 }}>🔗 Vínculo com a Cloudbeds</h2>
                <p className="texto-suave" style={{ fontSize: 12, marginTop: 4 }}>
                  Cada apartamento precisa ser vinculado ao quarto correspondente na Cloudbeds pra que a sincronização de status funcione. Carregue a lista da Cloudbeds e escolha o par certo pra cada apartamento abaixo.
                </p>
              </div>
              <button type="button" className="botao botao-suave" onClick={carregarQuartosCloudbeds} disabled={carregandoCloudbeds} style={{ whiteSpace: 'nowrap' }}>
                {carregandoCloudbeds ? 'Buscando…' : '🔄 Carregar quartos da Cloudbeds'}
              </button>
            </div>
            {erroCloudbeds && <div className="aviso-erro" style={{ marginTop: 10 }}>{erroCloudbeds}</div>}
            {quartosCloudbeds && (
              <>
                <p className="texto-suave" style={{ fontSize: 12, marginTop: 10 }}>
                  {quartosCloudbeds.length} quarto(s) encontrado(s) na Cloudbeds.
                  {quartos.length === 0
                    ? ' Vocês ainda não têm nenhum apartamento cadastrado aqui — use o botão abaixo pra importar todos de uma vez, já vinculados.'
                    : ' Use o seletor em cada apartamento abaixo pra vincular, ou importe de uma vez os que faltam.'}
                </p>
                <button type="button" className="botao botao-principal" onClick={importarQuartosDaCloudbeds} disabled={importandoCloudbeds} style={{ marginTop: 6 }}>
                  {importandoCloudbeds ? 'Importando…' : `📥 Importar/vincular os ${quartosCloudbeds.length} quartos automaticamente`}
                </button>
              </>
            )}
          </div>
          )}

          <div className="gv-barra">
            <p className="texto-suave" style={{ fontSize: 13, margin: 0 }}>
              Um quarto sem camareira atribuída fica invisível na tela de arrumação de todo mundo.
            </p>
            {souAdmin && (
              <button type="button" className="botao botao-principal" onClick={abrirNovoQuarto}>
                + Novo Quarto
              </button>
            )}
          </div>

          {mostrarFormNovoQuarto && souAdmin && (
            <form className="cartao" style={{ marginBottom: 16 }} onSubmit={salvarQuarto}>
              <h2 style={{ fontSize: '1.1rem', marginBottom: 4 }}>Novo quarto</h2>
              <label className="rotulo">Número do apartamento *</label>
              <input className="campo" type="text" value={qNumero} onChange={(e) => setQNumero(e.target.value)} placeholder="Ex.: 204" />
              <label className="rotulo">Camareira responsável</label>
              <select className="campo" value={qCamareira} onChange={(e) => setQCamareira(e.target.value)}>
                <option value="">— Sem camareira atribuída —</option>
                {camareiras.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
              {camareiras.length === 0 && (
                <p className="texto-suave" style={{ fontSize: 12, marginTop: 4 }}>
                  Nenhum usuário com o perfil "Camareira" cadastrado ainda — crie um em Administração → Usuários.
                </p>
              )}
              <label className="rotulo">Estado do Apartamento</label>
              <select className="campo" value={qEstadoApartamento} onChange={(e) => setQEstadoApartamento(e.target.value)}>
                {Object.entries(ESTADO_APARTAMENTO_LABEL).map(([chave, rotulo]) => <option key={chave} value={chave}>{rotulo}</option>)}
              </select>
              {erroFormQuarto && <div className="aviso-erro">{erroFormQuarto}</div>}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
                <button type="submit" className="botao botao-principal" disabled={salvando}>
                  {salvando ? 'Salvando…' : 'Cadastrar'}
                </button>
                <button type="button" className="botao botao-suave" onClick={() => setMostrarFormNovoQuarto(false)}>Cancelar</button>
              </div>
            </form>
          )}

          {quartos.length === 0 ? (
            <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
              Nenhum quarto cadastrado. Clique em "+ Novo Quarto".
            </div>
          ) : (
            <div className="gv-lista">
              {quartos.map((q) => (
                <div key={q.id} className="cartao gv-item-quarto">
                  {editandoQuartoId === q.id ? (
                    <form onSubmit={salvarQuarto} style={{ width: '100%' }}>
                      <label className="rotulo">Número do apartamento *</label>
                      <input className="campo" type="text" value={qNumero} onChange={(e) => setQNumero(e.target.value)} placeholder="Ex.: 204" autoFocus />
                      <label className="rotulo">Camareira responsável</label>
                      <select className="campo" value={qCamareira} onChange={(e) => setQCamareira(e.target.value)}>
                        <option value="">— Sem camareira atribuída —</option>
                        {camareiras.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                      </select>
                      {camareiras.length === 0 && (
                        <p className="texto-suave" style={{ fontSize: 12, marginTop: 4 }}>
                          Nenhum usuário com o perfil "Camareira" cadastrado ainda.
                        </p>
                      )}
                      <label className="rotulo">Estado do Apartamento</label>
                      <select className="campo" value={qEstadoApartamento} onChange={(e) => setQEstadoApartamento(e.target.value)}>
                        {Object.entries(ESTADO_APARTAMENTO_LABEL).map(([chave, rotulo]) => <option key={chave} value={chave}>{rotulo}</option>)}
                      </select>
                      {erroFormQuarto && <div className="aviso-erro">{erroFormQuarto}</div>}
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
                        <button type="submit" className="botao botao-principal" disabled={salvando}>
                          {salvando ? 'Salvando…' : 'Salvar alterações'}
                        </button>
                        <button type="button" className="botao botao-suave" onClick={() => setEditandoQuartoId(null)}>Cancelar</button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="gv-item-quarto-esq">
                        <div className="gv-item-quarto-topo">
                          <strong>Apartamento {q.numero}</strong>
                          <span className="gv-badge" style={{ background: STATUS_QUARTO_COR[q.status].fundo, color: STATUS_QUARTO_COR[q.status].texto }}>
                            {STATUS_QUARTO_LABEL[q.status]}
                          </span>
                          <span className="gv-badge" style={{ background: '#EAF0FB', color: '#2C4C7C' }}>
                            {ESTADO_APARTAMENTO_LABEL[q.estado_apartamento] || ESTADO_APARTAMENTO_LABEL.SAIDA_SUJO}
                          </span>
                        </div>
                        <div className="texto-suave" style={{ fontSize: 13 }}>
                          {q.camareira_id ? `Camareira: ${nomeDe(q.camareira_id)}` : 'Sem camareira atribuída'}
                          {q.ultima_limpeza ? ` · última limpeza em ${formatarDataHora(q.ultima_limpeza)}` : ''}
                        </div>
                        {quartosCloudbeds && (
                          <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
                            <select className="campo" style={{ fontSize: 12, padding: '4px 8px' }}
                              value={q.cloudbeds_room_id || ''}
                              onChange={(e) => salvarVinculoCloudbeds(q, e.target.value)}
                              disabled={salvandoVinculo === q.id}>
                              <option value="">— Não vinculado à Cloudbeds —</option>
                              {quartosCloudbeds.map((rc) => (
                                <option key={rc.roomID} value={rc.roomID}>{rc.roomName} ({rc.roomTypeName})</option>
                              ))}
                            </select>
                            {salvandoVinculo === q.id && <span className="texto-suave" style={{ fontSize: 11 }}>salvando…</span>}
                          </div>
                        )}
                      </div>
                      <div className="gv-item-quarto-acoes">
                        {q.status !== 'SUJO' && q.status !== 'EM_ARRUMACAO' && (
                          <button type="button" className="botao botao-suave" onClick={() => marcarSujo(q)} disabled={salvando}>
                            Marcar sujo
                          </button>
                        )}
                        <button type="button" className="botao botao-suave" onClick={() => abrirEdicaoQuarto(q)}>Editar</button>
                        {souAdmin && (
                          excluindoQuartoId === q.id ? (
                            <span className="gv-confirmar">
                              Excluir?
                              <button type="button" className="botao botao-perigo" onClick={() => excluirQuarto(q)}>Sim</button>
                              <button type="button" className="botao botao-suave" onClick={() => setExcluindoQuartoId(null)}>Não</button>
                            </span>
                          ) : (
                            <button type="button" className="botao botao-suave" onClick={() => setExcluindoQuartoId(q.id)}>Excluir</button>
                          )
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ================= INSIGHTS (admin) ================= */}
      {!carregando && subAba === 'insights' && souAdmin && (
        <section>
          <div className="mn-periodo" style={{ marginBottom: 14 }}>
            {[['DIA', 'Hoje'], ['MES', 'Este mês'], ['ANO', 'Este ano'], ['TUDO', 'Tudo']].map(([chave, rotulo]) => (
              <button key={chave} type="button"
                className={insightPeriodo === chave ? 'gv-periodo-botao gv-periodo-ativo' : 'gv-periodo-botao'}
                onClick={() => setInsightPeriodo(chave)}>
                {rotulo}
              </button>
            ))}
          </div>

          <div className="gv-numeros">
            <div className="cartao gv-numero"><div className="gv-numero-valor">{quartosLimposAgora}</div><div className="gv-numero-rot">🟢 Limpos agora</div></div>
            <div className="cartao gv-numero"><div className="gv-numero-valor">{quartosPendentesAgora}</div><div className="gv-numero-rot">🔴 Pendentes agora</div></div>
            <div className="cartao gv-numero"><div className="gv-numero-valor">{sessoesFinalizadasPeriodo.length}</div><div className="gv-numero-rot">✅ Arrumações no período</div></div>
          </div>

          <div className="cartao" style={{ marginTop: 14 }}>
            <h3 style={{ fontSize: '1rem', marginTop: 0 }}>Ranking de produtividade</h3>
            {ranking.length === 0 ? (
              <p className="texto-suave" style={{ fontSize: 14 }}>Sem arrumações concluídas no período selecionado.</p>
            ) : (
              <div className="gv-ranking">
                {ranking.map((c, i) => (
                  <div key={i} className="gv-ranking-linha">
                    <span className="gv-ranking-pos">{i + 1}º</span>
                    <span className="gv-ranking-nome">{c.nome}</span>
                    <span className="gv-ranking-total">{c.total} quarto(s)</span>
                    <span className="gv-ranking-tempo">média {duracaoLegivel(c.tempoMedio)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="cartao" style={{ marginTop: 14 }}>
            <h3 style={{ fontSize: '1rem', marginTop: 0 }}>Log detalhado</h3>
            {sessoesFinalizadasPeriodo.length === 0 ? (
              <p className="texto-suave" style={{ fontSize: 14 }}>Nenhuma arrumação concluída no período.</p>
            ) : (
              <div className="gv-tabela-envelope">
                <table className="gv-tabela">
                  <thead>
                    <tr><th>Apartamento</th><th>Camareira</th><th>Início</th><th>Fim</th><th>Duração</th></tr>
                  </thead>
                  <tbody>
                    {sessoesFinalizadasPeriodo.map((s) => (
                      <tr key={s.id}>
                        <td>{s.quarto_numero}</td>
                        <td>{nomeDe(s.camareira_id) || s.camareira_nome}</td>
                        <td>{formatarDataHora(s.inicio_em)}</td>
                        <td>{formatarDataHora(s.fim_em)}</td>
                        <td>{duracaoLegivel(s.duracao_minutos)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ================= CONFIGURAÇÕES (admin) ================= */}
      {!carregando && subAba === 'config' && souAdmin && (
        <section>
          <div className="cartao" style={{ maxWidth: 560 }}>
            <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>Integração Cloudbeds</h2>
            <p className="texto-suave" style={{ fontSize: 13 }}>
              A Governança usa a <strong>mesma credencial da Cloudbeds</strong> já configurada para as
              Fichas de Hóspedes e o PDV — não é preciso cadastrar uma chave separada aqui.
            </p>

            <div style={{ background: '#FDF3D7', color: '#8A6100', borderRadius: 10, padding: '10px 14px', fontSize: 13, margin: '10px 0' }}>
              ⚠️ <strong>Atenção:</strong> a chave de API da Cloudbeds usada hoje foi criada com os escopos de
              Hóspede/Reserva/Hotel/Acomodação. Governança usa um escopo <strong>separado</strong>
              ("Housekeeping" — Ler e Escrever). Se a sincronização abaixo falhar com erro de permissão,
              entre em Configurações → API Credentials na Cloudbeds e adicione esse escopo à chave existente.
            </div>

            <button type="button" className="botao botao-principal" onClick={carregarQuartosCloudbeds} disabled={carregandoCloudbeds}>
              {carregandoCloudbeds ? 'Testando…' : '🔄 Testar conexão'}
            </button>
            {erroCloudbeds && <div className="aviso-erro" style={{ marginTop: 10 }}>{erroCloudbeds}</div>}
            {quartosCloudbeds && !erroCloudbeds && (
              <div style={{ background: '#DDF2E4', color: '#1E6B3C', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginTop: 10 }}>
                ✅ Conexão funcionando! Encontramos {quartosCloudbeds.length} quarto(s) na Cloudbeds.
                Agora vá na aba "Quartos" pra vincular cada apartamento ao quarto correspondente.
              </div>
            )}
          </div>

          <div className="cartao" style={{ maxWidth: 560, marginTop: 14 }}>
            <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>🔄 Corrigir status agora</h2>
            <p className="texto-suave" style={{ fontSize: 13 }}>
              Puxa o status real de todos os apartamentos já vinculados direto da Cloudbeds e corrige aqui na hora — útil se algum apartamento estiver mostrando "Sujo", "Limpo" ou "Manutenção" errado.
            </p>
            <button type="button" className="botao botao-principal" onClick={sincronizarStatusComCloudbeds} disabled={sincronizandoStatus}>
              {sincronizandoStatus ? 'Corrigindo…' : '🔄 Corrigir status de todos os quartos agora'}
            </button>
          </div>

          <div className="cartao" style={{ maxWidth: 560, marginTop: 14 }}>
            <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>🔔 Notificações em tempo real</h2>
            <p className="texto-suave" style={{ fontSize: 13 }}>
              Quando ativado, a própria Cloudbeds avisa nosso sistema instantaneamente toda vez que o status de limpeza de um quarto mudar por lá (inclusive quando ela marca "sujo" sozinha após um check-out) — sem precisar de nenhuma ação manual ou de ficar clicando em "Corrigir status".
            </p>
            {webhookAtivo ? (
              <>
                <p style={{ color: 'var(--sucesso-texto, #1E6B3C)', fontWeight: 700, fontSize: 14 }}>✅ Ativado</p>
                <button type="button" className="botao botao-suave" onClick={() => configurarWebhook(false)} disabled={configurandoWebhook}>
                  {configurandoWebhook ? 'Desativando…' : 'Desativar notificações'}
                </button>
              </>
            ) : (
              <button type="button" className="botao botao-principal" onClick={() => configurarWebhook(true)} disabled={configurandoWebhook}>
                {configurandoWebhook ? 'Ativando…' : '🔔 Ativar notificações da Cloudbeds'}
              </button>
            )}
            {erroWebhook && <div className="aviso-erro" style={{ marginTop: 10 }}>{erroWebhook}</div>}
          </div>
        </section>
      )}

      {/* ================= POP-UP 1: MANUTENÇÃO ================= */}
      {popupManutencao && (
        <div className="gv-overlay" role="dialog" aria-modal="true">
          <div className="gv-modal">
            <h2 style={{ fontSize: '1.15rem', marginTop: 0 }}>Detectou algum problema de manutenção?</h2>
            <p className="texto-suave" style={{ fontSize: 13 }}>Apartamento {popupManutencao.quartoNumero}</p>

            {manutTemProblema === null && (
              <div className="gv-simnaobotoes">
                <button type="button" className="botao botao-principal" onClick={() => setManutTemProblema(true)}>Sim</button>
                <button type="button" className="botao botao-suave" onClick={() => setManutTemProblema(false)}>Não</button>
              </div>
            )}

            {manutTemProblema === true && (
              <>
                <label className="rotulo">Descreva o problema *</label>
                <textarea className="campo" rows={3} value={manutDescricao}
                  onChange={(e) => setManutDescricao(e.target.value)} placeholder="Ex.: Torneira do banheiro pingando" />
                <label className="rotulo">Prioridade</label>
                <select className="campo" value={manutPrioridade} onChange={(e) => setManutPrioridade(e.target.value)}>
                  {Object.entries(PRIORIDADE_LABEL).map(([chave, rotulo]) => (
                    <option key={chave} value={chave}>{rotulo}</option>
                  ))}
                </select>
              </>
            )}

            {erroPopup && <div className="aviso-erro">{erroPopup}</div>}

            {manutTemProblema !== null && (
              <div className="gv-modal-botoes">
                <button type="button" className="botao botao-principal" onClick={confirmarPopupManutencao} disabled={salvando}>
                  {salvando ? 'Enviando…' : 'Continuar'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= POP-UP 2: ACHADOS E PERDIDOS ================= */}
      {popupAchados && (
        <div className="gv-overlay" role="dialog" aria-modal="true">
          <div className="gv-modal">
            <h2 style={{ fontSize: '1.15rem', marginTop: 0 }}>Encontrou algum item esquecido no apartamento?</h2>
            <p className="texto-suave" style={{ fontSize: 13 }}>Apartamento {popupAchados.quartoNumero}</p>

            {achadosTemItem === null && (
              <div className="gv-simnaobotoes">
                <button type="button" className="botao botao-principal" onClick={() => setAchadosTemItem(true)}>Sim</button>
                <button type="button" className="botao botao-suave" onClick={() => setAchadosTemItem(false)}>Não</button>
              </div>
            )}

            {achadosTemItem === true && (
              <>
                <label className="rotulo">Foto do item *</label>
                <input className="campo" type="file" accept="image/*" capture="environment"
                  onChange={(e) => setAchadosFoto(e.target.files?.[0] || null)} />
                <label className="rotulo">Categoria</label>
                <select className="campo" value={achadosCategoria} onChange={(e) => setAchadosCategoria(e.target.value)}>
                  {Object.entries(CATEGORIA_ACHADOS_LABEL).map(([chave, rotulo]) => (
                    <option key={chave} value={chave}>{rotulo}</option>
                  ))}
                </select>
                <label className="rotulo">Descrição *</label>
                <input className="campo" type="text" value={achadosDescricao}
                  onChange={(e) => setAchadosDescricao(e.target.value)} placeholder="Ex.: Carregador de celular branco" />
                <p className="texto-suave" style={{ fontSize: 12 }}>Local: Apartamento {popupAchados.quartoNumero} (preenchido automaticamente)</p>
              </>
            )}

            {erroPopup && <div className="aviso-erro">{erroPopup}</div>}

            {achadosTemItem !== null && (
              <div className="gv-modal-botoes">
                <button type="button" className="botao botao-principal" onClick={confirmarPopupAchados} disabled={salvando}>
                  {salvando ? 'Enviando…' : 'Concluir'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

// ---- Estilos específicos deste módulo ---------------------------------------

function EstilosGovernanca() {
  return (
    <style>{`
      .gv-sync {
        background: var(--marca-clara); color: var(--marca); border-radius: 10px;
        padding: 10px 14px; font-size: 13px; margin-bottom: 12px;
      }

      .gv-abas { display: flex; gap: 6px; overflow-x: auto; margin: 14px 0 16px; padding-bottom: 4px; }
      .gv-aba {
        border: 1px solid var(--borda); background: var(--branco); color: var(--tinta);
        border-radius: 999px; padding: 10px 16px; font-size: 14px; font-weight: 600;
        cursor: pointer; white-space: nowrap; min-height: 42px;
      }
      .gv-aba-ativa { background: var(--marca); border-color: var(--marca); color: var(--branco); }

      /* Camareira */
      .gv-lista-quartos { display: flex; flex-direction: column; gap: 10px; }
      .gv-quarto-botao {
        display: flex; align-items: center; justify-content: space-between;
        text-align: left; cursor: pointer; font-family: inherit; width: 100%;
        padding: 18px 16px;
      }
      .gv-quarto-numero { font-size: 16px; font-weight: 700; }
      .gv-quarto-seta { font-size: 20px; color: var(--marca); }
      .gv-quarto-botao:hover:not(:disabled) { border-color: var(--marca); }

      .gv-checklist { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; }
      .gv-check-item {
        display: flex; align-items: center; gap: 12px; padding: 12px 8px;
        font-size: 15px; cursor: pointer; border-bottom: 1px solid var(--borda);
      }
      .gv-check-item input { width: 22px; height: 22px; flex-shrink: 0; }

      /* Quartos */
      .gv-barra { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
      .gv-lista { display: flex; flex-direction: column; gap: 12px; }
      .gv-item-quarto { display: flex; flex-direction: column; gap: 10px; padding: 16px; }
      .gv-item-quarto-topo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .gv-item-quarto-topo strong { font-size: 16px; }
      .gv-badge { display: inline-block; font-size: 12px; font-weight: 700; border-radius: 999px; padding: 3px 10px; }
      .gv-item-quarto-acoes { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
      .gv-confirmar { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--erro-texto); flex-wrap: wrap; }

      /* Insights */
      .gv-periodo-botao {
        border: 1px solid var(--borda); background: var(--branco); color: var(--tinta);
        border-radius: 999px; padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer;
      }
      .mn-periodo { display: flex; gap: 6px; flex-wrap: wrap; }
      .gv-periodo-ativo { background: var(--marca); border-color: var(--marca); color: var(--branco); }

      .gv-numeros { display: grid; grid-template-columns: 1fr; gap: 12px; }
      .gv-numero { text-align: center; padding: 18px 12px; }
      .gv-numero-valor { font-family: var(--fonte-titulo); font-weight: 700; font-size: 30px; color: var(--marca); }
      .gv-numero-rot { font-size: 13px; color: var(--texto-suave); margin-top: 4px; }

      .gv-ranking { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
      .gv-ranking-linha {
        display: grid; grid-template-columns: 30px 1fr auto auto; gap: 10px; align-items: center;
        font-size: 14px; padding: 8px 0; border-bottom: 1px dashed var(--borda);
      }
      .gv-ranking-pos { font-weight: 700; color: var(--marca); }
      .gv-ranking-nome { font-weight: 600; }
      .gv-ranking-total { font-size: 13px; color: var(--texto-suave); }
      .gv-ranking-tempo { font-size: 13px; color: var(--texto-suave); }

      .gv-tabela-envelope { overflow-x: auto; }
      .gv-tabela { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; min-width: 480px; }
      .gv-tabela th { text-align: left; border-bottom: 2px solid var(--borda); padding: 6px 8px; font-size: 12px; }
      .gv-tabela td { border-bottom: 1px solid var(--borda); padding: 6px 8px; }

      /* Configurações */
      .gv-chave-campo { display: flex; gap: 8px; align-items: center; }
      .gv-chave-campo .campo { flex: 1; }
      .gv-olho {
        border: 1px solid var(--borda); background: var(--branco); border-radius: 10px;
        width: 44px; height: 44px; font-size: 18px; cursor: pointer; flex-shrink: 0;
      }

      /* Pop-ups */
      .gv-overlay {
        position: fixed; inset: 0; background: rgba(15, 25, 22, 0.55);
        display: flex; align-items: center; justify-content: center; z-index: 80; padding: 18px;
      }
      .gv-modal { background: var(--branco); width: 100%; max-width: 420px; border-radius: 18px; padding: 22px; max-height: 90vh; overflow-y: auto; }
      .gv-simnaobotoes { display: flex; gap: 10px; margin-top: 14px; }
      .gv-simnaobotoes .botao { flex: 1; }
      .gv-modal-botoes { display: flex; gap: 10px; margin-top: 16px; }
      .gv-modal-botoes .botao { flex: 1; }

      @media (min-width: 640px) {
        .gv-barra { flex-direction: row; align-items: center; justify-content: space-between; }
        .gv-item-quarto { flex-direction: row; justify-content: space-between; align-items: flex-start; }
        .gv-numeros { grid-template-columns: 1fr 1fr 1fr; }
      }
    `}</style>
  );
}
