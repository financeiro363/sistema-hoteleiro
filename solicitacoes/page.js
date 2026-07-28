'use client';

// ============================================================================
// MÓDULO: SOLICITAÇÕES (Workflow / Fluxo de Trabalho)
// Funciona como um "e-mail interno" de tarefas: criar, receber, comentar,
// concluir e encaminhar solicitações — sempre isolado por hotel (RLS).
// ============================================================================

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

// ---- Constantes de apoio ----------------------------------------------------

const LISTA_STATUS = ['Pendente', 'Em Andamento', 'Concluído', 'Encaminhado', 'Cancelado'];
const LISTA_PRIORIDADES = ['Baixa', 'Média', 'Alta', 'Urgente'];

// Cores das etiquetas (tags) de status
const COR_STATUS = {
  'Pendente':     { fundo: '#FDF3D7', texto: '#8A6100', borda: '#EBD394' },
  'Em Andamento': { fundo: '#DCEBFA', texto: '#1D4E89', borda: '#A9CBEE' },
  'Concluído':    { fundo: '#DDF2E4', texto: '#1E6B3C', borda: '#A5D9B8' },
  'Encaminhado':  { fundo: '#EBE2F7', texto: '#5B3A8E', borda: '#C9B3E8' },
  'Cancelado':    { fundo: '#EFEFEF', texto: '#666666', borda: '#D4D4D4' },
};

// Cores das etiquetas de prioridade
const COR_PRIORIDADE = {
  'Baixa':   { fundo: '#F0F0F0', texto: '#555555' },
  'Média':   { fundo: '#E3EEF9', texto: '#2A5E9C' },
  'Alta':    { fundo: '#FCE8D9', texto: '#A34E00' },
  'Urgente': { fundo: '#FBDDDD', texto: '#A31212' },
};

// Formata data e hora no padrão brasileiro
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

// Formata só a data (para o prazo)
function formatarData(valor) {
  if (!valor) return '—';
  try {
    const [ano, mes, dia] = String(valor).slice(0, 10).split('-');
    return `${dia}/${mes}/${ano}`;
  } catch (e) {
    return String(valor);
  }
}

// Verifica se o prazo já passou (e a tarefa ainda não terminou)
function prazoEstourado(tarefa) {
  if (!tarefa.prazo_conclusao) return false;
  if (tarefa.status === 'Concluído' || tarefa.status === 'Cancelado') return false;
  const hoje = new Date();
  const hojeTexto = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
  return String(tarefa.prazo_conclusao).slice(0, 10) < hojeTexto;
}

// Limpa o nome do arquivo para o envio (sem acentos/caracteres especiais)
function limparNomeArquivo(nome) {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
}

// ---- Componente principal ---------------------------------------------------

export default function PaginaSolicitacoes() {
  const router = useRouter();

  // Dados básicos
  const [carregando, setCarregando] = useState(true);
  const [erroGeral, setErroGeral] = useState('');
  const [usuario, setUsuario] = useState(null);      // quem está logado (tabela usuarios)
  const [colegas, setColegas] = useState([]);        // todos os usuários do mesmo hotel
  const [tarefas, setTarefas] = useState([]);        // tarefas visíveis (RLS já filtra)

  // Navegação por abas
  const [aba, setAba] = useState('recebidas');

  // Filtros e busca
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [filtroDataDe, setFiltroDataDe] = useState('');
  const [filtroDataAte, setFiltroDataAte] = useState('');

  // Nova solicitação
  const [mostrarNova, setMostrarNova] = useState(false);
  const [novoTitulo, setNovoTitulo] = useState('');
  const [novaDescricao, setNovaDescricao] = useState('');
  const [novaPrioridade, setNovaPrioridade] = useState('Média');
  const [novoPrazo, setNovoPrazo] = useState('');
  const [novosDestinatarios, setNovosDestinatarios] = useState([]);
  const [novosArquivos, setNovosArquivos] = useState([]);

  // Tarefa aberta (detalhe)
  const [tarefaAberta, setTarefaAberta] = useState(null);
  const [historico, setHistorico] = useState([]);
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);

  // Ações dentro da tarefa aberta
  const [acaoAtiva, setAcaoAtiva] = useState(null); // 'concluir' | 'encaminhar' | 'cancelar' | 'comentar'
  const [comentarioAcao, setComentarioAcao] = useState('');
  const [destinatariosEncaminhar, setDestinatariosEncaminhar] = useState([]);

  const [salvando, setSalvando] = useState(false);

  // Notificações na tela (toasts)
  const [avisos, setAvisos] = useState([]);
  const contadorAviso = useRef(0);
  const usuarioRef = useRef(null);
  const tarefaAbertaRef = useRef(null);

  useEffect(() => { usuarioRef.current = usuario; }, [usuario]);
  useEffect(() => { tarefaAbertaRef.current = tarefaAberta; }, [tarefaAberta]);

  const mostrarAviso = useCallback((texto, tipo = 'info') => {
    contadorAviso.current += 1;
    const id = contadorAviso.current;
    setAvisos((lista) => [...lista, { id, texto, tipo }]);
    setTimeout(() => {
      setAvisos((lista) => lista.filter((a) => a.id !== id));
    }, 6000);
  }, []);

  // ---- Carregamento de dados ------------------------------------------------

  const carregarTarefas = useCallback(async () => {
    const { data, error } = await supabase
      .from('tarefas')
      .select('*')
      .order('data_atualizacao', { ascending: false });
    if (error) {
      setErroGeral('Não foi possível carregar as solicitações. Detalhe técnico: ' + error.message);
      return;
    }
    setTarefas(data || []);
  }, []);

  useEffect(() => {
    let ativo = true;

    async function iniciar() {
      // 1) Verifica login
      const { data: sessao } = await supabase.auth.getSession();
      if (!sessao?.session) {
        router.push('/login');
        return;
      }

      // 2) Busca os dados da pessoa logada na tabela "usuarios"
      const { data: perfil, error: erroPerfil } = await supabase
        .from('usuarios')
        .select('id, nome, email, papel, hotel_id')
        .eq('auth_id', sessao.session.user.id)
        .single();

      if (erroPerfil || !perfil) {
        if (ativo) {
          setErroGeral('Seu login funciona, mas não encontramos seu cadastro na tabela de usuários. Avise o administrador.');
          setCarregando(false);
        }
        return;
      }
      if (!ativo) return;
      setUsuario(perfil);

      // 3) Busca os colegas do mesmo hotel (para escolher destinatários)
      const { data: listaColegas } = await supabase
        .from('usuarios')
        .select('id, nome, email, papel')
        .order('nome', { ascending: true });
      if (ativo) setColegas(listaColegas || []);

      // 4) Carrega as tarefas
      await carregarTarefas();
      if (ativo) setCarregando(false);
    }

    iniciar();
    return () => { ativo = false; };
  }, [router, carregarTarefas]);

  // ---- Notificações em tempo real (Supabase Realtime) -----------------------

  useEffect(() => {
    if (!usuario) return;

    const canal = supabase
      .channel('tarefas-tempo-real')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'tarefas' },
        (payload) => {
          const t = payload.new;
          const eu = usuarioRef.current;
          if (eu && t.responsavel_atual_id === eu.id && t.criado_por_id !== eu.id) {
            mostrarAviso(`Nova solicitação recebida: "${t.titulo}"`, 'nova');
          }
          carregarTarefas();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tarefas' },
        (payload) => {
          const t = payload.new;
          const eu = usuarioRef.current;
          if (eu) {
            if (t.responsavel_atual_id === eu.id && t.criado_por_id !== eu.id) {
              mostrarAviso(`Solicitação #${t.id} atualizada — status: ${t.status}`, 'info');
            } else if (t.criado_por_id === eu.id) {
              mostrarAviso(`Sua solicitação #${t.id} foi atualizada — status: ${t.status}`, 'info');
            }
          }
          carregarTarefas();
          // Se a tarefa aberta na tela for essa, atualiza o detalhe também
          const aberta = tarefaAbertaRef.current;
          if (aberta && aberta.id === t.id) {
            setTarefaAberta((atual) => (atual && atual.id === t.id ? { ...atual, ...t } : atual));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, [usuario, carregarTarefas, mostrarAviso]);

  // ---- Funções auxiliares de exibição ---------------------------------------

  const nomeDoUsuario = useCallback(
    (id) => {
      const pessoa = colegas.find((c) => c.id === id);
      return pessoa ? pessoa.nome : `Usuário #${id}`;
    },
    [colegas]
  );

  const souAdmin = usuario?.papel === 'ADMIN';

  // Lista de tarefas de acordo com a aba escolhida
  function tarefasDaAba() {
    if (!usuario) return [];
    let lista = tarefas;

    if (aba === 'recebidas') {
      lista = lista.filter(
        (t) =>
          t.responsavel_atual_id === usuario.id &&
          t.status !== 'Concluído' &&
          t.status !== 'Cancelado'
      );
    } else if (aba === 'enviadas') {
      lista = lista.filter((t) => t.criado_por_id === usuario.id);
    } else if (aba === 'concluidas') {
      lista = lista.filter((t) => t.status === 'Concluído');
    }
    // aba 'todas' (só admin): não filtra nada além dos filtros abaixo

    // Filtros de busca
    const textoBusca = busca.trim().toLowerCase();
    if (textoBusca) {
      lista = lista.filter((t) => {
        const porTitulo = (t.titulo || '').toLowerCase().includes(textoBusca);
        const porId =
          String(t.id) === textoBusca.replace('#', '') ||
          `#${t.id}` === textoBusca;
        return porTitulo || porId;
      });
    }
    if (filtroStatus) {
      lista = lista.filter((t) => t.status === filtroStatus);
    }
    if (filtroDataDe) {
      lista = lista.filter((t) => String(t.data_criacao).slice(0, 10) >= filtroDataDe);
    }
    if (filtroDataAte) {
      lista = lista.filter((t) => String(t.data_criacao).slice(0, 10) <= filtroDataAte);
    }
    return lista;
  }

  // Contadores das abas (sem os filtros, para orientação rápida)
  const totalRecebidas = usuario
    ? tarefas.filter(
        (t) =>
          t.responsavel_atual_id === usuario.id &&
          t.status !== 'Concluído' &&
          t.status !== 'Cancelado'
      ).length
    : 0;
  const totalEnviadas = usuario ? tarefas.filter((t) => t.criado_por_id === usuario.id).length : 0;
  const totalConcluidas = tarefas.filter((t) => t.status === 'Concluído').length;

  // ---- Histórico da tarefa aberta -------------------------------------------

  const carregarHistorico = useCallback(async (taskId) => {
    setCarregandoHistorico(true);
    const { data, error } = await supabase
      .from('tarefas_historico')
      .select('*')
      .eq('task_id', taskId)
      .order('data_hora', { ascending: true });
    if (!error) setHistorico(data || []);
    setCarregandoHistorico(false);
  }, []);

  function abrirTarefa(t) {
    setTarefaAberta(t);
    setAcaoAtiva(null);
    setComentarioAcao('');
    setDestinatariosEncaminhar([]);
    setHistorico([]);
    carregarHistorico(t.id);
  }

  function fecharTarefa() {
    setTarefaAberta(null);
    setAcaoAtiva(null);
    setComentarioAcao('');
    setDestinatariosEncaminhar([]);
  }

  // ---- Registrar uma linha no histórico -------------------------------------

  async function registrarHistorico(taskId, acao, comentario, encaminhadoParaId = null) {
    const { error } = await supabase.from('tarefas_historico').insert({
      task_id: taskId,
      usuario_id: usuario.id,
      acao,
      comentario: comentario || null,
      encaminhado_para_id: encaminhadoParaId,
      hotel_id: usuario.hotel_id,
    });
    if (error) throw new Error('Falha ao gravar no histórico: ' + error.message);
  }

  // ---- Envio de anexos (Supabase Storage) -----------------------------------

  async function enviarAnexos(arquivos) {
    const enviados = [];
    for (const arquivo of arquivos) {
      const caminho = `${usuario.hotel_id}/${Date.now()}-${limparNomeArquivo(arquivo.name)}`;
      const { error } = await supabase.storage.from('anexos').upload(caminho, arquivo);
      if (error) {
        throw new Error(
          `Falha ao enviar o anexo "${arquivo.name}". ` +
          'Confira se o bucket "anexos" foi criado no Supabase (Storage). ' +
          'Detalhe técnico: ' + error.message
        );
      }
      enviados.push({ nome: arquivo.name, caminho });
    }
    return enviados;
  }

  async function baixarAnexo(anexo) {
    const { data, error } = await supabase.storage
      .from('anexos')
      .createSignedUrl(anexo.caminho, 300);
    if (error || !data?.signedUrl) {
      mostrarAviso('Não foi possível abrir o anexo. Tente novamente.', 'erro');
      return;
    }
    window.open(data.signedUrl, '_blank');
  }

  // ---- Criar nova solicitação -----------------------------------------------

  async function criarSolicitacao(evento) {
    evento.preventDefault();
    if (salvando) return;

    if (!novoTitulo.trim()) {
      mostrarAviso('Escreva um título para a solicitação.', 'erro');
      return;
    }
    if (novosDestinatarios.length === 0) {
      mostrarAviso('Escolha pelo menos um destinatário.', 'erro');
      return;
    }

    setSalvando(true);
    try {
      // 1) Envia os anexos uma vez só (os caminhos são reaproveitados)
      let anexosEnviados = [];
      if (novosArquivos.length > 0) {
        anexosEnviados = await enviarAnexos(novosArquivos);
      }

      // 2) Cria UMA tarefa para CADA destinatário escolhido
      //    (como um e-mail enviado para várias pessoas)
      for (const destinatarioId of novosDestinatarios) {
        const { data: criada, error } = await supabase
          .from('tarefas')
          .insert({
            titulo: novoTitulo.trim(),
            descricao: novaDescricao.trim() || null,
            status: 'Pendente',
            prioridade: novaPrioridade,
            prazo_conclusao: novoPrazo || null,
            criado_por_id: usuario.id,
            responsavel_atual_id: destinatarioId,
            anexos: anexosEnviados,
            hotel_id: usuario.hotel_id,
          })
          .select()
          .single();
        if (error) throw new Error('Falha ao criar a solicitação: ' + error.message);

        await registrarHistorico(
          criada.id,
          'Criou',
          `Criou a solicitação e atribuiu para ${nomeDoUsuario(destinatarioId)}.`,
          destinatarioId
        );
      }

      mostrarAviso(
        novosDestinatarios.length === 1
          ? 'Solicitação enviada!'
          : `Solicitação enviada para ${novosDestinatarios.length} pessoas!`,
        'sucesso'
      );

      // 3) Limpa o formulário e recarrega a lista
      setNovoTitulo('');
      setNovaDescricao('');
      setNovaPrioridade('Média');
      setNovoPrazo('');
      setNovosDestinatarios([]);
      setNovosArquivos([]);
      setMostrarNova(false);
      await carregarTarefas();
    } catch (erro) {
      mostrarAviso(erro.message, 'erro');
    } finally {
      setSalvando(false);
    }
  }

  // ---- Ações na tarefa aberta ------------------------------------------------

  // (a) Mudar status para "Em Andamento"
  async function iniciarAtendimento() {
    if (!tarefaAberta || salvando) return;
    setSalvando(true);
    try {
      const { error } = await supabase
        .from('tarefas')
        .update({ status: 'Em Andamento' })
        .eq('id', tarefaAberta.id);
      if (error) throw new Error('Falha ao atualizar o status: ' + error.message);

      await registrarHistorico(tarefaAberta.id, 'Alterou Status', 'Mudou o status para "Em Andamento".');
      setTarefaAberta({ ...tarefaAberta, status: 'Em Andamento' });
      mostrarAviso('Status alterado para "Em Andamento".', 'sucesso');
      await carregarTarefas();
      await carregarHistorico(tarefaAberta.id);
    } catch (erro) {
      mostrarAviso(erro.message, 'erro');
    } finally {
      setSalvando(false);
    }
  }

  // (b) Concluir (exige comentário final)
  async function concluirTarefa() {
    if (!tarefaAberta || salvando) return;
    if (!comentarioAcao.trim()) {
      mostrarAviso('Escreva um comentário final antes de concluir.', 'erro');
      return;
    }
    setSalvando(true);
    try {
      const agora = new Date().toISOString();
      const { error } = await supabase
        .from('tarefas')
        .update({ status: 'Concluído', data_conclusao: agora })
        .eq('id', tarefaAberta.id);
      if (error) throw new Error('Falha ao concluir: ' + error.message);

      await registrarHistorico(tarefaAberta.id, 'Concluiu', comentarioAcao.trim());
      setTarefaAberta({ ...tarefaAberta, status: 'Concluído', data_conclusao: agora });
      setAcaoAtiva(null);
      setComentarioAcao('');
      mostrarAviso('Solicitação concluída!', 'sucesso');
      await carregarTarefas();
      await carregarHistorico(tarefaAberta.id);
    } catch (erro) {
      mostrarAviso(erro.message, 'erro');
    } finally {
      setSalvando(false);
    }
  }

  // (c) Encaminhar para uma ou mais pessoas (exige comentário do motivo)
  async function encaminharTarefa() {
    if (!tarefaAberta || salvando) return;
    if (destinatariosEncaminhar.length === 0) {
      mostrarAviso('Escolha pelo menos uma pessoa para encaminhar.', 'erro');
      return;
    }
    if (!comentarioAcao.trim()) {
      mostrarAviso('Explique o motivo do encaminhamento no comentário.', 'erro');
      return;
    }
    setSalvando(true);
    try {
      const [primeiro, ...demais] = destinatariosEncaminhar;
      const motivo = comentarioAcao.trim();

      // A tarefa original passa para a primeira pessoa escolhida
      const { error } = await supabase
        .from('tarefas')
        .update({ status: 'Encaminhado', responsavel_atual_id: primeiro })
        .eq('id', tarefaAberta.id);
      if (error) throw new Error('Falha ao encaminhar: ' + error.message);

      await registrarHistorico(tarefaAberta.id, 'Encaminhou', motivo, primeiro);

      // Para as demais pessoas, o sistema cria uma cópia da solicitação
      // (cada pessoa fica com a sua, como um e-mail encaminhado para vários)
      for (const outroId of demais) {
        const { data: copia, error: erroCopia } = await supabase
          .from('tarefas')
          .insert({
            titulo: tarefaAberta.titulo,
            descricao: tarefaAberta.descricao,
            status: 'Encaminhado',
            prioridade: tarefaAberta.prioridade,
            prazo_conclusao: tarefaAberta.prazo_conclusao,
            criado_por_id: usuario.id,
            responsavel_atual_id: outroId,
            anexos: tarefaAberta.anexos || [],
            hotel_id: usuario.hotel_id,
          })
          .select()
          .single();
        if (erroCopia) throw new Error('Falha ao criar cópia do encaminhamento: ' + erroCopia.message);

        await registrarHistorico(
          copia.id,
          'Encaminhou',
          `(cópia da solicitação #${tarefaAberta.id}) ${motivo}`,
          outroId
        );
      }

      setTarefaAberta({ ...tarefaAberta, status: 'Encaminhado', responsavel_atual_id: primeiro });
      setAcaoAtiva(null);
      setComentarioAcao('');
      setDestinatariosEncaminhar([]);
      mostrarAviso('Solicitação encaminhada!', 'sucesso');
      await carregarTarefas();
      await carregarHistorico(tarefaAberta.id);
    } catch (erro) {
      mostrarAviso(erro.message, 'erro');
    } finally {
      setSalvando(false);
    }
  }

  // Cancelar (só quem criou; exige comentário)
  async function cancelarTarefa() {
    if (!tarefaAberta || salvando) return;
    if (!comentarioAcao.trim()) {
      mostrarAviso('Explique o motivo do cancelamento no comentário.', 'erro');
      return;
    }
    setSalvando(true);
    try {
      const { error } = await supabase
        .from('tarefas')
        .update({ status: 'Cancelado' })
        .eq('id', tarefaAberta.id);
      if (error) throw new Error('Falha ao cancelar: ' + error.message);

      await registrarHistorico(
        tarefaAberta.id,
        'Alterou Status',
        `Cancelou a solicitação. Motivo: ${comentarioAcao.trim()}`
      );
      setTarefaAberta({ ...tarefaAberta, status: 'Cancelado' });
      setAcaoAtiva(null);
      setComentarioAcao('');
      mostrarAviso('Solicitação cancelada.', 'sucesso');
      await carregarTarefas();
      await carregarHistorico(tarefaAberta.id);
    } catch (erro) {
      mostrarAviso(erro.message, 'erro');
    } finally {
      setSalvando(false);
    }
  }

  // Comentar (qualquer participante)
  async function comentarTarefa() {
    if (!tarefaAberta || salvando) return;
    if (!comentarioAcao.trim()) {
      mostrarAviso('Escreva o comentário antes de enviar.', 'erro');
      return;
    }
    setSalvando(true);
    try {
      await registrarHistorico(tarefaAberta.id, 'Comentou', comentarioAcao.trim());
      // Toca a tarefa para atualizar a data (e avisar os envolvidos em tempo real)
      await supabase
        .from('tarefas')
        .update({ data_atualizacao: new Date().toISOString() })
        .eq('id', tarefaAberta.id);
      setAcaoAtiva(null);
      setComentarioAcao('');
      mostrarAviso('Comentário adicionado.', 'sucesso');
      await carregarHistorico(tarefaAberta.id);
      await carregarTarefas();
    } catch (erro) {
      mostrarAviso(erro.message, 'erro');
    } finally {
      setSalvando(false);
    }
  }

  // Marca/desmarca uma pessoa numa lista de destinatários
  function alternarDestinatario(lista, definirLista, id) {
    if (lista.includes(id)) {
      definirLista(lista.filter((x) => x !== id));
    } else {
      definirLista([...lista, id]);
    }
  }

  async function sair() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  // ---- Telas de carregamento / erro -----------------------------------------

  if (carregando) {
    return (
      <div className="sol-pagina">
        <EstilosDoModulo />
        <div className="sol-carregando">Carregando solicitações…</div>
      </div>
    );
  }

  if (erroGeral && !usuario) {
    return (
      <div className="sol-pagina">
        <EstilosDoModulo />
        <div className="sol-erro-geral">{erroGeral}</div>
      </div>
    );
  }

  const listaVisivel = tarefasDaAba();
  const souResponsavel = tarefaAberta && tarefaAberta.responsavel_atual_id === usuario.id;
  const souCriador = tarefaAberta && tarefaAberta.criado_por_id === usuario.id;
  const tarefaEncerrada =
    tarefaAberta && (tarefaAberta.status === 'Concluído' || tarefaAberta.status === 'Cancelado');
  const anexosDaTarefa = Array.isArray(tarefaAberta?.anexos) ? tarefaAberta.anexos : [];

  // ---- Interface -------------------------------------------------------------

  return (
    <div className="sol-pagina">
      <EstilosDoModulo />

      {/* Avisos em tempo real (canto da tela) */}
      <div className="sol-avisos" aria-live="polite">
        {avisos.map((a) => (
          <div key={a.id} className={`sol-aviso sol-aviso-${a.tipo}`}>
            {a.texto}
          </div>
        ))}
      </div>

      {/* Cabeçalho */}
      <header className="sol-cabecalho">
        <div className="sol-cabecalho-linha1">
          <h1>Solicitações</h1>
          <div className="sol-cabecalho-acoes">
            <span className="sol-usuario-logado">
              {usuario.nome} {souAdmin ? '· Admin' : ''}
            </span>
            <button type="button" className="sol-botao-suave" onClick={sair}>
              Sair
            </button>
          </div>
        </div>
        <p className="sol-subtitulo">
          Crie, receba, acompanhe e encaminhe tarefas da equipe — como um e-mail interno do hotel.
        </p>
        <button
          type="button"
          className="sol-botao-principal"
          onClick={() => setMostrarNova(!mostrarNova)}
        >
          {mostrarNova ? 'Fechar formulário' : '+ Nova solicitação'}
        </button>
      </header>

      {/* Formulário de nova solicitação */}
      {mostrarNova && (
        <form className="sol-cartao sol-form-nova" onSubmit={criarSolicitacao}>
          <h2>Nova solicitação</h2>

          <label className="sol-rotulo" htmlFor="novo-titulo">Título *</label>
          <input
            id="novo-titulo"
            className="sol-campo"
            type="text"
            value={novoTitulo}
            onChange={(e) => setNovoTitulo(e.target.value)}
            placeholder="Ex.: Trocar chuveiro do quarto 204"
            maxLength={200}
          />

          <label className="sol-rotulo" htmlFor="nova-descricao">Descrição</label>
          <textarea
            id="nova-descricao"
            className="sol-campo"
            rows={4}
            value={novaDescricao}
            onChange={(e) => setNovaDescricao(e.target.value)}
            placeholder="Detalhe o que precisa ser feito…"
          />

          <div className="sol-linha-campos">
            <div>
              <label className="sol-rotulo" htmlFor="nova-prioridade">Prioridade</label>
              <select
                id="nova-prioridade"
                className="sol-campo"
                value={novaPrioridade}
                onChange={(e) => setNovaPrioridade(e.target.value)}
              >
                {LISTA_PRIORIDADES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="sol-rotulo" htmlFor="novo-prazo">Prazo de conclusão</label>
              <input
                id="novo-prazo"
                className="sol-campo"
                type="date"
                value={novoPrazo}
                onChange={(e) => setNovoPrazo(e.target.value)}
              />
            </div>
          </div>

          <label className="sol-rotulo">Enviar para (uma ou mais pessoas) *</label>
          <div className="sol-lista-pessoas">
            {colegas.filter((c) => c.id !== usuario.id).length === 0 && (
              <p className="sol-texto-suave">
                Nenhum outro usuário cadastrado neste hotel ainda.
              </p>
            )}
            {colegas
              .filter((c) => c.id !== usuario.id)
              .map((c) => (
                <label key={c.id} className="sol-pessoa">
                  <input
                    type="checkbox"
                    checked={novosDestinatarios.includes(c.id)}
                    onChange={() =>
                      alternarDestinatario(novosDestinatarios, setNovosDestinatarios, c.id)
                    }
                  />
                  <span>{c.nome}</span>
                  <span className="sol-pessoa-papel">{c.papel}</span>
                </label>
              ))}
          </div>

          <label className="sol-rotulo" htmlFor="novos-anexos">Anexos (opcional)</label>
          <input
            id="novos-anexos"
            className="sol-campo"
            type="file"
            multiple
            onChange={(e) => setNovosArquivos(Array.from(e.target.files || []))}
          />
          {novosArquivos.length > 0 && (
            <p className="sol-texto-suave">
              {novosArquivos.length} arquivo(s) selecionado(s):{' '}
              {novosArquivos.map((f) => f.name).join(', ')}
            </p>
          )}

          <div className="sol-form-botoes">
            <button type="submit" className="sol-botao-principal" disabled={salvando}>
              {salvando ? 'Enviando…' : 'Enviar solicitação'}
            </button>
            <button
              type="button"
              className="sol-botao-suave"
              onClick={() => setMostrarNova(false)}
              disabled={salvando}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* Abas */}
      <nav className="sol-abas" aria-label="Caixas de solicitações">
        <button
          type="button"
          className={aba === 'recebidas' ? 'sol-aba sol-aba-ativa' : 'sol-aba'}
          onClick={() => setAba('recebidas')}
        >
          Minhas tarefas <span className="sol-contador">{totalRecebidas}</span>
        </button>
        <button
          type="button"
          className={aba === 'enviadas' ? 'sol-aba sol-aba-ativa' : 'sol-aba'}
          onClick={() => setAba('enviadas')}
        >
          Enviadas por mim <span className="sol-contador">{totalEnviadas}</span>
        </button>
        <button
          type="button"
          className={aba === 'concluidas' ? 'sol-aba sol-aba-ativa' : 'sol-aba'}
          onClick={() => setAba('concluidas')}
        >
          Concluídas <span className="sol-contador">{totalConcluidas}</span>
        </button>
        {souAdmin && (
          <button
            type="button"
            className={aba === 'todas' ? 'sol-aba sol-aba-ativa' : 'sol-aba'}
            onClick={() => setAba('todas')}
          >
            Todas do hotel <span className="sol-contador">{tarefas.length}</span>
          </button>
        )}
      </nav>

      {/* Filtros e busca */}
      <div className="sol-filtros">
        <input
          className="sol-campo sol-campo-busca"
          type="text"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por título ou nº (ex.: #12)…"
          aria-label="Buscar solicitações"
        />
        <select
          className="sol-campo"
          value={filtroStatus}
          onChange={(e) => setFiltroStatus(e.target.value)}
          aria-label="Filtrar por status"
        >
          <option value="">Todos os status</option>
          {LISTA_STATUS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <div className="sol-filtro-datas">
          <label className="sol-rotulo-mini" htmlFor="filtro-de">De</label>
          <input
            id="filtro-de"
            className="sol-campo"
            type="date"
            value={filtroDataDe}
            onChange={(e) => setFiltroDataDe(e.target.value)}
          />
          <label className="sol-rotulo-mini" htmlFor="filtro-ate">Até</label>
          <input
            id="filtro-ate"
            className="sol-campo"
            type="date"
            value={filtroDataAte}
            onChange={(e) => setFiltroDataAte(e.target.value)}
          />
        </div>
        {(busca || filtroStatus || filtroDataDe || filtroDataAte) && (
          <button
            type="button"
            className="sol-botao-suave"
            onClick={() => {
              setBusca('');
              setFiltroStatus('');
              setFiltroDataDe('');
              setFiltroDataAte('');
            }}
          >
            Limpar filtros
          </button>
        )}
      </div>

      {erroGeral && <div className="sol-erro-geral">{erroGeral}</div>}

      {/* Lista de solicitações */}
      <main className="sol-lista">
        {listaVisivel.length === 0 && (
          <div className="sol-vazio">
            {aba === 'recebidas' && 'Nenhuma tarefa pendente para você. Caixa de entrada em dia! ✔'}
            {aba === 'enviadas' && 'Você ainda não enviou nenhuma solicitação. Use o botão "+ Nova solicitação".'}
            {aba === 'concluidas' && 'Nenhuma solicitação concluída por enquanto.'}
            {aba === 'todas' && 'Nenhuma solicitação encontrada com esses filtros.'}
          </div>
        )}

        {listaVisivel.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`sol-item ${t.status === 'Pendente' || t.status === 'Encaminhado' ? 'sol-item-pendente' : ''}`}
            onClick={() => abrirTarefa(t)}
          >
            <div className="sol-item-topo">
              <span className="sol-item-id">#{t.id}</span>
              <span
                className="sol-tag"
                style={{
                  background: COR_STATUS[t.status]?.fundo,
                  color: COR_STATUS[t.status]?.texto,
                  borderColor: COR_STATUS[t.status]?.borda,
                }}
              >
                {t.status}
              </span>
              <span
                className="sol-tag sol-tag-prioridade"
                style={{
                  background: COR_PRIORIDADE[t.prioridade]?.fundo,
                  color: COR_PRIORIDADE[t.prioridade]?.texto,
                }}
              >
                {t.prioridade}
              </span>
              {prazoEstourado(t) && <span className="sol-tag sol-tag-atraso">Prazo vencido</span>}
            </div>
            <div className="sol-item-titulo">{t.titulo}</div>
            <div className="sol-item-rodape">
              <span>De: {nomeDoUsuario(t.criado_por_id)}</span>
              <span>Para: {nomeDoUsuario(t.responsavel_atual_id)}</span>
              {t.prazo_conclusao && <span>Prazo: {formatarData(t.prazo_conclusao)}</span>}
              <span>Atualizada: {formatarDataHora(t.data_atualizacao)}</span>
            </div>
          </button>
        ))}
      </main>

      {/* Painel de detalhe da tarefa */}
      {tarefaAberta && (
        <div className="sol-fundo-modal" role="dialog" aria-modal="true">
          <div className="sol-modal">
            <div className="sol-modal-cabecalho">
              <div>
                <span className="sol-item-id">#{tarefaAberta.id}</span>{' '}
                <span
                  className="sol-tag"
                  style={{
                    background: COR_STATUS[tarefaAberta.status]?.fundo,
                    color: COR_STATUS[tarefaAberta.status]?.texto,
                    borderColor: COR_STATUS[tarefaAberta.status]?.borda,
                  }}
                >
                  {tarefaAberta.status}
                </span>{' '}
                <span
                  className="sol-tag sol-tag-prioridade"
                  style={{
                    background: COR_PRIORIDADE[tarefaAberta.prioridade]?.fundo,
                    color: COR_PRIORIDADE[tarefaAberta.prioridade]?.texto,
                  }}
                >
                  {tarefaAberta.prioridade}
                </span>
              </div>
              <button type="button" className="sol-botao-fechar" onClick={fecharTarefa} aria-label="Fechar">
                ✕
              </button>
            </div>

            <h2 className="sol-modal-titulo">{tarefaAberta.titulo}</h2>

            <div className="sol-modal-info">
              <div><strong>Criada por:</strong> {nomeDoUsuario(tarefaAberta.criado_por_id)}</div>
              <div><strong>Responsável atual:</strong> {nomeDoUsuario(tarefaAberta.responsavel_atual_id)}</div>
              <div><strong>Criada em:</strong> {formatarDataHora(tarefaAberta.data_criacao)}</div>
              <div>
                <strong>Prazo:</strong> {formatarData(tarefaAberta.prazo_conclusao)}{' '}
                {prazoEstourado(tarefaAberta) && <span className="sol-tag sol-tag-atraso">Vencido</span>}
              </div>
              {tarefaAberta.data_conclusao && (
                <div><strong>Concluída em:</strong> {formatarDataHora(tarefaAberta.data_conclusao)}</div>
              )}
            </div>

            {tarefaAberta.descricao && (
              <p className="sol-modal-descricao">{tarefaAberta.descricao}</p>
            )}

            {anexosDaTarefa.length > 0 && (
              <div className="sol-anexos">
                <strong>Anexos:</strong>
                <div className="sol-anexos-lista">
                  {anexosDaTarefa.map((a, i) => (
                    <button
                      key={i}
                      type="button"
                      className="sol-anexo"
                      onClick={() => baixarAnexo(a)}
                    >
                      📎 {a.nome}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Botões de ação */}
            {!tarefaEncerrada && (
              <div className="sol-acoes">
                {souResponsavel &&
                  (tarefaAberta.status === 'Pendente' || tarefaAberta.status === 'Encaminhado') && (
                    <button
                      type="button"
                      className="sol-botao-principal"
                      onClick={iniciarAtendimento}
                      disabled={salvando}
                    >
                      Iniciar (Em Andamento)
                    </button>
                  )}
                {souResponsavel && (
                  <button
                    type="button"
                    className="sol-botao-concluir"
                    onClick={() => { setAcaoAtiva(acaoAtiva === 'concluir' ? null : 'concluir'); setComentarioAcao(''); }}
                    disabled={salvando}
                  >
                    Concluir
                  </button>
                )}
                {souResponsavel && (
                  <button
                    type="button"
                    className="sol-botao-suave"
                    onClick={() => { setAcaoAtiva(acaoAtiva === 'encaminhar' ? null : 'encaminhar'); setComentarioAcao(''); setDestinatariosEncaminhar([]); }}
                    disabled={salvando}
                  >
                    Encaminhar
                  </button>
                )}
                {souCriador && (
                  <button
                    type="button"
                    className="sol-botao-perigo"
                    onClick={() => { setAcaoAtiva(acaoAtiva === 'cancelar' ? null : 'cancelar'); setComentarioAcao(''); }}
                    disabled={salvando}
                  >
                    Cancelar solicitação
                  </button>
                )}
                <button
                  type="button"
                  className="sol-botao-suave"
                  onClick={() => { setAcaoAtiva(acaoAtiva === 'comentar' ? null : 'comentar'); setComentarioAcao(''); }}
                  disabled={salvando}
                >
                  Comentar
                </button>
              </div>
            )}
            {tarefaEncerrada && (
              <div className="sol-acoes">
                <button
                  type="button"
                  className="sol-botao-suave"
                  onClick={() => { setAcaoAtiva(acaoAtiva === 'comentar' ? null : 'comentar'); setComentarioAcao(''); }}
                  disabled={salvando}
                >
                  Comentar
                </button>
              </div>
            )}

            {/* Caixas das ações que exigem comentário */}
            {acaoAtiva === 'concluir' && (
              <div className="sol-caixa-acao">
                <label className="sol-rotulo" htmlFor="coment-concluir">
                  Comentário final (obrigatório) — o que foi feito?
                </label>
                <textarea
                  id="coment-concluir"
                  className="sol-campo"
                  rows={3}
                  value={comentarioAcao}
                  onChange={(e) => setComentarioAcao(e.target.value)}
                  placeholder="Ex.: Chuveiro trocado e testado, tudo funcionando."
                />
                <button type="button" className="sol-botao-concluir" onClick={concluirTarefa} disabled={salvando}>
                  {salvando ? 'Salvando…' : 'Confirmar conclusão'}
                </button>
              </div>
            )}

            {acaoAtiva === 'encaminhar' && (
              <div className="sol-caixa-acao">
                <label className="sol-rotulo">Encaminhar para (uma ou mais pessoas):</label>
                <div className="sol-lista-pessoas">
                  {colegas
                    .filter((c) => c.id !== usuario.id)
                    .map((c) => (
                      <label key={c.id} className="sol-pessoa">
                        <input
                          type="checkbox"
                          checked={destinatariosEncaminhar.includes(c.id)}
                          onChange={() =>
                            alternarDestinatario(destinatariosEncaminhar, setDestinatariosEncaminhar, c.id)
                          }
                        />
                        <span>{c.nome}</span>
                        <span className="sol-pessoa-papel">{c.papel}</span>
                      </label>
                    ))}
                </div>
                <label className="sol-rotulo" htmlFor="coment-encaminhar">
                  Motivo do encaminhamento (obrigatório):
                </label>
                <textarea
                  id="coment-encaminhar"
                  className="sol-campo"
                  rows={3}
                  value={comentarioAcao}
                  onChange={(e) => setComentarioAcao(e.target.value)}
                  placeholder="Ex.: Repassando para a manutenção, pois é um reparo elétrico."
                />
                <button type="button" className="sol-botao-principal" onClick={encaminharTarefa} disabled={salvando}>
                  {salvando ? 'Encaminhando…' : 'Confirmar encaminhamento'}
                </button>
              </div>
            )}

            {acaoAtiva === 'cancelar' && (
              <div className="sol-caixa-acao">
                <label className="sol-rotulo" htmlFor="coment-cancelar">
                  Motivo do cancelamento (obrigatório):
                </label>
                <textarea
                  id="coment-cancelar"
                  className="sol-campo"
                  rows={3}
                  value={comentarioAcao}
                  onChange={(e) => setComentarioAcao(e.target.value)}
                  placeholder="Ex.: Problema já foi resolvido de outra forma."
                />
                <button type="button" className="sol-botao-perigo" onClick={cancelarTarefa} disabled={salvando}>
                  {salvando ? 'Cancelando…' : 'Confirmar cancelamento'}
                </button>
              </div>
            )}

            {acaoAtiva === 'comentar' && (
              <div className="sol-caixa-acao">
                <label className="sol-rotulo" htmlFor="coment-livre">Comentário:</label>
                <textarea
                  id="coment-livre"
                  className="sol-campo"
                  rows={3}
                  value={comentarioAcao}
                  onChange={(e) => setComentarioAcao(e.target.value)}
                  placeholder="Escreva uma atualização ou observação…"
                />
                <button type="button" className="sol-botao-principal" onClick={comentarTarefa} disabled={salvando}>
                  {salvando ? 'Enviando…' : 'Enviar comentário'}
                </button>
              </div>
            )}

            {/* Linha do tempo (histórico) */}
            <div className="sol-historico">
              <h3>Histórico</h3>
              {carregandoHistorico && <p className="sol-texto-suave">Carregando histórico…</p>}
              {!carregandoHistorico && historico.length === 0 && (
                <p className="sol-texto-suave">Nenhum registro no histórico ainda.</p>
              )}
              <ol className="sol-linha-tempo">
                {historico.map((h) => (
                  <li key={h.id} className="sol-evento">
                    <div className="sol-evento-topo">
                      <strong>{nomeDoUsuario(h.usuario_id)}</strong>
                      <span className="sol-evento-acao">{h.acao}</span>
                      {h.encaminhado_para_id && (
                        <span className="sol-evento-para">→ {nomeDoUsuario(h.encaminhado_para_id)}</span>
                      )}
                    </div>
                    {h.comentario && <div className="sol-evento-comentario">{h.comentario}</div>}
                    <div className="sol-evento-data">{formatarDataHora(h.data_hora)}</div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Estilos (mobile-first; ajustes para tablet/desktop nas media queries) --

function EstilosDoModulo() {
  return (
    <style>{`
      .sol-pagina {
        min-height: 100vh;
        background: #F6F7F5;
        color: #22302B;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
        padding: 16px;
        max-width: 960px;
        margin: 0 auto;
      }
      .sol-carregando, .sol-vazio {
        text-align: center;
        padding: 48px 16px;
        color: #5C6B64;
        font-size: 16px;
      }
      .sol-erro-geral {
        background: #FBDDDD;
        color: #A31212;
        border: 1px solid #F0B4B4;
        border-radius: 10px;
        padding: 14px 16px;
        margin: 12px 0;
        font-size: 15px;
      }

      /* Cabeçalho */
      .sol-cabecalho { margin-bottom: 16px; }
      .sol-cabecalho-linha1 {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        flex-wrap: wrap;
      }
      .sol-cabecalho h1 { font-size: 26px; margin: 0; letter-spacing: -0.5px; }
      .sol-cabecalho-acoes { display: flex; align-items: center; gap: 10px; }
      .sol-usuario-logado { font-size: 14px; color: #5C6B64; }
      .sol-subtitulo { color: #5C6B64; font-size: 14px; margin: 6px 0 14px; }

      /* Botões */
      .sol-botao-principal, .sol-botao-suave, .sol-botao-concluir, .sol-botao-perigo {
        border: none; border-radius: 10px; padding: 12px 18px;
        font-size: 15px; font-weight: 600; cursor: pointer;
        min-height: 44px;
      }
      .sol-botao-principal { background: #0F5C55; color: #FFFFFF; }
      .sol-botao-principal:hover { background: #0C4A45; }
      .sol-botao-suave { background: #E7EAE7; color: #22302B; }
      .sol-botao-suave:hover { background: #DBDFDB; }
      .sol-botao-concluir { background: #1E6B3C; color: #FFFFFF; }
      .sol-botao-concluir:hover { background: #175530; }
      .sol-botao-perigo { background: #FBDDDD; color: #A31212; }
      .sol-botao-perigo:hover { background: #F5C7C7; }
      button:disabled { opacity: 0.6; cursor: not-allowed; }
      button:focus-visible { outline: 3px solid #0F5C55; outline-offset: 2px; }
      input:focus-visible, select:focus-visible, textarea:focus-visible {
        outline: 2px solid #0F5C55; outline-offset: 1px;
      }

      /* Cartões e formulários */
      .sol-cartao {
        background: #FFFFFF; border: 1px solid #E2E6E2; border-radius: 14px;
        padding: 16px; margin-bottom: 16px;
        box-shadow: 0 1px 3px rgba(20, 40, 35, 0.05);
      }
      .sol-form-nova h2 { margin: 0 0 8px; font-size: 19px; }
      .sol-rotulo { display: block; font-size: 14px; font-weight: 600; margin: 12px 0 6px; }
      .sol-rotulo-mini { font-size: 13px; color: #5C6B64; }
      .sol-campo {
        width: 100%; box-sizing: border-box;
        border: 1px solid #C9D1CB; border-radius: 10px;
        padding: 11px 12px; font-size: 16px; background: #FFFFFF; color: #22302B;
      }
      textarea.sol-campo { resize: vertical; }
      .sol-linha-campos { display: grid; grid-template-columns: 1fr; gap: 4px 12px; }
      .sol-form-botoes { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; }

      /* Lista de pessoas (checkboxes) */
      .sol-lista-pessoas {
        display: flex; flex-direction: column; gap: 4px;
        max-height: 220px; overflow-y: auto;
        border: 1px solid #E2E6E2; border-radius: 10px; padding: 8px;
        background: #FBFCFB;
      }
      .sol-pessoa {
        display: flex; align-items: center; gap: 10px;
        padding: 8px; border-radius: 8px; cursor: pointer; font-size: 15px;
      }
      .sol-pessoa:hover { background: #EFF3EF; }
      .sol-pessoa input { width: 18px; height: 18px; }
      .sol-pessoa-papel { margin-left: auto; font-size: 12px; color: #7A877F; }

      /* Abas */
      .sol-abas {
        display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px;
        margin-bottom: 12px;
      }
      .sol-aba {
        border: 1px solid #E2E6E2; background: #FFFFFF; color: #43524B;
        border-radius: 999px; padding: 9px 14px; font-size: 14px; font-weight: 600;
        cursor: pointer; white-space: nowrap; min-height: 40px;
      }
      .sol-aba-ativa { background: #0F5C55; border-color: #0F5C55; color: #FFFFFF; }
      .sol-contador {
        display: inline-block; margin-left: 6px; font-size: 12px;
        background: rgba(0,0,0,0.10); border-radius: 999px; padding: 1px 8px;
      }
      .sol-aba-ativa .sol-contador { background: rgba(255,255,255,0.22); }

      /* Filtros */
      .sol-filtros { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
      .sol-filtro-datas { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .sol-filtro-datas .sol-campo { width: auto; flex: 1; min-width: 130px; }

      /* Lista de solicitações */
      .sol-lista { display: flex; flex-direction: column; gap: 10px; }
      .sol-item {
        text-align: left; background: #FFFFFF; border: 1px solid #E2E6E2;
        border-left: 4px solid #E2E6E2; border-radius: 12px;
        padding: 14px; cursor: pointer; width: 100%;
        font-family: inherit; color: inherit;
        box-shadow: 0 1px 3px rgba(20, 40, 35, 0.05);
      }
      .sol-item:hover { border-color: #0F5C55; }
      .sol-item-pendente { border-left-color: #0F5C55; }
      .sol-item-topo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .sol-item-id { font-size: 13px; font-weight: 700; color: #7A877F; }
      .sol-item-titulo { font-size: 16px; font-weight: 600; margin: 8px 0 6px; }
      .sol-item-rodape {
        display: flex; gap: 6px 16px; flex-wrap: wrap;
        font-size: 13px; color: #5C6B64;
      }

      /* Etiquetas (tags) */
      .sol-tag {
        display: inline-block; font-size: 12px; font-weight: 700;
        border: 1px solid transparent; border-radius: 999px; padding: 3px 10px;
      }
      .sol-tag-prioridade { border: none; }
      .sol-tag-atraso { background: #A31212; color: #FFFFFF; }

      /* Modal de detalhe */
      .sol-fundo-modal {
        position: fixed; inset: 0; background: rgba(15, 25, 22, 0.45);
        display: flex; align-items: flex-end; justify-content: center; z-index: 50;
        padding: 0;
      }
      .sol-modal {
        background: #FFFFFF; width: 100%; max-height: 92vh; overflow-y: auto;
        border-radius: 18px 18px 0 0; padding: 18px;
      }
      .sol-modal-cabecalho {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        margin-bottom: 8px;
      }
      .sol-botao-fechar {
        border: none; background: #E7EAE7; border-radius: 999px;
        width: 40px; height: 40px; font-size: 16px; cursor: pointer;
      }
      .sol-modal-titulo { font-size: 20px; margin: 4px 0 12px; }
      .sol-modal-info {
        display: grid; grid-template-columns: 1fr; gap: 5px;
        font-size: 14px; color: #43524B;
        background: #F6F7F5; border-radius: 10px; padding: 12px;
      }
      .sol-modal-descricao {
        white-space: pre-wrap; font-size: 15px; line-height: 1.55; margin: 14px 0;
      }
      .sol-anexos { margin: 12px 0; font-size: 14px; }
      .sol-anexos-lista { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
      .sol-anexo {
        border: 1px solid #C9D1CB; background: #FBFCFB; border-radius: 10px;
        padding: 8px 12px; font-size: 14px; cursor: pointer;
      }
      .sol-anexo:hover { border-color: #0F5C55; }

      .sol-acoes { display: flex; gap: 8px; flex-wrap: wrap; margin: 14px 0; }
      .sol-caixa-acao {
        border: 1px solid #E2E6E2; border-radius: 12px; padding: 14px;
        background: #FBFCFB; margin-bottom: 14px;
        display: flex; flex-direction: column; gap: 8px;
      }
      .sol-caixa-acao .sol-rotulo { margin-top: 0; }

      /* Histórico */
      .sol-historico h3 { font-size: 16px; margin: 18px 0 10px; }
      .sol-linha-tempo { list-style: none; margin: 0; padding: 0; }
      .sol-evento {
        border-left: 3px solid #C9D1CB; padding: 0 0 14px 14px; position: relative;
      }
      .sol-evento::before {
        content: ''; position: absolute; left: -7px; top: 3px;
        width: 11px; height: 11px; border-radius: 999px;
        background: #0F5C55;
      }
      .sol-evento-topo { display: flex; gap: 8px; flex-wrap: wrap; font-size: 14px; align-items: baseline; }
      .sol-evento-acao {
        font-size: 12px; font-weight: 700; color: #0F5C55;
        background: #E3EFEA; border-radius: 999px; padding: 2px 9px;
      }
      .sol-evento-para { font-size: 13px; color: #5B3A8E; font-weight: 600; }
      .sol-evento-comentario {
        font-size: 14px; margin-top: 4px; white-space: pre-wrap; line-height: 1.5;
      }
      .sol-evento-data { font-size: 12px; color: #7A877F; margin-top: 3px; }

      .sol-texto-suave { font-size: 13px; color: #7A877F; }

      /* Avisos (toasts) */
      .sol-avisos {
        position: fixed; top: 12px; left: 12px; right: 12px; z-index: 100;
        display: flex; flex-direction: column; gap: 8px; pointer-events: none;
      }
      .sol-aviso {
        background: #22302B; color: #FFFFFF; border-radius: 12px;
        padding: 13px 16px; font-size: 14px; font-weight: 600;
        box-shadow: 0 6px 18px rgba(15, 25, 22, 0.25);
      }
      .sol-aviso-nova { background: #0F5C55; }
      .sol-aviso-sucesso { background: #1E6B3C; }
      .sol-aviso-erro { background: #A31212; }

      /* Tablet e desktop */
      @media (min-width: 640px) {
        .sol-pagina { padding: 28px 24px; }
        .sol-linha-campos { grid-template-columns: 1fr 1fr; }
        .sol-filtros { flex-direction: row; flex-wrap: wrap; align-items: center; }
        .sol-campo-busca { flex: 2; min-width: 220px; width: auto; }
        .sol-filtros > select.sol-campo { flex: 1; min-width: 160px; width: auto; }
        .sol-fundo-modal { align-items: center; padding: 24px; }
        .sol-modal { max-width: 720px; border-radius: 18px; padding: 24px; }
        .sol-modal-info { grid-template-columns: 1fr 1fr; }
      }

      /* Respeita quem prefere menos animação */
      @media (prefers-reduced-motion: no-preference) {
        .sol-aviso { animation: sol-entrar 0.25s ease-out; }
        @keyframes sol-entrar {
          from { transform: translateY(-8px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      }
    `}</style>
  );
}
