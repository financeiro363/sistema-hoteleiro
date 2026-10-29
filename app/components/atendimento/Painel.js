'use client';

// ============================================================================
// CAIXA DE ENTRADA — aba Painel (indicadores, como o painel do Asksuite)
// ============================================================================
// Números do período escolhido: atendimentos, fora do horário comercial,
// mensagens, cotações, reservas, anúncios, tempo da 1ª resposta, contatos
// novos; gráfico mês a mês, por hora do dia, por canal e por atendente.
// Cotações e reservas contam as conversas com as etiquetas "Cotação" e
// "Reservou" (entram sozinhas ao mover o cartão para essas etapas).
// ============================================================================

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { chamarApi, NOME_CANAL, ICONE_CANAL } from './util';

const FUSO = 'America/Fortaleza';
// Paleta categórica validada (ordem fixa: azul, laranja, verde-água)
const CORES = ['#2a78d6', '#eb6834', '#1baf7a'];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const compacto = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const inteiro = new Intl.NumberFormat('pt-BR');
const fmt = (n) => (Math.abs(n) >= 10000 ? compacto.format(n) : inteiro.format(n || 0));

function hojeLocal() { return new Date().toLocaleDateString('en-CA', { timeZone: FUSO }); }
function rotuloMes(m) { const [a, mm] = m.split('-'); return `${MESES[Number(mm) - 1]}/${a.slice(2)}`; }
function primeiroDia(ano, mes) { return `${ano}-${String(mes).padStart(2, '0')}-01`; }
function ultimoDia(ano, mes) { return new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10); }

function intervalo(periodo, de, ate) {
  const hoje = hojeLocal();
  const ano = Number(hoje.slice(0, 4));
  const mes = Number(hoje.slice(5, 7));
  const voltar = (n) => { const d = new Date(Date.UTC(ano, mes - 1 - n, 1)); return [d.getUTCFullYear(), d.getUTCMonth() + 1]; };
  if (periodo === 'mes') return [primeiroDia(ano, mes), hoje];
  if (periodo === 'passado') { const [a, m] = voltar(1); return [primeiroDia(a, m), ultimoDia(a, m)]; }
  if (periodo === '3m') { const [a, m] = voltar(2); return [primeiroDia(a, m), hoje]; }
  if (periodo === '6m') { const [a, m] = voltar(5); return [primeiroDia(a, m), hoje]; }
  if (periodo === '12m') { const [a, m] = voltar(11); return [primeiroDia(a, m), hoje]; }
  if (periodo === 'ano') return [`${ano}-01-01`, hoje];
  if (periodo === '24m') { const [a, m] = voltar(23); return [primeiroDia(a, m), hoje]; }
  return [de || hoje, ate || hoje];
}

function minutosTexto(min) {
  if (min === null || min === undefined) return '—';
  const m = Math.round(Number(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  return `${Math.round(h / 24)} dias`;
}

const NOMES_CANAL = { WHATSAPP: 'WhatsApp', INSTAGRAM: 'Instagram', EMAIL: 'E-mail', BOOKING: 'Mensagens do Booking.com', SITE: 'Chat do site', FACEBOOK: 'Facebook' };
function nomeCanal(f) {
  const t = String(f || '').trim();
  return NOMES_CANAL[t.toUpperCase().replace(/[^A-Z]/g, '')] || t || 'Não informado';
}
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const nomesHoteis = (lista) => (lista || []).map((h) => h.nome || 'outro hotel').join(' e ') || 'outro hotel';
const reaisCurto = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

// Largura real do elemento (para o gráfico se ajustar à tela)
function useLargura() {
  const ref = useRef(null);
  const [largura, setLargura] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setLargura(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setLargura(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, largura];
}

function passoBonito(maximo, marcas = 4) {
  if (maximo <= 0) return 1;
  const bruto = maximo / marcas;
  const pot = 10 ** Math.floor(Math.log10(bruto));
  const n = bruto / pot;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pot;
}

// Coluna com o topo arredondado (4 px) e a base reta
function caminhoColuna(x, y, w, h) {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// ---------------------------------------------------------------------------
// Gráfico de colunas (uma ou mais séries), com dica ao passar o mouse
function GraficoColunas({ categorias, series, altura = 240, titulo, rotuloCategoria = (c) => c, mostrarRotulosACada = 1 }) {
  const [ref, largura] = useLargura();
  const [foco, setFoco] = useState(null);
  const esquerda = 40;
  const direita = 8;
  const topo = 12;
  const base = 26;
  const larguraPlot = Math.max(0, largura - esquerda - direita);
  const alturaPlot = altura - topo - base;
  const maximo = Math.max(1, ...series.flatMap((s) => s.valores));
  const passo = passoBonito(maximo);
  const teto = Math.ceil(maximo / passo) * passo;
  const marcas = [];
  for (let v = 0; v <= teto + 1e-9; v += passo) marcas.push(v);
  const banda = categorias.length ? larguraPlot / categorias.length : 0;
  const gap = 2;
  const larguraBarra = Math.max(2, Math.min(24, (banda * 0.72 - gap * (series.length - 1)) / series.length));
  const grupo = larguraBarra * series.length + gap * (series.length - 1);
  const y = (v) => topo + alturaPlot - (v / teto) * alturaPlot;

  return (
    <div className="pi-grafico" ref={ref}>
      {largura > 0 && (
        <svg width={largura} height={altura} role="img" aria-label={titulo}>
          {marcas.map((v) => (
            <g key={v}>
              <line x1={esquerda} x2={largura - direita} y1={y(v)} y2={y(v)} stroke={v === 0 ? '#c3c2b7' : '#e1e0d9'} strokeWidth="1" shapeRendering="crispEdges" />
              <text x={esquerda - 6} y={y(v)} dy="0.32em" textAnchor="end" className="pi-eixo">{fmt(v)}</text>
            </g>
          ))}
          {categorias.map((c, i) => {
            const x0 = esquerda + i * banda + (banda - grupo) / 2;
            return (
              <g key={c}>
                {foco === i && <rect x={esquerda + i * banda} y={topo} width={banda} height={alturaPlot} fill="#0b0b0b" opacity="0.04" />}
                {series.map((s, k) => {
                  const v = s.valores[i] || 0;
                  return <path key={s.nome} d={caminhoColuna(x0 + k * (larguraBarra + gap), y(v), larguraBarra, y(0) - y(v))} fill={s.cor} />;
                })}
                {i % mostrarRotulosACada === 0 && (
                  <text x={esquerda + i * banda + banda / 2} y={altura - 8} textAnchor="middle" className="pi-eixo">{rotuloCategoria(c)}</text>
                )}
                <rect
                  x={esquerda + i * banda} y={topo} width={banda} height={alturaPlot + base} fill="transparent" tabIndex={0}
                  aria-label={`${rotuloCategoria(c)}: ${series.map((s) => `${s.nome} ${s.valores[i] || 0}`).join(', ')}`}
                  onPointerEnter={() => setFoco(i)} onPointerMove={() => setFoco(i)} onPointerLeave={() => setFoco(null)}
                  onFocus={() => setFoco(i)} onBlur={() => setFoco(null)}
                />
              </g>
            );
          })}
        </svg>
      )}
      {foco !== null && largura > 0 && (
        <div className="pi-dica" style={{ left: Math.min(Math.max(esquerda + foco * banda + banda / 2, 80), largura - 80), top: 4 }}>
          <div className="pi-dica-titulo">{rotuloCategoria(categorias[foco])}</div>
          {series.map((s) => (
            <div key={s.nome} className="pi-dica-linha">
              <i style={{ background: s.cor }} /><strong>{inteiro.format(s.valores[foco] || 0)}</strong><span>{s.nome}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Legenda({ series }) {
  return (
    <div className="pi-legenda">
      {series.map((s) => <span key={s.nome}><i style={{ background: s.cor }} />{s.nome}</span>)}
    </div>
  );
}

function Cartao({ rotulo, valor, detalhe }) {
  return (
    <div className="pi-cartao">
      <div className="pi-rotulo">{rotulo}</div>
      <div className="pi-valor">{valor}</div>
      {detalhe && <div className="pi-detalhe">{detalhe}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prazo de resposta (SLA): quantas mensagens foram respondidas dentro do prazo.
// Só as que chegam no horário comercial e nos canais de conversa (sem e-mail).
function SecaoPrazo({ sla, nomes }) {
  const prazo = Number(sla.prazo_min) === Number(sla.prazo_max) ? `${sla.prazo_min} min` : `${sla.prazo_min} a ${sla.prazo_max} min`;
  const dentro = Number(sla.dentro) || 0;
  const fora = (Number(sla.fora_respondidas) || 0) + (Number(sla.aguardando_fora) || 0);
  const linhas = [
    ...(sla.por_atendente || []).map((a) => ({ chave: a.id, nome: nomes[a.id] || `Usuário #${a.id}`, ...a })),
    ...(Number(sla.robo?.respostas) > 0 ? [{ chave: 'robo', nome: '🤖 Robô', ...sla.robo }] : []),
  ];
  return (
    <>
      <h2 className="pi-secao">⏰ Prazo de resposta ({prazo})</h2>
      <div className="pi-cartoes">
        <Cartao rotulo="Respondidas no prazo" valor={pct(dentro, dentro + fora)} detalhe={`${fmt(dentro)} de ${fmt(dentro + fora)} mensagens${Number(sla.aguardando) - Number(sla.aguardando_fora) > 0 ? ` · ${fmt(Number(sla.aguardando) - Number(sla.aguardando_fora))} esperando, ainda no prazo` : ''}`} />
        <Cartao rotulo="Fora do prazo" valor={fmt(fora)} detalhe={`${fmt(sla.fora_respondidas)} respondidas depois do prazo · ${fmt(sla.aguardando_fora)} ainda esperando`} />
        <Cartao rotulo="Tempo médio de resposta" valor={minutosTexto(sla.tempo_medio_min)}
          detalhe={`Metade respondida em até ${minutosTexto(sla.tempo_mediano_min)} · 1ª resposta: ${minutosTexto(sla.primeira?.tempo_medio_min)} · seguintes: ${minutosTexto(sla.seguintes?.tempo_medio_min)}`} />
        <Cartao rotulo="Resolvidas sem resposta" valor={fmt(sla.encerradas_sem_resposta)} detalhe="O cliente escreveu (ex.: “obrigado”) e a conversa foi resolvida sem responder" />
      </div>
      {linhas.length > 0 && (
        <section className="at-cartao">
          <h2>Quem respondeu</h2>
          <div className="at-tabela-rolagem">
            <table className="at-tabela at-tabela-previa">
              <thead><tr><th /><th className="num">Respostas</th><th className="num">No prazo</th><th className="num">%</th><th className="num">Tempo médio</th></tr></thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.chave}>
                    <td>{l.nome}</td><td className="num">{inteiro.format(l.respostas || 0)}</td><td className="num">{inteiro.format(l.dentro || 0)}</td>
                    <td className="num">{pct(l.dentro, l.respostas)}</td><td className="num">{minutosTexto(l.tempo_medio_min)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <p className="at-dica">
        Conta as mensagens que chegaram no horário comercial, no WhatsApp e no chat do site (o e-mail fica de fora); {fmt(sla.fora_horario)} chegaram fora do horário.
        A resposta do robô conta, menos quando ele passa a conversa para a equipe. O prazo muda em “Funil e etiquetas”.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Automações (Fase 5) e pesquisa de satisfação — só ADMIN
const NOME_AUTOMACAO = {
  FUP_RESERVAR: 'Clicou e não reservou', FUP_COTACAO: 'Cotação sem clique', SEM_DISPONIBILIDADE: 'Abriu vaga (lista de espera)',
  GRUPO: 'Retomar grupo', CONFIRMACAO_RESERVA: 'Confirmação da reserva', PRE_CHECKIN: 'Véspera da chegada',
  POS_CHECKOUT: 'Depois da saída', PESQUISA: 'Pesquisa de satisfação',
};
const notaTexto = (m) => (m == null ? '—' : `${String(m).replace('.', ',')} ⭐`);

function SecaoAutomacoes({ dados, nomes }) {
  const tipos = Object.entries(dados.por_tipo || {});
  const notas = dados.notas || {};
  if (!tipos.length && !Number(notas.quantidade)) return null;
  return (
    <>
      <h2 className="pi-secao">🔁 Automações</h2>
      {Number(notas.quantidade) > 0 && (
        <div className="pi-cartoes">
          <Cartao rotulo="Nota média do atendimento" valor={notaTexto(notas.media)} detalhe={`${fmt(notas.quantidade)} resposta(s) da pesquisa de satisfação`} />
          {Number(notas.robo?.quantidade) > 0 && <Cartao rotulo="Nota do robô" valor={notaTexto(notas.robo.media)} detalhe={`${fmt(notas.robo.quantidade)} resposta(s)`} />}
        </div>
      )}
      {(notas.por_atendente || []).length > 0 && (
        <section className="at-cartao">
          <h2>Nota por atendente</h2>
          <table className="at-tabela at-tabela-previa">
            <thead><tr><th>Atendente</th><th className="num">Respostas</th><th className="num">Nota média</th></tr></thead>
            <tbody>{notas.por_atendente.map((a) => <tr key={a.id}><td>{nomes[a.id] || `Usuário #${a.id}`}</td><td className="num">{inteiro.format(a.quantidade)}</td><td className="num">{notaTexto(a.media)}</td></tr>)}</tbody>
          </table>
        </section>
      )}
      {tipos.length > 0 && (
        <section className="at-cartao">
          <h2>Mensagens automáticas</h2>
          <div className="at-tabela-rolagem">
            <table className="at-tabela at-tabela-previa">
              <thead><tr><th>Automação</th><th className="num">Enviadas</th><th className="num">Responderam</th><th className="num">Reservas depois</th><th className="num">Valor</th><th className="num">Não enviadas</th></tr></thead>
              <tbody>
                {tipos.map(([tipo, x]) => (
                  <tr key={tipo}>
                    <td>{NOME_AUTOMACAO[tipo] || tipo}</td><td className="num">{inteiro.format(x.enviados)}</td><td className="num">{inteiro.format(x.respostas)}</td>
                    <td className="num">{inteiro.format(x.reservas)}</td><td className="num">{reaisCurto(x.valor)}</td><td className="num">{inteiro.format(Number(x.pulados) + Number(x.falhas))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="at-dica">Detalhes e o motivo de cada mensagem que não saiu ficam em 🔁 Automações.</p>
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Vendas pelas cotações: quem vende, por qual canal, dentro ou fora do horário
// e com quantos dias de antecedência o cliente procura.
function LinhaVenda({ nome, x }) {
  return (
    <tr>
      <td>{nome}</td><td className="num">{inteiro.format(x.cotacoes || 0)}</td><td className="num">{inteiro.format(x.reservas || 0)}</td>
      <td className="num">{pct(x.reservas, x.cotacoes)}</td><td className="num">{reaisCurto(x.valor)}</td>
    </tr>
  );
}

function SecaoVendas({ vendas, nomes }) {
  const dentro = vendas.horario?.dentro || {};
  const fora = vendas.horario?.fora || {};
  const robo = vendas.robo || {};
  const cab = <thead><tr><th /><th className="num">Cotações</th><th className="num">Reservas</th><th className="num">Conversão</th><th className="num">Valor</th></tr></thead>;
  return (
    <>
      <h2 className="pi-secao">💵 Vendas pelas cotações</h2>
      <div className="pi-cartoes">
        <Cartao rotulo="Dentro do horário comercial" valor={reaisCurto(dentro.valor)} detalhe={`${fmt(dentro.cotacoes)} cotações · ${fmt(dentro.reservas)} reservas`} />
        <Cartao rotulo="Fora do horário comercial" valor={reaisCurto(fora.valor)} detalhe={`${fmt(fora.cotacoes)} cotações (${fmt(fora.robo)} do robô) · ${fmt(fora.reservas)} reservas`} />
        <Cartao rotulo="Antecedência média" valor={vendas.antecedencia?.media_dias != null ? `${String(vendas.antecedencia.media_dias).replace('.', ',')} dias` : '—'} detalhe="Entre o pedido de cotação e a data de entrada" />
      </div>
      <section className="at-cartao">
        <h2>Quem vende</h2>
        <div className="at-tabela-rolagem">
          <table className="at-tabela at-tabela-previa">
            {cab}
            <tbody>
              {(vendas.por_atendente || []).map((a) => <LinhaVenda key={a.id} nome={nomes[a.id] || `Usuário #${a.id}`} x={a} />)}
              {Number(robo.cotacoes) > 0 && <LinhaVenda nome="🤖 Robô" x={robo} />}
            </tbody>
          </table>
        </div>
        <p className="at-dica">Conta as cotações enviadas pelo sistema no período e as reservas que vieram delas (valor da reserva na Cloudbeds).</p>
      </section>
      <section className="at-cartao">
        <h2>Por canal</h2>
        <div className="at-tabela-rolagem">
          <table className="at-tabela at-tabela-previa">
            {cab}
            <tbody>{(vendas.por_canal || []).map((c) => <LinhaVenda key={c.canal} nome={`${ICONE_CANAL[c.canal] || ''} ${NOME_CANAL[c.canal] || c.canal}`} x={c} />)}</tbody>
          </table>
        </div>
      </section>
      <section className="at-cartao">
        <h2>Com quantos dias de antecedência o cliente procura</h2>
        <div className="at-tabela-rolagem">
          <table className="at-tabela at-tabela-previa">
            <thead><tr><th>Antecedência</th><th className="num">Cotações</th><th className="num">Reservas</th><th className="num">Conversão</th></tr></thead>
            <tbody>
              {(vendas.antecedencia?.faixas || []).map((f) => (
                <tr key={f.faixa}><td>{f.faixa}</td><td className="num">{inteiro.format(f.cotacoes)}</td><td className="num">{inteiro.format(f.reservas)}</td><td className="num">{pct(f.reservas, f.cotacoes)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Mensagens de WhatsApp e custo (só ADMIN). A Meta cobra cada mensagem de
// atendimento depois das 1.000 grátis do mês, por número.
const reaisCentavos = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Preço por mensagem cobrada (por hotel) — o ADMIN ajusta conforme a fatura da Meta
function PrecoMensagem({ hotelId, preco, onMudou, campo = 'whatsapp_preco_mensagem', rotulo = 'Preço por mensagem cobrada' }) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const idCampo = campo === 'whatsapp_preco_mensagem' ? `preco-${hotelId}` : `preco-${campo}-${hotelId}`;
  async function salvar() {
    const n = Number(String(valor).replace(',', '.'));
    if (!(n >= 0 && n <= 5)) { setErro('Use um valor entre R$ 0,00 e R$ 5,00.'); return; }
    setSalvando(true); setErro('');
    const { error } = await supabase.from('atendimento_preferencias')
      .upsert({ hotel_id: hotelId, [campo]: n, atualizado_em: new Date().toISOString() }, { onConflict: 'hotel_id' });
    setSalvando(false);
    if (error) {
      const sql = campo === 'whatsapp_preco_mensagem' ? 'da economia (sql/caixa_de_entrada_economia.sql)' : 'da Fase 6 (sql/caixa_de_entrada_fase6.sql)';
      setErro(/whatsapp_preco/i.test(error.message) ? `Falta rodar no Supabase o SQL ${sql}.` : error.message);
      return;
    }
    setEditando(false);
    onMudou?.();
  }
  if (!editando) {
    return (
      <span className="at-dica" style={{ margin: 0 }}>
        {rotulo}: <strong>{reaisCentavos(preco)}</strong>{' '}
        <button type="button" className="at-link-pequeno" onClick={() => { setValor(String(preco).replace('.', ',')); setEditando(true); }}>Alterar</button>
      </span>
    );
  }
  return (
    <span className="at-botoes" style={{ marginTop: 0, alignItems: 'center' }}>
      <label className="at-dica" style={{ margin: 0 }} htmlFor={idCampo}>{rotulo} (R$)</label>
      <input id={idCampo} className="at-select" style={{ width: 90 }} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
      <button type="button" className="at-btn at-btn-verde" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
      <button type="button" className="at-btn" onClick={() => setEditando(false)}>Cancelar</button>
      {erro && <span className="at-ruim" style={{ fontSize: 13 }}>{erro}</span>}
    </span>
  );
}

// Modelos (templates): campanhas, automações e reabrir conversa — a Meta cobra
// por categoria (marketing custa mais; utilidade dentro das 24 h é grátis)
function CustoModelos({ n, custoConversa, onMudou }) {
  const t = n.meses.reduce((a, m) => ({
    modelos: a.modelos + m.modelos, marketing: a.marketing + Number(m.modelos_marketing || 0), utilidade: a.utilidade + Number(m.modelos_utilidade || 0),
    gratis: a.gratis + Number(m.modelos_gratis || 0), custo: a.custo + Number(m.custo_modelos || 0), estimado: a.estimado || !!m.modelos_estimado,
  }), { modelos: 0, marketing: 0, utilidade: 0, gratis: 0, custo: 0, estimado: false });
  if (!t.modelos) return null;
  return (
    <>
      <h3 style={{ margin: '14px 0 6px', fontSize: 16 }}>Modelos (automações, campanhas e reabrir conversa)</h3>
      <div className="at-botoes" style={{ marginTop: 0, gap: 16 }}>
        <PrecoMensagem hotelId={n.hotel_id} preco={Number(n.preco_marketing ?? 0.35)} onMudou={onMudou} campo="whatsapp_preco_marketing" rotulo="Preço do modelo de marketing" />
        <PrecoMensagem hotelId={n.hotel_id} preco={Number(n.preco_utilidade ?? 0.04)} onMudou={onMudou} campo="whatsapp_preco_utilidade" rotulo="Preço do modelo de utilidade" />
      </div>
      <div className="pi-cartoes">
        <Cartao rotulo="Modelos enviados" valor={fmt(t.modelos)} detalhe={`${fmt(t.marketing)} de marketing · ${fmt(t.utilidade)} de utilidade · ${fmt(t.gratis)} grátis`} />
        <Cartao rotulo="Custo dos modelos" valor={`${t.estimado ? '≈ ' : ''}${reaisCentavos(t.custo)}`} detalhe="Marketing e utilidade cobrados pela Meta" />
        <Cartao rotulo="Custo total estimado" valor={`≈ ${reaisCentavos(custoConversa + t.custo)}`} detalhe="Conversa + modelos" />
      </div>
      <div className="at-tabela-rolagem">
        <table className="at-tabela at-tabela-previa">
          <thead><tr><th>Mês</th><th className="num">Modelos</th><th className="num">Marketing</th><th className="num">Utilidade</th><th className="num">Grátis</th><th className="num">Custo dos modelos</th></tr></thead>
          <tbody>
            {n.meses.filter((m) => m.modelos > 0).map((m) => (
              <tr key={m.mes}>
                <td>{rotuloMes(m.mes)}</td><td className="num">{inteiro.format(m.modelos)}</td><td className="num">{inteiro.format(m.modelos_marketing || 0)}</td>
                <td className="num">{inteiro.format(m.modelos_utilidade || 0)}</td><td className="num">{inteiro.format(m.modelos_gratis || 0)}</td>
                <td className="num">{m.modelos_estimado ? '≈ ' : ''}{reaisCentavos(m.custo_modelos)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {t.estimado && <p className="at-dica">“≈” nos modelos: a Meta ainda não informou a categoria de alguns; eles foram contados como marketing.</p>}
    </>
  );
}

function SecaoWhatsApp({ whatsapp, multi, hoteis, onMudou }) {
  const numeros = (whatsapp?.numeros || []).filter((n) => n.meses.length > 0);
  const franquia = Number(whatsapp?.franquia || 1000);
  const mesAtual = hojeLocal().slice(0, 7);
  if (!(whatsapp?.numeros || []).length) return null;
  return (
    <>
      <h2 className="pi-secao">📱 Mensagens de WhatsApp e custo</h2>
      <p className="at-dica" style={{ marginTop: 0 }}>
        Desde 1º/10/2026 a Meta cobra cada mensagem que o hotel envia na conversa, depois das {inteiro.format(franquia)} grátis do mês em cada número.
        Conversas que começam por anúncio (Clique para o WhatsApp) ou pelo botão da página do Facebook não são cobradas. Só administradores veem esta parte.
      </p>
      {numeros.length === 0 && <div className="at-vazio">Nenhuma mensagem de WhatsApp enviada neste período.</div>}
      {numeros.map((n) => {
        const atual = n.meses.find((m) => m.mes === mesAtual);
        const usadas = atual ? atual.entregues : 0;
        const tot = n.meses.reduce((a, m) => ({
          atendimento: a.atendimento + m.atendimento, robo: a.robo + m.robo, equipe: a.equipe + m.equipe, modelos: a.modelos + m.modelos,
          gratis_anuncio: a.gratis_anuncio + m.gratis_anuncio, cobradas: a.cobradas + m.cobradas, custo: a.custo + Number(m.custo || 0),
        }), { atendimento: 0, robo: 0, equipe: 0, modelos: 0, gratis_anuncio: 0, cobradas: 0, custo: 0 });
        const estimado = n.meses.some((m) => m.estimado && m.cobradas > 0);
        return (
          <section key={n.canal_id} className="at-cartao">
            <div className="at-canal-topo">
              <h2>{n.nome}{n.numero ? ` · ${n.numero}` : ''}{multi ? ` — ${hoteis.find((h) => h.id === n.hotel_id)?.nome || ''}` : ''}</h2>
              <PrecoMensagem hotelId={n.hotel_id} preco={Number(n.preco)} onMudou={onMudou} />
            </div>
            {atual && (
              <>
                <div className={`at-whats-barra ${usadas > franquia ? 'passou' : ''}`}><span style={{ width: `${Math.min(100, (usadas / franquia) * 100)}%` }} /></div>
                <p className="at-dica" style={{ margin: '0 0 8px' }}>
                  Este mês: {inteiro.format(usadas)} de {inteiro.format(franquia)} mensagens grátis usadas
                  {usadas > franquia ? ` — passou da franquia; a partir daqui cada mensagem custa cerca de ${reaisCentavos(n.preco)}.` : ` — faltam ${inteiro.format(franquia - usadas)}.`}
                </p>
              </>
            )}
            <div className="pi-cartoes">
              <Cartao rotulo="Mensagens enviadas" valor={fmt(tot.atendimento)} detalhe={`${fmt(tot.robo)} do robô · ${fmt(tot.equipe)} da equipe`} />
              <Cartao rotulo="Cobradas pela Meta" valor={`${estimado ? '≈ ' : ''}${fmt(tot.cobradas)}`} detalhe={`${fmt(tot.gratis_anuncio)} grátis por anúncio`} />
              <Cartao rotulo="Custo estimado" valor={`${estimado ? '≈ ' : ''}${reaisCentavos(tot.custo)}`} detalhe={`A ${reaisCentavos(n.preco)} por mensagem cobrada`} />
            </div>
            <div className="at-tabela-rolagem">
              <table className="at-tabela at-tabela-previa">
                <thead><tr><th>Mês</th><th className="num">Enviadas</th><th className="num">Robô</th><th className="num">Equipe</th><th className="num">Grátis (anúncio)</th><th className="num">Cobradas</th><th className="num">Custo</th></tr></thead>
                <tbody>
                  {n.meses.map((m) => (
                    <tr key={m.mes}>
                      <td>{rotuloMes(m.mes)}</td><td className="num">{inteiro.format(m.atendimento)}</td><td className="num">{inteiro.format(m.robo)}</td>
                      <td className="num">{inteiro.format(m.equipe)}</td><td className="num">{inteiro.format(m.gratis_anuncio)}</td>
                      <td className="num">{m.estimado && m.cobradas > 0 ? '≈ ' : ''}{inteiro.format(m.cobradas)}</td><td className="num">{reaisCentavos(m.custo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {tot.modelos > 0 && n.meses[0]?.modelos_marketing === undefined && <p className="at-dica">Também saíram {inteiro.format(tot.modelos)} modelo(s) aprovado(s) (para reabrir conversa). Esses a Meta cobra à parte, por outro preço.</p>}
            {n.meses[0]?.modelos_marketing !== undefined && <CustoModelos n={n} custoConversa={tot.custo} onMudou={onMudou} />}
          </section>
        );
      })}
      <p className="at-dica">“≈” = estimativa (mensagens antigas, de antes de a Meta informar a cobrança: conta tudo o que passou de {inteiro.format(franquia)} no mês). O preço por mensagem é aproximado: confira na fatura da Meta e ajuste em “Alterar”.</p>
    </>
  );
}

export function PainelIndicadores({ hoteis, nomes }) {
  const [hotel, setHotel] = useState('');
  const [periodo, setPeriodo] = useState('6m');
  const [de, setDe] = useState(hojeLocal().slice(0, 8) + '01');
  const [ate, setAte] = useState(hojeLocal());
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [verTabela, setVerTabela] = useState(false);
  const [recarregar, setRecarregar] = useState(0);

  const [inicio, fim] = intervalo(periodo, de, ate);
  const idsHoteis = hoteis.map((h) => h.id).join(',');

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    setErro('');
    chamarApi('/api/atendimento', { acao: 'painel', hoteis: hotel ? [Number(hotel)] : idsHoteis.split(',').map(Number), inicio, fim })
      .then((r) => { if (ativo) setDados(r.painel); })
      .catch((e) => { if (ativo) setErro(/atendimento_painel|schema cache|function/i.test(e.message) ? 'Falta rodar no Supabase o SQL da Fase 2 da Caixa de Entrada.' : e.message); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [hotel, inicio, fim, idsHoteis, recarregar]);

  const t = dados?.totais || {};
  const cot = dados?.cotacoes || null;
  const meses = dados?.meses || [];
  const seriesMes = useMemo(() => [
    { nome: 'Atendimentos', cor: CORES[0], valores: meses.map((m) => m.atendimentos) },
    { nome: 'Cotações', cor: CORES[1], valores: meses.map((m) => m.cotacoes) },
    { nome: 'Reservas', cor: CORES[2], valores: meses.map((m) => m.reservas) },
  ], [meses]);
  const horas = Array.from({ length: 24 }, (_, h) => String(h));
  const seriesHora = [{ nome: 'Atendimentos', cor: CORES[0], valores: horas.map((h) => Number(dados?.por_hora?.[h] || 0)) }];
  const canais = Object.entries(dados?.canais || {}).sort((a, b) => b[1] - a[1]);
  const maxCanal = Math.max(1, ...canais.map(([, n]) => n));
  const reservasPorAtendente = Object.fromEntries((dados?.cotacoes?.reservas_por_atendente || []).map((x) => [x.id, x.reservas]));
  const atendentes = [...(dados?.atendentes || [])];
  Object.keys(reservasPorAtendente).forEach((id) => { if (!atendentes.some((a) => String(a.id) === String(id))) atendentes.push({ id: Number(id), conversas: 0, enviadas: 0 }); });
  const hist = dados?.historico || null;
  const robo = dados?.robo || null;
  const vendas = dados?.vendas || null;
  const mesesHist = (hist?.meses || []).filter((m) => m.conversas > 0);
  const seriesHist = [
    { nome: 'Conversas', cor: CORES[0], valores: mesesHist.map((m) => m.conversas) },
    { nome: 'Cotações', cor: CORES[1], valores: mesesHist.map((m) => m.cotacoes) },
    { nome: 'Reservas', cor: CORES[2], valores: mesesHist.map((m) => m.reservas) },
  ];

  return (
    <div className={`pi ${carregando && dados ? 'pi-recarregando' : ''}`}>
      <div className="at-filtros-mais" style={{ marginBottom: 12 }}>
        <label><span>Período</span>
          <select className="at-select" value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
            <option value="mes">Este mês</option>
            <option value="passado">Mês passado</option>
            <option value="3m">Últimos 3 meses</option>
            <option value="6m">Últimos 6 meses</option>
            <option value="12m">Últimos 12 meses</option>
            <option value="ano">Este ano</option>
            <option value="24m">Últimos 24 meses</option>
            <option value="outro">Escolher datas…</option>
          </select>
        </label>
        {periodo === 'outro' && (
          <>
            <label><span>De</span><input type="date" className="at-select" value={de} max={ate} onChange={(e) => setDe(e.target.value)} /></label>
            <label><span>Até</span><input type="date" className="at-select" value={ate} min={de} onChange={(e) => setAte(e.target.value)} /></label>
          </>
        )}
        {hoteis.length > 1 && (
          <label><span>Hotel</span>
            <select className="at-select" value={hotel} onChange={(e) => setHotel(e.target.value)}>
              <option value="">Todos os hotéis</option>
              {hoteis.map((h) => <option key={h.id} value={h.id}>{h.nome}</option>)}
            </select>
          </label>
        )}
        <span className="at-dica" style={{ margin: 0 }}>{inicio.split('-').reverse().join('/')} a {fim.split('-').reverse().join('/')}</span>
      </div>

      {erro && <div className="aviso-erro">{erro}</div>}
      {!dados && carregando && <div className="at-vazio">Calculando…</div>}

      {dados && (
        <>
          <div className="pi-cartoes">
            <Cartao rotulo="Atendimentos" valor={fmt(t.atendimentos)} detalhe={`${fmt(t.contatos_novos)} contato(s) novo(s)`} />
            <Cartao rotulo="Fora do horário comercial" valor={fmt(t.fora_horario)} detalhe={`${pct(t.fora_horario, t.atendimentos)} dos atendimentos`} />
            <Cartao rotulo="Mensagens" valor={fmt(t.mensagens)} detalhe={`${fmt(t.recebidas)} recebidas · ${fmt(t.enviadas)} enviadas`} />
            <Cartao rotulo="Tempo médio da 1ª resposta" valor={minutosTexto(t.primeira_resposta_min)} detalhe={`${pct(t.respondidas, t.atendimentos)} dos atendimentos respondidos`} />
            <Cartao rotulo="Cotações" valor={fmt(t.cotacoes)} detalhe={`${pct(t.cotacoes, t.atendimentos)} dos atendimentos`} />
            <Cartao rotulo="Reservas" valor={fmt(t.reservas)} detalhe={`Conversão: ${pct(t.reservas, t.atendimentos)} dos atendimentos`} />
            <Cartao rotulo="Vieram de anúncio (AD)" valor={fmt(t.anuncios)} detalhe={`${pct(t.anuncios, t.atendimentos)} dos atendimentos`} />
          </div>

          {dados.sla && Number(dados.sla.consideradas) > 0 && <SecaoPrazo sla={dados.sla} nomes={nomes} />}

          {cot && (
            <>
              <h2 className="pi-secao">💰 Cotações pelo sistema</h2>
              <div className="pi-cartoes">
                <Cartao rotulo="Cotações enviadas" valor={fmt(cot.enviadas)} detalhe={`Total cotado: ${reaisCurto(cot.valor_cotado)}`} />
                <Cartao rotulo="Clicaram em Reservar agora" valor={fmt(cot.clicadas)} detalhe={`${pct(cot.clicadas, cot.enviadas)} das cotações`} />
                <Cartao rotulo="Reservaram" valor={fmt(cot.reservadas)} detalhe={`${pct(cot.reservadas, cot.enviadas)} das cotações · ${reaisCurto(cot.valor_reservado)}`} />
                <Cartao rotulo="Reservas ligadas a conversas" valor={fmt(cot.reservas_detectadas)} detalhe="Encontradas na Cloudbeds pelo telefone ou e-mail" />
                <Cartao rotulo="Pedidos sem disponibilidade" valor={fmt(cot.sem_disponibilidade)} detalhe="Cotações em que não havia quarto (demanda perdida)" />
                {Number(cot.outro_hotel?.enviadas) > 0 && (
                  <Cartao rotulo="🏨 Mandou para o outro hotel" valor={fmt(cot.outro_hotel.enviadas)}
                    detalhe={`Sem quarto aqui, cotou ${nomesHoteis(cot.outro_hotel.por_hotel)} · ${fmt(cot.outro_hotel.reservadas)} reservaram lá · ${reaisCurto(cot.outro_hotel.valor_reservado)}`} />
                )}
                {Number(cot.recebeu_outro_hotel?.enviadas) > 0 && (
                  <Cartao rotulo="🏨 Veio de outro hotel do grupo" valor={fmt(cot.recebeu_outro_hotel.enviadas)}
                    detalhe={`Cotações deste hotel feitas pelo ${nomesHoteis(cot.recebeu_outro_hotel.por_hotel)} · ${fmt(cot.recebeu_outro_hotel.reservadas)} reservaram · ${reaisCurto(cot.recebeu_outro_hotel.valor_reservado)}`} />
                )}
              </div>
              {(Number(cot.outro_hotel?.enviadas) > 0 || Number(cot.recebeu_outro_hotel?.enviadas) > 0) && (
                <p className="at-dica">As cotações de outro hotel do grupo ficam à parte: não entram nos números acima nem em “Vendas pelas cotações”.</p>
              )}
              {(cot.datas_sem_disponibilidade || []).length > 0 && (
                <section className="at-cartao">
                  <h2>Datas mais procuradas sem quarto disponível</h2>
                  <table className="at-tabela at-tabela-previa">
                    <thead><tr><th>Entrada</th><th>Saída</th><th className="num">Pedidos</th></tr></thead>
                    <tbody>
                      {cot.datas_sem_disponibilidade.map((d) => (
                        <tr key={`${d.checkin}-${d.checkout}`}><td>{d.checkin.split('-').reverse().join('/')}</td><td>{d.checkout.split('-').reverse().join('/')}</td><td className="num">{inteiro.format(d.pedidos)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}
            </>
          )}

          {vendas && Number(vendas.total?.cotacoes) > 0 && <SecaoVendas vendas={vendas} nomes={nomes} />}

          {robo && (
            <>
              <h2 className="pi-secao">🤖 Robô com IA</h2>
              <div className="pi-cartoes">
                <Cartao rotulo="Conversas atendidas pelo robô" valor={fmt(robo.conversas)} detalhe={`${fmt(robo.fora_horario)} fora do horário comercial · ${fmt(robo.respostas)} resposta(s)`} />
                <Cartao rotulo="Resolveu sem a equipe" valor={fmt(robo.resolveu_sozinho)} detalhe={`${pct(robo.resolveu_sozinho, robo.conversas)} das conversas · ${fmt(robo.passou_equipe)} passada(s) para a equipe`} />
                <Cartao rotulo="Cotações enviadas pelo robô" valor={fmt(robo.cotacoes)} detalhe={`${fmt(robo.cliques)} com clique em Reservar · ${fmt(robo.sem_disponibilidade)} sem quarto`} />
                <Cartao rotulo="Reservas das cotações do robô" valor={fmt(robo.reservas)} detalhe={reaisCurto(robo.valor_reservado)} />
                {Number(robo.outro_hotel?.cotacoes) > 0 && (
                  <Cartao rotulo="🏨 Robô cotou o outro hotel" valor={fmt(robo.outro_hotel.cotacoes)}
                    detalhe={`Quando não havia quarto aqui · ${fmt(robo.outro_hotel.cliques)} clique(s) · ${fmt(robo.outro_hotel.reservas)} reservaram lá · ${reaisCurto(robo.outro_hotel.valor_reservado)}`} />
                )}
                <Cartao rotulo="Solicitações registradas" valor={fmt(robo.solicitacoes)} detalhe="Grupos, pedidos especiais, reservas existentes…" />
                {robo.lacunas != null && (
                  <Cartao rotulo="Perguntas que o robô não soube" valor={fmt(robo.lacunas)} detalhe="Complete o conteúdo em Robô (IA) → Conteúdo" />
                )}
                {robo.custo_usd != null && (
                  <Cartao rotulo="Custo da IA no período" valor={Number(robo.custo_usd).toLocaleString('pt-BR', { style: 'currency', currency: 'USD' })} detalhe="Cobrado em dólar pela Anthropic (inclui testes)" />
                )}
              </div>
            </>
          )}

          {dados.automacoes && <SecaoAutomacoes dados={dados.automacoes} nomes={nomes} />}

          {dados.whatsapp && <SecaoWhatsApp whatsapp={dados.whatsapp} multi={hoteis.length > 1 && !hotel} hoteis={hoteis} onMudou={() => setRecarregar((n) => n + 1)} />}

          <section className="at-cartao">
            <div className="at-canal-topo">
              <h2>Mês a mês</h2>
              <button type="button" className="at-link-pequeno" onClick={() => setVerTabela(!verTabela)}>{verTabela ? 'Ver gráfico' : 'Ver tabela'}</button>
            </div>
            {verTabela ? (
              <div className="at-tabela-rolagem">
                <table className="at-tabela at-tabela-previa">
                  <thead><tr><th>Mês</th><th className="num">Atendimentos</th><th className="num">Fora do horário</th><th className="num">Cotações</th><th className="num">Reservas</th><th className="num">Mensagens</th></tr></thead>
                  <tbody>
                    {meses.map((m) => (
                      <tr key={m.mes}><td>{rotuloMes(m.mes)}</td><td className="num">{inteiro.format(m.atendimentos)}</td><td className="num">{inteiro.format(m.fora_horario)}</td>
                        <td className="num">{inteiro.format(m.cotacoes)}</td><td className="num">{inteiro.format(m.reservas)}</td><td className="num">{inteiro.format(m.mensagens)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <>
                <Legenda series={seriesMes} />
                <GraficoColunas titulo="Atendimentos, cotações e reservas por mês" categorias={meses.map((m) => m.mes)} series={seriesMes} rotuloCategoria={rotuloMes}
                  mostrarRotulosACada={meses.length > 12 ? 2 : 1} />
              </>
            )}
          </section>

          <div className="at-grade">
            <section className="at-cartao">
              <h2>Atendimentos por hora do dia</h2>
              <p className="at-dica" style={{ marginTop: 0 }}>Hora em que o cliente começou a conversa (horário de João Pessoa).</p>
              <GraficoColunas titulo="Atendimentos por hora do dia" categorias={horas} series={seriesHora} altura={200}
                rotuloCategoria={(h) => `${h}h`} mostrarRotulosACada={3} />
            </section>
            <section className="at-cartao">
              <h2>Por canal</h2>
              {canais.length === 0 ? <p className="at-dica">Nenhum atendimento no período.</p> : canais.map(([canal, n]) => (
                <div key={canal} className="pi-barra-linha">
                  <span className="pi-barra-nome">{ICONE_CANAL[canal]} {NOME_CANAL[canal] || canal}</span>
                  <span className="pi-barra-trilho"><span className="pi-barra" style={{ width: `${(n / maxCanal) * 100}%`, background: CORES[0] }} /></span>
                  <strong className="pi-barra-valor">{inteiro.format(n)}</strong>
                </div>
              ))}
              <h2 style={{ marginTop: 18 }}>Por atendente</h2>
              {atendentes.length === 0 ? <p className="at-dica">Ninguém respondeu no período.</p> : (
                <table className="at-tabela at-tabela-previa">
                  <thead><tr><th>Atendente</th><th className="num">Conversas (responsável)</th><th className="num">Mensagens enviadas</th><th className="num">Reservas</th></tr></thead>
                  <tbody>
                    {atendentes.map((a) => (
                      <tr key={a.id}><td>{nomes[a.id] || `Usuário #${a.id}`}</td><td className="num">{inteiro.format(a.conversas)}</td><td className="num">{inteiro.format(a.enviadas)}</td><td className="num">{inteiro.format(reservasPorAtendente[a.id] || 0)}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
          {hist && (
            <>
              <h2 className="pi-secao">📜 Histórico do Asksuite (importado)</h2>
              <p className="at-dica" style={{ marginTop: -6 }}>Números da planilha de conversas exportada do Asksuite, no período escolhido. Ficam separados para não somar duas vezes com o que já entra pelo sistema.</p>
              <div className="pi-cartoes">
                <Cartao rotulo="Conversas" valor={fmt(hist.conversas)} detalhe={`${fmt(hist.pelo_robo)} atendidas pelo robô`} />
                <Cartao rotulo="Pediram cotação" valor={fmt(hist.cotacoes)} detalhe={`${pct(hist.cotacoes, hist.conversas)} das conversas`} />
                <Cartao rotulo="Clicaram em Reservar agora" valor={fmt(hist.cliques)} detalhe={`${pct(hist.cliques, hist.cotacoes)} das cotações`} />
                <Cartao rotulo="Reservas" valor={fmt(hist.reservas)} detalhe={`${reaisCurto(hist.valor_reservado)} · ${fmt(hist.reservas_robo)} fechadas pelo robô`} />
                <Cartao rotulo="Sem disponibilidade" valor={fmt(hist.sem_disponibilidade)} detalhe={`${pct(hist.sem_disponibilidade, hist.cotacoes)} das cotações`} />
              </div>
              <div className="at-grade">
                <section className="at-cartao">
                  <h2>Mês a mês (Asksuite)</h2>
                  {mesesHist.length ? (
                    <>
                      <Legenda series={seriesHist} />
                      <GraficoColunas titulo="Conversas, cotações e reservas por mês no Asksuite" categorias={mesesHist.map((m) => m.mes)} series={seriesHist}
                        rotuloCategoria={rotuloMes} mostrarRotulosACada={mesesHist.length > 12 ? 2 : 1} />
                    </>
                  ) : <p className="at-dica">Sem conversas no período.</p>}
                </section>
                <section className="at-cartao">
                  <h2>Por canal (Asksuite)</h2>
                  <table className="at-tabela at-tabela-previa">
                    <thead><tr><th>Canal</th><th className="num">Conversas</th><th className="num">Cotações</th><th className="num">Reservas</th></tr></thead>
                    <tbody>
                      {(hist.por_fonte || []).map((f) => (
                        <tr key={f.fonte}><td>{nomeCanal(f.fonte)}</td><td className="num">{inteiro.format(f.conversas)}</td><td className="num">{inteiro.format(f.cotacoes)}</td><td className="num">{inteiro.format(f.reservas)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              </div>
            </>
          )}

          <p className="at-dica">Cotações e reservas contam as conversas com as etiquetas “Cotação” e “Reservou”. Elas entram sozinhas quando o cartão é movido para essas etapas no Quadro (ou podem ser colocadas à mão na conversa).</p>
        </>
      )}
    </div>
  );
}
