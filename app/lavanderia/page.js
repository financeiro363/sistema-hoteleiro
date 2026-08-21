'use client';

// ============================================================================
// LAVANDERIA
// - Catálogo de Preços (ADMIN): 3 valores por peça (Lavar / Passar / Lavar
//   e Passar). Editar preço NÃO afeta lotes antigos: o preço fica
//   "fotografado" dentro de cada item no momento da entrada.
// - Nova Entrada: hóspede + apartamento, itens com botões rápidos de
//   serviço, observação de avaria por item, Valor Total em tempo real,
//   código sequencial LAV-2026-0001 e comprovante em DUAS VIAS com
//   "✂ Corte aqui" para impressão.
// - Ciclo: Recebido → Em Processamento → Pronto para Entrega → Entregue.
// - Operação Rápida: busca por código/apartamento/hóspede e mostra sempre
//   o botão certo do próximo passo (o plano B do QR Code previsto no
//   documento: consulta manual pelo código).
// - Painel Geral com filtros; Log de Auditoria imutável (só ADMIN).
// ============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { bloquearSeNaoPermitido } from '../../lib/restricaoAcesso';

// ---- Constantes (mesmas do protótipo) ---------------------------------------

const SERVICO_LABEL = {
  LAVAR: 'Apenas Lavar',
  PASSAR: 'Apenas Passar',
  LAVAR_PASSAR: 'Lavar e Passar',
};

const STATUS_LABEL = {
  RECEBIDO: 'Recebido',
  EM_PROCESSAMENTO: 'Em Processamento',
  PRONTO: 'Pronto para Entrega',
  ENTREGUE: 'Entregue',
};
const STATUS_COR = {
  RECEBIDO: { fundo: '#DCEBFA', texto: '#1D4E89' },
  EM_PROCESSAMENTO: { fundo: '#FDF3D7', texto: '#8A6100' },
  PRONTO: { fundo: '#EBE2F7', texto: '#5B3A8E' },
  ENTREGUE: { fundo: '#DDF2E4', texto: '#1E6B3C' },
};

const MEIO_ENTREGA_LABEL = {
  DEIXADO_APARTAMENTO: 'Deixado no Apartamento',
  ENTREGUE_MAOS: 'Entregue em Mãos ao Hóspede',
};

// ---- Funções de apoio -------------------------------------------------------

function dinheiro(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(valor || 0));
}

function formatarDataHora(valor) {
  if (!valor) return '—';
  try {
    return new Date(valor).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch (e) { return String(valor); }
}

// ---- Componente principal ---------------------------------------------------

export default function Lavanderia() {
  const router = useRouter();

  const [verificandoLogin, setVerificandoLogin] = useState(true);
  const [usuario, setUsuario] = useState(null);
  const [nomesUsuarios, setNomesUsuarios] = useState({});
  const [nomeHotel, setNomeHotel] = useState('');

  const [subAba, setSubAba] = useState('painel'); // painel | entrada | rapida | catalogo | log
  const [catalogo, setCatalogo] = useState([]);
  const [lotes, setLotes] = useState([]);
  const [logs, setLogs] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);

  // Painel — filtros
  const [fApartamento, setFApartamento] = useState('');
  const [fStatus, setFStatus] = useState('TODOS');
  const [fDataDe, setFDataDe] = useState('');
  const [fDataAte, setFDataAte] = useState('');

  // Nova Entrada
  const [eHospede, setEHospede] = useState('');
  const [eApartamento, setEApartamento] = useState('');
  const [eReserva, setEReserva] = useState('');
  const [eItens, setEItens] = useState([]); // [{peca, servico, preco, avaria}]
  const [ePecaId, setEPecaId] = useState('');
  const [erroEntrada, setErroEntrada] = useState('');
  const [enviandoCloudbeds, setEnviandoCloudbeds] = useState(null); // id do lote sendo enviado

  // Configuração da Cloudbeds (admin)
  const [itemCloudbedsLavanderia, setItemCloudbedsLavanderia] = useState('');
  const [itensCloudbedsConfig, setItensCloudbedsConfig] = useState(null);
  const [buscandoCloudbedsConfig, setBuscandoCloudbedsConfig] = useState(false);
  const [salvandoConfigCloudbeds, setSalvandoConfigCloudbeds] = useState(false);
  const [erroConfigCloudbeds, setErroConfigCloudbeds] = useState('');

  // Comprovante aberto
  const [comprovante, setComprovante] = useState(null);

  // Operação Rápida
  const [buscaRapida, setBuscaRapida] = useState('');
  const [loteAtivo, setLoteAtivo] = useState(null);
  const [meioEscolhido, setMeioEscolhido] = useState('DEIXADO_APARTAMENTO');

  // Catálogo (admin)
  const [cNome, setCNome] = useState('');
  const [cLavar, setCLavar] = useState('');
  const [cPassar, setCPassar] = useState('');
  const [cLavarPassar, setCLavarPassar] = useState('');
  const [editandoPeca, setEditandoPeca] = useState(null); // {id, nome, lavar, passar, lavarPassar}
  const [excluindoPecaId, setExcluindoPecaId] = useState(null);
  const [erroCatalogo, setErroCatalogo] = useState('');

  // Detalhe de lote (painel)
  const [detalhe, setDetalhe] = useState(null);

  const souAdmin = usuario?.papel === 'ADMIN';

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
      if (bloquearSeNaoPermitido(dadosUsuario.papel, router)) return;
      setVerificandoLogin(false);

      const { data: h } = await supabase
        .from('hoteis').select('nome_fantasia, lavanderia_cloudbeds_item_id').eq('id', dadosUsuario.hotel_id).single();
      if (ativo && h?.nome_fantasia) setNomeHotel(h.nome_fantasia);
      if (ativo && h?.lavanderia_cloudbeds_item_id) setItemCloudbedsLavanderia(h.lavanderia_cloudbeds_item_id);
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

    const { data: pecas } = await supabase
      .from('lavanderia_catalogo').select('*').order('nome_peca', { ascending: true });
    setCatalogo(pecas || []);

    const { data: listaLotes, error: e1 } = await supabase
      .from('lavanderia_lotes').select('*').order('criado_em', { ascending: false });
    if (e1) setErro('Não foi possível carregar os lotes. Detalhe técnico: ' + e1.message);
    else setLotes(listaLotes || []);

    if (u.papel === 'ADMIN') {
      const { data: ls } = await supabase
        .from('lavanderia_log').select('*')
        .order('data_hora', { ascending: false }).limit(300);
      setLogs(ls || []);
    }
    setCarregando(false);
  }, []);

  useEffect(() => {
    if (usuario) carregarTudo(usuario);
  }, [usuario, carregarTudo]);

  // Recarrega só a lista do log (para o admin ver os passos na hora)
  const recarregarLogs = useCallback(async () => {
    if (usuario?.papel !== 'ADMIN') return;
    const { data: ls } = await supabase
      .from('lavanderia_log').select('*')
      .order('data_hora', { ascending: false }).limit(300);
    setLogs(ls || []);
  }, [usuario]);

  async function registrarLog(acao, detalhe) {
    const { error } = await supabase.from('lavanderia_log').insert({
      usuario_id: usuario.id, acao, detalhe, hotel_id: usuario.hotel_id,
    });
    if (error) {
      // Não engole o erro: avisa na tela para não passar despercebido
      setErro('O passo foi salvo, mas não consegui registrar no histórico. Detalhe técnico: ' + error.message);
      return;
    }
    // Atualiza a lista do log na hora (se estiver na aba de log)
    await recarregarLogs();
  }

  // ---- Nova Entrada ----
  function adicionarItem(servico) {
    setErroEntrada('');
    const peca = catalogo.find((p) => p.id === Number(ePecaId));
    if (!peca) { setErroEntrada('Escolha a peça primeiro.'); return; }
    const preco =
      servico === 'LAVAR' ? Number(peca.preco_lavar) :
      servico === 'PASSAR' ? Number(peca.preco_passar) :
      Number(peca.preco_lavar_passar);
    setEItens([...eItens, { peca: peca.nome_peca, servico, preco, avaria: '' }]);
  }

  function atualizarAvaria(indice, texto) {
    setEItens(eItens.map((it, i) => (i === indice ? { ...it, avaria: texto } : it)));
  }

  function removerItem(indice) {
    setEItens(eItens.filter((_, i) => i !== indice));
  }

  const totalEntrada = eItens.reduce((soma, it) => soma + Number(it.preco || 0), 0);

  function proximoCodigo(extra = 0) {
    const ano = new Date().getFullYear();
    const prefixo = `LAV-${ano}-`;
    let maior = 0;
    lotes.forEach((l) => {
      if (l.codigo && l.codigo.startsWith(prefixo)) {
        const n = Number(l.codigo.slice(prefixo.length));
        if (isFinite(n) && n > maior) maior = n;
      }
    });
    return `${prefixo}${String(maior + 1 + extra).padStart(4, '0')}`;
  }

  async function lancarNoCloudbeds(lote) {
    setEnviandoCloudbeds(lote.id);
    const { data: sessao } = await supabase.auth.getSession();
    try {
      const resposta = await fetch('/api/lavanderia-lancar-cloudbeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.session.access_token}` },
        body: JSON.stringify({ loteId: lote.id }),
      });
      const resultado = await resposta.json();
      setEnviandoCloudbeds(null);
      if (!resposta.ok || resultado.erro) {
        mostrarAviso(`⚠️ Lote ${lote.codigo} salvo, mas a Cloudbeds recusou: ${resultado.erro || 'erro desconhecido'}. Você pode tentar de novo no Painel Geral.`);
        setLotes((atuais) => atuais.map((l) => l.id === lote.id ? { ...l, cloudbeds_status: 'FALHOU', cloudbeds_erro: resultado.erro } : l));
        return false;
      }
      mostrarAviso(`✅ Lote ${lote.codigo} lançado na reserva ${lote.numero_reserva} com sucesso!`);
      setLotes((atuais) => atuais.map((l) => l.id === lote.id ? { ...l, cloudbeds_status: 'ENVIADO', cloudbeds_erro: null } : l));
      return true;
    } catch (e) {
      setEnviandoCloudbeds(null);
      mostrarAviso(`⚠️ Lote ${lote.codigo} salvo, mas houve falha de conexão ao enviar para a Cloudbeds. Tente de novo no Painel Geral.`);
      setLotes((atuais) => atuais.map((l) => l.id === lote.id ? { ...l, cloudbeds_status: 'FALHOU' } : l));
      return false;
    }
  }

  async function darEntrada() {
    if (salvando) return;
    setErroEntrada('');
    if (!eHospede.trim()) { setErroEntrada('Informe o nome do hóspede.'); return; }
    if (!eApartamento.trim()) { setErroEntrada('Informe o apartamento.'); return; }
    if (!eReserva.trim()) { setErroEntrada('Informe o número da reserva na Cloudbeds — é pra ela que a cobrança vai.'); return; }
    if (eItens.length === 0) { setErroEntrada('Adicione pelo menos uma peça.'); return; }

    setSalvando(true);
    let salvo = null;
    let erroFinal = null;
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const { data, error } = await supabase
        .from('lavanderia_lotes')
        .insert({
          codigo: proximoCodigo(tentativa),
          nome_hospede: eHospede.trim(),
          apartamento: eApartamento.trim(),
          numero_reserva: eReserva.trim(),
          cloudbeds_status: 'NAO_ENVIADO',
          itens: eItens,
          valor_total: totalEntrada,
          criado_por_id: usuario.id,
          hotel_id: usuario.hotel_id,
        })
        .select().single();
      if (!error) { salvo = data; break; }
      erroFinal = error.message;
      if (!/duplicate|unique/i.test(error.message)) break;
    }
    setSalvando(false);

    if (!salvo) { setErroEntrada('Não foi possível dar entrada. Detalhe técnico: ' + erroFinal); return; }

    await registrarLog('Entrada de Item',
      `Lote ${salvo.codigo}: ${eItens.length} peça(s) para ${salvo.nome_hospede} (apto ${salvo.apartamento}, reserva ${salvo.numero_reserva}). Total: ${dinheiro(salvo.valor_total)}.`);

    setEHospede(''); setEApartamento(''); setEReserva(''); setEItens([]); setEPecaId('');
    setLotes([salvo, ...lotes]);
    setComprovante(salvo);
    mostrarAviso(`Entrada registrada! Enviando cobrança para a reserva ${salvo.numero_reserva}…`);

    // Lança na Cloudbeds logo em seguida — se falhar, o lote fica marcado
    // como FALHOU e pode ser reenviado depois pelo Painel Geral.
    await lancarNoCloudbeds(salvo);
  }

  // ---- Ciclo de vida (Operação Rápida) ----
  async function iniciarLavagem(lote) {
    if (salvando) return;
    setSalvando(true);
    const agora = new Date().toISOString();
    const { error } = await supabase.from('lavanderia_lotes')
      .update({ status: 'EM_PROCESSAMENTO', iniciado_por_id: usuario.id, iniciado_em: agora })
      .eq('id', lote.id);
    setSalvando(false);
    if (error) { setErro('Não foi possível atualizar. Detalhe técnico: ' + error.message); return; }
    await registrarLog('Início da Lavagem',
      `Código ${lote.codigo} conferido na lavanderia. Status alterado para: Em Processamento.`);
    const atualizado = { ...lote, status: 'EM_PROCESSAMENTO', iniciado_por_id: usuario.id, iniciado_em: agora };
    setLotes(lotes.map((l) => (l.id === lote.id ? atualizado : l)));
    setLoteAtivo(atualizado);
    mostrarAviso('Lavagem iniciada!');
  }

  async function marcarPronto(lote) {
    if (salvando) return;
    setSalvando(true);
    const agora = new Date().toISOString();
    const { error } = await supabase.from('lavanderia_lotes')
      .update({ status: 'PRONTO', pronto_por_id: usuario.id, pronto_em: agora })
      .eq('id', lote.id);
    setSalvando(false);
    if (error) { setErro('Não foi possível atualizar. Detalhe técnico: ' + error.message); return; }
    await registrarLog('Fim da Lavagem',
      `Serviço concluído para o lote ${lote.codigo}. Status alterado para: Pronto para Entrega.`);
    const atualizado = { ...lote, status: 'PRONTO', pronto_por_id: usuario.id, pronto_em: agora };
    setLotes(lotes.map((l) => (l.id === lote.id ? atualizado : l)));
    setLoteAtivo(atualizado);
    mostrarAviso('Lote pronto para entrega!');
  }

  async function confirmarEntrega(lote) {
    if (salvando) return;
    setSalvando(true);
    const agora = new Date().toISOString();
    const { error } = await supabase.from('lavanderia_lotes')
      .update({ status: 'ENTREGUE', meio_entrega: meioEscolhido, entregue_por_id: usuario.id, entregue_em: agora })
      .eq('id', lote.id);
    setSalvando(false);
    if (error) { setErro('Não foi possível atualizar. Detalhe técnico: ' + error.message); return; }
    await registrarLog('Entrega Concluída',
      `Código ${lote.codigo} conferido no quarto. Método: ${MEIO_ENTREGA_LABEL[meioEscolhido]}. Status alterado para: Entregue.`);
    setLotes(lotes.map((l) => (l.id === lote.id
      ? { ...l, status: 'ENTREGUE', meio_entrega: meioEscolhido, entregue_por_id: usuario.id, entregue_em: agora }
      : l)));
    setLoteAtivo(null);
    setMeioEscolhido('DEIXADO_APARTAMENTO');
    mostrarAviso('Entrega concluída! 🎉');
  }

  // ---- Catálogo (admin) ----
  async function cadastrarPeca() {
    if (salvando) return;
    setErroCatalogo('');
    if (!cNome.trim()) { setErroCatalogo('Informe o nome da peça.'); return; }
    setSalvando(true);
    const { error } = await supabase.from('lavanderia_catalogo').insert({
      nome_peca: cNome.trim(),
      preco_lavar: Number(cLavar) || 0,
      preco_passar: Number(cPassar) || 0,
      preco_lavar_passar: Number(cLavarPassar) || 0,
      hotel_id: usuario.hotel_id,
    });
    setSalvando(false);
    if (error) { setErroCatalogo('Não foi possível cadastrar. Detalhe técnico: ' + error.message); return; }
    await registrarLog('Cadastro de Peça',
      `Item: ${cNome.trim()}. Lavar: ${dinheiro(cLavar)} · Passar: ${dinheiro(cPassar)} · Lavar e Passar: ${dinheiro(cLavarPassar)}.`);
    setCNome(''); setCLavar(''); setCPassar(''); setCLavarPassar('');
    mostrarAviso('Peça cadastrada no catálogo!');
    carregarTudo(usuario);
  }

  async function salvarEdicaoPeca() {
    if (!editandoPeca || salvando) return;
    setErroCatalogo('');
    const original = catalogo.find((p) => p.id === editandoPeca.id);
    if (!original) return;

    setSalvando(true);
    const { error } = await supabase.from('lavanderia_catalogo').update({
      nome_peca: editandoPeca.nome.trim() || original.nome_peca,
      preco_lavar: Number(editandoPeca.lavar) || 0,
      preco_passar: Number(editandoPeca.passar) || 0,
      preco_lavar_passar: Number(editandoPeca.lavarPassar) || 0,
    }).eq('id', editandoPeca.id);
    setSalvando(false);
    if (error) { setErroCatalogo('Não foi possível salvar. Detalhe técnico: ' + error.message); return; }

    // Log no formato específico: uma linha por serviço alterado
    const comparacoes = [
      ['Lavar', Number(original.preco_lavar), Number(editandoPeca.lavar) || 0],
      ['Passar', Number(original.preco_passar), Number(editandoPeca.passar) || 0],
      ['Lavar e Passar', Number(original.preco_lavar_passar), Number(editandoPeca.lavarPassar) || 0],
    ];
    for (const [servico, antes, depois] of comparacoes) {
      if (antes !== depois) {
        await registrarLog('Alteração de Preço',
          `Item: ${original.nome_peca}. Serviço: ${servico} alterado de ${dinheiro(antes)} para ${dinheiro(depois)}.`);
      }
    }
    setEditandoPeca(null);
    mostrarAviso('Peça atualizada! (lotes antigos mantêm o preço da época)');
    carregarTudo(usuario);
  }

  async function excluirPeca(peca) {
    setExcluindoPecaId(null);
    const { error } = await supabase.from('lavanderia_catalogo').delete().eq('id', peca.id);
    if (error) { setErro('Não foi possível excluir. Detalhe técnico: ' + error.message); return; }
    await registrarLog('Exclusão de Peça', `Item: ${peca.nome_peca} removido do catálogo.`);
    mostrarAviso('Peça excluída do catálogo (lotes antigos não mudam).');
    carregarTudo(usuario);
  }

  // ---- Configuração do item de Lavanderia na Cloudbeds (admin) ----
  async function buscarItensCloudbedsConfig() {
    setBuscandoCloudbedsConfig(true);
    setErroConfigCloudbeds('');
    const { data: sessao } = await supabase.auth.getSession();
    try {
      const resposta = await fetch('/api/pdv-listar-itens-cloudbeds', {
        headers: { Authorization: `Bearer ${sessao.session.access_token}` },
      });
      const resultado = await resposta.json();
      setBuscandoCloudbedsConfig(false);
      if (!resposta.ok || resultado.erro) { setErroConfigCloudbeds(resultado.erro || 'Não foi possível buscar os itens.'); return; }
      const lista = Array.isArray(resultado.itens) ? resultado.itens : Object.values(resultado.itens || {});
      setItensCloudbedsConfig(lista);
    } catch (e) {
      setBuscandoCloudbedsConfig(false);
      setErroConfigCloudbeds('Falha de conexão ao buscar os itens da Cloudbeds.');
    }
  }

  async function salvarConfigCloudbeds() {
    setSalvandoConfigCloudbeds(true);
    setErroConfigCloudbeds('');
    const { error } = await supabase.from('hoteis')
      .update({ lavanderia_cloudbeds_item_id: itemCloudbedsLavanderia.trim() || null }).eq('id', usuario.hotel_id);
    setSalvandoConfigCloudbeds(false);
    if (error) { setErroConfigCloudbeds('Não foi possível salvar. Detalhe técnico: ' + error.message); return; }
    mostrarAviso('Configuração da Cloudbeds salva!');
  }

  // ---- Filtros do painel ----
  const lotesFiltrados = lotes.filter((l) => {
    if (fStatus !== 'TODOS' && l.status !== fStatus) return false;
    if (fApartamento.trim() && !String(l.apartamento || '').toLowerCase().includes(fApartamento.trim().toLowerCase())) return false;
    const dia = String(l.criado_em).slice(0, 10);
    if (fDataDe && dia < fDataDe) return false;
    if (fDataAte && dia > fDataAte) return false;
    return true;
  });

  // ---- Operação Rápida: busca ----
  const termoRapido = buscaRapida.trim().toLowerCase();
  const lotesRapida = lotes
    .filter((l) => l.status !== 'ENTREGUE')
    .filter((l) =>
      !termoRapido ||
      (l.codigo || '').toLowerCase().includes(termoRapido) ||
      (l.apartamento || '').toLowerCase().includes(termoRapido) ||
      (l.nome_hospede || '').toLowerCase().includes(termoRapido)
    );

  if (verificandoLogin) {
    return (
      <main className="conteudo">
        <p className="texto-suave">Verificando seu acesso…</p>
      </main>
    );
  }

  const itensDoComprovante = comprovante && Array.isArray(comprovante.itens) ? comprovante.itens : [];

  return (
    <main className="conteudo">
      <EstilosLavanderia />

      <span className="olho">Serviços ao hóspede</span>
      <h1 style={{ marginBottom: 6 }}>Lavanderia</h1>

      {aviso && <div className="aviso-sucesso">{aviso}</div>}
      {erro && <div className="aviso-erro">{erro}</div>}

      {/* Sub-abas */}
      <nav className="lv-abas" aria-label="Seções">
        <button type="button" className={subAba === 'painel' ? 'lv-aba lv-aba-ativa' : 'lv-aba'}
          onClick={() => setSubAba('painel')}>
          Painel Geral
        </button>
        <button type="button" className={subAba === 'entrada' ? 'lv-aba lv-aba-ativa' : 'lv-aba'}
          onClick={() => setSubAba('entrada')}>
          + Nova Entrada
        </button>
        <button type="button" className={subAba === 'rapida' ? 'lv-aba lv-aba-ativa' : 'lv-aba'}
          onClick={() => { setSubAba('rapida'); setLoteAtivo(null); }}>
          Operação Rápida
        </button>
        {souAdmin && (
          <button type="button" className={subAba === 'catalogo' ? 'lv-aba lv-aba-ativa' : 'lv-aba'}
            onClick={() => setSubAba('catalogo')}>
            Catálogo de Preços
          </button>
        )}
        {souAdmin && (
          <button type="button" className={subAba === 'log' ? 'lv-aba lv-aba-ativa' : 'lv-aba'}
            onClick={() => setSubAba('log')}>
            Log de Auditoria
          </button>
        )}
      </nav>

      {/* ================= PAINEL GERAL ================= */}
      {subAba === 'painel' && (
        <section>
          <div className="lv-filtros">
            <input className="campo" type="text" value={fApartamento}
              onChange={(e) => setFApartamento(e.target.value)} placeholder="Apartamento…" />
            <select className="campo" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
              <option value="TODOS">Todos os status</option>
              {Object.entries(STATUS_LABEL).map(([chave, rotulo]) => (
                <option key={chave} value={chave}>{rotulo}</option>
              ))}
            </select>
            <div className="lv-filtro-datas">
              <input className="campo" type="date" value={fDataDe} onChange={(e) => setFDataDe(e.target.value)} />
              <span className="texto-suave">até</span>
              <input className="campo" type="date" value={fDataAte} onChange={(e) => setFDataAte(e.target.value)} />
            </div>
          </div>

          {carregando ? (
            <p className="texto-suave">Carregando…</p>
          ) : lotesFiltrados.length === 0 ? (
            <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
              Nenhum lote encontrado.
            </div>
          ) : (
            <div className="lv-lista">
              {lotesFiltrados.map((l) => (
                <div key={l.id} className="cartao lv-item">
                  <div className="lv-item-esq">
                    <div className="lv-item-topo">
                      <span className="lv-codigo">{l.codigo}</span>
                      <span className="lv-tag" style={{ background: STATUS_COR[l.status].fundo, color: STATUS_COR[l.status].texto }}>
                        {STATUS_LABEL[l.status]}
                      </span>
                    </div>
                    <div className="lv-item-nome">{l.nome_hospede} · Apto {l.apartamento}</div>
                    <div className="lv-item-meta">
                      {(Array.isArray(l.itens) ? l.itens.length : 0)} peça(s) · Entrada em {formatarDataHora(l.criado_em)} por {nomeDe(l.criado_por_id)}
                    </div>
                    {l.numero_reserva && (
                      <div className="lv-item-meta">
                        Reserva {l.numero_reserva} —{' '}
                        {l.cloudbeds_status === 'ENVIADO' && <span style={{ color: 'var(--sucesso-texto, #1E6B3C)', fontWeight: 700 }}>✓ Lançado na Cloudbeds</span>}
                        {l.cloudbeds_status === 'FALHOU' && <span style={{ color: 'var(--erro-texto, #A31212)', fontWeight: 700 }}>⚠️ Falhou{l.cloudbeds_erro ? `: ${l.cloudbeds_erro}` : ''}</span>}
                        {(!l.cloudbeds_status || l.cloudbeds_status === 'NAO_ENVIADO') && <span style={{ color: 'var(--texto-suave)' }}>⏳ Aguardando envio</span>}
                      </div>
                    )}
                    {l.status === 'ENTREGUE' && (
                      <div className="lv-item-entregue">
                        {MEIO_ENTREGA_LABEL[l.meio_entrega] || '—'} · por {nomeDe(l.entregue_por_id)} em {formatarDataHora(l.entregue_em)}
                      </div>
                    )}
                  </div>
                  <div className="lv-item-dir">
                    <div className="lv-valor">{dinheiro(l.valor_total)}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button type="button" className="botao botao-suave" onClick={() => setDetalhe(l)}>
                        Detalhes
                      </button>
                      <button type="button" className="botao botao-contorno" onClick={() => setComprovante(l)}>
                        Comprovante
                      </button>
                      {l.numero_reserva && l.cloudbeds_status !== 'ENVIADO' && (
                        <button type="button" className="botao botao-perigo" onClick={() => lancarNoCloudbeds(l)} disabled={enviandoCloudbeds === l.id}>
                          {enviandoCloudbeds === l.id ? 'Enviando…' : '🔄 Tentar lançar na Cloudbeds'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ================= NOVA ENTRADA ================= */}
      {subAba === 'entrada' && (
        <section className="cartao">
          <h2 style={{ fontSize: '1.15rem', marginBottom: 4 }}>Nova entrada de roupas</h2>

          {catalogo.length === 0 && (
            <div className="aviso-erro">
              O catálogo de preços está vazio — {souAdmin
                ? 'cadastre as peças na aba "Catálogo de Preços" antes de dar entrada.'
                : 'peça ao administrador para cadastrar as peças antes.'}
            </div>
          )}

          <div className="lv-tres">
            <div>
              <label className="rotulo">Hóspede *</label>
              <input className="campo" type="text" value={eHospede}
                onChange={(e) => setEHospede(e.target.value)} placeholder="Nome do hóspede" />
            </div>
            <div>
              <label className="rotulo">Apartamento *</label>
              <input className="campo" type="text" value={eApartamento}
                onChange={(e) => setEApartamento(e.target.value)} placeholder="Ex.: 204" />
            </div>
            <div>
              <label className="rotulo">Nº da Reserva (Cloudbeds) *</label>
              <input className="campo" type="text" value={eReserva}
                onChange={(e) => setEReserva(e.target.value)} placeholder="Ex.: 308213-1" />
            </div>
          </div>

          <label className="rotulo">Adicionar peça</label>
          <select className="campo" value={ePecaId} onChange={(e) => setEPecaId(e.target.value)}>
            <option value="">Escolha a peça…</option>
            {catalogo.map((p) => (
              <option key={p.id} value={p.id}>{p.nome_peca}</option>
            ))}
          </select>

          {ePecaId && (() => {
            const p = catalogo.find((x) => x.id === Number(ePecaId));
            if (!p) return null;
            return (
              <div className="lv-servicos">
                <button type="button" className="lv-servico-botao" onClick={() => adicionarItem('LAVAR')}>
                  {SERVICO_LABEL.LAVAR}<span>{dinheiro(p.preco_lavar)}</span>
                </button>
                <button type="button" className="lv-servico-botao" onClick={() => adicionarItem('PASSAR')}>
                  {SERVICO_LABEL.PASSAR}<span>{dinheiro(p.preco_passar)}</span>
                </button>
                <button type="button" className="lv-servico-botao" onClick={() => adicionarItem('LAVAR_PASSAR')}>
                  {SERVICO_LABEL.LAVAR_PASSAR}<span>{dinheiro(p.preco_lavar_passar)}</span>
                </button>
              </div>
            );
          })()}

          {eItens.length > 0 && (
            <div className="lv-itens-lista">
              {eItens.map((it, i) => (
                <div key={i} className="lv-item-entrada">
                  <div className="lv-item-entrada-topo">
                    <strong>{it.peca}</strong>
                    <span className="texto-suave" style={{ fontSize: 13 }}>{SERVICO_LABEL[it.servico]}</span>
                    <span style={{ fontWeight: 700 }}>{dinheiro(it.preco)}</span>
                    <button type="button" className="lv-remover" onClick={() => removerItem(i)} aria-label="Remover peça">✕</button>
                  </div>
                  <input className="campo" type="text" value={it.avaria}
                    onChange={(e) => atualizarAvaria(i, e.target.value)}
                    placeholder="Observação de avaria (ex.: mancha na manga) — opcional" />
                </div>
              ))}
            </div>
          )}

          <div className="lv-total">
            Valor Total: <strong>{dinheiro(totalEntrada)}</strong>
          </div>

          {(eHospede.trim() || eReserva.trim()) && (
            <div className="lv-confirmacao">
              Confira antes de enviar: <strong>{eHospede.trim() || '(nome não informado)'}</strong>
              {' — Reserva '}<strong>{eReserva.trim() || '(não informada)'}</strong>
              {' — '}<strong>{dinheiro(totalEntrada)}</strong>
            </div>
          )}

          {erroEntrada && <div className="aviso-erro">{erroEntrada}</div>}

          <button type="button" className="botao botao-principal" onClick={darEntrada}
            disabled={salvando || catalogo.length === 0} style={{ marginTop: 12 }}>
            {salvando ? 'Salvando…' : 'Finalizar Lançamento'}
          </button>
          <p className="texto-suave" style={{ fontSize: 12, marginTop: 8 }}>
            Ao finalizar: o lote é registrado, o comprovante interno abre para impressão, e a cobrança é enviada automaticamente para a reserva informada na Cloudbeds.
          </p>
        </section>
      )}

      {/* ================= OPERAÇÃO RÁPIDA ================= */}
      {subAba === 'rapida' && (
        <section style={{ maxWidth: 520, margin: '0 auto' }}>
          <p className="texto-suave" style={{ fontSize: 13 }}>
            Busque pelo código do comprovante (ex.: LAV-2026-0042), pelo apartamento ou pelo hóspede.
            O sistema mostra sempre o botão do próximo passo.
          </p>

          {!loteAtivo ? (
            <>
              <input className="campo" type="search" value={buscaRapida}
                onChange={(e) => setBuscaRapida(e.target.value)}
                placeholder="Código, apartamento ou hóspede…" style={{ marginBottom: 12 }} />
              {lotesRapida.length === 0 ? (
                <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
                  Nenhum lote ativo encontrado.
                </div>
              ) : (
                <div className="lv-lista">
                  {lotesRapida.map((l) => (
                    <button key={l.id} type="button" className="cartao lv-rapida-item"
                      onClick={() => { setLoteAtivo(l); setMeioEscolhido('DEIXADO_APARTAMENTO'); }}>
                      <div className="lv-item-topo">
                        <span className="lv-codigo">{l.codigo}</span>
                        <span className="lv-tag" style={{ background: STATUS_COR[l.status].fundo, color: STATUS_COR[l.status].texto }}>
                          {STATUS_LABEL[l.status]}
                        </span>
                      </div>
                      <div style={{ fontWeight: 600 }}>{l.nome_hospede} · Apto {l.apartamento}</div>
                      <div className="texto-suave" style={{ fontSize: 13 }}>{dinheiro(l.valor_total)}</div>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="cartao">
              <div className="lv-item-topo">
                <span className="lv-codigo" style={{ fontSize: 18 }}>{loteAtivo.codigo}</span>
                <span className="lv-tag" style={{ background: STATUS_COR[loteAtivo.status].fundo, color: STATUS_COR[loteAtivo.status].texto }}>
                  {STATUS_LABEL[loteAtivo.status]}
                </span>
              </div>
              <p style={{ fontWeight: 600, margin: '8px 0 2px' }}>{loteAtivo.nome_hospede} · Apto {loteAtivo.apartamento}</p>
              <p className="texto-suave" style={{ fontSize: 13, marginBottom: 14 }}>
                {(Array.isArray(loteAtivo.itens) ? loteAtivo.itens.length : 0)} peça(s) · {dinheiro(loteAtivo.valor_total)}
              </p>

              {loteAtivo.status === 'RECEBIDO' && (
                <button type="button" className="botao botao-principal" style={{ width: '100%' }}
                  onClick={() => iniciarLavagem(loteAtivo)} disabled={salvando}>
                  Confirmar Recebimento e Iniciar Lavagem
                </button>
              )}

              {loteAtivo.status === 'EM_PROCESSAMENTO' && (
                <button type="button" className="botao botao-principal" style={{ width: '100%' }}
                  onClick={() => marcarPronto(loteAtivo)} disabled={salvando}>
                  Marcar como Pronto
                </button>
              )}

              {loteAtivo.status === 'PRONTO' && (
                <>
                  <label className="rotulo">Meio de entrega:</label>
                  {Object.entries(MEIO_ENTREGA_LABEL).map(([chave, rotulo]) => (
                    <label key={chave} className="lv-radio">
                      <input type="radio" name="meio-entrega" checked={meioEscolhido === chave}
                        onChange={() => setMeioEscolhido(chave)} />
                      {rotulo}
                    </label>
                  ))}
                  <button type="button" className="botao botao-principal" style={{ width: '100%', marginTop: 10 }}
                    onClick={() => confirmarEntrega(loteAtivo)} disabled={salvando}>
                    Confirmar Entrega
                  </button>
                </>
              )}

              <button type="button" className="botao botao-suave" style={{ width: '100%', marginTop: 10 }}
                onClick={() => setLoteAtivo(null)}>
                ← Voltar
              </button>
            </div>
          )}
        </section>
      )}

      {/* ================= CATÁLOGO (admin) ================= */}
      {subAba === 'catalogo' && souAdmin && (
        <section>
          <div className="cartao" style={{ marginBottom: 14 }}>
            <h2 style={{ fontSize: '1.1rem', marginBottom: 4 }}>⚙️ Configuração da Cloudbeds</h2>
            <p className="texto-suave" style={{ fontSize: 12, marginTop: 0, marginBottom: 10 }}>
              Escolha qual item cadastrado na Cloudbeds (Configurações → Products → Items and Services) representa "Serviço de Lavanderia". Esse mesmo item é reaproveitado em toda cobrança — o valor e o detalhamento de cada lançamento vão junto, dinamicamente.
            </p>
            <label className="rotulo">ID do item na Cloudbeds</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="campo" type="text" value={itemCloudbedsLavanderia}
                onChange={(e) => setItemCloudbedsLavanderia(e.target.value)} placeholder="Ex.: 123456" style={{ flex: 1 }} />
              <button type="button" className="botao botao-suave" onClick={buscarItensCloudbedsConfig} disabled={buscandoCloudbedsConfig} style={{ whiteSpace: 'nowrap' }}>
                {buscandoCloudbedsConfig ? 'Buscando…' : '🔄 Buscar da Cloudbeds'}
              </button>
            </div>
            {erroConfigCloudbeds && <div className="aviso-erro" style={{ marginTop: 8 }}>{erroConfigCloudbeds}</div>}
            {itensCloudbedsConfig && (
              <div className="lv-lista-cloudbeds">
                {itensCloudbedsConfig.length === 0 ? (
                  <p className="texto-suave" style={{ fontSize: 13 }}>Nenhum item encontrado — cadastre primeiro na Cloudbeds.</p>
                ) : (
                  itensCloudbedsConfig.map((it, indice) => {
                    const id = it.itemId || it.appItemID || it.id || it.itemID || '';
                    const nomeItem = it.itemName || it.name || it.title || `Item ${id}`;
                    return (
                      <button key={id || indice} type="button" className="lv-item-cloudbeds-opcao"
                        onClick={() => setItemCloudbedsLavanderia(String(id))}>
                        <span>{nomeItem}</span>
                        <span className="texto-suave" style={{ fontSize: 11 }}>ID: {id}</span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
            <button type="button" className="botao botao-principal" onClick={salvarConfigCloudbeds}
              disabled={salvandoConfigCloudbeds} style={{ marginTop: 12 }}>
              {salvandoConfigCloudbeds ? 'Salvando…' : 'Salvar configuração'}
            </button>
          </div>

          <div className="cartao" style={{ marginBottom: 14 }}>
            <h2 style={{ fontSize: '1.1rem', marginBottom: 4 }}>Nova peça</h2>
            <label className="rotulo">Nome da peça *</label>
            <input className="campo" type="text" value={cNome}
              onChange={(e) => setCNome(e.target.value)} placeholder="Ex.: Camisa" />
            <div className="lv-tres">
              <div>
                <label className="rotulo">Lavar (R$)</label>
                <input className="campo" type="number" min="0" step="0.01" value={cLavar}
                  onChange={(e) => setCLavar(e.target.value)} placeholder="0,00" />
              </div>
              <div>
                <label className="rotulo">Passar (R$)</label>
                <input className="campo" type="number" min="0" step="0.01" value={cPassar}
                  onChange={(e) => setCPassar(e.target.value)} placeholder="0,00" />
              </div>
              <div>
                <label className="rotulo">Lavar e Passar (R$)</label>
                <input className="campo" type="number" min="0" step="0.01" value={cLavarPassar}
                  onChange={(e) => setCLavarPassar(e.target.value)} placeholder="0,00" />
              </div>
            </div>
            {erroCatalogo && <div className="aviso-erro">{erroCatalogo}</div>}
            <button type="button" className="botao botao-principal" onClick={cadastrarPeca}
              disabled={salvando} style={{ marginTop: 12 }}>
              Cadastrar peça
            </button>
            <p className="texto-suave" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
              Editar um preço depois não muda lotes já lançados — o preço fica "fotografado" na entrada.
            </p>
          </div>

          <div className="lv-lista">
            {catalogo.map((p) => (
              <div key={p.id} className="cartao lv-peca">
                {editandoPeca?.id === p.id ? (
                  <div style={{ width: '100%' }}>
                    <input className="campo" type="text" value={editandoPeca.nome}
                      onChange={(e) => setEditandoPeca({ ...editandoPeca, nome: e.target.value })} />
                    <div className="lv-tres">
                      <input className="campo" type="number" min="0" step="0.01" value={editandoPeca.lavar}
                        onChange={(e) => setEditandoPeca({ ...editandoPeca, lavar: e.target.value })} placeholder="Lavar" />
                      <input className="campo" type="number" min="0" step="0.01" value={editandoPeca.passar}
                        onChange={(e) => setEditandoPeca({ ...editandoPeca, passar: e.target.value })} placeholder="Passar" />
                      <input className="campo" type="number" min="0" step="0.01" value={editandoPeca.lavarPassar}
                        onChange={(e) => setEditandoPeca({ ...editandoPeca, lavarPassar: e.target.value })} placeholder="Lavar e Passar" />
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <button type="button" className="botao botao-principal" onClick={salvarEdicaoPeca} disabled={salvando}>
                        Salvar
                      </button>
                      <button type="button" className="botao botao-suave" onClick={() => setEditandoPeca(null)}>
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <strong style={{ flex: 1 }}>{p.nome_peca}</strong>
                    <span className="lv-preco">Lavar: {dinheiro(p.preco_lavar)}</span>
                    <span className="lv-preco">Passar: {dinheiro(p.preco_passar)}</span>
                    <span className="lv-preco">Lavar e Passar: {dinheiro(p.preco_lavar_passar)}</span>
                    <button type="button" className="botao botao-suave"
                      onClick={() => setEditandoPeca({ id: p.id, nome: p.nome_peca, lavar: p.preco_lavar, passar: p.preco_passar, lavarPassar: p.preco_lavar_passar })}>
                      Editar
                    </button>
                    {excluindoPecaId === p.id ? (
                      <span className="lv-confirmar">
                        Excluir?
                        <button type="button" className="botao botao-perigo" onClick={() => excluirPeca(p)}>Sim</button>
                        <button type="button" className="botao botao-suave" onClick={() => setExcluindoPecaId(null)}>Não</button>
                      </span>
                    ) : (
                      <button type="button" className="botao botao-suave" onClick={() => setExcluindoPecaId(p.id)}>
                        Excluir
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
            {catalogo.length === 0 && (
              <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
                Nenhuma peça cadastrada ainda.
              </div>
            )}
          </div>
        </section>
      )}

      {/* ================= LOG (admin) ================= */}
      {subAba === 'log' && souAdmin && (
        <section className="lv-lista">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <p className="texto-suave" style={{ fontSize: 13, margin: 0 }}>
              Histórico completo de cada peça: entrada, início da lavagem, conclusão e entrega — com o usuário e a data de cada passo.
            </p>
            <button type="button" className="botao botao-suave" onClick={recarregarLogs}>
              ↻ Atualizar
            </button>
          </div>
          {logs.length === 0 ? (
            <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
              Nenhum registro no log ainda.
            </div>
          ) : (
            logs.map((l) => (
              <div key={l.id} className="cartao" style={{ padding: '12px 16px' }}>
                <div>
                  <strong>{nomeDe(l.usuario_id)}</strong>{' '}
                  <span className="lv-log-acao">{l.acao}</span>
                </div>
                {l.detalhe && <div style={{ fontSize: 14, marginTop: 3 }}>{l.detalhe}</div>}
                <div className="texto-suave" style={{ fontSize: 12 }}>{formatarDataHora(l.data_hora)}</div>
              </div>
            ))
          )}
        </section>
      )}

      {/* ================= DETALHES DO LOTE ================= */}
      {detalhe && (
        <div className="lv-overlay" role="dialog" aria-modal="true">
          <div className="lv-modal">
            <div className="lv-modal-topo">
              <h2 style={{ fontSize: '1.15rem', margin: 0 }}>{detalhe.codigo}</h2>
              <button type="button" className="lv-fechar" onClick={() => setDetalhe(null)} aria-label="Fechar">✕</button>
            </div>
            <p style={{ fontWeight: 600, margin: '4px 0' }}>{detalhe.nome_hospede} · Apto {detalhe.apartamento}</p>
            <span className="lv-tag" style={{ background: STATUS_COR[detalhe.status].fundo, color: STATUS_COR[detalhe.status].texto }}>
              {STATUS_LABEL[detalhe.status]}
            </span>

            <table className="lv-tabela">
              <thead>
                <tr><th>Peça</th><th>Serviço</th><th>Avaria</th><th style={{ textAlign: 'right' }}>Preço</th></tr>
              </thead>
              <tbody>
                {(Array.isArray(detalhe.itens) ? detalhe.itens : []).map((it, i) => (
                  <tr key={i}>
                    <td>{it.peca}</td>
                    <td>{SERVICO_LABEL[it.servico]}</td>
                    <td>{it.avaria || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{dinheiro(it.preco)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="lv-total" style={{ marginTop: 8 }}>Total: <strong>{dinheiro(detalhe.valor_total)}</strong></div>

            <div className="lv-trilha">
              <div>Entrada: {formatarDataHora(detalhe.criado_em)} · {nomeDe(detalhe.criado_por_id)}</div>
              {detalhe.iniciado_em && <div>Início da lavagem: {formatarDataHora(detalhe.iniciado_em)} · {nomeDe(detalhe.iniciado_por_id)}</div>}
              {detalhe.pronto_em && <div>Pronto: {formatarDataHora(detalhe.pronto_em)} · {nomeDe(detalhe.pronto_por_id)}</div>}
              {detalhe.entregue_em && <div>Entregue ({MEIO_ENTREGA_LABEL[detalhe.meio_entrega] || '—'}): {formatarDataHora(detalhe.entregue_em)} · {nomeDe(detalhe.entregue_por_id)}</div>}
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
              <button type="button" className="botao botao-contorno" onClick={() => { setComprovante(detalhe); setDetalhe(null); }}>
                Ver Comprovante
              </button>
              <button type="button" className="botao botao-suave" onClick={() => setDetalhe(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* ================= COMPROVANTE (2 vias) ================= */}
      {comprovante && (
        <div className="lv-overlay" role="dialog" aria-modal="true">
          <div className="lv-modal" style={{ maxWidth: 640 }}>
            <div className="lv-modal-topo lv-nao-imprimir">
              <h2 style={{ fontSize: '1.15rem', margin: 0 }}>Comprovante — {comprovante.codigo}</h2>
              <button type="button" className="lv-fechar" onClick={() => setComprovante(null)} aria-label="Fechar">✕</button>
            </div>

            <div className="comprovante-lavanderia">
              {[1, 2].map((via) => (
                <div key={via}>
                  {via === 2 && <div className="lv-corte">✂ &nbsp;Corte aqui — — — — — — — — — — — — — — — — — — —</div>}
                  <div className="lv-via">
                    <div className="lv-via-cabecalho">
                      <div>
                        <div style={{ fontWeight: 700 }}>{nomeHotel || 'Hotel'} — Lavanderia</div>
                        <div style={{ fontSize: 11, color: '#555' }}>
                          {via === 1 ? '1ª via: Hóspede' : '2ª via: Lavanderia'}
                        </div>
                      </div>
                      <div className="lv-via-codigo">{comprovante.codigo}</div>
                    </div>
                    <div style={{ fontSize: 12, margin: '6px 0' }}>
                      Hóspede: <strong>{comprovante.nome_hospede}</strong> · Apto: <strong>{comprovante.apartamento}</strong> · Entrada: {formatarDataHora(comprovante.criado_em)}
                    </div>
                    <table className="lv-tabela lv-tabela-via">
                      <thead>
                        <tr><th>Peça</th><th>Serviço</th><th>Avaria</th><th style={{ textAlign: 'right' }}>Preço</th></tr>
                      </thead>
                      <tbody>
                        {itensDoComprovante.map((it, i) => (
                          <tr key={i}>
                            <td>{it.peca}</td>
                            <td>{SERVICO_LABEL[it.servico]}</td>
                            <td>{it.avaria || '—'}</td>
                            <td style={{ textAlign: 'right' }}>{dinheiro(it.preco)}</td>
                          </tr>
                        ))}
                        <tr>
                          <td colSpan={3} style={{ fontWeight: 700 }}>Valor Total</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{dinheiro(comprovante.valor_total)}</td>
                        </tr>
                      </tbody>
                    </table>
                    <div className="lv-via-assinatura">Assinatura do hóspede: ____________________________</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="lv-modal-botoes lv-nao-imprimir" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
              <button type="button" className="botao botao-principal" onClick={() => window.print()}>
                🖨️ Imprimir (2 vias)
              </button>
              <button type="button" className="botao botao-suave" onClick={() => setComprovante(null)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// ---- Estilos específicos deste módulo ---------------------------------------

function EstilosLavanderia() {
  return (
    <style>{`
      .lv-abas { display: flex; gap: 6px; overflow-x: auto; margin: 14px 0 16px; padding-bottom: 4px; }
      .lv-aba {
        border: 1px solid var(--borda); background: var(--branco); color: var(--tinta);
        border-radius: 999px; padding: 10px 16px; font-size: 14px; font-weight: 600;
        cursor: pointer; white-space: nowrap; min-height: 42px;
      }
      .lv-aba-ativa { background: var(--marca); border-color: var(--marca); color: var(--branco); }

      .lv-filtros { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
      .lv-filtro-datas { display: flex; align-items: center; gap: 8px; }
      .lv-filtro-datas .campo { width: auto; flex: 1; }

      .lv-lista { display: flex; flex-direction: column; gap: 12px; }
      .lv-item { display: flex; flex-direction: column; gap: 10px; padding: 16px; }
      .lv-item-topo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .lv-codigo { font-family: var(--fonte-titulo); font-weight: 700; font-size: 14px; color: var(--texto-suave); }
      .lv-tag { display: inline-block; font-size: 12px; font-weight: 700; border-radius: 999px; padding: 3px 10px; }
      .lv-item-nome { font-weight: 700; font-size: 16px; margin-top: 4px; }
      .lv-item-meta { font-size: 13px; color: var(--texto-suave); }
      .lv-item-entregue {
        font-size: 13px; color: var(--sucesso-texto); background: var(--sucesso-fundo);
        border-radius: 10px; padding: 6px 10px; margin-top: 6px; display: inline-block;
      }
      .lv-valor { font-family: var(--fonte-titulo); font-weight: 700; font-size: 20px; color: var(--marca); }

      .lv-duas { display: grid; grid-template-columns: 1fr; gap: 0 14px; }
      .lv-tres { display: grid; grid-template-columns: 1fr; gap: 0 14px; }

      .lv-servicos { display: grid; grid-template-columns: 1fr; gap: 8px; margin-top: 10px; }
      .lv-servico-botao {
        display: flex; justify-content: space-between; align-items: center; gap: 8px;
        border: 2px solid var(--borda); background: var(--branco); border-radius: 12px;
        padding: 12px 14px; font-size: 14px; font-weight: 600; cursor: pointer;
        font-family: inherit; color: var(--tinta); min-height: 48px;
      }
      .lv-servico-botao span { color: var(--marca); font-weight: 700; }
      .lv-servico-botao:hover { border-color: var(--marca); background: var(--marca-clara); }

      .lv-itens-lista { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; }
      .lv-item-entrada { border: 1px solid var(--borda); border-radius: 12px; padding: 10px 12px; background: var(--fundo); }
      .lv-item-entrada-topo { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
      .lv-remover {
        margin-left: auto; border: none; background: var(--erro-fundo); color: var(--erro-texto);
        border-radius: 999px; width: 30px; height: 30px; cursor: pointer; font-size: 13px;
      }
      .lv-total {
        font-size: 17px; margin-top: 14px; background: var(--marca-clara);
        color: var(--marca); border-radius: 10px; padding: 10px 14px;
      }
      .lv-confirmacao {
        font-size: 13px; margin-top: 10px; background: #FDF3D7; color: #8A6100;
        border-radius: 10px; padding: 10px 14px; border: 1px solid #f0dfa0;
      }
      .lv-lista-cloudbeds {
        display: flex; flex-direction: column; gap: 6px; max-height: 220px;
        overflow-y: auto; margin-top: 10px;
      }
      .lv-item-cloudbeds-opcao {
        display: flex; justify-content: space-between; align-items: center;
        border: 1px solid var(--borda); border-radius: 8px; padding: 8px 12px;
        background: var(--branco); cursor: pointer; font-family: inherit; font-size: 13px; text-align: left;
      }
      .lv-item-cloudbeds-opcao:hover { border-color: var(--marca); }

      .lv-rapida-item { text-align: left; cursor: pointer; font-family: inherit; color: inherit; width: 100%; border: 1px solid var(--borda); }
      .lv-rapida-item:hover { border-color: var(--marca); }
      .lv-radio { display: flex; align-items: center; gap: 10px; padding: 8px 4px; font-size: 15px; cursor: pointer; }
      .lv-radio input { width: 18px; height: 18px; }

      .lv-peca { display: flex; align-items: center; gap: 12px; padding: 14px 16px; flex-wrap: wrap; }
      .lv-preco { font-size: 13px; color: var(--texto-suave); }
      .lv-confirmar { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; color: var(--erro-texto); flex-wrap: wrap; }

      .lv-log-acao {
        font-size: 12px; font-weight: 700; color: var(--marca);
        background: var(--marca-clara); border-radius: 999px; padding: 2px 9px; margin-left: 6px;
      }

      .lv-overlay {
        position: fixed; inset: 0; background: rgba(15, 25, 22, 0.45);
        display: flex; align-items: flex-end; justify-content: center; z-index: 70;
      }
      .lv-modal {
        background: var(--branco); width: 100%; max-height: 92vh; overflow-y: auto;
        border-radius: 18px 18px 0 0; padding: 18px;
      }
      .lv-modal-topo { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
      .lv-fechar {
        border: none; background: #E9ECE8; border-radius: 999px;
        width: 40px; height: 40px; font-size: 16px; cursor: pointer; flex-shrink: 0;
      }

      .lv-tabela { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
      .lv-tabela th { text-align: left; border-bottom: 2px solid var(--borda); padding: 6px 4px; font-size: 12px; }
      .lv-tabela td { border-bottom: 1px solid var(--borda); padding: 6px 4px; }

      .lv-trilha {
        font-size: 13px; color: var(--texto-suave); background: var(--fundo);
        border-radius: 10px; padding: 10px 12px; margin-top: 12px;
        display: flex; flex-direction: column; gap: 3px;
      }

      /* Comprovante em duas vias */
      .comprovante-lavanderia { background: #FFFFFF; color: #1a1a1a; }
      .lv-via { border: 1px solid var(--borda); border-radius: 10px; padding: 14px; }
      .lv-via-cabecalho { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
      .lv-via-codigo {
        border: 2px solid #333; border-radius: 8px; padding: 6px 12px;
        font-family: var(--fonte-titulo); font-weight: 700; font-size: 16px;
      }
      .lv-tabela-via th, .lv-tabela-via td { font-size: 12px; }
      .lv-via-assinatura { font-size: 12px; margin-top: 22px; }
      .lv-corte {
        text-align: center; color: #888; font-size: 12px; margin: 14px 0;
        border-top: 1px dashed #aaa; padding-top: 4px;
      }

      @media (min-width: 640px) {
        .lv-filtros { flex-direction: row; align-items: center; }
        .lv-filtros .campo { width: auto; }
        .lv-filtros input.campo { flex: 1; min-width: 140px; }
        .lv-filtros select.campo { flex: 1; min-width: 170px; }
        .lv-duas { grid-template-columns: 1fr 1fr; }
        .lv-tres { grid-template-columns: 1fr 1fr 1fr; }
        .lv-servicos { grid-template-columns: 1fr 1fr 1fr; }
        .lv-item { flex-direction: row; justify-content: space-between; }
        .lv-item-dir { text-align: right; display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }
        .lv-overlay { align-items: center; padding: 24px; }
        .lv-modal { max-width: 600px; border-radius: 18px; padding: 24px; }
      }

      /* Impressão: só as 2 vias saem no papel */
      @media print {
        body * { visibility: hidden; }
        .comprovante-lavanderia, .comprovante-lavanderia * { visibility: visible; }
        .comprovante-lavanderia { position: fixed; top: 0; left: 0; width: 100%; padding: 16px; }
        .lv-nao-imprimir { display: none !important; }
      }
    `}</style>
  );
}
