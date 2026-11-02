// ============================================================================
// GOVERNANÇA — escala do dia, distribuição dos quartos e vistoria (sem segredo)
// ============================================================================
// Distribuição:
//   - entram os quartos para arrumar hoje (lista da camareira) e os de
//     "Previsão de saída" (viram saída no check-out); quem já está sendo
//     arrumado continua com quem entrou
//   - cada quarto vai para uma camareira presente que cobre o andar dele;
//     camareira presente sem andar marcado ajuda em qualquer andar
//   - andar sem ninguém: vai para quem estiver com menos trabalho
//   - entre as possíveis, ganha quem está com menos trabalho (saída pesa 2,
//     quarto com hóspede pesa 1)
// ============================================================================

import { precisaArrumar, compararNumero } from './regras';

export const PESO = { SAIDA: 2, OCUPADO: 1 };

// Andar: o que estiver cadastrado no quarto; senão, o número sem os dois
// últimos dígitos (203 → 2, 1004 → 10, 12 → 0 = térreo).
export function andarDoQuarto(q) {
  if (q?.andar !== null && q?.andar !== undefined && q?.andar !== '' && Number.isFinite(Number(q.andar))) return Number(q.andar);
  const m = String(q?.numero ?? '').match(/\d+/);
  if (!m) return null;
  const n = m[0];
  return n.length >= 3 ? Number(n.slice(0, n.length - 2)) : 0;
}

export function nomeDoAndar(andar) {
  if (andar === null || andar === undefined) return 'Sem andar';
  if (Number(andar) === 0) return 'Térreo';
  if (Number(andar) < 0) return `Subsolo ${Math.abs(andar)}`;
  return `${andar}º andar`;
}

export function tipoDoQuarto(q) {
  const e = q?.estado_apartamento;
  return !e || e === 'SAIDA_SUJO' || e === 'LIMPO' || e === 'PREVISAO_SAIDA_OCUPADO' ? 'SAIDA' : 'OCUPADO';
}

export function entraNaDistribuicao(q) {
  if (!q) return false;
  if (q.status === 'EM_ARRUMACAO' || q.status === 'MANUTENCAO') return false;
  return precisaArrumar(q) || q.estado_apartamento === 'PREVISAO_SAIDA_OCUPADO';
}

export function andaresDosQuartos(quartos) {
  return [...new Set((quartos || []).map(andarDoQuarto).filter((a) => a !== null))].sort((a, b) => a - b);
}

// Escala sugerida: a de hoje, se já foi salva; senão a do último dia salvo;
// camareira nova entra presente e sem andar.
export function escalaSugerida(camareiras, registros, hoje) {
  const deHoje = (registros || []).filter((r) => r.data === hoje);
  const anteriores = (registros || []).filter((r) => r.data < hoje).sort((a, b) => (a.data < b.data ? 1 : -1));
  const ultimoDia = anteriores[0]?.data || null;
  const base = deHoje.length ? deHoje : anteriores.filter((r) => r.data === ultimoDia);
  const linhas = (camareiras || []).map((c) => {
    const r = base.find((x) => Number(x.camareira_id) === Number(c.id));
    return {
      camareira_id: c.id, camareira_nome: c.nome,
      presente: r ? !!r.presente : true,
      andares: r ? [...(r.andares || [])].map(Number).sort((a, b) => a - b) : [],
    };
  });
  return { linhas, salvaHoje: deHoje.length > 0, copiadaDe: deHoje.length ? null : ultimoDia };
}

// Devolve { erro } ou { porCamareira, mudancas, andaresSemNinguem, total }
//   porCamareira: [{ camareira_id, camareira_nome, andares, quartos: [...], saidas, ocupados, carga, emAndamento }]
//   mudancas: [{ quarto, de, para }] — só os quartos que trocam de camareira
export function distribuir(quartos, escala) {
  const presentes = (escala || []).filter((e) => e.presente);
  if (!presentes.length) return { erro: 'Marque na escala quem veio trabalhar hoje.' };

  const grupos = presentes.map((e) => ({
    camareira_id: e.camareira_id, camareira_nome: e.camareira_nome, andares: [...(e.andares || [])],
    quartos: [], saidas: 0, ocupados: 0, carga: 0, emAndamento: 0,
  }));
  const grupoDe = (id) => grupos.find((g) => Number(g.camareira_id) === Number(id));

  // Quem já entrou num quarto continua com ele (e isso conta no trabalho dela)
  for (const q of quartos || []) {
    if (q.status !== 'EM_ARRUMACAO') continue;
    const g = grupoDe(q.camareira_id);
    if (g) { g.carga += PESO[tipoDoQuarto(q)]; g.emAndamento += 1; }
  }

  // Quem pode ficar com cada quarto: as do andar + as sem andar (volantes);
  // andar sem ninguém → todas
  const andaresSemNinguem = new Set();
  const alvo = (quartos || []).filter(entraNaDistribuicao).map((q) => {
    const andar = andarDoQuarto(q);
    let possiveis = grupos.filter((g) => g.andares.length === 0 || g.andares.includes(andar));
    if (!possiveis.length) { possiveis = grupos; andaresSemNinguem.add(andar); }
    return { q, possiveis, peso: PESO[tipoDoQuarto(q)] };
  });
  // Primeiro os quartos com menos opções, depois os mais pesados: assim a
  // divisão do que sobra (andar sem ninguém) já enxerga o trabalho de cada uma
  alvo.sort((a, b) => (a.possiveis.length - b.possiveis.length) || (b.peso - a.peso) || compararNumero(a.q.numero, b.q.numero));

  const mudancas = [];
  for (const { q, possiveis, peso } of alvo) {
    const escolhida = [...possiveis].sort((a, b) =>
      (a.carga - b.carga) || (a.quartos.length - b.quartos.length)
      || (Number(Number(b.camareira_id) === Number(q.camareira_id)) - Number(Number(a.camareira_id) === Number(q.camareira_id)))
      || String(a.camareira_nome).localeCompare(String(b.camareira_nome), 'pt-BR'))[0];
    escolhida.quartos.push(q);
    escolhida.carga += peso;
    if (tipoDoQuarto(q) === 'SAIDA') escolhida.saidas += 1; else escolhida.ocupados += 1;
    if (Number(q.camareira_id) !== Number(escolhida.camareira_id)) mudancas.push({ quarto: q, de: q.camareira_id ?? null, para: escolhida.camareira_id });
  }
  grupos.forEach((g) => g.quartos.sort((a, b) => compararNumero(a.numero, b.numero)));
  return {
    porCamareira: grupos,
    mudancas,
    andaresSemNinguem: [...andaresSemNinguem].filter((a) => a !== null).sort((a, b) => a - b),
    total: alvo.length,
  };
}

// ---- Vistoria -----------------------------------------------------------------

export const ITENS_VISTORIA = [
  { chave: 'cama', rotulo: 'Cama arrumada e enxoval sem manchas' },
  { chave: 'banheiro', rotulo: 'Banheiro limpo (vaso, pia, box, espelho)' },
  { chave: 'toalhas', rotulo: 'Toalhas e amenities repostos' },
  { chave: 'piso', rotulo: 'Piso e móveis sem poeira' },
  { chave: 'lixo', rotulo: 'Lixeiras vazias' },
  { chave: 'frigobar', rotulo: 'Frigobar conferido' },
  { chave: 'equipamentos', rotulo: 'TV, ar e luzes funcionando' },
  { chave: 'cheiro', rotulo: 'Cheiro agradável e quarto ventilado' },
];

export function resultadoDaVistoria(marcados) {
  const falhas = ITENS_VISTORIA.filter((i) => marcados?.[i.chave] === false);
  return { aprovado: falhas.length === 0, falhas };
}

export function textoRefazer(falhas, observacao) {
  const partes = falhas.map((f) => f.rotulo.split(' (')[0].toLowerCase());
  const obs = String(observacao || '').trim();
  return `Refazer: ${partes.join(', ') || 'ver com a governanta'}${obs ? ` — ${obs}` : ''}`.slice(0, 140);
}

// Quartos limpos hoje cuja última arrumação ainda não foi vistoriada
export function paraVistoriar(quartos, sessoes, vistorias, hoje, diaDe) {
  const vistas = new Set((vistorias || []).map((v) => String(v.sessao_id)).filter((x) => x !== 'null' && x !== 'undefined'));
  const ultimaPorQuarto = {};
  for (const s of sessoes || []) {
    if (!s.fim_em || s.cancelada || diaDe(s.fim_em) !== hoje) continue;
    const atual = ultimaPorQuarto[s.quarto_id];
    if (!atual || s.fim_em > atual.fim_em) ultimaPorQuarto[s.quarto_id] = s;
  }
  return (quartos || [])
    .filter((q) => q.status === 'LIMPO' && ultimaPorQuarto[q.id] && !vistas.has(String(ultimaPorQuarto[q.id].id)))
    .map((q) => ({ quarto: q, sessao: ultimaPorQuarto[q.id] }))
    .sort((a, b) => compararNumero(a.quarto.numero, b.quarto.numero));
}

// ---- Produtividade ------------------------------------------------------------
// Arrumação esquecida aberta (mais de 4 h) conta no total, mas fica fora da média.
export const LIMITE_MEDIA_MIN = 240;

function novoBalde() { return { n: 0, soma: 0 }; }
function somar(balde, min) {
  if (Number.isFinite(min) && min > 0 && min <= LIMITE_MEDIA_MIN) { balde.n += 1; balde.soma += min; }
}
export function media(balde) { return balde.n ? balde.soma / balde.n : 0; }

export function resumoProdutividade(sessoes, vistorias, nomeDe = () => null) {
  const camareiras = {}; const quartos = {}; const geral = novoBalde(); let total = 0;
  for (const s of sessoes || []) {
    if (!s.fim_em || s.cancelada) continue;
    total += 1;
    const min = Number(s.duracao_minutos);
    const chave = s.camareira_id ?? s.camareira_nome ?? '—';
    const c = (camareiras[chave] ||= { chave, nome: nomeDe(s.camareira_id) || s.camareira_nome || '—', total: 0, tudo: novoBalde(), SAIDA: novoBalde(), OCUPADO: novoBalde(), saidas: 0, ocupados: 0, aprovadas: 0, reprovadas: 0 });
    c.total += 1;
    somar(c.tudo, min); somar(geral, min);
    if (s.tipo === 'SAIDA') { c.saidas += 1; somar(c.SAIDA, min); }
    if (s.tipo === 'OCUPADO') { c.ocupados += 1; somar(c.OCUPADO, min); }
    const q = (quartos[s.quarto_numero] ||= { numero: s.quarto_numero, total: 0, tudo: novoBalde() });
    q.total += 1; somar(q.tudo, min);
  }
  for (const v of vistorias || []) {
    const chave = v.camareira_id ?? v.camareira_nome ?? '—';
    const c = camareiras[chave];
    if (!c) continue;
    if (v.resultado === 'APROVADO') c.aprovadas += 1; else c.reprovadas += 1;
  }
  return {
    total,
    mediaGeral: media(geral),
    porCamareira: Object.values(camareiras).sort((a, b) => (b.total - a.total) || (media(a.tudo) - media(b.tudo))),
    porQuarto: Object.values(quartos).filter((q) => q.tudo.n > 0).sort((a, b) => media(b.tudo) - media(a.tudo)),
  };
}
