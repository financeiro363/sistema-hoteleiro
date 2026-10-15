// ============================================================================
// CAMPOS DO GOVERNO NA CLOUDBEDS (FNRH) — "guestRequirements"
// ============================================================================
// Na Cloudbeds, os campos da ficha do governo brasileiro (os que têm o ícone
// de prédio 🏛 na tela: Raça, Possui uma necessidade especial, Necessidades
// especiais, Motivo da viagem, Meio de transporte...) NÃO são campos
// personalizados: eles ficam num bloco separado chamado "guestRequirements"
// (requisitos do hóspede), ligado ao modelo de ficha do país.
//
// A Cloudbeds não publica os nomes internos desses campos. Por isso este
// arquivo:
//   1) lê o bloco "guestRequirements" que a Cloudbeds devolve para o hóspede
//      e descobre, PELO NOME, qual campo é qual (raça, deficiência...);
//   2) monta o envio nesses mesmos nomes;
//   3) depois do envio, confere o que realmente gravou.
//
// Se um dia os nomes forem confirmados (pela ferramenta de diagnóstico do
// painel), é só colocá-los em NOMES_CONFIRMADOS abaixo — eles passam a ter
// prioridade sobre a descoberta automática.
// ============================================================================

import { rotuloRaca, rotuloNecessidade } from './fnrhOpcoes';

// Preencher quando os nomes reais forem confirmados no diagnóstico.
// Ex.: { raca: 'race', possuiNecessidade: 'hasDisability', ... }
export const NOMES_CONFIRMADOS = {};

const MOTIVO_VIAGEM_TEXTO = { LAZER: 'Lazer', NEGOCIOS: 'Negócios', EVENTOS: 'Eventos', PARENTES: 'Visita a parentes', SAUDE: 'Saúde', OUTRO: 'Outro' };
const MEIO_TRANSPORTE_TEXTO = { AVIAO: 'Avião', AUTOMOVEL: 'Automóvel', ONIBUS: 'Ônibus', TREM: 'Trem', OUTRO: 'Outro' };

// Nome "limpo" para comparar: minúsculo, sem acento, só letras e números
function normalizar(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Qual dos NOSSOS campos um nome da Cloudbeds representa (ou null)
export function identificarCampo(nome) {
  const n = normalizar(nome);
  if (!n) return null;
  if (/transport/.test(n)) return 'meioTransporte';
  if (/travelreason|reasonfortravel|tripreason|travelpurpose|purposeoftravel|tripurpose|motivo/.test(n)) return 'motivoViagem';
  if (/^(has|is|possui|tem)/.test(n) && /disab|deficien|specialneed|necessidade/.test(n)) return 'possuiNecessidade';
  if (/disab|deficien|specialneed|necessidade/.test(n)) return 'necessidades';
  if (/race|raca|ethnic|etnia|skincolor|cordapele/.test(n)) return 'raca';
  return null;
}

// Transforma o que a Cloudbeds devolveu numa lista de "vagas":
//   { campo (nosso), nome (da Cloudbeds), valorAtual, formato }
// Aceita os dois formatos mais comuns:
//   a) objeto simples: { race: 'x', hasDisability: true, ... }
//   b) lista de itens: [{ name|key|field|id: 'race', value: 'x' }, ...]
export function lerVagas(requisitos) {
  const vagas = [];
  if (!requisitos) return vagas;
  const lista = Array.isArray(requisitos) ? requisitos : null;
  if (lista) {
    lista.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const chaveId = ['name', 'key', 'field', 'fieldName', 'id', 'code'].find((k) => typeof item[k] === 'string' && item[k]);
      if (!chaveId) return;
      const campo = identificarCampo(item[chaveId]);
      if (campo) vagas.push({ campo, nome: item[chaveId], valorAtual: item.value ?? null, formato: 'lista', chaveId });
    });
    return vagas;
  }
  if (typeof requisitos === 'object') {
    Object.entries(requisitos).forEach(([nome, valor]) => {
      const campo = identificarCampo(nome);
      if (campo) vagas.push({ campo, nome, valorAtual: valor && typeof valor === 'object' && 'value' in valor ? valor.value : valor, formato: 'objeto' });
    });
  }
  return vagas;
}

// O valor de cada campo, a partir da ficha. Respeita o "jeito" do valor que
// já estava lá (ex.: se a Cloudbeds usa verdadeiro/falso para "possui
// deficiência", mandamos verdadeiro/falso).
function valorPara(campo, ficha, valorAtual) {
  switch (campo) {
    case 'raca':
      return ficha.raca ? rotuloRaca(ficha.raca) : null;
    case 'possuiNecessidade': {
      const r = ficha.possui_necessidade_especial;
      if (!r) return null;
      if (typeof valorAtual === 'boolean') return r === 'SIM' ? true : r === 'NAO' ? false : null;
      if (valorAtual === 0 || valorAtual === 1 || valorAtual === '0' || valorAtual === '1') return r === 'SIM' ? '1' : r === 'NAO' ? '0' : null;
      return rotuloNecessidade(r);
    }
    case 'necessidades':
      return ficha.possui_necessidade_especial === 'SIM' ? (ficha.necessidades_especiais || null) : null;
    case 'motivoViagem':
      return MOTIVO_VIAGEM_TEXTO[ficha.motivo_viagem] || ficha.motivo_viagem || null;
    case 'meioTransporte':
      return MEIO_TRANSPORTE_TEXTO[ficha.meio_transporte] || ficha.meio_transporte || null;
    default:
      return null;
  }
}

// Monta o que vai no envio. Devolve:
//   envio: o bloco pronto (mesmo formato que a Cloudbeds usa), ou null
//   enviados: [{ campo, nome, valor }]
export function montarRequisitos(requisitosAtuais, ficha) {
  let vagas = lerVagas(requisitosAtuais);

  // Nomes confirmados têm prioridade (e funcionam mesmo se a Cloudbeds
  // devolver o bloco vazio)
  Object.entries(NOMES_CONFIRMADOS).forEach(([campo, nome]) => {
    if (!nome) return;
    vagas = vagas.filter((v) => v.campo !== campo);
    vagas.push({ campo, nome, valorAtual: null, formato: Array.isArray(requisitosAtuais) ? 'lista' : 'objeto', chaveId: 'name' });
  });

  const enviados = [];
  vagas.forEach((v) => {
    const valor = valorPara(v.campo, ficha, v.valorAtual);
    if (valor === null || valor === undefined || valor === '') return;
    enviados.push({ ...v, valor });
  });
  if (enviados.length === 0) return { envio: null, enviados };

  const emLista = enviados.some((e) => e.formato === 'lista');
  const envio = emLista
    ? enviados.map((e) => ({ [e.chaveId || 'name']: e.nome, value: e.valor }))
    : [Object.fromEntries(enviados.map((e) => [e.nome, e.valor]))];
  return { envio, enviados };
}

// Depois do envio: o que realmente ficou gravado?
export function conferirRequisitos(requisitosDepois, enviados) {
  const vagasDepois = lerVagas(requisitosDepois);
  const igual = (a, b) => normalizar(String(a)) === normalizar(String(b));
  return enviados.map((e) => {
    const achado = vagasDepois.find((v) => v.nome === e.nome);
    return { campo: e.campo, nome: e.nome, enviado: e.valor, gravado: achado ? achado.valorAtual : null, ok: !!achado && igual(achado.valorAtual, e.valor) };
  });
}

export const NOME_CAMPO_PT = {
  raca: 'Raça',
  possuiNecessidade: 'Possui uma necessidade especial',
  necessidades: 'Necessidades especiais',
  motivoViagem: 'Motivo da viagem',
  meioTransporte: 'Meio de transporte',
};
