'use client';

// ============================================================================
// GOVERNANÇA (Housekeeping)
// - Camareira (celular): avisos no celular (Web Push) e pedidos especiais da
//   recepção no topo; lista dos quartos dela já na ordem certa
//   (prioridade da recepção → saídas → quartos com hóspede → "Não perturbe"
//   no fim). Botões grandes: "Entrei no quarto", "Não Perturbe" e, lá dentro,
//   "Quarto Limpo". Quartos sujos sem camareira aparecem em "Sem camareira"
//   para quem quiser pegar. Se o celular recarregar no meio, a arrumação
//   aberta volta sozinha. Checklist de 7 itens; o tempo vai para os Insights.
// - Ao terminar: pop-up "Detectou problema de manutenção?" (Sim → chamado em
//   Manutenção, origem GOVERNANCA, com foto opcional) e depois "Encontrou item
//   esquecido?" (Sim → Achados e Perdidos, origem GOVERNANCA, foto obrigatória).
// - Quartos (admin + colaborador): estado do apartamento com os 8 nomes das
//   camareiras, camareira responsável, prioridade da recepção, "Marcar sujo".
//   Trocar o estado acerta a limpeza e a Cloudbeds (regras em
//   lib/governanca/regras.js). "Interditado" pede a previsão de volta e
//   bloqueia o quarto na Cloudbeds até esse dia (sai da venda).
// - Painel (admin + colaborador): escala do dia e distribuição automática por
//   andar, vistoria opcional, estoque e enxoval no mínimo
//   (app/components/governanca/PainelGovernanta.js).
// - Insights (admin): limpos x pendentes, produtividade por camareira (saída
//   x quarto com hóspede, vistorias), tempo médio por apartamento, log.
// - Configurações (admin): integração com a Cloudbeds (mesma credencial de
//   Fichas de Hóspedes/PDV), "Corrigir status" e os avisos em tempo real da
//   Cloudbeds (com senha no endereço).
// - A tela se atualiza sozinha quando um quarto muda (Supabase Realtime, e a
//   cada minuto por garantia).
// ============================================================================

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { bloquearSeNaoPermitido } from '../../lib/restricaoAcesso';
import {
  STATUS_QUARTO_LABEL, ESTADO_APARTAMENTO_LABEL,
  mudancaDeEstado, precisaArrumar, naoPerturbeAtivo, grupoNaFila, ordenarFila, compararNumero, rotuloDoEstado,
  estadoAoTerminar, cloudbedsAoTerminar, estadoAposCloudbeds, estadoInicialDaCloudbeds,
  dataDeVoltaInvalida, bloqueioVencido, formatarDia, hojeNoHotel,
} from '../../lib/governanca/regras';
import { andarDoQuarto, nomeDoAndar, tipoDoQuarto, resumoProdutividade, media, LIMITE_MEDIA_MIN } from '../../lib/governanca/distribuicao';
import PainelGovernanta from '../components/governanca/PainelGovernanta';
import CamareirasCloudbeds from '../components/governanca/CamareirasCloudbeds';
import AvisosNoCelular from '../components/governanca/AvisosNoCelular';
import { chamarRota } from '../components/governanca/rota';
import PedidosCamareira from '../components/governanca/PedidosCamareira';

// ---- Constantes -------------------------------------------------------------

const STATUS_QUARTO_COR = {
  LIMPO: { fundo: '#DDF2E4', texto: '#1E6B3C' },
  SUJO: { fundo: '#FBDDDD', texto: '#A31212' },
  EM_ARRUMACAO: { fundo: '#FDF3D7', texto: '#8A6100' },
  MANUTENCAO: { fundo: '#EFEFEF', texto: '#666666' },
};

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

function horaCurta(valor) {
  if (!valor) return '';
  try { return new Date(valor).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Fortaleza' }); }
  catch (e) { return ''; }
}

function nomeDeArquivo(nome) {
  return String(nome || 'foto').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-80);
}

// O que a governança escolhe na hora de mandar para a Cloudbeds: aceita o
// texto antigo ('dirty'/'clean') ou { roomCondition, doNotDisturb, refusedService }.
function paraCloudbeds(params) {
  return typeof params === 'string' ? { roomCondition: params } : (params || {});
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
  const [msgSync, setMsgSync] = useState([]);

  // ---- Pop-ups pós-limpeza ----
  const [popupManutencao, setPopupManutencao] = useState(null); // {quartoNumero}
  const [manutTemProblema, setManutTemProblema] = useState(null); // true/false
  const [manutDescricao, setManutDescricao] = useState('');
  const [manutPrioridade, setManutPrioridade] = useState('MEDIA');
  const [manutFoto, setManutFoto] = useState(null);

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
  const [qInterditadoAte, setQInterditadoAte] = useState('');
  const [qMotivoInterdicao, setQMotivoInterdicao] = useState('');
  const [qPrioridade, setQPrioridade] = useState(false);
  const [qPrioridadeObs, setQPrioridadeObs] = useState('');
  const [qAndar, setQAndar] = useState('');
  const [vistorias, setVistorias] = useState([]);
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
  const [webhookBloqueio, setWebhookBloqueio] = useState(false);
  const [webhookComSenha, setWebhookComSenha] = useState(true);
  const usuarioRef = useRef(null);
  const sessaoAtivaRef = useRef(null);
  useEffect(() => { sessaoAtivaRef.current = sessaoAtiva; }, [sessaoAtiva]);

  const souAdmin = usuario?.papel === 'ADMIN';
  // Quartos: admin e colaborador podem ver e operar (é onde se atribui a
  // camareira de cada apartamento). Insights e Configurações continuam só admin.
  const podeVerQuartos = souAdmin || usuario?.papel === 'COLABORADOR';

  // Cada aviso novo cancela o relógio do anterior (senão o relógio velho
  // apagava a mensagem nova antes da hora)
  const relogiosAviso = useRef({});
  function mostrarAviso(texto) {
    setAviso(texto);
    clearTimeout(relogiosAviso.current.aviso);
    relogiosAviso.current.aviso = setTimeout(() => setAviso(''), 5000);
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
      if (dadosUsuario.papel === 'ADMIN' || dadosUsuario.papel === 'COLABORADOR') setSubAba('painel');
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
      .from('quartos').select('*').eq('hotel_id', u.hotel_id).order('numero', { ascending: true });
    if (e1) setErro('Não foi possível carregar os quartos. Detalhe técnico: ' + e1.message);
    else setQuartos(listaQuartos || []);

    const { data: listaSessoes } = await supabase
      .from('governanca_sessoes').select('*').eq('hotel_id', u.hotel_id).order('inicio_em', { ascending: false }).limit(1000);
    setSessoes(listaSessoes || []);

    // Arrumação que ficou aberta (o celular recarregou no meio): volta sozinha
    if (!sessaoAtivaRef.current && listaQuartos) {
      const aberta = (listaSessoes || []).find((s) => !s.fim_em && !s.cancelada && s.camareira_id === u.id);
      const quartoAberto = aberta && listaQuartos.find((q) => q.id === aberta.quarto_id && q.status === 'EM_ARRUMACAO');
      if (quartoAberto) {
        setSessaoAtiva({ ...aberta, quarto: quartoAberto });
        setChecklist({ ...CHECKLIST_VAZIO, ...(aberta.checklist || {}) });
      }
    }

    if (u.papel === 'ADMIN') {
      const { data: vs } = await supabase.from('governanca_vistorias').select('*')
        .eq('hotel_id', u.hotel_id).order('criado_em', { ascending: false }).limit(1000);
      setVistorias(vs || []);
      const { data: cfg } = await supabase
        .from('governanca_config').select('*').eq('hotel_id', u.hotel_id).maybeSingle();
      setConfig(cfg);

      try {
        const { data: sessao } = await supabase.auth.getSession();
        const resposta = await fetch('/api/governanca-configurar-webhook', { headers: { Authorization: `Bearer ${sessao.session.access_token}` } });
        const r = await resposta.json();
        if (resposta.ok) { setWebhookAtivo(!!r.ativo); setWebhookComSenha(!!r.comSenha); setWebhookBloqueio(!!r.bloqueio); }
      } catch (e) { /* a tela continua; o cartão mostra "desativado" */ }
    }

    setCarregando(false);
  }, []);

  useEffect(() => {
    usuarioRef.current = usuario;
    if (usuario) carregarTudo(usuario);
  }, [usuario, carregarTudo]);

  // Quartos e arrumações (tempo real e conferência de 1 em 1 minuto)
  const recarregarQuartos = useCallback(async () => {
    const u = usuarioRef.current;
    if (!u) return;
    const [{ data }, { data: listaSessoes }] = await Promise.all([
      supabase.from('quartos').select('*').eq('hotel_id', u.hotel_id).order('numero', { ascending: true }),
      supabase.from('governanca_sessoes').select('*').eq('hotel_id', u.hotel_id).order('inicio_em', { ascending: false }).limit(1000),
    ]);
    if (data) setQuartos(data);
    if (listaSessoes) setSessoes(listaSessoes);
  }, []);

  useEffect(() => {
    if (!usuario) return undefined;
    let espera = null;
    const agendar = () => { clearTimeout(espera); espera = setTimeout(recarregarQuartos, 400); };
    const canal = supabase
      .channel(`governanca-quartos-${usuario.hotel_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quartos', filter: `hotel_id=eq.${usuario.hotel_id}` }, agendar)
      .subscribe();
    const relogio = setInterval(() => { if (document.visibilityState === 'visible') recarregarQuartos(); }, 60000);
    const aoVoltar = () => { if (document.visibilityState === 'visible') recarregarQuartos(); };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      clearTimeout(espera); clearInterval(relogio);
      document.removeEventListener('visibilitychange', aoVoltar);
      supabase.removeChannel(canal);
    };
  }, [usuario, recarregarQuartos]);

  // Avisos da Cloudbeds: dois que chegam juntos (ex.: limpeza + bloqueio)
  // aparecem um embaixo do outro
  function mostrarSync(msg) {
    setMsgSync((lista) => [...(Array.isArray(lista) ? lista : []).filter((m) => m !== msg), msg].slice(-3));
    clearTimeout(relogiosAviso.current.sync);
    relogiosAviso.current.sync = setTimeout(() => setMsgSync([]), 8000);
  }

  function trocarQuarto(id, campos) {
    setQuartos((lista) => lista.map((q) => (q.id === id ? { ...q, ...campos } : q)));
  }

  // Envia a mudança pra Cloudbeds de verdade (via nossa rota de servidor — a
  // chave nunca passa pelo navegador). Se o quarto ainda não tiver vínculo
  // configurado, avisa isso claramente em vez de fingir que sincronizou.
  async function sincronizarComCloudbeds(quarto, params) {
    const corpo = paraCloudbeds(params);
    if (!Object.keys(corpo).length) return;
    try {
      const { data: sessao } = await supabase.auth.getSession();
      const resposta = await fetch('/api/governanca-atualizar-cloudbeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.session.access_token}` },
        body: JSON.stringify({ quartoId: quarto.id, ...corpo }),
      });
      const resultado = await resposta.json();
      if (resultado.naoVinculado) {
        mostrarSync(`🔄 Apartamento ${quarto.numero}: status atualizado aqui (esse quarto ainda não está vinculado a um quarto da Cloudbeds — configure em Quartos).`);
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

  // A lista dela já vem na ordem certa: prioridade da recepção, saídas,
  // quartos com hóspede e, no fim, os "Não perturbe" de hoje. Tocar em
  // "Entrei no quarto" equivale a ler o QR Code da porta.
  const agoraTela = new Date();
  const meusQuartos = ordenarFila(quartos.filter((q) => precisaArrumar(q) && q.camareira_id === usuario?.id), agoraTela);
  const semCamareira = ordenarFila(quartos.filter((q) => precisaArrumar(q) && !q.camareira_id), agoraTela);
  const proximasSaidas = quartos
    .filter((q) => q.estado_apartamento === 'PREVISAO_SAIDA_OCUPADO' && (q.camareira_id === usuario?.id || !q.camareira_id))
    .sort((a, b) => compararNumero(a.numero, b.numero));

  async function entrarNoQuarto(quarto) {
    if (salvando) return;
    setSalvando(true);
    setErro('');
    const inicioEm = new Date().toISOString();
    // Só entra se o quarto ainda estiver sujo (duas camareiras não pegam o mesmo)
    const campos = { status: 'EM_ARRUMACAO', ...(quarto.camareira_id ? {} : { camareira_id: usuario.id }), ...(quarto.nao_perturbe_em ? { nao_perturbe_em: null } : {}) };
    const { data: pegou, error: erroQuarto } = await supabase.from('quartos')
      .update(campos).eq('id', quarto.id).eq('status', 'SUJO').select('id');
    if (erroQuarto) { setSalvando(false); setErro('Não foi possível entrar no quarto. Detalhe técnico: ' + erroQuarto.message); return; }
    if (!pegou || pegou.length === 0) {
      setSalvando(false);
      mostrarAviso(`O apartamento ${quarto.numero} já não está mais sujo — outra pessoa entrou ou mudou o quarto.`);
      recarregarQuartos();
      return;
    }
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
        tipo: tipoDoQuarto(quarto),
      })
      .select().single();
    if (error) {
      await supabase.from('quartos').update({ status: 'SUJO' }).eq('id', quarto.id);
      setSalvando(false);
      setErro('Não foi possível iniciar. Detalhe técnico: ' + error.message);
      return;
    }
    setSalvando(false);
    setChecklist(CHECKLIST_VAZIO);
    const quartoAgora = { ...quarto, ...campos, nao_perturbe_em: quarto.nao_perturbe_em || null };
    setSessaoAtiva({ ...novaSessao, quarto: quartoAgora });
    trocarQuarto(quarto.id, campos);
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { /* sem rolagem */ }
    // A Cloudbeds não tem "em arrumação" (só limpo/sujo/inspecionado): ela
    // fica sabendo quando o quarto fica pronto.
  }

  // Hóspede pediu para não incomodar: o quarto vai para o fim da lista de hoje
  // e a Cloudbeds marca "Não perturbe".
  async function marcarNaoPerturbe(quarto) {
    if (salvando) return;
    setSalvando(true);
    const quando = new Date().toISOString();
    const { error } = await supabase.from('quartos').update({ nao_perturbe_em: quando }).eq('id', quarto.id);
    setSalvando(false);
    if (error) { setErro('Não foi possível marcar. Detalhe técnico: ' + error.message); return; }
    trocarQuarto(quarto.id, { nao_perturbe_em: quando });
    mostrarAviso(`Apartamento ${quarto.numero}: "Não perturbe". Ele foi para o fim da sua lista — tente de novo mais tarde.`);
    sincronizarComCloudbeds(quarto, { doNotDisturb: true });
  }

  // Entrou no quarto errado: volta para a lista sem contar nos Insights
  async function desistirDoQuarto() {
    if (!sessaoAtiva || salvando) return;
    setSalvando(true);
    const fimEm = new Date().toISOString();
    await supabase.from('governanca_sessoes').update({ fim_em: fimEm, cancelada: true, checklist }).eq('id', sessaoAtiva.id);
    await supabase.from('quartos').update({ status: 'SUJO' }).eq('id', sessaoAtiva.quarto.id).eq('status', 'EM_ARRUMACAO');
    trocarQuarto(sessaoAtiva.quarto.id, { status: 'SUJO' });
    setSalvando(false);
    mostrarAviso(`Apartamento ${sessaoAtiva.quarto.numero} voltou para a lista.`);
    setSessaoAtiva(null);
    carregarTudo(usuario);
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

    // Saída arrumada vira "Limpo / Apt limpo" (pronto pra vender). Quarto
    // com hóspede continua com o estado dele, mas a limpeza fica LIMPO e a
    // Cloudbeds recebe "clean" (lá aparece como "Ocupado e limpo").
    const quartoAntes = quartos.find((q) => q.id === sessaoAtiva.quarto.id) || sessaoAtiva.quarto;
    const novoEstadoApartamento = estadoAoTerminar(quartoAntes.estado_apartamento);
    const campos = { status: 'LIMPO', estado_apartamento: novoEstadoApartamento, ultima_limpeza: fimEm };
    if (quartoAntes.prioridade) { campos.prioridade = false; campos.prioridade_obs = null; }
    if (quartoAntes.nao_perturbe_em) campos.nao_perturbe_em = null;

    await supabase.from('quartos').update(campos).eq('id', sessaoAtiva.quarto.id);

    setSalvando(false);
    const numero = sessaoAtiva.quarto.numero;
    trocarQuarto(sessaoAtiva.quarto.id, campos);
    sincronizarComCloudbeds(sessaoAtiva.quarto, cloudbedsAoTerminar(sessaoAtiva.quarto));

    setPopupManutencao({ quartoNumero: numero });
    setManutTemProblema(null); setManutDescricao(''); setManutPrioridade('MEDIA'); setManutFoto(null); setErroPopup('');
    setSessaoAtiva(null);
    carregarTudo(usuario);
  }

  // ---- Pop-up 1: Manutenção ----
  async function confirmarPopupManutencao() {
    setErroPopup('');
    if (manutTemProblema === true) {
      if (!manutDescricao.trim()) { setErroPopup('Descreva o problema encontrado.'); return; }
      if (manutFoto && !/^image\//.test(manutFoto.type || '')) { setErroPopup('A foto precisa ser uma imagem.'); return; }
      setSalvando(true);
      // Foto (opcional): ajuda o técnico a ver o problema antes de subir
      let foto = {};
      if (manutFoto) {
        const caminho = `${usuario.hotel_id}/manutencao/${Date.now()}_${nomeDeArquivo(manutFoto.name)}`;
        const { error: erroUpload } = await supabase.storage.from('anexos').upload(caminho, manutFoto);
        if (erroUpload) {
          setSalvando(false);
          setErroPopup('Não foi possível enviar a foto. Detalhe técnico: ' + erroUpload.message);
          return;
        }
        foto = { foto_caminho: caminho, foto_nome: manutFoto.name };
      }
      const local = `Apartamento ${popupManutencao.quartoNumero}`;
      const { data: criadoManut, error } = await supabase.from('manutencoes').insert({
        local, descricao: manutDescricao.trim(), prioridade: manutPrioridade,
        origem: 'GOVERNANCA', criado_por_id: usuario.id, hotel_id: usuario.hotel_id, ...foto,
      }).select('id').single();
      if (!error) {
        // Aviso no celular da Manutenção (se falhar, a função agendada manda depois)
        if (criadoManut?.id) chamarRota('/api/manutencao-avisos', { chamadoId: criadoManut.id });
        await supabase.from('manutencoes_log').insert({
          usuario_id: usuario.id, local, acao: 'Chamado aberto',
          detalhe: `Chamado aberto via checklist da governança por ${usuario.nome} (prioridade ${PRIORIDADE_LABEL[manutPrioridade]}${foto.foto_caminho ? ', com foto' : ''}).`,
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
      const caminho = `${usuario.hotel_id}/achados/${Date.now()}_${nomeDeArquivo(achadosFoto.name)}`;
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
    setQInterditadoAte(''); setQMotivoInterdicao(''); setQPrioridade(false); setQPrioridadeObs(''); setQAndar('');
    setMostrarFormNovoQuarto(true);
  }

  function abrirEdicaoQuarto(q) {
    setMostrarFormNovoQuarto(false);
    setEditandoQuartoId(q.id);
    setQNumero(q.numero); setQCamareira(q.camareira_id ? String(q.camareira_id) : '');
    setQEstadoApartamento(q.estado_apartamento || 'SAIDA_SUJO');
    setQInterditadoAte(q.interditado_ate || ''); setQMotivoInterdicao('');
    setQPrioridade(!!q.prioridade); setQPrioridadeObs(q.prioridade_obs || '');
    setQAndar(q.andar === null || q.andar === undefined ? '' : String(q.andar));
    setErroFormQuarto('');
  }

  async function chamarBloqueio(quarto, corpo) {
    try {
      const { data: sessao } = await supabase.auth.getSession();
      const resposta = await fetch('/api/governanca-bloqueio-cloudbeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.session.access_token}` },
        body: JSON.stringify({ quartoId: quarto.id, ...corpo }),
      });
      const r = await resposta.json().catch(() => ({}));
      if (r.naoVinculado) return `Apartamento ${quarto.numero}: não está vinculado à Cloudbeds — ${corpo.acao === 'bloquear' ? 'bloqueie' : 'libere'} por lá se precisar.`;
      if (!resposta.ok || r.erro) return `⚠️ Apartamento ${quarto.numero}: ${r.erro || 'a Cloudbeds não respondeu.'} ${corpo.acao === 'bloquear' ? 'Bloqueie o quarto à mão na Cloudbeds.' : 'Libere o quarto à mão na Cloudbeds.'}`;
      return corpo.acao === 'bloquear'
        ? `🔒 Apartamento ${quarto.numero}: bloqueado na Cloudbeds até ${formatarDia(corpo.ate)} (fora da venda).`
        : `🔓 Apartamento ${quarto.numero}: liberado na Cloudbeds (volta para a venda).`;
    } catch (e) {
      return `⚠️ Apartamento ${quarto.numero}: falha de conexão com o servidor — confira o bloqueio na Cloudbeds.`;
    }
  }

  async function salvarQuarto(evento) {
    evento.preventDefault();
    if (salvando) return;
    setErroFormQuarto('');
    if (!qNumero.trim()) { setErroFormQuarto('Informe o número do apartamento.'); return; }
    if (qAndar.trim() !== '' && (!Number.isFinite(Number(qAndar)) || Number(qAndar) < -5 || Number(qAndar) > 200)) {
      setErroFormQuarto('Andar inválido. Deixe vazio para o sistema descobrir pelo número.');
      return;
    }
    const interditado = qEstadoApartamento === 'INTERDITADO';
    if (interditado) {
      const problema = dataDeVoltaInvalida(qInterditadoAte);
      if (problema) { setErroFormQuarto(problema); return; }
    }

    const quartoAntes = editandoQuartoId ? quartos.find((q) => q.id === editandoQuartoId) : null;
    const mudanca = mudancaDeEstado(quartoAntes || { status: 'SUJO', estado_apartamento: null }, qEstadoApartamento);
    const dados = {
      numero: qNumero.trim(),
      camareira_id: qCamareira ? Number(qCamareira) : null,
      ...mudanca.campos,
      prioridade: qPrioridade,
      prioridade_obs: qPrioridade && qPrioridadeObs.trim() ? qPrioridadeObs.trim().slice(0, 140) : null,
      andar: qAndar.trim() === '' ? null : Math.trunc(Number(qAndar)),
      // Com bloqueio feito na Cloudbeds, quem troca a data é a rota do
      // bloqueio (ela precisa saber a data antiga se o bloqueio já venceu).
      interditado_ate: quartoAntes?.cloudbeds_bloqueio_id ? (quartoAntes.interditado_ate || null) : (interditado ? qInterditadoAte : null),
    };

    setSalvando(true);
    if (editandoQuartoId) {
      const { error } = await supabase.from('quartos').update(dados).eq('id', editandoQuartoId);
      setSalvando(false);
      if (error) { setErroFormQuarto('Não foi possível salvar. Detalhe técnico: ' + error.message); return; }
      mostrarAviso('Quarto atualizado!');
      setEditandoQuartoId(null);
      const quartoDepois = { ...quartoAntes, ...dados };
      // Trocou o estado? A Cloudbeds fica sabendo na hora.
      if (mudanca.mudou && quartoAntes.cloudbeds_room_id) sincronizarComCloudbeds(quartoDepois, mudanca.cloudbeds);
      // Interditado: bloqueia (ou troca a data); saiu de Interditado: libera
      const precisaBloquear = interditado && (mudanca.mudou || !quartoAntes.cloudbeds_bloqueio_id || quartoAntes.interditado_ate !== qInterditadoAte);
      const precisaLiberar = !interditado && (quartoAntes.cloudbeds_bloqueio_id || quartoAntes.estado_apartamento === 'INTERDITADO');
      if (precisaBloquear) {
        chamarBloqueio(quartoDepois, { acao: 'bloquear', ate: qInterditadoAte, motivo: qMotivoInterdicao }).then((t) => { mostrarSync(t); recarregarQuartos(); });
      } else if (precisaLiberar && quartoAntes.cloudbeds_bloqueio_id) {
        chamarBloqueio(quartoDepois, { acao: 'liberar' }).then((t) => { mostrarSync(t); recarregarQuartos(); });
      } else if (precisaLiberar && quartoAntes.cloudbeds_room_id) {
        mostrarSync(`Apartamento ${quartoAntes.numero}: não havia bloqueio feito por aqui — se ele foi bloqueado direto na Cloudbeds, libere por lá.`);
      }
    } else {
      const { data: novo, error } = await supabase.from('quartos')
        .insert({ ...dados, hotel_id: usuario.hotel_id }).select().single();
      setSalvando(false);
      if (error) { setErroFormQuarto('Não foi possível cadastrar. Detalhe técnico: ' + error.message); return; }
      mostrarAviso('Quarto cadastrado!');
      setMostrarFormNovoQuarto(false);
      if (interditado && novo) chamarBloqueio(novo, { acao: 'bloquear', ate: qInterditadoAte, motivo: qMotivoInterdicao }).then((t) => { mostrarSync(t); recarregarQuartos(); });
    }
    carregarTudo(usuario);
  }

  async function marcarSujo(quarto) {
    if (salvando) return;
    setSalvando(true);
    const mudanca = mudancaDeEstado(quarto, 'SAIDA_SUJO');
    const campos = { status: 'SUJO', estado_apartamento: 'SAIDA_SUJO' };
    const { error } = await supabase.from('quartos').update(campos).eq('id', quarto.id);
    setSalvando(false);
    if (error) { setErro('Não foi possível atualizar. Detalhe técnico: ' + error.message); return; }
    trocarQuarto(quarto.id, campos);
    mostrarAviso(`Quarto ${quarto.numero} marcado como sujo (check-out simulado).`);
    sincronizarComCloudbeds(quarto, { roomCondition: 'dirty', ...(mudanca.cloudbeds.refusedService === false ? { refusedService: false } : {}) });
  }

  // Bloqueio que ficou para trás (a Cloudbeds não respondeu na hora)
  async function liberarBloqueio(quarto) {
    if (salvando) return;
    setSalvando(true);
    const texto = await chamarBloqueio(quarto, { acao: 'liberar' });
    setSalvando(false);
    mostrarSync(texto);
    recarregarQuartos();
  }

  // Interditado que a Cloudbeds não bloqueou na hora: tentar de novo
  async function bloquearDeNovo(quarto) {
    if (salvando) return;
    setSalvando(true);
    const texto = await chamarBloqueio(quarto, { acao: 'bloquear', ate: quarto.interditado_ate });
    setSalvando(false);
    mostrarSync(texto);
    recarregarQuartos();
  }

  // Recepção: "faça este primeiro" (hóspede chegando cedo, por exemplo)
  async function alternarPrioridade(quarto) {
    if (salvando) return;
    setSalvando(true);
    const campos = quarto.prioridade ? { prioridade: false, prioridade_obs: null } : { prioridade: true };
    const { error } = await supabase.from('quartos').update(campos).eq('id', quarto.id);
    setSalvando(false);
    if (error) { setErro('Não foi possível marcar a prioridade. Detalhe técnico: ' + error.message); return; }
    trocarQuarto(quarto.id, campos);
    mostrarAviso(campos.prioridade ? `⭐ Apartamento ${quarto.numero} vai para o topo da lista da camareira.` : `Apartamento ${quarto.numero} sem prioridade.`);
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

  const sessoesFinalizadasPeriodo = sessoes.filter((s) => s.fim_em && !s.cancelada && dentroDoPeriodo(s.fim_em));

  const quartosLimposAgora = quartos.filter((q) => q.status === 'LIMPO').length;
  const quartosPendentesAgora = quartos.filter((q) => precisaArrumar(q) || q.status === 'EM_ARRUMACAO').length;

  // Produtividade: por camareira (saída x quarto com hóspede, vistorias) e por apartamento
  const vistoriasPeriodo = vistorias.filter((v) => dentroDoPeriodo(v.criado_em));
  const produtividade = resumoProdutividade(sessoesFinalizadasPeriodo, vistoriasPeriodo, (id) => (id ? nomesUsuarios[id] : null));
  const ranking = produtividade.porCamareira;

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
    trocarQuarto(quarto.id, { cloudbeds_room_id: cloudbedsRoomId || null });
    mostrarAviso(cloudbedsRoomId ? `Apartamento ${quarto.numero} vinculado à Cloudbeds!` : `Vínculo removido do apartamento ${quarto.numero}.`);
  }

  // Cadastrar quarto por quarto manualmente pra depois vincular seria muito
  // trabalho num hotel com dezenas de quartos. Esse botão faz os dois passos
  // de uma vez: cria o apartamento aqui (usando o nome do quarto da
  // Cloudbeds como número) já com o vínculo pronto. Quartos que já existirem
  // aqui (mesmo número, comparando sem diferenciar maiúsculas/espaços) só
  // recebem o vínculo, sem duplicar.
  // Traduz a situação real da Cloudbeds para o nosso quarto (limpeza +
  // estado do apartamento) — mesmas regras do aviso automático.
  // "Interditado" e "Serviços gerais" só a equipe muda.
  function camposDaCloudbeds(q, rc) {
    return estadoAposCloudbeds(q, { condicao: rc.roomCondition, ocupado: !!rc.roomOccupied, bloqueado: !!rc.roomBlocked });
  }

  async function importarQuartosDaCloudbeds() {
    if (!quartosCloudbeds || quartosCloudbeds.length === 0) return;
    setImportandoCloudbeds(true);
    setErro('');

    const normalizar = (t) => String(t || '').trim().toLowerCase();
    const porNumero = Object.fromEntries(quartos.map((q) => [normalizar(q.numero), q]));

    let criados = 0, vinculados = 0, jaOk = 0;
    for (const rc of quartosCloudbeds) {
      const existente = porNumero[normalizar(rc.roomName)];
      if (existente) {
        const campos = { ...(existente.cloudbeds_room_id !== rc.roomID ? { cloudbeds_room_id: rc.roomID } : {}), ...(camposDaCloudbeds(existente, rc) || {}) };
        if (!Object.keys(campos).length) { jaOk++; continue; }
        const { error } = await supabase.from('quartos').update(campos).eq('id', existente.id);
        if (!error) vinculados++;
      } else {
        const { error } = await supabase.from('quartos').insert({
          numero: rc.roomName, cloudbeds_room_id: rc.roomID, ...estadoInicialDaCloudbeds(rc), hotel_id: usuario.hotel_id,
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
      const campos = camposDaCloudbeds(q, rc);
      if (campos) {
        const { error } = await supabase.from('quartos').update(campos).eq('id', q.id);
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
      mostrarAviso(ativar ? '🔔 Notificações da Cloudbeds ativadas, com senha!' : 'Notificações desativadas.');
      if (resultado.aviso) mostrarSync(resultado.aviso);
      carregarTudo(usuario);
    } catch (e) {
      setConfigurandoWebhook(false);
      setErroWebhook('Falha de conexão.');
    }
  }

  // Campos comuns ao cadastro e à edição: estado (os 8 nomes), previsão de
  // volta do Interditado e a prioridade da recepção
  function camposDoEstado() {
    const efeito = {
      SAIDA_SUJO: 'Entra na lista da camareira (saída).',
      ARRUMACAO_OCUPADO: 'Entra na lista da camareira (hóspede no quarto).',
      VIROU_ARRUMACAO_OCUPADO: 'Entra na lista da camareira (hóspede no quarto).',
      NAO_DESEJA_ARRUMACAO_OCUPADO: 'Sai da lista de hoje. Na Cloudbeds: "Recusou serviço".',
      PREVISAO_SAIDA_OCUPADO: 'Aparece em "Próximas saídas". Vira "Saída / Apt Sujo" sozinho no check-out.',
      LIMPO: 'Limpo — na Cloudbeds fica "limpo".',
      SERVICOS_GERAIS: 'Fica em manutenção, sem tirar da venda.',
      INTERDITADO: 'Fica em manutenção e sai da venda na Cloudbeds até a previsão de volta.',
    }[qEstadoApartamento];
    return (
      <>
        <label className="rotulo">Estado do Apartamento</label>
        <select className="campo" value={qEstadoApartamento} onChange={(e) => setQEstadoApartamento(e.target.value)}>
          {Object.entries(ESTADO_APARTAMENTO_LABEL).map(([chave, rotulo]) => <option key={chave} value={chave}>{rotulo}</option>)}
        </select>
        {efeito && <p className="texto-suave gv-efeito">{efeito}</p>}
        {qEstadoApartamento === 'INTERDITADO' && (
          <div className="gv-interdicao">
            <label className="rotulo" htmlFor="gv-volta">Previsão de volta *</label>
            <input id="gv-volta" className="campo" type="date" min={hojeNoHotel()} value={qInterditadoAte}
              onChange={(e) => { setQInterditadoAte(e.target.value); setErroFormQuarto(''); }} />
            <p className="texto-suave gv-efeito">O quarto fica bloqueado na Cloudbeds de hoje até este dia (inclusive).</p>
            <label className="rotulo" htmlFor="gv-motivo">Motivo (opcional)</label>
            <input id="gv-motivo" className="campo" type="text" maxLength={120} value={qMotivoInterdicao}
              onChange={(e) => setQMotivoInterdicao(e.target.value)} placeholder="Ex.: troca do ar-condicionado" />
          </div>
        )}
        <label className="rotulo" htmlFor="gv-andar">Andar</label>
        <input id="gv-andar" className="campo" type="number" inputMode="numeric" min={-5} max={200} value={qAndar}
          onChange={(e) => setQAndar(e.target.value)}
          placeholder={`Vazio = pelo número${andarDoQuarto({ numero: qNumero }) !== null ? ` (${nomeDoAndar(andarDoQuarto({ numero: qNumero }))})` : ''}`} />
        <label className="gv-check-prioridade">
          <input type="checkbox" checked={qPrioridade} onChange={(e) => setQPrioridade(e.target.checked)} />
          <span>⭐ Prioridade — a camareira faz este quarto primeiro</span>
        </label>
        {qPrioridade && (
          <input className="campo" type="text" maxLength={140} value={qPrioridadeObs}
            onChange={(e) => setQPrioridadeObs(e.target.value)} placeholder="Motivo (opcional). Ex.: hóspede chega às 11h" aria-label="Motivo da prioridade" />
        )}
      </>
    );
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
      {msgSync.length > 0 && <div className="gv-sync" role="status">{msgSync.map((m) => <div key={m}>{m}</div>)}</div>}

      {/* Sub-abas */}
      <nav className="gv-abas" aria-label="Seções">
        {podeVerQuartos && (
          <button type="button" className={subAba === 'painel' ? 'gv-aba gv-aba-ativa' : 'gv-aba'}
            onClick={() => setSubAba('painel')}>
            Painel
          </button>
        )}
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
          {usuario?.papel === 'CAMAREIRA' && <AvisosNoCelular />}
          <PedidosCamareira usuario={usuario} />
          {!sessaoAtiva ? (
            <>
              <div className="gv-cam-topo">
                <strong>{meusQuartos.length === 0 ? 'Nenhum quarto seu para arrumar' : `${meusQuartos.length} quarto(s) para arrumar`}</strong>
                <span className="texto-suave">A lista já está na ordem: prioridades, saídas e depois os quartos com hóspede.</span>
              </div>
              {meusQuartos.length === 0 ? (
                <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
                  Nenhum apartamento pendente para você no momento. 🎉
                </div>
              ) : (
                <div className="gv-lista-quartos">
                  {meusQuartos.map((q) => (
                    <CartaoDaCamareira key={q.id} q={q} agora={agoraTela} salvando={salvando}
                      onEntrar={() => entrarNoQuarto(q)} onNaoPerturbe={() => marcarNaoPerturbe(q)} />
                  ))}
                </div>
              )}

              {semCamareira.length > 0 && (
                <div className="gv-cam-bloco">
                  <h2 className="gv-cam-titulo">Sem camareira ({semCamareira.length})</h2>
                  <p className="texto-suave" style={{ fontSize: 13, margin: '0 0 8px' }}>
                    Ninguém pegou estes ainda. Ao tocar em &quot;Pegar e entrar&quot;, o quarto passa a ser seu.
                  </p>
                  <div className="gv-lista-quartos">
                    {semCamareira.map((q) => (
                      <CartaoDaCamareira key={q.id} q={q} agora={agoraTela} salvando={salvando} semDona
                        onEntrar={() => entrarNoQuarto(q)} onNaoPerturbe={() => marcarNaoPerturbe(q)} />
                    ))}
                  </div>
                </div>
              )}

              {proximasSaidas.length > 0 && (
                <div className="gv-cam-bloco">
                  <h2 className="gv-cam-titulo">Próximas saídas ({proximasSaidas.length})</h2>
                  <p className="texto-suave" style={{ fontSize: 13, margin: '0 0 8px' }}>
                    O hóspede ainda está no quarto. Quando a recepção fizer o check-out, ele entra na sua lista sozinho.
                  </p>
                  <div className="gv-saidas">
                    {proximasSaidas.map((q) => <span key={q.id} className="gv-saida-chip">{q.numero}</span>)}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="cartao gv-sessao">
              <h2 className="gv-sessao-numero">Apartamento {sessaoAtiva.quarto.numero}</h2>
              <p className="texto-suave" style={{ fontSize: 13, marginTop: 0 }}>
                {rotuloDoEstado(sessaoAtiva.quarto)} · você entrou às {horaCurta(sessaoAtiva.inicio_em)}
              </p>
              <p style={{ fontSize: 14, margin: '10px 0 0' }}>Marque cada item conforme for concluindo:</p>

              <div className="gv-checklist">
                {CHECKLIST_ITENS.map((item) => (
                  <label key={item.chave} className="gv-check-item">
                    <input type="checkbox" checked={!!checklist[item.chave]}
                      onChange={() => alternarChecklist(item.chave)} />
                    <span>{item.rotulo}</span>
                  </label>
                ))}
              </div>

              <button type="button" className="botao botao-principal gv-botao-grande gv-botao-limpo"
                onClick={finalizarArrumacao} disabled={salvando}>
                {salvando ? 'Salvando…' : '✅ Quarto Limpo'}
              </button>
              <button type="button" className="gv-desistir" onClick={desistirDoQuarto} disabled={salvando}>
                Entrei no quarto errado — voltar para a lista
              </button>
            </div>
          )}
        </section>
      )}

      {/* ================= PAINEL (governanta / recepção) ================= */}
      {!carregando && subAba === 'painel' && podeVerQuartos && (
        <PainelGovernanta usuario={usuario} quartos={quartos} sessoes={sessoes} camareiras={camareiras}
          recarregar={recarregarQuartos} mostrarAviso={mostrarAviso} mostrarSync={mostrarSync} />
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
              Quarto sujo sem camareira aparece para todas as camareiras em &quot;Sem camareira&quot;, e a primeira que pegar fica com ele.
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
              {camposDoEstado()}
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
                      {camposDoEstado()}
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
                          {q.prioridade && <span className="gv-badge gv-tag-prioridade">⭐ Prioridade</span>}
                          {naoPerturbeAtivo(q) && <span className="gv-badge gv-tag-dnd">🚫 Não perturbe às {horaCurta(q.nao_perturbe_em)}</span>}
                          {q.cloudbeds_bloqueio_id && (
                            <span className={bloqueioVencido(q) ? 'gv-badge gv-tag-vencido' : 'gv-badge gv-tag-bloqueio'}>
                              {bloqueioVencido(q) ? `⚠️ Bloqueio venceu em ${formatarDia(q.interditado_ate)}` : `🔒 Fora da venda até ${formatarDia(q.interditado_ate)}`}
                            </span>
                          )}
                          {!q.cloudbeds_bloqueio_id && q.estado_apartamento === 'INTERDITADO' && (
                            <span className={q.cloudbeds_room_id ? 'gv-badge gv-tag-vencido' : 'gv-badge gv-tag-dnd'}>
                              {q.cloudbeds_room_id ? '⚠️ Ainda à venda na Cloudbeds' : 'Sem vínculo com a Cloudbeds'}
                              {q.interditado_ate ? ` · volta prevista ${formatarDia(q.interditado_ate)}` : ''}
                            </span>
                          )}
                        </div>
                        <div className="texto-suave" style={{ fontSize: 13 }}>
                          {q.camareira_id ? `Camareira: ${nomeDe(q.camareira_id)}` : 'Sem camareira atribuída'}
                          {q.ultima_limpeza ? ` · última limpeza em ${formatarDataHora(q.ultima_limpeza)}` : ''}
                          {andarDoQuarto(q) !== null ? ` · ${nomeDoAndar(andarDoQuarto(q))}` : ''}
                          {q.prioridade && q.prioridade_obs ? ` · ⭐ ${q.prioridade_obs}` : ''}
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
                        {q.status !== 'SUJO' && q.status !== 'EM_ARRUMACAO' && q.status !== 'MANUTENCAO' && (
                          <button type="button" className="botao botao-suave" onClick={() => marcarSujo(q)} disabled={salvando}>
                            Marcar sujo
                          </button>
                        )}
                        {(precisaArrumar(q) || q.prioridade) && (
                          <button type="button" className="botao botao-suave" onClick={() => alternarPrioridade(q)} disabled={salvando}>
                            {q.prioridade ? 'Tirar prioridade' : '⭐ Prioridade'}
                          </button>
                        )}
                        {!q.cloudbeds_bloqueio_id && q.cloudbeds_room_id && q.estado_apartamento === 'INTERDITADO' && q.interditado_ate && !bloqueioVencido(q) && (
                          <button type="button" className="botao botao-suave" onClick={() => bloquearDeNovo(q)} disabled={salvando}>
                            🔒 Bloquear na Cloudbeds
                          </button>
                        )}
                        {q.cloudbeds_bloqueio_id && q.estado_apartamento !== 'INTERDITADO' && (
                          <button type="button" className="botao botao-suave" onClick={() => liberarBloqueio(q)} disabled={salvando}>
                            🔓 Liberar na Cloudbeds
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
            <div className="cartao gv-numero"><div className="gv-numero-valor">{duracaoLegivel(produtividade.mediaGeral)}</div><div className="gv-numero-rot">⏱️ Tempo médio por quarto</div></div>
          </div>

          <div className="cartao" style={{ marginTop: 14 }}>
            <h3 style={{ fontSize: '1rem', marginTop: 0 }}>Produtividade por camareira</h3>
            {ranking.length === 0 ? (
              <p className="texto-suave" style={{ fontSize: 14 }}>Sem arrumações concluídas no período selecionado.</p>
            ) : (
              <div className="gv-tabela-envelope">
                <table className="gv-tabela gv-tabela-prod">
                  <thead>
                    <tr><th>#</th><th>Camareira</th><th>Quartos</th><th>Tempo médio</th><th>Saída</th><th>Com hóspede</th><th>Vistorias</th></tr>
                  </thead>
                  <tbody>
                    {ranking.map((c, i) => (
                      <tr key={c.chave}>
                        <td>{i + 1}º</td>
                        <td><strong>{c.nome}</strong></td>
                        <td>{c.total}</td>
                        <td>{duracaoLegivel(media(c.tudo))}</td>
                        <td>{c.saidas ? `${c.saidas} · ${duracaoLegivel(media(c.SAIDA))}` : '—'}</td>
                        <td>{c.ocupados ? `${c.ocupados} · ${duracaoLegivel(media(c.OCUPADO))}` : '—'}</td>
                        <td>{c.aprovadas + c.reprovadas ? `✅ ${c.aprovadas} · ↩️ ${c.reprovadas}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="texto-suave" style={{ fontSize: 12, marginBottom: 0 }}>
              Saída e com hóspede contam a partir desta versão. Arrumação esquecida aberta por mais de {LIMITE_MEDIA_MIN / 60} h fica fora da média.
            </p>
          </div>

          {produtividade.porQuarto.length > 0 && (
            <div className="cartao" style={{ marginTop: 14 }}>
              <h3 style={{ fontSize: '1rem', marginTop: 0 }}>Tempo médio por apartamento</h3>
              <div className="gv-tabela-envelope">
                <table className="gv-tabela">
                  <thead><tr><th>Apartamento</th><th>Arrumações</th><th>Tempo médio</th></tr></thead>
                  <tbody>
                    {produtividade.porQuarto.slice(0, 30).map((q) => (
                      <tr key={q.numero}><td>{q.numero}</td><td>{q.total}</td><td>{duracaoLegivel(media(q.tudo))}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="texto-suave" style={{ fontSize: 12, marginBottom: 0 }}>Os mais demorados primeiro.</p>
            </div>
          )}

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
            <p className="texto-suave" style={{ fontSize: 13 }}>
              Além da limpeza, o aviso acerta o estado do apartamento: check-out feito → &quot;Saída / Apt Sujo&quot;;
              quarto vago e limpo → &quot;Limpo / Apt limpo&quot;. &quot;Interditado&quot; e &quot;Serviços gerais&quot; só a equipe muda.
            </p>
            <p className="texto-suave" style={{ fontSize: 13 }}>
              Bloqueio feito direto na Cloudbeds: o quarto vira &quot;Interditado&quot; aqui, com a data de volta, e sai da lista das camareiras.
              Ao desbloquear lá, volta sozinho como &quot;Saída / Apt Sujo&quot;.
            </p>
            {webhookAtivo ? (
              <>
                <p style={{ color: 'var(--sucesso-texto, #1E6B3C)', fontWeight: 700, fontSize: 14 }}>
                  ✅ Ativado{webhookComSenha ? ' — com senha' : ''}{webhookBloqueio ? ' · bloqueios incluídos' : ''}
                </p>
                {webhookComSenha && !webhookBloqueio && (
                  <div className="gv-alerta" role="alert">
                    Os bloqueios feitos direto na Cloudbeds ainda não chegam aqui. Clique em <strong>Reativar</strong> para incluir
                    (a chave de API precisa do escopo &quot;Room Block&quot;).
                  </div>
                )}
                {!webhookComSenha && (
                  <div className="gv-alerta" role="alert">
                    ⚠️ Estas notificações foram ativadas antes de existir a senha. Hoje qualquer pessoa que descobrir o endereço
                    consegue mudar o status dos quartos. Clique em <strong>Reativar com senha</strong> — leva um segundo.
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {(!webhookComSenha || !webhookBloqueio) && (
                    <button type="button" className="botao botao-principal" onClick={() => configurarWebhook(true)} disabled={configurandoWebhook}>
                      {configurandoWebhook ? 'Reativando…' : webhookComSenha ? '🔒 Reativar (incluir bloqueios)' : '🔐 Reativar com senha'}
                    </button>
                  )}
                  <button type="button" className="botao botao-suave" onClick={() => configurarWebhook(false)} disabled={configurandoWebhook}>
                    {configurandoWebhook ? 'Aguarde…' : 'Desativar notificações'}
                  </button>
                </div>
              </>
            ) : (
              <button type="button" className="botao botao-principal" onClick={() => configurarWebhook(true)} disabled={configurandoWebhook}>
                {configurandoWebhook ? 'Ativando…' : '🔔 Ativar notificações da Cloudbeds'}
              </button>
            )}
            {erroWebhook && (
              <div className="aviso-erro" style={{ marginTop: 10 }}>
                {erroWebhook}
                {webhookAtivo && ' Se a Cloudbeds disser que a inscrição já existe, clique em "Desativar notificações" e depois ative de novo.'}
              </div>
            )}
          </div>

          <CamareirasCloudbeds camareiras={camareiras} mostrarAviso={mostrarAviso} />
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
                <label className="rotulo" htmlFor="gv-manut-foto">Foto do problema (opcional)</label>
                <input id="gv-manut-foto" className="campo" type="file" accept="image/*" capture="environment"
                  onChange={(e) => setManutFoto(e.target.files?.[0] || null)} />
                {manutFoto && <p className="texto-suave" style={{ fontSize: 12, margin: '4px 0 0' }}>📷 {manutFoto.name}</p>}
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

// ---- Cartão de um quarto na lista da camareira (celular) --------------------

function CartaoDaCamareira({ q, agora, salvando, semDona, onEntrar, onNaoPerturbe }) {
  const grupo = grupoNaFila(q, agora);
  const dnd = naoPerturbeAtivo(q, agora);
  return (
    <div className={`cartao gv-cam-cartao gv-grupo-${grupo}`}>
      <div className="gv-cam-cabeca">
        <span className="gv-cam-numero">{q.numero}</span>
        <span className="gv-cam-info">
          <span className="gv-cam-estado">{rotuloDoEstado(q)}</span>
          {q.prioridade && <span className="gv-tag gv-tag-prioridade">⭐ Prioridade{q.prioridade_obs ? ` — ${q.prioridade_obs}` : ''}</span>}
          {dnd && <span className="gv-tag gv-tag-dnd">🚫 Não perturbe às {horaCurta(q.nao_perturbe_em)}</span>}
        </span>
      </div>
      <div className="gv-cam-botoes">
        <button type="button" className="botao botao-principal gv-botao-grande" onClick={onEntrar} disabled={salvando}>
          {semDona ? '🙋 Pegar e entrar' : dnd ? '🚪 Tentar de novo' : '🚪 Entrei no quarto'}
        </button>
        {!dnd && !semDona && (
          <button type="button" className="botao gv-botao-grande gv-botao-dnd" onClick={onNaoPerturbe} disabled={salvando}>
            🚫 Não Perturbe
          </button>
        )}
      </div>
    </div>
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

      .gv-cam-topo { display: flex; flex-direction: column; gap: 2px; margin-bottom: 10px; font-size: 15px; }
      .gv-cam-topo .texto-suave { font-size: 12px; }
      .gv-cam-cartao { padding: 14px; border-left: 6px solid var(--borda); }
      .gv-grupo-0 { border-left-color: #C9A227; }
      .gv-grupo-1 { border-left-color: #C0392B; }
      .gv-grupo-2 { border-left-color: #2C6FAF; }
      .gv-grupo-9 { border-left-color: #9AA5A0; opacity: 0.85; }
      .gv-cam-cabeca { display: flex; align-items: center; gap: 14px; }
      .gv-cam-numero { font-family: var(--fonte-titulo); font-size: 30px; font-weight: 700; min-width: 64px; line-height: 1; }
      .gv-cam-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .gv-cam-estado { font-size: 14px; font-weight: 600; }
      .gv-tag { display: inline-block; font-size: 12px; font-weight: 700; border-radius: 8px; padding: 3px 8px; width: fit-content; max-width: 100%; }
      .gv-tag-prioridade { background: #FBF0C9; color: #7A5A00; }
      .gv-tag-dnd { background: #ECEFEE; color: #4A5551; }
      .gv-tag-bloqueio { background: #F3E5E5; color: #8A1F1F; }
      .gv-tag-vencido { background: #FDF3D7; color: #8A6100; }
      .gv-cam-botoes { display: flex; gap: 8px; margin-top: 12px; }
      .gv-cam-botoes .gv-botao-grande:first-child { flex: 2; }
      .gv-cam-botoes .gv-botao-grande + .gv-botao-grande { flex: 1; }
      .gv-botao-grande { min-height: 56px; font-size: 16px; font-weight: 700; border-radius: 14px; }
      .gv-botao-dnd { background: var(--branco); border: 2px solid #9AA5A0; color: #4A5551; }
      .gv-cam-bloco { margin-top: 22px; }
      .gv-cam-titulo { font-size: 1rem; margin: 0 0 4px; }
      .gv-saidas { display: flex; flex-wrap: wrap; gap: 8px; }
      .gv-saida-chip { border: 1px dashed var(--borda); border-radius: 10px; padding: 8px 12px; font-weight: 700; background: var(--branco); }
      .gv-sessao-numero { font-family: var(--fonte-titulo); font-size: 1.7rem; margin: 0 0 4px; }
      .gv-botao-limpo { width: 100%; margin-top: 16px; min-height: 64px; font-size: 18px; }
      .gv-desistir {
        display: block; width: 100%; margin-top: 12px; background: none; border: none; color: var(--texto-suave);
        text-decoration: underline; font-size: 13px; cursor: pointer; padding: 10px; font-family: inherit;
      }
      .gv-efeito { font-size: 12px; margin: 4px 0 0; }
      .gv-interdicao { background: #FBF4F4; border: 1px solid #EBCACA; border-radius: 12px; padding: 4px 12px 12px; margin-top: 10px; }
      .gv-check-prioridade { display: flex; align-items: center; gap: 10px; margin: 14px 0 6px; font-size: 14px; font-weight: 600; cursor: pointer; }
      .gv-check-prioridade input { width: 20px; height: 20px; }
      .gv-alerta { background: #FDF3D7; color: #8A6100; border-radius: 10px; padding: 10px 14px; font-size: 13px; margin: 8px 0 12px; }

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

      .gv-numeros { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .gv-tabela-prod { min-width: 640px; }
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
        .gv-numeros { grid-template-columns: repeat(4, 1fr); }
      }
    `}</style>
  );
}
