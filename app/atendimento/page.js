'use client';

// ============================================================================
// CAIXA DE ENTRADA (Atendimento → Caixa de Entrada) — Fase 1, Parte A
// ============================================================================
// WhatsApp e e-mails do hotel num lugar só:
//   - lista de conversas (abertas, minhas, sem responsável, resolvidas)
//   - conversa com envio de texto, anexos, modelos do WhatsApp e notas internas
//   - reserva da Cloudbeds ao lado
//   - abas "Respostas prontas" e "Canais" (só ADMIN)
// Acesso: ADMIN, ou COLABORADOR com a permissão "Pode usar a Caixa de Entrada"
// (Administração → Usuários).
// Atualiza ao vivo (Supabase Realtime) e, por garantia, a cada 20 segundos.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { bloquearSeNaoPermitido } from '../../lib/restricaoAcesso';
import {
  chamarApi, avisarCabecalho, ESTILOS_ATENDIMENTO, STATUS_CONVERSA, ICONE_CANAL, horaCurta, iniciais, primeiroNome,
} from '../components/atendimento/util';
import { Conversa, PainelReserva, NovaConversa } from '../components/atendimento/Conversa';
import { ConfigCanais, RespostasProntas } from '../components/atendimento/Configuracoes';

const FILTROS = [
  ['abertas', 'Abertas'],
  ['minhas', 'Minhas'],
  ['sem', 'Sem responsável'],
  ['nao_lidas', 'Não lidas'],
  ['resolvidas', 'Resolvidas'],
  ['todas', 'Todas'],
];

const limparBusca = (t) => String(t || '').replace(/[,()%*\\]/g, ' ').trim();

export default function CaixaDeEntrada() {
  const router = useRouter();
  const [usuario, setUsuario] = useState(null);
  const [verificando, setVerificando] = useState(true);
  const [semPermissao, setSemPermissao] = useState(false);
  const [aba, setAba] = useState('conversas');

  const [canais, setCanais] = useState([]);
  const [atendentes, setAtendentes] = useState([]);
  const [respostas, setRespostas] = useState([]);
  const [conversas, setConversas] = useState([]);
  const [carregandoLista, setCarregandoLista] = useState(true);
  const [erroLista, setErroLista] = useState('');
  const [filtro, setFiltro] = useState('abertas');
  const [canalFiltro, setCanalFiltro] = useState('');
  const [busca, setBusca] = useState('');

  const [selecionadaId, setSelecionadaId] = useState(null);
  const [mensagens, setMensagens] = useState([]);
  const [carregandoMensagens, setCarregandoMensagens] = useState(false);
  const [lateralAberta, setLateralAberta] = useState(false);
  const [novaConversa, setNovaConversa] = useState(false);

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
      if (p.get('aba') && ['conversas', 'respostas', 'canais'].includes(p.get('aba'))) setAba(p.get('aba'));
      if (p.get('conversa')) setSelecionadaId(Number(p.get('conversa')));
      setVerificando(false);
    })();
    return () => { ativo = false; };
  }, [router]);

  const souAdmin = usuario?.papel === 'ADMIN';

  // ---- Dados de apoio ----------------------------------------------------------
  const carregarApoio = useCallback(async (u) => {
    const [c, a, r] = await Promise.all([
      supabase.from('atendimento_canais').select('id, hotel_id, tipo, nome, endereco_exibicao, ativo, status, erro, ultima_sincronizacao, config, identificador').eq('hotel_id', u.hotel_id).order('nome'),
      supabase.from('usuarios').select('*').eq('hotel_id', u.hotel_id).order('nome'),
      supabase.from('atendimento_respostas_prontas').select('*').eq('hotel_id', u.hotel_id).order('atalho'),
    ]);
    if (c.error) setErroLista(/atendimento_|does not exist|schema cache/i.test(c.error.message)
      ? 'A Caixa de Entrada ainda não foi ativada no banco de dados (falta rodar o SQL da Caixa de Entrada no Supabase).'
      : 'Não foi possível carregar os canais: ' + c.error.message);
    setCanais(c.data || []);
    setAtendentes((a.data || []).filter((p) => p.ativo !== false && (p.papel === 'ADMIN' || (p.papel === 'COLABORADOR' && p.pode_acessar_atendimento))).map((p) => ({ id: p.id, nome: p.nome })));
    setRespostas(r.data || []);
  }, []);

  // ---- Lista de conversas -------------------------------------------------------
  const carregarLista = useCallback(async () => {
    if (!usuario) return;
    let q = supabase.from('atendimento_conversas').select('*').eq('hotel_id', usuario.hotel_id);
    if (filtro === 'abertas') q = q.neq('status', 'RESOLVIDA');
    if (filtro === 'minhas') q = q.eq('responsavel_id', usuario.id).neq('status', 'RESOLVIDA');
    if (filtro === 'sem') q = q.is('responsavel_id', null).neq('status', 'RESOLVIDA');
    if (filtro === 'nao_lidas') q = q.gt('nao_lidas', 0);
    if (filtro === 'resolvidas') q = q.eq('status', 'RESOLVIDA');
    if (canalFiltro) q = q.eq('canal_id', canalFiltro);
    const termo = limparBusca(busca);
    if (termo) {
      const t = `%${termo}%`;
      q = q.or(`contato_nome.ilike.${t},contato_endereco.ilike.${t},assunto.ilike.${t},chave_externa.ilike.${t},ultima_mensagem_resumo.ilike.${t}`);
    }
    const { data, error } = await q.order('ultima_mensagem_em', { ascending: false, nullsFirst: false }).order('id', { ascending: false }).limit(300);
    if (error) {
      setErroLista(/atendimento_|does not exist|schema cache/i.test(error.message)
        ? 'A Caixa de Entrada ainda não foi ativada no banco de dados (falta rodar o SQL da Caixa de Entrada no Supabase).'
        : 'Não foi possível carregar as conversas: ' + error.message);
    } else {
      setErroLista('');
      setConversas(data || []);
    }
    setCarregandoLista(false);
  }, [usuario, filtro, canalFiltro, busca]);

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

  useEffect(() => { if (usuario && !semPermissao) carregarApoio(usuario); }, [usuario, semPermissao, carregarApoio]);
  useEffect(() => { if (usuario && !semPermissao) carregarLista(); }, [usuario, semPermissao, carregarLista]);
  useEffect(() => {
    setMensagens([]);
    if (selecionadaId) { setCarregandoMensagens(true); carregarMensagens(selecionadaId); }
  }, [selecionadaId, carregarMensagens]);
  useEffect(() => {
    if (selecionada?.nao_lidas && document.visibilityState === 'visible') marcarLida(selecionada);
  }, [selecionada, marcarLida]);

  // ---- Ao vivo + garantia a cada 20 s ----------------------------------------
  const recarregarTudo = useCallback(() => {
    carregarLista();
    if (selecionadaRef.current) carregarMensagens(selecionadaRef.current);
  }, [carregarLista, carregarMensagens]);

  const agendado = useRef(null);
  const agendarRecarga = useCallback(() => {
    clearTimeout(agendado.current);
    agendado.current = setTimeout(recarregarTudo, 400);
  }, [recarregarTudo]);

  useEffect(() => {
    if (!usuario || semPermissao) return undefined;
    const canalRt = supabase.channel(`atendimento-${usuario.hotel_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'atendimento_conversas', filter: `hotel_id=eq.${usuario.hotel_id}` }, agendarRecarga)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'atendimento_mensagens', filter: `hotel_id=eq.${usuario.hotel_id}` }, agendarRecarga)
      .subscribe();
    const intervalo = setInterval(recarregarTudo, 20000);
    return () => { supabase.removeChannel(canalRt); clearInterval(intervalo); clearTimeout(agendado.current); };
  }, [usuario, semPermissao, agendarRecarga, recarregarTudo]);

  // E-mails: pede sincronização ao abrir e a cada minuto (o servidor limita)
  const temEmail = canais.some((c) => c.tipo === 'EMAIL' && c.ativo);
  useEffect(() => {
    if (!temEmail) return undefined;
    const sincronizar = () => chamarApi('/api/atendimento', { acao: 'sincronizar' }).then((r) => { if (r.novas) recarregarTudo(); }).catch(() => {});
    sincronizar();
    const id = setInterval(sincronizar, 60000);
    return () => clearInterval(id);
  }, [temEmail, recarregarTudo]);

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
  const nomesAtendentes = Object.fromEntries(atendentes.map((a) => [a.id, a.nome]));
  const totalNaoLidas = conversas.reduce((s, c) => s + (c.status !== 'RESOLVIDA' ? c.nao_lidas : 0), 0);
  const canalSelecionado = selecionada ? mapaCanais[selecionada.canal_id] : null;

  function abrirConversa(id) {
    setSelecionadaId(id);
    window.history.replaceState(null, '', `/atendimento?conversa=${id}`);
  }

  return (
    <main className={`conteudo at-conteudo ${aba === 'conversas' && selecionada ? 'at-com-conversa' : ''}`}>
      <style>{ESTILOS_ATENDIMENTO}</style>
      <div className="at-cabecalho-pagina">
      <span className="olho">Atendimento</span>
      <div className="barra-pagina">
        <h1 style={{ margin: 0 }}>Caixa de Entrada</h1>
        {aba === 'conversas' && <button type="button" className="botao botao-principal" onClick={() => setNovaConversa(true)}>+ Nova conversa</button>}
      </div>

      <div className="at-abas">
        <button type="button" className={`at-aba ${aba === 'conversas' ? 'ativa' : ''}`} onClick={() => setAba('conversas')}>
          💬 Conversas{totalNaoLidas > 0 && <span className="at-aba-badge">{totalNaoLidas > 99 ? '99+' : totalNaoLidas}</span>}
        </button>
        <button type="button" className={`at-aba ${aba === 'respostas' ? 'ativa' : ''}`} onClick={() => setAba('respostas')}>⚡ Respostas prontas</button>
        {souAdmin && <button type="button" className={`at-aba ${aba === 'canais' ? 'ativa' : ''}`} onClick={() => setAba('canais')}>⚙️ Canais</button>}
      </div>
      </div>

      {erroLista && <div className="aviso-erro">{erroLista}</div>}
      {aba === 'conversas' && !erroLista && canais.length === 0 && (
        <div className="aviso-erro" style={{ background: '#FFF4D6', color: '#7A5600' }}>
          Nenhum canal ligado ainda. {souAdmin ? 'Conecte o WhatsApp e as caixas de e-mail na aba “Canais”.' : 'Peça ao administrador para conectar o WhatsApp e os e-mails.'}
        </div>
      )}

      {aba === 'respostas' && <RespostasProntas usuario={usuario} respostas={respostas} onMudou={() => carregarApoio(usuario)} />}
      {aba === 'canais' && souAdmin && <ConfigCanais />}

      {aba === 'conversas' && (
        <div className={`at-painel ${selecionada && lateralAberta ? 'com-lateral' : ''}`}>
          {/* ---------------- Lista ---------------- */}
          <div className={`at-col at-col-lista ${selecionada ? 'at-celular-escondido' : ''}`}>
            <div className="at-lista-topo">
              <input className="campo at-campo-pequeno" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="🔎 Nome, telefone, e-mail ou assunto" />
              <div className="at-filtros">
                {FILTROS.map(([chave, rotulo]) => (
                  <button key={chave} type="button" className={`at-filtro ${filtro === chave ? 'ativo' : ''}`} onClick={() => setFiltro(chave)}>{rotulo}</button>
                ))}
              </div>
              {canais.length > 1 && (
                <select className="at-select" style={{ maxWidth: '100%' }} value={canalFiltro} onChange={(e) => setCanalFiltro(e.target.value)} aria-label="Canal">
                  <option value="">Todos os canais</option>
                  {canais.map((c) => <option key={c.id} value={c.id}>{ICONE_CANAL[c.tipo]} {c.nome}</option>)}
                </select>
              )}
            </div>
            <div className="at-lista">
              {carregandoLista ? <div className="at-vazio">Carregando…</div> : conversas.length === 0 ? (
                <div className="at-vazio">{busca ? 'Nada encontrado nessa busca.' : 'Nenhuma conversa aqui. 🎉'}</div>
              ) : conversas.map((c) => {
                const nome = c.contato_nome || c.contato_endereco || 'Cliente';
                return (
                  <button key={c.id} type="button" className={`at-item ${c.id === selecionadaId ? 'ativo' : ''}`} onClick={() => abrirConversa(c.id)}>
                    <div className="at-avatar">{iniciais(nome)}<span className="at-avatar-canal">{ICONE_CANAL[c.canal_tipo]}</span></div>
                    <div className="at-item-meio">
                      <div className="at-item-linha">
                        <span className="at-item-nome">{nome}</span>
                        <span className={`at-item-hora ${c.nao_lidas ? 'nova' : ''}`}>{horaCurta(c.ultima_mensagem_em)}</span>
                      </div>
                      {c.canal_tipo === 'EMAIL' && c.assunto && <div className="at-item-resumo"><strong>{c.assunto}</strong></div>}
                      <div className="at-item-linha">
                        <span className="at-item-resumo">{c.ultima_direcao === 'SAIDA' ? '↪ ' : ''}{c.ultima_mensagem_resumo || '—'}</span>
                        {c.nao_lidas > 0 && <span className="at-badge">{c.nao_lidas}</span>}
                      </div>
                      <div className="at-item-rodape">
                        {c.status !== 'ABERTA' && <span className={`at-chip ${c.status === 'PENDENTE' ? 'at-chip-pendente' : 'at-chip-resolvida'}`}>{STATUS_CONVERSA[c.status]}</span>}
                        {c.responsavel_id
                          ? <span className="at-chip at-chip-resp">{c.responsavel_id === usuario.id ? 'Comigo' : primeiroNome(nomesAtendentes[c.responsavel_id] || '—')}</span>
                          : <span className="at-chip">Sem responsável</span>}
                        {c.cloudbeds_reservation_id && <span className="at-chip">🏨 {c.cloudbeds_reservation_id}</span>}
                        {canais.length > 1 && mapaCanais[c.canal_id] && <span className="at-chip">{mapaCanais[c.canal_id].nome}</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ---------------- Conversa ---------------- */}
          <div className={`at-col ${selecionada ? '' : 'at-esconder-celular'}`}>
            {selecionada ? (
              <Conversa
                conversa={selecionada}
                canal={canalSelecionado}
                mensagens={mensagens}
                carregando={carregandoMensagens}
                usuario={usuario}
                atendentes={atendentes}
                respostas={respostas}
                lateralAberta={lateralAberta}
                onAlternarLateral={() => setLateralAberta(!lateralAberta)}
                onRecarregar={() => { recarregarTudo(); }}
                onVoltar={() => { setSelecionadaId(null); window.history.replaceState(null, '', '/atendimento'); }}
              />
            ) : (
              <div className="at-vazio" style={{ margin: 'auto' }}>Escolha uma conversa na lista.</div>
            )}
          </div>

          {/* ---------------- Reserva (computador) ---------------- */}
          {selecionada && lateralAberta && (
            <div className="at-col at-col-lateral at-esconder-celular">
              <PainelReserva conversa={selecionada} onMudou={recarregarTudo} />
            </div>
          )}
        </div>
      )}

      {/* Reserva (celular): abre por cima */}
      {aba === 'conversas' && selecionada && lateralAberta && (
        <div className="at-overlay at-so-celular" role="dialog" aria-modal="true" aria-label="Reserva">
          <div className="at-modal" style={{ padding: 0 }}>
            <div className="at-modal-topo" style={{ padding: '12px 14px 0' }}>
              <h2>Reserva</h2>
              <button type="button" className="at-btn" onClick={() => setLateralAberta(false)} aria-label="Fechar">✕</button>
            </div>
            <PainelReserva conversa={selecionada} onMudou={recarregarTudo} />
          </div>
        </div>
      )}

      {novaConversa && (
        <NovaConversa
          canais={canais}
          onFechar={() => setNovaConversa(false)}
          onCriada={(id) => { setNovaConversa(false); setFiltro('todas'); recarregarTudo(); if (id) abrirConversa(id); }}
        />
      )}
    </main>
  );
}
