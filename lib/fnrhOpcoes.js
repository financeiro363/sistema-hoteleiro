// ============================================================================
// OPÇÕES DA FNRH — as MESMAS listas da Cloudbeds e do governo (FNRH digital)
// ============================================================================
// Uma lista só, usada no formulário do hóspede, no painel do hotel e no
// envio para a Cloudbeds — assim os textos nunca ficam diferentes de um
// lugar para outro.
//
// No banco fica guardado o CÓDIGO (ex.: "NEGOCIOS"); na tela aparece o texto.
// Os códigos seguem a lista oficial do Ministério do Turismo (FNRH digital),
// que é o que a Cloudbeds usa — confirmado pelo diagnóstico do J. R. Hotel
// (race "BRANCA", hasDisability "SIM", disabilities "FISICA",
// travelReason "NEGOCIOS", transportationMode "AUTOMOVEL").
//
// "cloudbeds" = código enviado para a Cloudbeds, quando é diferente do
// nosso. ⚠️ = código ainda não visto num diagnóstico real (seguimos a lista
// oficial do governo); se a Cloudbeds recusar, é só corrigir aqui.
// ============================================================================

export const RACAS = [
  { valor: 'ASIATICA', rotulo: 'Asiática', en: 'Asian', cloudbeds: 'AMARELA' }, // ⚠️ governo: "AMARELA"
  { valor: 'BRANCA', rotulo: 'Branca', en: 'White' },
  { valor: 'INDIGENA', rotulo: 'Indígena', en: 'Indigenous' },
  { valor: 'PARDA', rotulo: 'Parda', en: 'Mixed race' },
  { valor: 'PRETA', rotulo: 'Preta', en: 'Black' },
  { valor: 'PREFIRO_NAO_DIZER', rotulo: 'Prefiro não dizer', en: 'Prefer not to say', cloudbeds: 'NAOINFORMAR' }, // ⚠️
];

export const NECESSIDADE_ESPECIAL = [
  { valor: 'SIM', rotulo: 'Sim', en: 'Yes' },
  { valor: 'NAO', rotulo: 'Não', en: 'No' },
  { valor: 'PREFIRO_NAO_DIZER', rotulo: 'Prefiro não dizer', en: 'Prefer not to say', cloudbeds: 'NAOINFORMAR' }, // ⚠️
];

// Tipos de deficiência — lista oficial (é uma LISTA na Cloudbeds, não texto livre)
export const TIPOS_DEFICIENCIA = [
  { valor: 'FISICA', rotulo: 'Deficiência física', en: 'Physical disability' },
  { valor: 'AUDITIVA_SURDEZ', rotulo: 'Deficiência auditiva / surdez', en: 'Hearing impairment / deafness' },
  { valor: 'VISUAL', rotulo: 'Deficiência visual', en: 'Visual impairment' },
  { valor: 'INTELECTUAL', rotulo: 'Deficiência intelectual', en: 'Intellectual disability' },
  { valor: 'PSICOSSOCIAL', rotulo: 'Deficiência psicossocial (ou mental)', en: 'Psychosocial (mental) disability' },
  { valor: 'MULTIPLA', rotulo: 'Deficiência múltipla', en: 'Multiple disabilities' },
];

// Motivo da viagem — as 8 opções que a Cloudbeds mostra
export const MOTIVOS_VIAGEM = [
  { valor: 'COMPRAS', rotulo: 'Compras' },
  { valor: 'CONGRESSO_FEIRA', rotulo: 'Congresso / Feira de Negócios' },
  { valor: 'ESTUDOS_CURSOS', rotulo: 'Estudos / Cursos' },
  { valor: 'LAZER_FERIAS', rotulo: 'Lazer / Férias' },
  { valor: 'NEGOCIOS', rotulo: 'Negócios' },
  { valor: 'PARENTES_AMIGOS', rotulo: 'Parentes / Amigos' },
  { valor: 'RELIGIAO', rotulo: 'Religião' },
  { valor: 'SAUDE', rotulo: 'Saúde' },
];

// Meio de transporte — as 8 opções que a Cloudbeds mostra
export const MEIOS_TRANSPORTE = [
  { valor: 'ONIBUS', rotulo: 'Ônibus' },
  { valor: 'AUTOMOVEL', rotulo: 'Automóvel' },
  { valor: 'AVIAO', rotulo: 'Avião' },
  { valor: 'MOTOCICLETA', rotulo: 'Motocicleta', cloudbeds: 'MOTO' }, // ⚠️ governo: "MOTO"
  { valor: 'NAVIO_BARCO', rotulo: 'Navio / Barco' },
  { valor: 'A_PE', rotulo: 'A pé' }, // ⚠️
  { valor: 'BONDE_VLT', rotulo: 'Bonde (ou VLT)', cloudbeds: 'BONDE' }, // ⚠️
  { valor: 'BICICLETA', rotulo: 'Bicicleta' }, // ⚠️
];

// Códigos ANTIGOS do nosso sistema (fichas preenchidas antes desta mudança)
// → código novo. null = não existe opção equivalente na Cloudbeds.
const MOTIVO_ANTIGO = { LAZER: 'LAZER_FERIAS', EVENTOS: 'CONGRESSO_FEIRA', PARENTES: 'PARENTES_AMIGOS', OUTRO: null };
const TRANSPORTE_ANTIGO = { TREM: null, OUTRO: null };
const ROTULO_ANTIGO = { LAZER: 'Lazer', EVENTOS: 'Eventos', PARENTES: 'Visita a parentes', OUTRO: 'Outro', TREM: 'Trem' };

const achar = (lista, valor) => lista.find((o) => o.valor === valor);

export function rotuloRaca(valor) { return achar(RACAS, valor)?.rotulo || ''; }
export function rotuloNecessidade(valor) { return achar(NECESSIDADE_ESPECIAL, valor)?.rotulo || ''; }
// Fichas antigas podem ter texto livre em "necessidades especiais": mostra como está
export function rotuloDeficiencia(valor) { return achar(TIPOS_DEFICIENCIA, valor)?.rotulo || valor || ''; }
export function rotuloMotivo(valor) { return achar(MOTIVOS_VIAGEM, valor)?.rotulo || ROTULO_ANTIGO[valor] || valor || ''; }
export function rotuloTransporte(valor) { return achar(MEIOS_TRANSPORTE, valor)?.rotulo || ROTULO_ANTIGO[valor] || valor || ''; }

// ---- Códigos para a Cloudbeds -------------------------------------------
const codigo = (opcao) => (opcao ? opcao.cloudbeds || opcao.valor : null);

export function codigoCloudbedsRaca(valor) { return codigo(achar(RACAS, valor)); }
export function codigoCloudbedsNecessidade(valor) { return codigo(achar(NECESSIDADE_ESPECIAL, valor)); }

export function codigoCloudbedsDeficiencia(valor) {
  const direto = achar(TIPOS_DEFICIENCIA, valor);
  if (direto) return codigo(direto);
  // texto livre (fichas antigas): tenta reconhecer pelo conteúdo
  const t = String(valor || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (!t) return null;
  if (/multipl/.test(t)) return 'MULTIPLA';
  if (/fisic|cadeir|locomo|motor|muleta|amput/.test(t)) return 'FISICA';
  if (/auditiv|surd|ouvi/.test(t)) return 'AUDITIVA_SURDEZ';
  if (/visual|ceg|visao/.test(t)) return 'VISUAL';
  if (/intelect/.test(t)) return 'INTELECTUAL';
  if (/psico|mental/.test(t)) return 'PSICOSSOCIAL';
  return null;
}

export function codigoCloudbedsMotivo(valor) {
  if (!valor) return null;
  if (valor in MOTIVO_ANTIGO) return MOTIVO_ANTIGO[valor];
  return codigo(achar(MOTIVOS_VIAGEM, valor));
}

export function codigoCloudbedsTransporte(valor) {
  if (!valor) return null;
  if (valor in TRANSPORTE_ANTIGO) return TRANSPORTE_ANTIGO[valor];
  return codigo(achar(MEIOS_TRANSPORTE, valor));
}
