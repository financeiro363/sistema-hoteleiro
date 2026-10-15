// ============================================================================
// OPÇÕES DA FNRH: RAÇA E NECESSIDADE ESPECIAL
// ============================================================================
// Uma lista só, usada no formulário do hóspede, no painel do hotel, na
// impressão da ficha e no envio para a Cloudbeds — assim os textos nunca
// ficam diferentes de um lugar para outro.
//
// No banco fica guardado o CÓDIGO (ex.: "PARDA"); na tela aparece o texto.
// ============================================================================

export const RACAS = [
  { valor: 'ASIATICA', rotulo: 'Asiática', en: 'Asian' },
  { valor: 'BRANCA', rotulo: 'Branca', en: 'White' },
  { valor: 'INDIGENA', rotulo: 'Indígena', en: 'Indigenous' },
  { valor: 'PARDA', rotulo: 'Parda', en: 'Mixed race' },
  { valor: 'PRETA', rotulo: 'Preta', en: 'Black' },
  { valor: 'PREFIRO_NAO_DIZER', rotulo: 'Prefiro não dizer', en: 'Prefer not to say' },
];

export const NECESSIDADE_ESPECIAL = [
  { valor: 'SIM', rotulo: 'Sim', en: 'Yes' },
  { valor: 'NAO', rotulo: 'Não', en: 'No' },
  { valor: 'PREFIRO_NAO_DIZER', rotulo: 'Prefiro não dizer', en: 'Prefer not to say' },
];

export function rotuloRaca(valor) {
  return RACAS.find((r) => r.valor === valor)?.rotulo || '';
}

export function rotuloNecessidade(valor) {
  return NECESSIDADE_ESPECIAL.find((n) => n.valor === valor)?.rotulo || '';
}
