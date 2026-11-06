// ============================================================================
// FUNIL EM REAIS E META DE VENDAS (M16)
// ============================================================================
// "Vendido" = valor das reservas que vieram das cotações do sistema (status
// RESERVOU, valor da reserva na Cloudbeds), no mês em que a reserva entrou.
// "Cotado" = valor (a partir de) das cotações enviadas no mês.
// A meta é digitada pelo ADMIN, por hotel e mês (decisão do dono, 05/11/2026).
// As funções puras ficam no topo (testes); a busca no banco, no fim.
// ============================================================================

const FUSO = 'America/Fortaleza';
export const mesDe = (instante) => new Date(instante).toLocaleDateString('en-CA', { timeZone: FUSO }).slice(0, 7);
export const hojeLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: FUSO });

// '2026-09-15', '2026-11-02' → ['2026-09', '2026-10', '2026-11']
export function mesesEntre(inicio, fim) {
  const lista = [];
  let [a, m] = inicio.slice(0, 7).split('-').map(Number);
  const [af, mf] = fim.slice(0, 7).split('-').map(Number);
  while (a < af || (a === af && m <= mf)) {
    lista.push(`${a}-${String(m).padStart(2, '0')}`);
    m += 1; if (m > 12) { m = 1; a += 1; }
  }
  return lista;
}

export const diasDoMes = (mes) => { const [a, m] = mes.split('-').map(Number); return new Date(Date.UTC(a, m, 0)).getUTCDate(); };

// Mantendo o ritmo até agora, quanto o mês fecha
export function projecaoDoMes(vendido, mes, hoje = hojeLocal()) {
  if (hoje.slice(0, 7) !== mes) return null;
  const dia = Number(hoje.slice(8, 10));
  return Math.round((Number(vendido || 0) / dia) * diasDoMes(mes) * 100) / 100;
}

// Valor digitado ("15.000", "15000,50", "R$ 12 mil" não) → número ou null
export function lerValorMeta(texto) {
  const t = String(texto ?? '').replace(/[R$\s]/g, '');
  if (t === '') return null;
  const normal = /,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/[.,](?=\d{3}(\D|$))/g, '');
  const n = Number(normal);
  return Number.isFinite(n) && n >= 0 && n <= 100000000 ? Math.round(n * 100) / 100 : NaN;
}

// cotacoes:  [{ hotel_id, criado_em, valor_minimo, status, primeiro_clique_em }]  (criadas no período)
// reservas:  [{ hotel_id, reservou_em, reserva_valor }]                           (reservadas no período)
// metas:     [{ hotel_id, mes: 'AAAA-MM-01', valor }]
export function montarFunil({ inicio, fim, cotacoes = [], reservas = [], metas = [], hoje = hojeLocal() }) {
  const meses = mesesEntre(inicio, fim).map((mes) => ({ mes, cotacoes: 0, cotado: 0, clicaram: 0, valor_clicado: 0, reservas: 0, vendido: 0, meta: null }));
  const porMes = Object.fromEntries(meses.map((m) => [m.mes, m]));
  for (const c of cotacoes) {
    const m = porMes[mesDe(c.criado_em)];
    if (!m) continue;
    m.cotacoes += 1; m.cotado += Number(c.valor_minimo || 0);
    if (c.primeiro_clique_em || c.status === 'CLICOU' || c.status === 'RESERVOU') { m.clicaram += 1; m.valor_clicado += Number(c.valor_minimo || 0); }
  }
  for (const r of reservas) {
    const m = porMes[mesDe(r.reservou_em)];
    if (!m) continue;
    m.reservas += 1; m.vendido += Number(r.reserva_valor || 0);
  }
  for (const x of metas) {
    const m = porMes[String(x.mes).slice(0, 7)];
    if (m) m.meta = (m.meta || 0) + Number(x.valor || 0);
  }
  const soma = (k) => meses.reduce((s, m) => s + m[k], 0);
  const atual = porMes[hoje.slice(0, 7)] || null;
  return {
    meses,
    totais: { cotacoes: soma('cotacoes'), cotado: soma('cotado'), clicaram: soma('clicaram'), valor_clicado: soma('valor_clicado'), reservas: soma('reservas'), vendido: soma('vendido') },
    mes_atual: atual ? { ...atual, projecao: projecaoDoMes(atual.vendido, atual.mes, hoje), dia: Number(hoje.slice(8, 10)), dias: diasDoMes(atual.mes) } : null,
  };
}

// ---------------------------------------------------------------- banco (servidor)
async function todas(montar) {
  const linhas = [];
  for (let p = 0; p < 30; p += 1) {
    const { data, error } = await montar().order('id').range(p * 1000, p * 1000 + 999);
    if (error) throw error;
    linhas.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return linhas;
}

export async function funilEmReais(supabaseAdmin, hoteis, inicio, fim) {
  const de = new Date(`${inicio}T03:00:00Z`).toISOString();
  const ate = new Date(new Date(`${fim}T03:00:00Z`).getTime() + 86400000).toISOString();
  const [cotacoes, reservas] = await Promise.all([
    todas(() => supabaseAdmin.from('atendimento_cotacoes').select('id, hotel_id, criado_em, valor_minimo, status, primeiro_clique_em')
      .in('hotel_id', hoteis).gte('criado_em', de).lt('criado_em', ate)),
    todas(() => supabaseAdmin.from('atendimento_cotacoes').select('*')
      .in('hotel_id', hoteis).eq('status', 'RESERVOU').gte('reservou_em', de).lt('reservou_em', ate))
      // Reserva cancelada na Cloudbeds depois (M10) não conta como vendida
      .then((l) => l.filter((c) => !c.reserva_cancelada_em)),
  ]);
  let metas = [];
  let semTabela = false;
  const { data, error } = await supabaseAdmin.from('atendimento_metas').select('hotel_id, mes, valor')
    .in('hotel_id', hoteis).gte('mes', `${inicio.slice(0, 7)}-01`).lte('mes', `${fim.slice(0, 7)}-01`);
  if (error) semTabela = true; else metas = data || [];
  return { ...montarFunil({ inicio, fim, cotacoes, reservas, metas }), sem_tabela_metas: semTabela };
}
