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
export function PainelIndicadores({ hoteis, nomes }) {
  const [hotel, setHotel] = useState('');
  const [periodo, setPeriodo] = useState('6m');
  const [de, setDe] = useState(hojeLocal().slice(0, 8) + '01');
  const [ate, setAte] = useState(hojeLocal());
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [verTabela, setVerTabela] = useState(false);

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
  }, [hotel, inicio, fim, idsHoteis]);

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

          {cot && (
            <>
              <h2 className="pi-secao">💰 Cotações pelo sistema</h2>
              <div className="pi-cartoes">
                <Cartao rotulo="Cotações enviadas" valor={fmt(cot.enviadas)} detalhe={`Total cotado: ${reaisCurto(cot.valor_cotado)}`} />
                <Cartao rotulo="Clicaram em Reservar agora" valor={fmt(cot.clicadas)} detalhe={`${pct(cot.clicadas, cot.enviadas)} das cotações`} />
                <Cartao rotulo="Reservaram" valor={fmt(cot.reservadas)} detalhe={`${pct(cot.reservadas, cot.enviadas)} das cotações · ${reaisCurto(cot.valor_reservado)}`} />
                <Cartao rotulo="Reservas ligadas a conversas" valor={fmt(cot.reservas_detectadas)} detalhe="Encontradas na Cloudbeds pelo telefone ou e-mail" />
                <Cartao rotulo="Pedidos sem disponibilidade" valor={fmt(cot.sem_disponibilidade)} detalhe="Cotações em que não havia quarto (demanda perdida)" />
              </div>
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
