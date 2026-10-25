'use client';

// ============================================================================
// CAIXA DE ENTRADA — aba "🔁 Automações" (Fase 5, só ADMIN)
// ============================================================================
// Liga, desliga e configura as mensagens automáticas de cada hotel (modelo do
// WhatsApp, espera, horário de envio, limite por dia) e mostra cada disparo:
// enviado, agendado ou não enviado (com o motivo).
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { chamarApi, dataHora, baixarCsv, telefoneBonito } from './util';
import {
  AUTOMACOES, AUTOMACAO_POR_TIPO, CAMPOS_VARIAVEL, SITUACOES_DISPARO, esperaTexto,
} from '../../../lib/atendimento/automacoesConfig';
import { rotuloVariavel, baseDoLink } from '../../../lib/atendimento/modelosTexto';

const COR_SITUACAO = {
  AGENDADO: { background: '#EAF2FC', color: '#1B4F8A' },
  ENVIADO: { background: '#E5F4EA', color: '#14532D' },
  PULADO: { background: '#F1F1EE', color: '#5B6762' },
  FALHOU: { background: '#FDECEA', color: '#B42318' },
  CANCELADO: { background: '#F1F1EE', color: '#5B6762' },
};
const contatoBonito = (c) => (c && /^\+?[\d\s()-]+$/.test(c) ? telefoneBonito(c) : c || '');
const reais = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

function separarEspera(minutos) {
  const m = Number(minutos) || 0;
  if (m && m % 1440 === 0) return { valor: m / 1440, unidade: 1440 };
  if (m && m % 60 === 0) return { valor: m / 60, unidade: 60 };
  return { valor: m, unidade: 1 };
}

function formDe(def, salvo) {
  const s = salvo || {};
  const esp = separarEspera(s.espera_minutos ?? def.espera);
  return {
    tipo: def.tipo,
    ativo: !!s.ativo,
    canal_id: s.canal_id || '',
    modelo_nome: s.modelo_nome || '',
    modelo_idioma: s.modelo_idioma || '',
    variaveis: s.variaveis || [],
    variaveis_cabecalho: s.variaveis_cabecalho || [],
    texto_livre: s.texto_livre ?? def.textoPadrao ?? '',
    espera_valor: esp.valor,
    espera_unidade: esp.unidade,
    janela_inicio: s.janela_inicio || '08:00',
    janela_fim: s.janela_fim || '21:00',
    limite_dia: s.limite_dia || 100,
    hora: s.config?.hora || def.configPadrao?.hora || '10:00',
    dias: s.config?.dias ?? def.configPadrao?.dias ?? 1,
    reverificar_horas: s.config?.reverificar_horas || def.configPadrao?.reverificar_horas || 6,
    parar_robo: s.config?.parar_robo ?? !!def.pararRobo,
  };
}

function paraSalvar(f) {
  return {
    tipo: f.tipo, ativo: f.ativo, canal_id: f.canal_id || null, modelo_nome: f.modelo_nome || null, modelo_idioma: f.modelo_idioma || null,
    variaveis: f.variaveis, variaveis_cabecalho: f.variaveis_cabecalho, texto_livre: f.texto_livre,
    espera_minutos: Math.round(Number(f.espera_valor || 0) * Number(f.espera_unidade || 1)),
    janela_inicio: f.janela_inicio, janela_fim: f.janela_fim, limite_dia: Number(f.limite_dia),
    config: { hora: f.hora, dias: Number(f.dias), reverificar_horas: Number(f.reverificar_horas), parar_robo: !!f.parar_robo },
  };
}

// ---------------------------------------------------------------------------
function Formulario({ def, salvo, canais, hotelId, onSalvo, onFechar }) {
  const [f, setF] = useState(() => formDe(def, salvo));
  const [modelos, setModelos] = useState(null);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [telefone, setTelefone] = useState('');
  const usaHora = def.tipo === 'PRE_CHECKIN' || def.tipo === 'POS_CHECKOUT';

  useEffect(() => {
    if (!f.canal_id) { setModelos(null); return undefined; }
    let ativo = true;
    setLendo(true);
    chamarApi('/api/atendimento', { acao: 'modelos', canalId: Number(f.canal_id) })
      .then((r) => { if (ativo) setModelos((r.modelos || []).filter((m) => !m.cabecalhoMidia)); })
      .catch((e) => { if (ativo) { setModelos([]); setErro(e.message); } })
      .finally(() => { if (ativo) setLendo(false); });
    return () => { ativo = false; };
  }, [f.canal_id]);

  const modelo = (modelos || []).find((m) => m.nome === f.modelo_nome && (!f.modelo_idioma || m.idioma === f.modelo_idioma));
  const opcoesCampo = def.campos.map((c) => [c, CAMPOS_VARIAVEL[c]]);

  function escolherModelo(valor) {
    const [nome, idioma] = valor.split('|');
    const m = (modelos || []).find((x) => x.nome === nome && x.idioma === idioma);
    // Sugestão: pelo nome da variável ({{nomeDoHotel}} → hotel) ou pela ordem
    const porNome = (n) => {
      const t = String(n || '').toLowerCase();
      const achado = [['atendente', 'atendente'], ['hotel', 'hotel'], ['empresa', 'hotel'], ['checkin', 'checkin'], ['entrada', 'checkin'], ['checkout', 'checkout'],
        ['saida', 'checkout'], ['noite', 'noites'], ['link', 'link_reservar'], ['valor', 'valor'], ['preco', 'valor'], ['reserva', 'numero_reserva'], ['nome', 'nome'], ['viajante', 'nome']]
        .find(([k, c]) => t.includes(k) && def.campos.includes(c));
      return achado ? achado[1] : null;
    };
    const sugestao = (n, nomes) => Array.from({ length: n }, (_, i) => porNome(nomes?.[i]) || (i === 0 ? 'nome' : def.campos[i] || def.campos[0]));
    setF({
      ...f, modelo_nome: nome || '', modelo_idioma: idioma || '',
      variaveis: m ? sugestao(m.variaveisCorpo, m.nomesCorpo) : [], variaveis_cabecalho: m ? sugestao(m.variaveisCabecalho, m.nomesCabecalho) : [],
    });
  }

  async function salvar(extra = {}) {
    setOcupado(true); setErro(''); setOk('');
    try {
      const r = await chamarApi('/api/atendimento', { acao: 'automacao_salvar', hotelId, automacao: paraSalvar({ ...f, ...extra }) });
      setF(formDe(def, r.automacao));
      setOk(r.automacao.ativo ? '✅ Salva e ligada.' : 'Salva (desligada).');
      onSalvo?.();
    } catch (e) { setErro(e.message); }
    setOcupado(false);
  }

  async function testar() {
    setOcupado(true); setErro(''); setOk('');
    try {
      await chamarApi('/api/atendimento', { acao: 'automacao_salvar', hotelId, automacao: paraSalvar(f) });
      const r = await chamarApi('/api/atendimento', { acao: 'automacao_testar', hotelId, tipo: def.tipo, telefone });
      setOk(`Teste enviado para ${telefone}. Mensagem: ${r.texto}`);
      onSalvo?.();
    } catch (e) { setErro(e.message); }
    setOcupado(false);
  }

  return (
    <div className="at-canal" style={{ background: '#FAFBF9', marginTop: 10 }}>
      <label className="at-reserva" style={{ display: 'flex', gap: 10, alignItems: 'center', margin: 0, cursor: 'pointer' }}>
        <input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} />
        <strong>{f.ativo ? '🟢 Ligada' : '⚪ Desligada'}</strong>
        <span className="at-dica" style={{ margin: 0 }}>(ao ligar, só vale para o que acontecer daqui para frente)</span>
      </label>

      <div className="at-grade" style={{ marginTop: 10 }}>
        <div>
          <label className="rotulo" htmlFor={`au-canal-${def.tipo}`}>Número de WhatsApp que envia</label>
          <select id={`au-canal-${def.tipo}`} className="campo" value={f.canal_id} onChange={(e) => setF({ ...f, canal_id: e.target.value, modelo_nome: '', modelo_idioma: '', variaveis: [], variaveis_cabecalho: [] })}>
            <option value="">Escolha…</option>
            {canais.map((c) => <option key={c.id} value={c.id} disabled={!c.ativo}>{c.nome}{c.numero ? ` · ${c.numero}` : ''}{c.ativo ? '' : ' (desligado)'}</option>)}
          </select>
          <span className="at-dica" style={{ display: 'block', margin: 0 }}>Se o cliente já conversou por outro número do hotel, a mensagem sai pelo número da conversa.</span>
        </div>
        <div>
          <label className="rotulo" htmlFor={`au-modelo-${def.tipo}`}>Modelo aprovado pela Meta</label>
          <select id={`au-modelo-${def.tipo}`} className="campo" value={f.modelo_nome ? `${f.modelo_nome}|${f.modelo_idioma}` : ''} onChange={(e) => escolherModelo(e.target.value)} disabled={!f.canal_id || lendo}>
            <option value="">{lendo ? 'Lendo os modelos na Meta…' : f.canal_id ? 'Escolha…' : 'Escolha o número antes'}</option>
            {(modelos || []).map((m) => <option key={`${m.nome}|${m.idioma}`} value={`${m.nome}|${m.idioma}`}>{m.nome} ({m.idioma}{m.categoria ? ` · ${m.categoria === 'MARKETING' ? 'marketing' : m.categoria === 'UTILITY' ? 'utilidade' : m.categoria.toLowerCase()}` : ''})</option>)}
            {f.modelo_nome && !modelo && modelos && <option value={`${f.modelo_nome}|${f.modelo_idioma}`}>{f.modelo_nome} (não encontrado)</option>}
          </select>
          <span className="at-dica" style={{ display: 'block', margin: 0 }}>Modelos de marketing custam mais que os de utilidade. Modelos novos são criados no WhatsApp Manager da Meta.</span>
        </div>
      </div>

      {modelo && (
        <div className="at-reserva" style={{ marginTop: 8 }}>
          <div className="at-dica" style={{ margin: '0 0 6px' }}>Texto do modelo:</div>
          {modelo.cabecalho && <div><strong>{modelo.cabecalho}</strong></div>}
          <div style={{ whiteSpace: 'pre-wrap' }}>{modelo.corpo}</div>
          {modelo.rodape && <div className="at-dica" style={{ margin: '4px 0 0' }}>{modelo.rodape}</div>}
          {(f.variaveis_cabecalho.length > 0 || f.variaveis.length > 0) && (
            <div className="at-grade" style={{ marginTop: 8 }}>
              {f.variaveis_cabecalho.map((v, i) => (
                <label key={`c${i}`}><span className="rotulo">Título {rotuloVariavel(i, modelo.nomesCabecalho)}</span>
                  <select className="campo" value={v} onChange={(e) => setF({ ...f, variaveis_cabecalho: f.variaveis_cabecalho.map((x, k) => (k === i ? e.target.value : x)) })}>
                    {opcoesCampo.map(([c, r]) => <option key={c} value={c}>{r}</option>)}
                  </select>
                </label>
              ))}
              {f.variaveis.map((v, i) => (
                <label key={`v${i}`}><span className="rotulo">{rotuloVariavel(i, modelo.nomesCorpo)} no texto</span>
                  <select className="campo" value={v} onChange={(e) => setF({ ...f, variaveis: f.variaveis.map((x, k) => (k === i ? e.target.value : x)) })}>
                    {opcoesCampo.map(([c, r]) => <option key={c} value={c}>{r}</option>)}
                  </select>
                </label>
              ))}
            </div>
          )}
          {(modelo.botoesLink || []).map((b) => {
            const base = baseDoLink(b.url);
            const doSistema = typeof window !== 'undefined' && base.replace(/^https?:\/\//i, '').toLowerCase() === `${window.location.host.toLowerCase()}/r/`;
            return (
              <div key={b.indice} className="at-dica" style={{ margin: '8px 0 0', color: doSistema ? undefined : '#B42318' }}>
                🔘 Botão “{b.texto}” abre {base}…{' '}
                {doSistema ? '(o link “Reservar agora” da cotação — certo)' : '— este link não é do sistema: crie na Meta um modelo com o botão abrindo ' + (typeof window !== 'undefined' ? window.location.origin : '') + '/r/{{1}}'}
              </div>
            );
          })}
        </div>
      )}

      {def.tipo === 'PESQUISA' && (
        <div style={{ marginTop: 8 }}>
          <label className="rotulo" htmlFor="au-texto-pesquisa">Texto da pesquisa (quando a conversa ainda está aberta, até 24 h)</label>
          <textarea id="au-texto-pesquisa" className="campo" rows={3} value={f.texto_livre} onChange={(e) => setF({ ...f, texto_livre: e.target.value })} />
          <span className="at-dica" style={{ display: 'block', margin: 0 }}>Pode usar {'{nome}'} e {'{atendente}'}. O cliente responde com um número de 1 a 5 e recebe “Obrigado pela avaliação!”. Depois de 24 h, só sai se houver modelo escolhido.</span>
        </div>
      )}

      <div className="at-grade" style={{ marginTop: 8 }}>
        {usaHora ? (
          <>
            <label><span className="rotulo">{def.tipo === 'PRE_CHECKIN' ? 'Quantos dias antes da entrada' : 'Quantos dias depois da saída'}</span>
              <input className="campo" type="number" min={0} max={7} value={f.dias} onChange={(e) => setF({ ...f, dias: e.target.value })} /></label>
            <label><span className="rotulo">Hora do envio</span>
              <input className="campo" type="time" value={f.hora} onChange={(e) => setF({ ...f, hora: e.target.value })} /></label>
          </>
        ) : def.tipo === 'SEM_DISPONIBILIDADE' ? (
          <label><span className="rotulo">Consultar a Cloudbeds de novo a cada (horas)</span>
            <input className="campo" type="number" min={1} max={48} value={f.reverificar_horas} onChange={(e) => setF({ ...f, reverificar_horas: e.target.value })} /></label>
        ) : (
          <label><span className="rotulo">Esperar quanto tempo</span>
            <span style={{ display: 'flex', gap: 6 }}>
              <input className="campo" type="number" min={0} value={f.espera_valor} onChange={(e) => setF({ ...f, espera_valor: e.target.value })} style={{ maxWidth: 110 }} />
              <select className="campo" value={f.espera_unidade} onChange={(e) => setF({ ...f, espera_unidade: Number(e.target.value) })}>
                <option value={1}>minutos</option><option value={60}>horas</option><option value={1440}>dias</option>
              </select>
            </span></label>
        )}
        <label><span className="rotulo">Só envia das</span>
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input className="campo" type="time" value={f.janela_inicio} onChange={(e) => setF({ ...f, janela_inicio: e.target.value })} />
            <span>às</span>
            <input className="campo" type="time" value={f.janela_fim} onChange={(e) => setF({ ...f, janela_fim: e.target.value })} />
          </span></label>
        <label><span className="rotulo">No máximo por dia</span>
          <input className="campo" type="number" min={1} max={5000} value={f.limite_dia} onChange={(e) => setF({ ...f, limite_dia: e.target.value })} /></label>
      </div>

      <label className="at-reserva" style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '10px 0 0', cursor: 'pointer' }}>
        <input type="checkbox" checked={!!f.parar_robo} onChange={(e) => setF({ ...f, parar_robo: e.target.checked })} />
        <span>Depois de enviar, o robô fica em silêncio nessa conversa (quem responde é a equipe)</span>
      </label>

      {erro && <div className="aviso-erro" style={{ marginTop: 8 }}>{erro}</div>}
      {ok && <div className="aviso-erro" style={{ marginTop: 8, background: '#E5F4EA', color: '#14532D' }}>{ok}</div>}
      <div className="at-botoes">
        <button type="button" className="at-btn at-btn-verde" onClick={() => salvar()} disabled={ocupado}>{ocupado ? 'Salvando…' : 'Salvar'}</button>
        <button type="button" className="at-btn" onClick={onFechar}>Fechar</button>
      </div>
      {f.modelo_nome && (
        <div className="at-botoes" style={{ alignItems: 'center' }}>
          <input className="campo" style={{ maxWidth: 220, margin: 0 }} placeholder="Seu WhatsApp (83 9…)" value={telefone} onChange={(e) => setTelefone(e.target.value)} aria-label="Número para o teste" />
          <button type="button" className="at-btn" onClick={testar} disabled={ocupado || !telefone.trim()}>📲 Enviar um teste</button>
          <span className="at-dica" style={{ margin: 0 }}>Manda o modelo com dados de exemplo (conta como uma mensagem paga).</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function Automacoes({ hoteis, hotelAtual, onAbrirConversa }) {
  const [hotelId, setHotelId] = useState((hoteis.find((h) => h.id === Number(hotelAtual)) || hoteis[0])?.id);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [aberta, setAberta] = useState(null);
  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroSituacao, setFiltroSituacao] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    if (!hotelId) return;
    try {
      const r = await chamarApi('/api/atendimento', { acao: 'automacoes', hotelId, tipo: filtroTipo || undefined, situacao: filtroSituacao || undefined });
      setDados(r); setErro('');
    } catch (e) { setErro(e.message); }
  }, [hotelId, filtroTipo, filtroSituacao]);

  useEffect(() => { carregar(); const id = setInterval(carregar, 60000); return () => clearInterval(id); }, [carregar]);
  useEffect(() => { setAberta(null); setDados(null); }, [hotelId]);

  const porTipo = useMemo(() => Object.fromEntries((dados?.automacoes || []).map((a) => [a.tipo, a])), [dados]);
  const stats = dados?.painel?.por_tipo || {};

  async function ligarDesligar(def, salvo, ligar) {
    if (ligar && !salvo?.modelo_nome && !(def.tipo === 'PESQUISA' && salvo?.texto_livre)) { setAberta(def.tipo); return; }
    setOcupado(true); setErro('');
    try {
      await chamarApi('/api/atendimento', { acao: 'automacao_salvar', hotelId, automacao: paraSalvar({ ...formDe(def, salvo), ativo: ligar }) });
      await carregar();
    } catch (e) { setErro(e.message); }
    setOcupado(false);
  }

  async function cancelar(d) {
    try { await chamarApi('/api/atendimento', { acao: 'disparo_cancelar', disparoId: d.id }); await carregar(); } catch (e) { setErro(e.message); }
  }

  function exportar() {
    baixarCsv('disparos.csv', ['Nº', 'Criado', 'Automação', 'Cliente', 'Contato', 'Situação', 'Motivo', 'Agendado para', 'Enviado em', 'Nota'],
      (dados?.disparos || []).map((d) => [d.id, dataHora(d.criado_em), AUTOMACAO_POR_TIPO[d.tipo]?.titulo || d.tipo, d.cliente || '', d.contato || '',
        SITUACOES_DISPARO[d.situacao] || d.situacao, d.motivo || '', d.agendado_para ? dataHora(d.agendado_para) : '', d.enviado_em ? dataHora(d.enviado_em) : '', d.nota || '']));
  }

  return (
    <>
      {hoteis.length > 1 && (
        <div className="at-botoes" style={{ marginTop: 0, marginBottom: 12, alignItems: 'center' }}>
          <label className="at-detalhe" style={{ margin: 0 }}>
            <span style={{ color: 'var(--tinta)', fontWeight: 600 }}>Hotel</span>
            <select className="at-select" value={hotelId} onChange={(e) => setHotelId(Number(e.target.value))}>
              {hoteis.map((h) => <option key={h.id} value={h.id}>{h.nome}</option>)}
            </select>
          </label>
        </div>
      )}
      <div className="aviso-erro" style={{ background: '#FFF4D6', color: '#7A5600' }}>
        ⚠️ Todas as automações começam <strong>desligadas</strong>. Antes de ligar uma, <strong>desligue a mesma no Asksuite</strong> (AskFlow → Agentes), para o cliente não receber duas mensagens.
        Fora da conversa só dá para mandar <strong>modelo aprovado pela Meta</strong>, e cada envio é cobrado. Quem responder “SAIR” não recebe mais.
      </div>
      {erro && <div className="aviso-erro">{erro}</div>}
      {!dados && !erro && <div className="at-vazio">Carregando…</div>}
      {dados && (
        <>
          {dados.canais.length === 0 && <div className="aviso-erro">Este hotel ainda não tem número de WhatsApp ligado no sistema (aba ⚙️ Canais).</div>}
          {AUTOMACOES.map((def) => {
            const salvo = porTipo[def.tipo];
            const s = stats[def.tipo] || {};
            const espera = def.tipo === 'PRE_CHECKIN' || def.tipo === 'POS_CHECKOUT'
              ? `${salvo?.config?.dias ?? def.configPadrao.dias} dia(s) ${def.tipo === 'PRE_CHECKIN' ? 'antes' : 'depois'}, às ${salvo?.config?.hora || def.configPadrao.hora}`
              : def.tipo === 'SEM_DISPONIBILIDADE' ? `consulta a cada ${salvo?.config?.reverificar_horas || def.configPadrao.reverificar_horas} h`
                : `espera ${esperaTexto(salvo?.espera_minutos ?? def.espera)}`;
            return (
              <section key={def.tipo} className="at-cartao">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <h2 style={{ margin: 0 }}>{salvo?.ativo ? '🟢' : '⚪'} {def.titulo}</h2>
                  <div className="at-botoes" style={{ marginTop: 0 }}>
                    <button type="button" className={`at-btn ${salvo?.ativo ? '' : 'at-btn-verde'}`} disabled={ocupado} onClick={() => ligarDesligar(def, salvo, !salvo?.ativo)}>{salvo?.ativo ? 'Desligar' : 'Ligar'}</button>
                    <button type="button" className="at-btn" onClick={() => setAberta(aberta === def.tipo ? null : def.tipo)}>{aberta === def.tipo ? 'Fechar' : '⚙️ Configurar'}</button>
                  </div>
                </div>
                <p className="at-dica" style={{ margin: '6px 0 2px' }}>{def.descricao}</p>
                <p className="at-dica" style={{ margin: '0 0 2px' }}>
                  {salvo?.modelo_nome ? `Modelo: ${salvo.modelo_nome}` : 'Modelo: (não escolhido)'} · {espera} · das {salvo?.janela_inicio || '08:00'} às {salvo?.janela_fim || '21:00'} · até {salvo?.limite_dia || 100} por dia
                </p>
                <p className="at-dica" style={{ margin: 0 }}>💡 {def.asksuite}</p>
                {(Number(s.enviados) > 0 || Number(s.agendados) > 0 || Number(s.pulados) > 0) && (
                  <p className="at-dica" style={{ margin: '4px 0 0' }}>
                    Últimos 30 dias: <strong>{s.enviados}</strong> enviada(s) · {s.respostas} responderam · {s.reservas} reserva(s) depois ({reais(s.valor)}) · {s.agendados} agendada(s) · {Number(s.pulados) + Number(s.falhas)} não enviada(s)
                  </p>
                )}
                {aberta === def.tipo && (
                  <Formulario key={`${hotelId}-${def.tipo}`} def={def} salvo={salvo} canais={dados.canais} hotelId={hotelId} onSalvo={carregar} onFechar={() => setAberta(null)} />
                )}
              </section>
            );
          })}

          <section className="at-cartao">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>📬 Mensagens automáticas</h2>
              <button type="button" className="at-btn" onClick={exportar} disabled={!(dados.disparos || []).length}>⬇ Exportar</button>
            </div>
            <div className="at-filtros-mais" style={{ margin: '10px 0' }}>
              <label><span>Automação</span>
                <select className="at-select" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
                  <option value="">Todas</option>
                  {AUTOMACOES.map((a) => <option key={a.tipo} value={a.tipo}>{a.titulo}</option>)}
                </select>
              </label>
              <label><span>Situação</span>
                <select className="at-select" value={filtroSituacao} onChange={(e) => setFiltroSituacao(e.target.value)}>
                  <option value="">Todas</option>
                  {Object.entries(SITUACOES_DISPARO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
            </div>
            {(dados.disparos || []).length === 0 ? <div className="at-vazio">Nenhuma mensagem automática ainda.</div> : (
              <div className="at-tabela-rolagem">
                <table className="at-tabela at-tabela-previa">
                  <thead><tr><th>Quando</th><th>Automação</th><th>Cliente</th><th>Situação</th><th>Detalhe</th><th /></tr></thead>
                  <tbody>
                    {dados.disparos.map((d) => (
                      <tr key={d.id}>
                        <td>{dataHora(d.enviado_em || d.agendado_para || d.criado_em)}</td>
                        <td>{AUTOMACAO_POR_TIPO[d.tipo]?.titulo || d.tipo}</td>
                        <td>{d.cliente || '—'}<div className="at-dica" style={{ margin: 0 }}>{contatoBonito(d.contato)}</div></td>
                        <td><span className="at-chip" style={COR_SITUACAO[d.situacao]}>{SITUACOES_DISPARO[d.situacao] || d.situacao}</span></td>
                        <td>{d.nota ? `⭐ Nota ${d.nota}` : d.motivo || (d.situacao === 'AGENDADO' ? `sai em ${dataHora(d.agendado_para)}` : '')}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {d.conversa_id && <button type="button" className="at-link-pequeno" onClick={() => onAbrirConversa(d.conversa_id)}>Abrir conversa</button>}
                          {d.situacao === 'AGENDADO' && <button type="button" className="at-link-pequeno" style={{ marginLeft: 8 }} onClick={() => cancelar(d)}>Cancelar</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
