// ============================================================================
// CAMPOS DO GOVERNO NA CLOUDBEDS (FNRH) — "guestRequirements"
// ============================================================================
// Na Cloudbeds, os campos da ficha do governo brasileiro (os que têm o ícone
// de prédio 🏛 na tela) NÃO são campos personalizados: ficam num bloco
// separado chamado "guestRequirements". Os NOMES abaixo foram confirmados
// pelo diagnóstico do J. R. Hotel (reserva 8254250967406, outubro/2026):
//
//   race, hasDisability, disabilities, travelReason, transportationMode,
//   neighborhood (bairro), stateBrazil, cityBrazil, state, city,
//   guestTaxIdNumber (Número de Identificação Fiscal = CPF)
//
// Os VALORES são códigos (ex.: "BRANCA", "SIM", "FISICA", "NEGOCIOS") —
// a conversão fica em lib/fnrhOpcoes.js.
//
// Depois do envio, o sistema lê de novo e confere o que realmente gravou.
// ============================================================================

import {
  codigoCloudbedsRaca, codigoCloudbedsNecessidade, codigoCloudbedsDeficiencia,
  codigoCloudbedsMotivo, codigoCloudbedsTransporte,
} from './fnrhOpcoes';

export const NOME_CAMPO_PT = {
  race: 'Raça',
  hasDisability: 'Possui uma necessidade especial',
  disabilities: 'Necessidades especiais',
  travelReason: 'Motivo da viagem',
  transportationMode: 'Meio de transporte',
  neighborhood: 'Bairro',
  stateBrazil: 'Estado',
  cityBrazil: 'Cidade',
  state: 'Estado (texto)',
  city: 'Cidade (texto)',
  guestTaxIdNumber: 'Número de Identificação Fiscal (CPF)',
};

// Hóspede estrangeiro usa "tipo de viagem" no lugar do motivo
const TIPO_VIAGEM_PARA_MOTIVO = {
  TURISMO: 'LAZER_FERIAS', TRABALHO_NEGOCIOS: 'NEGOCIOS', ESTUDO_CONGRESSO: 'ESTUDOS_CURSOS', OUTROS: null,
};

// Monta o bloco a enviar.
//   ficha: a linha de fichas_fnrh
//   endereco: { uf, ibge, cidade, bairro } — vindo da consulta do CEP
// Devolve { envio: [ {campo: valor, ...} ] | null, enviados: [{ campo, valor }] }
export function montarRequisitos(ficha, endereco = {}) {
  const ehPassaporte = ficha.tipo_documento === 'PASSAPORTE';
  const motivo = ehPassaporte && ficha.tipo_viagem_estrangeiro
    ? TIPO_VIAGEM_PARA_MOTIVO[ficha.tipo_viagem_estrangeiro]
    : codigoCloudbedsMotivo(ficha.motivo_viagem);

  const valores = {
    race: codigoCloudbedsRaca(ficha.raca),
    hasDisability: codigoCloudbedsNecessidade(ficha.possui_necessidade_especial),
    disabilities: ficha.possui_necessidade_especial === 'SIM' ? codigoCloudbedsDeficiencia(ficha.necessidades_especiais) : null,
    travelReason: motivo,
    transportationMode: codigoCloudbedsTransporte(ficha.meio_transporte),
  };

  // Endereço brasileiro: Estado pela sigla (ex.: "PB") e Cidade pelo NOME
  // (ex.: "João Pessoa"), com acento, como os Correios informam pelo CEP.
  // ⚠️ Não mandar o código IBGE da cidade: a Cloudbeds mostra o número
  // em vez do nome (visto no J. R. Hotel em 15/10/2026: "2507507").
  if (!ehPassaporte) {
    const uf = (endereco.uf || (/^[A-Z]{2}$/i.test(ficha.estado || '') ? ficha.estado : '') || '').toUpperCase();
    const nomeCidade = endereco.cidade || ficha.cidade || null;
    Object.assign(valores, {
      neighborhood: ficha.bairro || endereco.bairro || null,
      stateBrazil: uf || null,
      cityBrazil: nomeCidade,
      state: uf || null,
      city: nomeCidade,
      guestTaxIdNumber: ficha.tipo_documento === 'CPF' ? String(ficha.numero_documento || '').replace(/\D/g, '') || null : null,
    });
  }

  const enviados = Object.entries(valores)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([campo, valor]) => ({ campo, valor }));
  if (enviados.length === 0) return { envio: null, enviados };
  return { envio: [Object.fromEntries(enviados.map((e) => [e.campo, e.valor]))], enviados };
}

// Depois do envio: o que realmente ficou gravado?
export function conferirRequisitos(requisitosDepois, enviados) {
  const atual = requisitosDepois && typeof requisitosDepois === 'object' && !Array.isArray(requisitosDepois) ? requisitosDepois : {};
  const limpo = (v) => String(v ?? '').trim().toUpperCase();
  return enviados.map((e) => ({
    campo: e.campo, enviado: e.valor, gravado: atual[e.campo] ?? null, ok: limpo(atual[e.campo]) === limpo(e.valor),
  }));
}

// ---- Para a ferramenta de diagnóstico --------------------------------------
// Mostra, dos campos que a Cloudbeds devolveu, quais são os que o sistema usa.
export function lerVagas(requisitos) {
  if (!requisitos || typeof requisitos !== 'object' || Array.isArray(requisitos)) return [];
  return Object.keys(NOME_CAMPO_PT)
    .filter((nome) => nome in requisitos)
    .map((nome) => ({ campo: nome, nome, valorAtual: requisitos[nome] }));
}
