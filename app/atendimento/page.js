'use client';

// ============================================================================
// CAIXA DE ENTRADA (Atendimento → Caixa de Entrada) — Fase 2: LiveChat completo
// ============================================================================
// WhatsApp e e-mails dos hotéis num lugar só:
//   - Conversas em LISTA ou em QUADRO (Kanban por etapa do funil), com filtros
//     por hotel, atendente, etapa, etiqueta, canal, período e situação
//   - conversa com envio de texto, anexos, modelos do WhatsApp, notas internas,
//     etapa, etiquetas, valor da cotação, contato/histórico e reserva Cloudbeds
//   - Contatos (lista, editar, juntar, importar e exportar planilha)
//   - Painel (indicadores mês a mês)
//   - Respostas prontas; Funil e etiquetas (ADMIN); Canais (ADMIN)
//   - Fase 4: Solicitações (registradas pelo robô) e Robô com IA (ADMIN)
// Os dois hotéis aparecem juntos para quem atende nos dois (vínculo do usuário).
// Acesso: ADMIN, ou COLABORADOR com "Pode usar a Caixa de Entrada".
// Atualiza ao vivo (Supabase Realtime) e, por garantia, a cada 20 segundos.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { bloquearSeNaoPermitido } from '../../lib/restricaoAcesso';
import {
  chamarApi, avisarCabecalho, ESTILOS_ATENDIMENTO, ICONE_CANAL, NOME_CANAL, STATUS_CONVERSA, chaveNome, tocarAviso, mostrarNotificacao,
  lerPreferencia, gravarPreferencia, baixarCsv, dataHora,
} from '../components/atendimento/util';
import { Conversa, PainelLateral, NovaConversa } from '../components/atendimento/Conversa';
import { ConfigCanais, RespostasProntas } from '../components/atendimento/Configuracoes';
import { CartaoConversa, Quadro, colunasDoQuadro } from '../components/atendimento/Quadro';
import { Contatos } from '../components/atendimento/Contatos';
import { PainelIndicadores } from '../components/atendimento/Painel';
import { FunilEtiquetas } from '../components/atendimento/Funil';
import { ModelosEmail } from '../components/atendimento/ModelosEmail';
import { Solicitacoes } from '../components/atendimento/Solicitacoes';
import { RoboIA } from '../components/atendimento/Robo';
import { Automacoes } from '../components/atendimento/Automacoes';
import { WhatsAppAvancado } from '../components/atendimento/WhatsApp';

const FILTROS = [
  ['abertas', 'Abertas'],
  ['minhas', 'Minhas'],
  ['sem', 'Sem responsável'],
  ['nao_respondidas', 'Não respondidas'],
  ['nao_lidas', 'Não lidas'],
  ['resolvidas', 'Resolvidas'],
  ['arquivadas', 'Arquivadas'],
  ['todas', 'Todas'],
];

const PERIODOS = [
  ['', 'Qualquer data'],
  ['hoje', 'Hoje'],
  ['7', 'Últimos 7 dias'],
  ['30', 'Últimos 30 dias'],
  ['90', 'Últimos 90 dias'],
];

const ABAS = ['conversas', 'contatos', 'solicitacoes', 'painel', 'respostas', 'modelos', 'funil', 'robo', 'automacoes', 'whatsapp', 'canais'];
const FECHADAS = '(RESOLVIDA,ARQUIVADA)';
const LIMITE_LISTA = 300;
const LIMITE_QUADRO = 600;
const DIA_MS = 86400000;

const limparBusca = (t) => String(t || '').replace(/[,()%*\\]/g, ' ').trim();
const mensagemSemSql = 'A Caixa de Entrada ainda não foi ativada no banco de dados (falta rodar o SQL da Caixa de Entrada no Supabase).';
const mensagemSemFase2 = 'Falta rodar no Supabase o SQL da Fase 2 da Caixa de Entrada (sql/caixa_de_entrada_fase2.sql).';

export default function CaixaDeEntrada() {
  const router = useRouter();
  const [usuario, setUsuario] = useState(null);
  const [verificando, setVerificando] = useState(true);
  const [semPermissao, setSemPermissao] = useState(false);
  const [aba, setAba] = useState('conversas');

  const [equipe, setEquipe] = useState({ hoteis: [], pessoas: [], nomes: {} });
  const [canais, setCanais] = useState([]);
  const [respostas, setRespostas] = useState([]);
  const [etapas, setEtapas] = useState([]);
  const [etiquetas, setEtiquetas] = useState([]);
  const [preferencias, setPreferencias] = useState([]);
  const [modelos, setModelos] = useState([]);
  const [robos, setRobos] = useState({}); // hotel_id → configuração do robô (Fase 4)
  const [usoWhats, setUsoWhats] = useState([]); // franquia de mensagens grátis do mês (só ADMIN)
  const [avisosFechados, setAvisosFechados] = useState({});
  const [solicitacoesNovas, setSolicitacoesNovas] = useState(0);
  const [faltaFase2, setFaltaFase2] = useState(false);

  const [conversas, setConversas] = useState([]);
  const [reservaram, setReservaram] = useState(new Set()); // contatos com ⭐
  const [carregandoLista, setCarregandoLista] = useState(true);
  const [erroLista, setErroLista] = useState('');
  const [aviso, setAviso] = useState('');
  const [visao, setVisao] = useState('lista');
  const [filtro, setFiltro] = useState('abertas');
  const [hotelFiltro, setHotelFiltro] = useState('');
  const [atendenteFiltro, setAtendenteFiltro] = useState('');
  const [etapaFiltro, setEtapaFiltro] = useState('');
  const [etiquetaFiltro, setEtiquetaFiltro] = useState('');
  const [canalFiltro, setCanalFiltro] = useState('');
  const [periodo, setPeriodo] = useState('');
  const [ordem, setOrdem] = useState('recentes');
  const [busca, setBusca] = useState('');
  const [mostrarFiltros, setMostrarFiltros] = useState(false);

  const [selecionadaId, setSelecionadaId] = useState(null);
  const [mensagens, setMensagens] = useState([]);
  const [carregandoMensagens, setCarregandoMensagens] = useState(false);
  const [lateralAberta, setLateralAberta] = useState(false);
  const [novaConversa, setNovaConversa] = useState(null);
  const [avisosLigados, setAvisosLigados] = useState(false);
  const [agora, setAgora] = useState(Date.now());

  const selecionadaRef = useRef(null);
  selecionadaRef.current = selecionadaId;

  // ---- Acesso ----------------------------------------------------------------
  useEffect(() => {
    let ativo = true;
    (async () => {
      const { data: sessao } = await supabase.auth.getSession();
      if (!sessao?.session) { router.push('/login'); return; }
      const { data: u, error } = await supabase.from('usuarios').select('*').eq('auth_id', sessao.session.user.id).single();
      if (error || !u) { router.push('/login'); return; }
      if (bloquearSeNaoPermitido(u.papel, router)) return;
      if (!ativo) return;
      const pode = u.papel === 'ADMIN' || (u.papel === 'COLABORADOR' && u.pode_acessar_atendimento === true);
      setUsuario(u);
      setSemPermissao(!pode);
      const p = new URLSearchParams(window.location.search);
      if (p.get('aba') && ABAS.includes(p.get('aba'))) setAba(p.get('aba'));
      if (p.get('conversa')) setSelecionadaId(Number(p.get('conversa')));
      setVisao(lerPreferencia('at-visao', 'lista') === 'quadro' ? 'quadro' : 'lista');
      setAvisosLigados(lerPreferencia('at-avisos', false) === true && typeof Notification !== 'undefined');
      setVerificando(false);
    })();
    return () => { ativo = false; };
  }, [router]);

  const souAdmin = usuario?.papel === 'ADMIN';
  const hoteisIds = useMemo(() => (equipe.hoteis.length ? equipe.hoteis.map((h) => h.id) : (usuario ? [Number(usuario.hotel_id)] : [])), [equipe.hoteis, usuario]);
  const multiHotel = hoteisIds.length > 1;
  const nomesHoteis = useMemo(() => Object.fromEntries(equipe.hoteis.map((h) => [h.id, h.nome])), [equipe.hoteis]);
  const souAdminDeAlgum = souAdmin || equipe.hoteis.some((h) => h.souAdmin);

  // ADMIN: aviso quando um número do WhatsApp está perto de passar das 1.000
  // mensagens grátis do mês (depois disso a Meta cobra cada mensagem)
  const idsAdmin = (equipe.hoteis.length ? equipe.hoteis.filter((h) => h.souAdmin).map((h) => h.id) : (souAdmin && usuario ? [Number(usuario.hotel_id)] : [])).join(',');
  useEffect(() => {
    if (!idsAdmin) return undefined;
    let ativo = true;
    const ler = async () => {
      const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Fortaleza' });
      const { data } = await supabase.rpc('atendimento_whatsapp_uso', { p_hoteis: idsAdmin.split(',').map(Number), p_inicio: `${hoje.slice(0, 7)}-01`, p_fim: hoje });
      if (!ativo) return;
      const franquia = Number(data?.franquia || 1000);
      setUsoWhats((data?.numeros || []).map((n) => ({ ...n, franquia, usadas: (n.meses || []).reduce((t, m) => t + Number(m.entregues || 0), 0), mes: hoje.slice(0, 7) }))
        .filter((n) => n.usadas >= franquia * 0.9));
    };
    ler();
    const id = setInterval(ler, 10 * 60 * 1000);
    return () => { ativo = false; clearInterval(id); };
  }, [idsAdmin]);
  useEffect(() => {
    try { setAvisosFechados(JSON.parse(sessionStorage.getItem('at-avisos-whats') || '{}')); } catch (e) { /* nada */ }
  }, []);
  function fecharAvisoWhats(chave) {
    const novo = { ...avisosFechados, [chave]: true };
    setAvisosFechados(novo);
    try { sessionStorage.setItem('at-avisos-whats', JSON.stringify(novo)); } catch (e) { /* nada */ }
  }
  const nomesTodos = useMemo(() => {
    const n = { ...equipe.nomes, ...Object.fromEntries(equipe.pessoas.map((p) => [p.id, p.nome])) };
    if (usuario && !n[usuario.id]) n[usuario.id] = usuario.nome;
    return n;
  }, [equipe, usuario]);

  // ---- Dados de apoio ----------------------------------------------------------
  const carregarApoio = useCallback(async () => {
    let eq = null;
    try {
      eq = await chamarApi('/api/atendimento', { acao: 'equipe' });
      setEquipe({ hoteis: eq.hoteis || [], pessoas: eq.pessoas || [], nomes: eq.nomes || {} });
    } catch (e) { /* segue com o hotel atual */ }
    const [c, r, et, eg, pr, me, rb] = await Promise.all([
      supabase.from('atendimento_canais').select('id, hotel_id, tipo, nome, endereco_exibicao, ativo, status, erro, ultima_sincronizacao, config, identificador').order('nome'),
      supabase.from('atendimento_respostas_prontas').select('*').order('atalho'),
      supabase.from('atendimento_etapas').select('*').order('ordem').order('id'),
      supabase.from('atendimento_etiquetas').select('*').order('nome'),
      supabase.from('atendimento_preferencias').select('*'),
      supabase.from('atendimento_modelos_email').select('*').order('categoria').order('nome'),
      supabase.from('atendimento_robo').select('hotel_id, ligado, canais, horas_retomar, nome_assistente'),
    ]);
    if (c.error) setErroLista(/atendimento_|does not exist|schema cache/i.test(c.error.message) ? mensagemSemSql : 'Não foi possível carregar os canais: ' + c.error.message);
    setCanais(c.data || []);
    setRespostas(r.data || []);
    setFaltaFase2(!!(et.error || eg.error));
    setEtapas(et.data || []);
    setEtiquetas(eg.data || []);
    setPreferencias(pr.data || []);
    setModelos(me.data || []);
    setRobos(Object.fromEntries((rb.data || []).map((x) => [x.hotel_id, x])));
  }, []);

  // ---- Filtros → consulta ----------------------------------------------------
  const etiquetasPorId = useMemo(() => Object.fromEntries(etiquetas.map((e) => [e.id, e])), [etiquetas]);
  const opcoesEtiqueta = useMemo(() => {
    const m = new Map();
    etiquetas.forEach((e) => { const k = chaveNome(e.nome); if (!m.has(k)) m.set(k, e.nome); });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [etiquetas]);
  const opcoesEtapa = useMemo(() => colunasDoQuadro(etapas), [etapas]);
  const alertas = useMemo(() => {
    const a = {};
    hoteisIds.forEach((h) => { a[h] = 15; });
    preferencias.forEach((p) => { a[p.hotel_id] = p.alerta_espera_minutos; });
    return a;
  }, [preferencias, hoteisIds]);

  // Monta a consulta com os filtros da tela (usada na lista, no quadro e no exportar)
  const montarConsulta = useCallback(() => {
    let q = supabase.from('atendimento_conversas').select('*');
    if (hotelFiltro) q = q.eq('hotel_id', Number(hotelFiltro));
    else if (hoteisIds.length) q = q.in('hotel_id', hoteisIds); // só o hotel escolhido no topo
    if (filtro === 'abertas') q = q.not('status', 'in', FECHADAS);
    if (filtro === 'minhas') q = q.eq('responsavel_id', usuario.id).not('status', 'in', FECHADAS);
    if (filtro === 'sem') q = q.is('responsavel_id', null).not('status', 'in', FECHADAS);
    if (filtro === 'nao_respondidas') q = q.eq('ultima_direcao', 'ENTRADA').not('status', 'in', FECHADAS);
    if (filtro === 'nao_lidas') q = q.gt('nao_lidas', 0);
    if (filtro === 'resolvidas') q = q.eq('status', 'RESOLVIDA');
    if (filtro === 'arquivadas') q = q.eq('status', 'ARQUIVADA');
    if (filtro === 'todas') q = q.neq('status', 'ARQUIVADA');
    if (atendenteFiltro === 'sem') q = q.is('responsavel_id', null);
    else if (atendenteFiltro) q = q.eq('responsavel_id', Number(atendenteFiltro));
    if (etiquetaFiltro) {
      const ids = etiquetas.filter((e) => chaveNome(e.nome) === etiquetaFiltro).map((e) => e.id);
      q = q.overlaps('etiquetas', ids.length ? ids : [0]);
    }
    if (etapaFiltro) {
      const ids = etapas.filter((e) => chaveNome(e.nome) === etapaFiltro).map((e) => e.id);
      q = q.in('etapa_id', ids.length ? ids : [0]);
    }
    if (canalFiltro) q = q.eq('canal_id', Number(canalFiltro));
    if (periodo) {
      const desde = periodo === 'hoje'
        ? `${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Fortaleza' })}T00:00:00-03:00`
        : new Date(Date.now() - Number(periodo) * DIA_MS).toISOString();
      q = q.gte('ultima_mensagem_em', desde);
    }
    const termo = limparBusca(busca);
    if (termo) {
      const t = `%${termo}%`;
      q = q.or(`contato_nome.ilike.${t},contato_endereco.ilike.${t},assunto.ilike.${t},chave_externa.ilike.${t},ultima_mensagem_resumo.ilike.${t}`);
    }
    const crescente = ordem === 'antigas';
    return q.order('ultima_mensagem_em', { ascending: crescente, nullsFirst: false }).order('id', { ascending: crescente });
  }, [usuario, filtro, hotelFiltro, hoteisIds, atendenteFiltro, etiquetaFiltro, etapaFiltro, canalFiltro, periodo, busca, ordem, etiquetas, etapas]);

  const carregarLista = useCallback(async () => {
    if (!usuario) return;
    const { data, error } = await montarConsulta().limit(visao === 'quadro' ? LIMITE_QUADRO : LIMITE_LISTA);
    if (error) {
      setErroLista(/atendimento_|does not exist|schema cache/i.test(error.message)
        ? (/etiquetas|etapa_id|ARQUIVADA/.test(error.message) ? mensagemSemFase2 : mensagemSemSql)
        : 'Não foi possível carregar as conversas: ' + error.message);
    } else {
      setErroLista('');
      setConversas(data || []);
      const ids = [...new Set((data || []).map((c) => c.contato_id).filter(Boolean))];
      if (ids.length) {
        const { data: ct } = await supabase.from('atendimento_contatos').select('id').eq('ja_reservou', true).in('id', ids.slice(0, 600));
        setReservaram(new Set((ct || []).map((x) => x.id)));
      }
      let qSol = supabase.from('atendimento_solicitacoes').select('id', { count: 'exact', head: true }).eq('situacao', 'NOVA');
      if (hoteisIds.length) qSol = qSol.in('hotel_id', hoteisIds);
      const { count, error: erroSol } = await qSol;
      if (!erroSol) setSolicitacoesNovas(count || 0);
    }
    setCarregandoLista(false);
  }, [usuario, montarConsulta, visao]);

  // Exportar os atendimentos do filtro atual (todos, não só os da tela)
  const [exportando, setExportando] = useState(false);
  async function exportarAtendimentos() {
    setExportando(true);
    try {
      const todos = [];
      for (let de = 0; de < 20000; de += 1000) {
        const { data, error } = await montarConsulta().range(de, de + 999);
        if (error) throw error;
        todos.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      const etapaPorId = Object.fromEntries(etapas.map((e) => [e.id, e.nome]));
      const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Fortaleza' });
      baixarCsv(`atendimentos-${hoje}.csv`,
        ['Início', 'Hotel', 'Canal', 'Contato', 'Telefone / e-mail', 'Assunto', 'Situação', 'Etapa', 'Etiquetas', 'Responsável', 'Valor da cotação',
          'Veio de anúncio', 'Última mensagem', 'Primeira resposta', 'Reserva Cloudbeds', 'Resumo'],
        todos.map((c) => [
          dataHora(c.criado_em), nomesHoteis[c.hotel_id] || c.hotel_id, NOME_CANAL[c.canal_tipo] || c.canal_tipo, c.contato_nome || '', c.contato_endereco || '',
          c.assunto || '', STATUS_CONVERSA[c.status] || c.status, etapaPorId[c.etapa_id] || '',
          (c.etiquetas || []).map((id) => etiquetasPorId[id]?.nome).filter(Boolean).join(', '),
          c.responsavel_id ? (nomesTodos[c.responsavel_id] || `#${c.responsavel_id}`) : '',
          c.valor_cotacao ? Number(c.valor_cotacao).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '',
          c.origem ? (c.origem.titulo || 'Sim') : '', dataHora(c.ultima_mensagem_em), c.primeira_resposta_em ? dataHora(c.primeira_resposta_em) : '',
          c.cloudbeds_reservation_id || '', c.ultima_mensagem_resumo || '',
        ]));
      setAviso(`${todos.length} atendimento(s) exportado(s).`);
    } catch (e) { setAviso('Não foi possível exportar: ' + e.message); }
    setExportando(false);
  }

  // A conversa aberta pode não estar no filtro atual — busca ela à parte
  const [conversaAvulsa, setConversaAvulsa] = useState(null);
  const selecionada = useMemo(
    () => conversas.find((c) => c.id === selecionadaId) || (conversaAvulsa?.id === selecionadaId ? conversaAvulsa : null),
    [conversas, selecionadaId, conversaAvulsa],
  );
  useEffect(() => {
    if (!selecionadaId || conversas.some((c) => c.id === selecionadaId)) return;
    supabase.from('atendimento_conversas').select('*').eq('id', selecionadaId).maybeSingle()
      .then(({ data }) => setConversaAvulsa(data || null));
  }, [selecionadaId, conversas]);

  // ---- Mensagens da conversa aberta ----------------------------------------
  const carregarMensagens = useCallback(async (id) => {
    if (!id) return;
    const { data, error } = await supabase.from('atendimento_mensagens').select('*').eq('conversa_id', id)
      .order('data_original', { ascending: false, nullsFirst: true }).order('id', { ascending: false }).limit(400);
    if (!error && selecionadaRef.current === id) {
      setMensagens((data || []).slice().sort((a, b) => {
        const x = new Date(a.data_original || a.criado_em).getTime();
        const y = new Date(b.data_original || b.criado_em).getTime();
        return x - y || a.id - b.id;
      }));
    }
    setCarregandoMensagens(false);
  }, []);

  const marcarLida = useCallback(async (conversa) => {
    if (!conversa || !conversa.nao_lidas) return;
    setConversas((lista) => lista.map((c) => (c.id === conversa.id ? { ...c, nao_lidas: 0 } : c)));
    try { await chamarApi('/api/atendimento', { acao: 'ler', conversaId: conversa.id }); } catch (e) { /* tenta de novo depois */ }
    avisarCabecalho();
  }, []);

  useEffect(() => { if (usuario && !semPermissao) carregarApoio(); }, [usuario, semPermissao, carregarApoio]);
  useEffect(() => { if (usuario && !semPermissao) carregarLista(); }, [usuario, semPermissao, carregarLista]);
  useEffect(() => {
    setMensagens([]);
    if (selecionadaId) { setCarregandoMensagens(true); carregarMensagens(selecionadaId); }
  }, [selecionadaId, carregarMensagens]);
  useEffect(() => {
    if (selecionada?.nao_lidas && document.visibilityState === 'visible') marcarLida(selecionada);
  }, [selecionada, marcarLida]);

  // Relógio para o "esperando há…" (a cada 30 s)
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  // ---- Avisos de mensagem nova (som + notificação) ----------------------------
  const vistos = useRef(null);
  const verificarNovidades = useCallback(async () => {
    if (!usuario) return;
    const { data } = await supabase.from('atendimento_conversas')
      .select('id, hotel_id, contato_nome, contato_endereco, ultima_mensagem_resumo, ultima_mensagem_em, canal_tipo, responsavel_id')
      .gt('nao_lidas', 0).not('status', 'in', FECHADAS)
      .or(`responsavel_id.is.null,responsavel_id.eq.${usuario.id}`)
      .order('ultima_mensagem_em', { ascending: false, nullsFirst: false }).limit(30);
    if (!data) return;
    const antes = vistos.current;
    vistos.current = new Map(data.map((c) => [c.id, c.ultima_mensagem_em]));
    if (!antes || !avisosLigados) return;
    const novas = data.filter((c) => (!antes.has(c.id) || antes.get(c.id) !== c.ultima_mensagem_em)
      && !(c.id === selecionadaRef.current && document.visibilityState === 'visible'));
    if (!novas.length) return;
    tocarAviso();
    if (document.visibilityState !== 'visible' || novas[0].id !== selecionadaRef.current) {
      const c = novas[0];
      const titulo = novas.length > 1 ? `${novas.length} conversas com mensagem nova` : `${ICONE_CANAL[c.canal_tipo] || ''} ${c.contato_nome || c.contato_endereco || 'Cliente'}`;
      mostrarNotificacao(titulo, novas.length > 1 ? 'Abra a Caixa de Entrada para ver.' : (c.ultima_mensagem_resumo || 'Mensagem nova'), () => abrirConversa(c.id));
    }
  }, [usuario, avisosLigados]); // eslint-disable-line react-hooks/exhaustive-deps

  async function alternarAvisos() {
    if (avisosLigados) { setAvisosLigados(false); gravarPreferencia('at-avisos', false); return; }
    if (typeof Notification === 'undefined') { setAviso('Este navegador não mostra notificações. O som continua tocando com a página aberta.'); }
    else if (Notification.permission !== 'granted') {
      const r = await Notification.requestPermission().catch(() => 'denied');
      if (r !== 'granted') setAviso('O navegador bloqueou as notificações. Vou avisar só com som enquanto a página estiver aberta. Para liberar, clique no cadeado ao lado do endereço do site.');
    }
    tocarAviso();
    setAvisosLigados(true);
    gravarPreferencia('at-avisos', true);
  }

  // ---- Ao vivo + garantia a cada 20 s ----------------------------------------
  const recarregarTudo = useCallback(() => {
    carregarLista();
    verificarNovidades();
    if (selecionadaRef.current) carregarMensagens(selecionadaRef.current);
  }, [carregarLista, carregarMensagens, verificarNovidades]);

  const agendado = useRef(null);
  const agendarRecarga = useCallback(() => {
    clearTimeout(agendado.current);
    agendado.current = setTimeout(recarregarTudo, 400);
  }, [recarregarTudo]);

  const chaveHoteis = hoteisIds.join(',');
  useEffect(() => {
    if (!usuario || semPermissao || !chaveHoteis) return undefined;
    const filtroRt = `hotel_id=in.(${chaveHoteis})`;
    const canalRt = supabase.channel(`atendimento-${usuario.id}-${chaveHoteis}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'atendimento_conversas', filter: filtroRt }, agendarRecarga)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'atendimento_mensagens', filter: filtroRt }, agendarRecarga)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'atendimento_cotacoes', filter: filtroRt }, agendarRecarga)
      .subscribe();
    const intervalo = setInterval(recarregarTudo, 20000);
    verificarNovidades();
    return () => { supabase.removeChannel(canalRt); clearInterval(intervalo); clearTimeout(agendado.current); };
  }, [usuario, semPermissao, chaveHoteis, agendarRecarga, recarregarTudo, verificarNovidades]);

  // E-mails: pede sincronização ao abrir e a cada minuto (o servidor limita)
  const temEmail = canais.some((c) => c.tipo === 'EMAIL' && c.ativo);
  useEffect(() => {
    if (!temEmail) return undefined;
    const sincronizar = () => chamarApi('/api/atendimento', { acao: 'sincronizar' }).then((r) => { if (r.novas) recarregarTudo(); }).catch(() => {});
    sincronizar();
    const id = setInterval(sincronizar, 60000);
    return () => clearInterval(id);
  }, [temEmail, recarregarTudo]);

  // ---- Ações -------------------------------------------------------------------
  function abrirConversa(id) {
    setAba('conversas');
    setSelecionadaId(id);
    window.history.replaceState(null, '', `/atendimento?conversa=${id}`);
  }

  function fecharConversa() {
    setSelecionadaId(null);
    setLateralAberta(false);
    window.history.replaceState(null, '', '/atendimento');
  }

  function trocarVisao(v) {
    if (v === visao) return;
    setVisao(v);
    gravarPreferencia('at-visao', v);
    if (selecionadaId) fecharConversa();
  }

  async function moverConversa(conversa, coluna) {
    const etapaId = coluna.porHotel[conversa.hotel_id];
    if (!etapaId) {
      setAviso(`O hotel ${nomesHoteis[conversa.hotel_id] || ''} não tem a etapa “${coluna.nome}”. O administrador pode criar em “Funil e etiquetas”.`);
      return;
    }
    setConversas((lista) => lista.map((c) => (c.id === conversa.id ? { ...c, etapa_id: etapaId } : c)));
    const { error } = await supabase.from('atendimento_conversas')
      .update({ etapa_id: etapaId, atualizado_em: new Date().toISOString() }).eq('id', conversa.id);
    if (error) setAviso('Não foi possível mover: ' + error.message);
    carregarLista();
  }

  function limparFiltros() {
    setHotelFiltro(''); setAtendenteFiltro(''); setEtapaFiltro(''); setEtiquetaFiltro(''); setCanalFiltro(''); setPeriodo(''); setBusca(''); setOrdem('recentes');
  }

  // ---- Telas -------------------------------------------------------------------
  if (verificando) return <main className="conteudo"><p className="texto-suave">Verificando seu acesso…</p></main>;
  if (semPermissao) {
    return (
      <main className="conteudo">
        <span className="olho">Atendimento</span>
        <h1>Caixa de Entrada</h1>
        <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
          Você ainda não tem permissão para usar a Caixa de Entrada. Peça ao administrador para liberar em Administração → Usuários.
        </div>
      </main>
    );
  }

  const mapaCanais = Object.fromEntries(canais.map((c) => [c.id, c]));
  const nomes = nomesTodos;
  const totalNaoLidas = conversas.reduce((s, c) => s + (!['RESOLVIDA', 'ARQUIVADA'].includes(c.status) ? c.nao_lidas : 0), 0);
  const canalSelecionado = selecionada ? mapaCanais[selecionada.canal_id] : null;
  const pessoasDaConversa = selecionada
    ? (equipe.pessoas.length ? equipe.pessoas.filter((p) => p.hoteis.includes(selecionada.hotel_id)) : [{ id: usuario.id, nome: usuario.nome }])
    : [];
  const filtrosAtivos = [hotelFiltro, atendenteFiltro, etapaFiltro, etiquetaFiltro, canalFiltro, periodo, ordem !== 'recentes' ? 'o' : ''].filter(Boolean).length;
  const quadro = visao === 'quadro';

  const conversaAberta = selecionada && (
    <Conversa
      conversa={selecionada}
      canal={canalSelecionado}
      mensagens={mensagens}
      carregando={carregandoMensagens}
      usuario={usuario}
      atendentes={pessoasDaConversa}
      nomes={nomes}
      respostas={respostas.filter((r) => r.hotel_id === selecionada.hotel_id)}
      etapas={etapas.filter((e) => e.hotel_id === selecionada.hotel_id)}
      etiquetas={etiquetas.filter((e) => e.hotel_id === selecionada.hotel_id)}
      nomeHotel={multiHotel ? nomesHoteis[selecionada.hotel_id] : null}
      nomeHotelReal={nomesHoteis[selecionada.hotel_id] || ''}
      modelos={modelos.filter((m) => m.hotel_id === selecionada.hotel_id)}
      robo={robos[selecionada.hotel_id]}
      alertaMinutos={alertas[selecionada.hotel_id]}
      lateralAberta={lateralAberta}
      onAlternarLateral={() => setLateralAberta(!lateralAberta)}
      onRecarregar={() => { recarregarTudo(); }}
      onVoltar={fecharConversa}
      rotuloVoltar={quadro ? 'Fechar conversa' : null}
    />
  );
  const lateral = selecionada && <PainelLateral conversa={selecionada} onMudou={recarregarTudo} onAbrirConversa={abrirConversa} />;

  return (
    <main className={`conteudo at-conteudo ${aba === 'conversas' && selecionada && !quadro ? 'at-com-conversa' : ''}`}>
      <style>{ESTILOS_ATENDIMENTO}</style>
      <div className="at-cabecalho-pagina">
        <span className="olho">Atendimento</span>
        <div className="barra-pagina">
          <h1 style={{ margin: 0 }}>Caixa de Entrada</h1>
          <div className="at-botoes" style={{ marginTop: 0 }}>
            <button type="button" className={`at-btn ${avisosLigados ? 'at-btn-ligado' : ''}`} onClick={alternarAvisos}
              title="Tocar um som e mostrar notificação quando chegar mensagem nova (sem responsável ou comigo)">
              {avisosLigados ? '🔔 Avisos ligados' : '🔕 Ligar avisos'}
            </button>
            {aba === 'conversas' && <button type="button" className="botao botao-principal" onClick={() => setNovaConversa({})}>+ Nova conversa</button>}
          </div>
        </div>

        <div className="at-abas" role="tablist">
          {[
            ['conversas', <>💬 Conversas{totalNaoLidas > 0 && <span className="at-aba-badge">{totalNaoLidas > 99 ? '99+' : totalNaoLidas}</span>}</>],
            ['contatos', '👥 Contatos'],
            ['solicitacoes', <>📋 Solicitações{solicitacoesNovas > 0 && <span className="at-aba-badge at-aba-badge-laranja">{solicitacoesNovas > 99 ? '99+' : solicitacoesNovas}</span>}</>],
            ['painel', '📊 Painel'],
            // Configurações: só o administrador do hotel (o colaborador continua
            // usando as respostas prontas e os modelos de e-mail na conversa)
            ...(souAdminDeAlgum ? [['respostas', '⚡ Respostas prontas'], ['modelos', '✉️ Modelos de e-mail'], ['funil', '🧩 Funil e etiquetas'], ['robo', '🤖 Robô (IA)'], ['automacoes', '🔁 Automações'], ['whatsapp', '📣 WhatsApp']] : []),
            ...(souAdmin ? [['canais', '⚙️ Canais']] : []),
          ].map(([chave, rotulo]) => (
            <button key={chave} type="button" role="tab" aria-selected={aba === chave} className={`at-aba ${aba === chave ? 'ativa' : ''}`} onClick={() => setAba(chave)}>{rotulo}</button>
          ))}
        </div>
      </div>

      {erroLista && <div className="aviso-erro">{erroLista}</div>}
      {!erroLista && faltaFase2 && <div className="aviso-erro">{mensagemSemFase2}</div>}
      {aviso && (
        <div className="aviso-erro" style={{ background: '#FFF4D6', color: '#7A5600', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <span>{aviso}</span>
          <button type="button" className="at-link-pequeno" onClick={() => setAviso('')}>Fechar</button>
        </div>
      )}
      {usoWhats.filter((n) => !avisosFechados[`${n.canal_id}-${n.mes}-${n.usadas > n.franquia ? 'passou' : 'perto'}`]).map((n) => {
        const chave = `${n.canal_id}-${n.mes}-${n.usadas > n.franquia ? 'passou' : 'perto'}`;
        const preco = Number(n.preco || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        return (
          <div key={chave} className="aviso-erro" style={{ background: '#FFF4D6', color: '#7A5600', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <span>
              📱 O WhatsApp <strong>{n.nome}</strong> já enviou {n.usadas.toLocaleString('pt-BR')} mensagens este mês.{' '}
              {n.usadas > n.franquia
                ? `Passou das ${n.franquia.toLocaleString('pt-BR')} grátis: cada mensagem enviada agora custa cerca de ${preco}. Juntar as mensagens num balão só economiza.`
                : `Faltam ${(n.franquia - n.usadas).toLocaleString('pt-BR')} para acabar as ${n.franquia.toLocaleString('pt-BR')} grátis do mês.`}
              {' '}Veja os detalhes no Painel.
            </span>
            <button type="button" className="at-link-pequeno" onClick={() => fecharAvisoWhats(chave)}>Fechar</button>
          </div>
        );
      })}
      {aba === 'conversas' && !erroLista && canais.length === 0 && (
        <div className="aviso-erro" style={{ background: '#FFF4D6', color: '#7A5600' }}>
          Nenhum canal ligado ainda. {souAdmin ? 'Conecte o WhatsApp e as caixas de e-mail na aba “Canais”.' : 'Peça ao administrador para conectar o WhatsApp e os e-mails.'}
        </div>
      )}

      {aba === 'contatos' && (
        <Contatos
          hoteis={equipe.hoteis.length ? equipe.hoteis : [{ id: Number(usuario.hotel_id), nome: 'Hotel atual' }]}
          multiHotel={multiHotel}
          nomes={nomes}
          onAbrirConversa={abrirConversa}
          onNovaConversa={(inicial) => { setAba('conversas'); setNovaConversa(inicial); }}
        />
      )}
      {aba === 'solicitacoes' && (
        <Solicitacoes
          usuario={usuario} hoteis={equipe.hoteis.length ? equipe.hoteis : [{ id: Number(usuario.hotel_id), nome: 'Hotel atual' }]}
          multiHotel={multiHotel} nomes={nomes} onAbrirConversa={abrirConversa} onMudou={carregarLista}
        />
      )}
      {aba === 'robo' && souAdminDeAlgum && (
        <RoboIA
          hoteis={equipe.hoteis.length ? equipe.hoteis.filter((h) => h.souAdmin) : [{ id: Number(usuario.hotel_id), nome: 'Hotel atual', souAdmin: true }]}
          hotelAtual={usuario.hotel_id} canais={canais} preferencias={preferencias} onMudou={carregarApoio}
        />
      )}
      {aba === 'whatsapp' && souAdminDeAlgum && (
        <WhatsAppAvancado
          hoteis={equipe.hoteis.length ? equipe.hoteis.filter((h) => h.souAdmin) : [{ id: Number(usuario.hotel_id), nome: 'Hotel atual', souAdmin: true }]}
          hotelAtual={usuario.hotel_id} canais={canais} onAbrirConversa={abrirConversa}
        />
      )}
      {aba === 'automacoes' && souAdminDeAlgum && (
        <Automacoes
          hoteis={equipe.hoteis.length ? equipe.hoteis.filter((h) => h.souAdmin) : [{ id: Number(usuario.hotel_id), nome: 'Hotel atual', souAdmin: true }]}
          hotelAtual={usuario.hotel_id} onAbrirConversa={abrirConversa}
        />
      )}
      {aba === 'painel' && (
        <PainelIndicadores hoteis={equipe.hoteis.length ? equipe.hoteis : [{ id: Number(usuario.hotel_id), nome: 'Hotel atual' }]} nomes={nomes} />
      )}
      {aba === 'respostas' && souAdminDeAlgum && (
        <RespostasProntas usuario={usuario} respostas={respostas} hoteis={equipe.hoteis} multiHotel={multiHotel} onMudou={carregarApoio} />
      )}
      {aba === 'modelos' && souAdminDeAlgum && (
        <ModelosEmail
          hoteis={equipe.hoteis.length ? equipe.hoteis : [{ id: Number(usuario.hotel_id), nome: 'Hotel atual', souAdmin }]}
          multiHotel={multiHotel} modelos={modelos} usuario={usuario} onMudou={carregarApoio}
        />
      )}
      {aba === 'funil' && souAdminDeAlgum && (
        <FunilEtiquetas
          hoteis={equipe.hoteis.length ? equipe.hoteis.filter((h) => h.souAdmin) : [{ id: Number(usuario.hotel_id), nome: 'Hotel atual', souAdmin: true }]}
          hotelAtual={usuario.hotel_id} etapas={etapas} etiquetas={etiquetas} preferencias={preferencias} onMudou={carregarApoio}
        />
      )}
      {aba === 'canais' && souAdmin && (
        <>
          {multiHotel && <p className="at-dica">Canais do hotel <strong>{nomesHoteis[Number(usuario.hotel_id)] || 'atual'}</strong>. Para configurar os canais do outro hotel, troque de hotel no menu do topo.</p>}
          <ConfigCanais />
        </>
      )}

      {aba === 'conversas' && (
        <>
          {/* ---------------- Barra de filtros ---------------- */}
          <div className="at-topo-conversas">
          <div className="at-barra-filtros">
            <div className="at-visao" role="group" aria-label="Forma de ver">
              <button type="button" className={!quadro ? 'ativo' : ''} onClick={() => trocarVisao('lista')} aria-pressed={!quadro}>☰ Lista</button>
              <button type="button" className={quadro ? 'ativo' : ''} onClick={() => trocarVisao('quadro')} aria-pressed={quadro}>▦ Quadro</button>
            </div>
            <input className="campo at-campo-pequeno at-busca" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="🔎 Nome, telefone, e-mail ou assunto" />
            <button type="button" className={`at-btn ${filtrosAtivos ? 'at-btn-ligado' : ''}`} onClick={() => setMostrarFiltros(!mostrarFiltros)} aria-expanded={mostrarFiltros}>
              ⚲ Filtros{filtrosAtivos ? ` (${filtrosAtivos})` : ''}
            </button>
            <button type="button" className="at-btn" onClick={exportarAtendimentos} disabled={exportando} title="Baixar planilha com os atendimentos deste filtro">
              {exportando ? 'Exportando…' : '⬇ Exportar'}
            </button>
          </div>
          <div className="at-filtros at-filtros-situacao">
            {FILTROS.map(([chave, rotulo]) => (
              <button key={chave} type="button" className={`at-filtro ${filtro === chave ? 'ativo' : ''}`} onClick={() => setFiltro(chave)}>{rotulo}</button>
            ))}
          </div>
          {mostrarFiltros && (
            <div className="at-filtros-mais">
              {multiHotel && (
                <label><span>Hotel</span>
                  <select className="at-select" value={hotelFiltro} onChange={(e) => setHotelFiltro(e.target.value)}>
                    <option value="">Todos os hotéis</option>
                    {equipe.hoteis.map((h) => <option key={h.id} value={h.id}>{h.nome}</option>)}
                  </select>
                </label>
              )}
              <label><span>Atendente</span>
                <select className="at-select" value={atendenteFiltro} onChange={(e) => setAtendenteFiltro(e.target.value)}>
                  <option value="">Todos</option>
                  <option value={usuario.id}>Comigo</option>
                  <option value="sem">Sem responsável</option>
                  {equipe.pessoas.filter((p) => p.id !== usuario.id).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </label>
              {!quadro && (
                <label><span>Etapa</span>
                  <select className="at-select" value={etapaFiltro} onChange={(e) => setEtapaFiltro(e.target.value)}>
                    <option value="">Todas</option>
                    {opcoesEtapa.map((c) => <option key={c.chave} value={c.chave}>{c.nome}</option>)}
                  </select>
                </label>
              )}
              <label><span>Etiqueta</span>
                <select className="at-select" value={etiquetaFiltro} onChange={(e) => setEtiquetaFiltro(e.target.value)}>
                  <option value="">Todas</option>
                  {opcoesEtiqueta.map(([k, nome]) => <option key={k} value={k}>{nome}</option>)}
                </select>
              </label>
              {canais.length > 1 && (
                <label><span>Canal</span>
                  <select className="at-select" value={canalFiltro} onChange={(e) => setCanalFiltro(e.target.value)}>
                    <option value="">Todos os canais</option>
                    {canais.map((c) => <option key={c.id} value={c.id}>{ICONE_CANAL[c.tipo]} {multiHotel && nomesHoteis[c.hotel_id] ? `${nomesHoteis[c.hotel_id]} · ` : ''}{c.nome}</option>)}
                  </select>
                </label>
              )}
              <label><span>Período</span>
                <select className="at-select" value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
                  {PERIODOS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                </select>
              </label>
              <label><span>Ordem</span>
                <select className="at-select" value={ordem} onChange={(e) => setOrdem(e.target.value)}>
                  <option value="recentes">Mais recentes primeiro</option>
                  <option value="antigas">Mais antigas primeiro</option>
                </select>
              </label>
              {filtrosAtivos > 0 && <button type="button" className="at-link-pequeno" onClick={limparFiltros}>Limpar filtros</button>}
            </div>
          )}
          </div>

          {quadro ? (
            <>
              {carregandoLista ? <div className="at-vazio">Carregando…</div> : (
                <Quadro
                  conversas={conversas} etapas={etapas} etiquetasPorId={etiquetasPorId} nomesHoteis={nomesHoteis}
                  multiHotel={multiHotel} nomes={nomes} usuarioId={usuario.id} alertas={alertas} agora={agora}
                  selecionadaId={selecionadaId} onAbrir={abrirConversa} onMover={moverConversa} limite={LIMITE_QUADRO} reservaram={reservaram} robos={robos}
                />
              )}
              {selecionada && (
                <div className="at-gaveta-fundo" onClick={(e) => { if (e.target === e.currentTarget) fecharConversa(); }} role="presentation">
                  <div className={`at-gaveta ${lateralAberta ? 'com-lateral' : ''}`} role="dialog" aria-modal="true" aria-label="Conversa">
                    <div className="at-col">{conversaAberta}</div>
                    {lateralAberta && <div className="at-col at-col-lateral at-esconder-celular">{lateral}</div>}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className={`at-painel ${selecionada && lateralAberta ? 'com-lateral' : ''}`}>
              {/* ---------------- Lista ---------------- */}
              <div className={`at-col at-col-lista ${selecionada ? 'at-celular-escondido' : ''}`}>
                <div className="at-lista">
                  {carregandoLista ? <div className="at-vazio">Carregando…</div> : conversas.length === 0 ? (
                    <div className="at-vazio">{busca || filtrosAtivos ? 'Nada encontrado com esses filtros.' : 'Nenhuma conversa aqui. 🎉'}</div>
                  ) : conversas.map((c) => (
                    <CartaoConversa
                      key={c.id}
                      c={c}
                      ativo={c.id === selecionadaId}
                      nomeHotel={multiHotel ? nomesHoteis[c.hotel_id] : null}
                      nomeResponsavel={nomes[c.responsavel_id]}
                      souEu={c.responsavel_id === usuario.id}
                      etiquetasPorId={etiquetasPorId}
                      alertaMinutos={alertas[c.hotel_id]}
                      agora={agora}
                      jaReservou={reservaram.has(c.contato_id)}
                      robo={robos[c.hotel_id]}
                      onAbrir={() => abrirConversa(c.id)}
                    />
                  ))}
                  {conversas.length >= LIMITE_LISTA && <div className="at-dica" style={{ padding: 10 }}>Mostrando as {LIMITE_LISTA} mais recentes. Use a busca ou os filtros para achar outras.</div>}
                </div>
              </div>

              {/* ---------------- Conversa ---------------- */}
              <div className={`at-col ${selecionada ? '' : 'at-esconder-celular'}`}>
                {conversaAberta || <div className="at-vazio" style={{ margin: 'auto' }}>Escolha uma conversa na lista.</div>}
              </div>

              {/* ---------------- Contato e reserva (computador) ---------------- */}
              {selecionada && lateralAberta && (
                <div className="at-col at-col-lateral at-esconder-celular">{lateral}</div>
              )}
            </div>
          )}
        </>
      )}

      {/* Contato e reserva (celular): abre por cima */}
      {aba === 'conversas' && selecionada && lateralAberta && (
        <div className="at-overlay at-so-celular at-overlay-lateral" role="dialog" aria-modal="true" aria-label="Contato e reserva">
          <div className="at-modal" style={{ padding: 0 }}>
            <div className="at-modal-topo" style={{ padding: '12px 14px 0' }}>
              <h2>Contato e reserva</h2>
              <button type="button" className="at-btn" onClick={() => setLateralAberta(false)} aria-label="Fechar">✕</button>
            </div>
            {lateral}
          </div>
        </div>
      )}

      {novaConversa && (
        <NovaConversa
          canais={canais}
          inicial={novaConversa}
          nomesHoteis={multiHotel ? nomesHoteis : null}
          nomesHoteisTodos={nomesHoteis}
          modelos={modelos}
          usuario={usuario}
          onFechar={() => setNovaConversa(null)}
          onCriada={(id) => { setNovaConversa(null); setFiltro('todas'); recarregarTudo(); if (id) abrirConversa(id); }}
        />
      )}
    </main>
  );
}
