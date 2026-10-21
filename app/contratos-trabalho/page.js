'use client';

// ============================================================================
// CONTRATOS DE TRABALHO (Administração → Contratos de Trabalho) — SÓ ADMIN
// ============================================================================
// O administrador preenche os dados do novo colaborador e o sistema monta,
// prontos para imprimir:
//   1) Contrato Individual de Trabalho a Título de Experiência
//   2) Manual de Procedimentos Internos (9 páginas)
//   3) Termo de Ciência e Aceite do Manual, já com nome e data
//
// - Os contratos ficam salvos (tabela contratos_trabalho) para reabrir,
//   corrigir e reimprimir. Só ADMIN do hotel vê (RLS no banco + checagem aqui).
// - Os dados do hotel (empregador) e as "outras informações" ficam salvos como
//   padrão do hotel (tabela contratos_trabalho_config) e já vêm preenchidos.
// - Campo vazio sai na impressão como linha em branco, para preencher à mão.
// - Textos: lib/contratoExperienciaModelo.js e lib/manualProcedimentosModelo.js
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { bloquearSeNaoPermitido } from '../../lib/restricaoAcesso';
import { buscarTodos } from '../../lib/buscarTodos';
import { formatarDocumento, validarCPF, validarCNPJ } from '../../lib/validarDocumento';
import {
  reaisPorExtenso, numeroPorExtenso, lerValorDinheiro, formatarDinheiro, soDigitos,
  formatarCPF, formatarPIS, validarPIS, formatarCEP, formatarTelefone,
  hojeFortaleza, dataCurta, dataPorExtenso, somarDias, diasEntre,
} from '../../lib/contratoTrabalhoUtil';
import { MANUAL_VERSAO_PADRAO } from '../../lib/manualProcedimentosModelo';
import {
  ContratoExperiencia, ManualProcedimentos, ajustarPaginasManual, ESTILOS_DOCUMENTOS,
} from '../components/DocumentosContratoTrabalho';

const PISO_SALARIAL = 1665.0; // CCT 2026/2028 (a partir de 01/05/2026)

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB',
  'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const ESTADOS_CIVIS = ['solteiro(a)', 'casado(a)', 'união estável', 'divorciado(a)', 'separado(a) judicialmente', 'viúvo(a)'];

// Campos que ficam salvos como "padrão do hotel"
const CAMPOS_DO_HOTEL = [
  'EMPREGADOR_RAZAO_SOCIAL', 'EMPREGADOR_NOME_FANTASIA', 'EMPREGADOR_CNPJ', 'EMPREGADOR_CEP',
  'EMPREGADOR_LOGRADOURO', 'EMPREGADOR_NUMERO', 'EMPREGADOR_BAIRRO', 'EMPREGADOR_CIDADE', 'EMPREGADOR_UF',
  'EMPREGADOR_REPRESENTANTE_LEGAL', 'CANAL_DENUNCIAS', 'EMAIL_ENCARREGADO_LGPD', 'MANUAL_VERSAO',
  'MANUAL_PAGINAS', 'EMPRESA_SOCIOS_COMUNS_RAZAO_SOCIAL', 'EMPRESA_SOCIOS_COMUNS_CNPJ',
];

const CAMPOS_DO_COLABORADOR = [
  'EMPREGADO_NOME', 'EMPREGADO_NACIONALIDADE', 'EMPREGADO_ESTADO_CIVIL', 'EMPREGADO_CPF', 'EMPREGADO_RG',
  'EMPREGADO_CTPS_NUMERO', 'EMPREGADO_CTPS_SERIE', 'EMPREGADO_PIS', 'EMPREGADO_CEP', 'EMPREGADO_ENDERECO',
  'EMPREGADO_BAIRRO', 'EMPREGADO_CIDADE', 'EMPREGADO_UF', 'EMPREGADO_EMAIL', 'EMPREGADO_TELEFONE',
  'EMPREGADO_EMAIL_CONTRACHEQUE', 'FUNCAO', 'CBO', 'SETOR', 'SALARIO_VALOR', 'DESCRICAO_ATRIBUICOES',
  'EXPERIENCIA_DIAS', 'EXPERIENCIA_INICIO', 'EXPERIENCIA_TERMINO', 'PRORROGACAO_DIAS', 'PRORROGACAO_TERMINO',
  'PRORROGACAO_DATA_ASSINATURA', 'DATA_ASSINATURA',
];

// Nome de cada campo (para os avisos de "campo vazio")
const ROTULOS = {
  EMPREGADOR_RAZAO_SOCIAL: 'Razão social do hotel', EMPREGADOR_NOME_FANTASIA: 'Nome fantasia',
  EMPREGADOR_CNPJ: 'CNPJ do hotel', EMPREGADOR_CEP: 'CEP do hotel', EMPREGADOR_LOGRADOURO: 'Rua do hotel',
  EMPREGADOR_NUMERO: 'Número do hotel', EMPREGADOR_BAIRRO: 'Bairro do hotel', EMPREGADOR_CIDADE: 'Cidade do hotel',
  EMPREGADOR_UF: 'UF do hotel', EMPREGADOR_REPRESENTANTE_LEGAL: 'Representante legal',
  EMPREGADO_NOME: 'Nome do colaborador', EMPREGADO_NACIONALIDADE: 'Nacionalidade', EMPREGADO_ESTADO_CIVIL: 'Estado civil',
  EMPREGADO_CPF: 'CPF', EMPREGADO_RG: 'RG', EMPREGADO_CTPS_NUMERO: 'Nº da Carteira de Trabalho',
  EMPREGADO_CTPS_SERIE: 'Série da Carteira de Trabalho', EMPREGADO_PIS: 'PIS/NIS', EMPREGADO_CEP: 'CEP do colaborador',
  EMPREGADO_ENDERECO: 'Endereço do colaborador', EMPREGADO_BAIRRO: 'Bairro do colaborador',
  EMPREGADO_CIDADE: 'Cidade do colaborador', EMPREGADO_UF: 'UF do colaborador', EMPREGADO_EMAIL: 'E-mail',
  EMPREGADO_TELEFONE: 'Telefone', EMPREGADO_EMAIL_CONTRACHEQUE: 'E-mail do contracheque',
  FUNCAO: 'Função', CBO: 'CBO', SETOR: 'Setor', SALARIO_VALOR: 'Salário', DESCRICAO_ATRIBUICOES: 'Atribuições da função',
  EXPERIENCIA_DIAS: 'Dias de experiência', EXPERIENCIA_INICIO: 'Início da experiência', EXPERIENCIA_TERMINO: 'Término da experiência',
  PRORROGACAO_DIAS: 'Dias da prorrogação', PRORROGACAO_TERMINO: 'Término da prorrogação',
  CANAL_DENUNCIAS: 'Canal de denúncias', EMAIL_ENCARREGADO_LGPD: 'E-mail do encarregado LGPD',
  MANUAL_VERSAO: 'Versão do manual', MANUAL_PAGINAS: 'Páginas do manual',
  EMPRESA_SOCIOS_COMUNS_RAZAO_SOCIAL: 'Empresa com sócios em comum', EMPRESA_SOCIOS_COMUNS_CNPJ: 'CNPJ da empresa com sócios em comum',
  DATA_ASSINATURA: 'Data de assinatura',
};

function formularioVazio(padraoHotel) {
  const f = {};
  [...CAMPOS_DO_HOTEL, ...CAMPOS_DO_COLABORADOR].forEach((c) => { f[c] = ''; });
  f.EMPREGADO_NACIONALIDADE = 'brasileiro(a)';
  f.MANUAL_VERSAO = MANUAL_VERSAO_PADRAO;
  f.MANUAL_PAGINAS = '09 (nove)';
  Object.assign(f, padraoHotel || {});
  f.DATA_ASSINATURA = hojeFortaleza();
  return f;
}

function inteiroPositivo(texto) {
  const n = parseInt(soDigitos(texto), 10);
  return n > 0 ? n : null;
}

// Monta o texto que vai em cada {{CAMPO}} do documento
function montarValores(f) {
  const v = {};
  Object.keys(f).forEach((k) => { v[k] = String(f[k] ?? '').trim(); });
  v.EMPREGADOR_CNPJ = f.EMPREGADOR_CNPJ ? formatarDocumento(f.EMPREGADOR_CNPJ) : '';
  v.EMPRESA_SOCIOS_COMUNS_CNPJ = f.EMPRESA_SOCIOS_COMUNS_CNPJ ? formatarDocumento(f.EMPRESA_SOCIOS_COMUNS_CNPJ) : '';
  v.EMPREGADOR_CEP = f.EMPREGADOR_CEP ? formatarCEP(f.EMPREGADOR_CEP) : '';
  v.EMPREGADO_CEP = f.EMPREGADO_CEP ? formatarCEP(f.EMPREGADO_CEP) : '';
  v.EMPREGADO_CPF = f.EMPREGADO_CPF ? formatarCPF(f.EMPREGADO_CPF) : '';
  v.EMPREGADO_PIS = f.EMPREGADO_PIS ? formatarPIS(f.EMPREGADO_PIS) : '';
  v.EMPREGADO_TELEFONE = f.EMPREGADO_TELEFONE ? formatarTelefone(f.EMPREGADO_TELEFONE) : '';
  const salario = lerValorDinheiro(f.SALARIO_VALOR);
  v.SALARIO_VALOR = salario ? formatarDinheiro(salario) : '';
  v.SALARIO_EXTENSO = salario ? reaisPorExtenso(salario) : '';
  const dias = inteiroPositivo(f.EXPERIENCIA_DIAS);
  v.EXPERIENCIA_DIAS = dias ? String(dias) : '';
  v.EXPERIENCIA_DIAS_EXTENSO = dias ? numeroPorExtenso(dias) : '';
  const diasProrrogacao = inteiroPositivo(f.PRORROGACAO_DIAS);
  v.PRORROGACAO_DIAS = diasProrrogacao ? `${diasProrrogacao} (${numeroPorExtenso(diasProrrogacao)})` : '';
  v.EXPERIENCIA_INICIO = dataCurta(f.EXPERIENCIA_INICIO);
  v.EXPERIENCIA_TERMINO = dataCurta(f.EXPERIENCIA_TERMINO);
  v.PRORROGACAO_TERMINO = dataCurta(f.PRORROGACAO_TERMINO);
  v.PRORROGACAO_DATA_ASSINATURA = dataPorExtenso(f.PRORROGACAO_DATA_ASSINATURA);
  v.DATA_ASSINATURA = dataPorExtenso(f.DATA_ASSINATURA);
  v.DATA_TERMO = dataCurta(f.DATA_ASSINATURA);
  return v;
}

// Erros que impedem salvar/imprimir e avisos sobre o prazo
function conferir(f) {
  const erros = [];
  const avisos = [];
  if (!String(f.EMPREGADO_NOME || '').trim()) erros.push('Informe o nome do colaborador.');
  if (f.EMPREGADO_CPF && !validarCPF(f.EMPREGADO_CPF)) erros.push('O CPF do colaborador não é válido. Confira os números.');
  if (f.EMPREGADO_PIS && !validarPIS(f.EMPREGADO_PIS)) erros.push('O PIS/NIS não é válido. Confira os 11 números.');
  if (f.EMPREGADOR_CNPJ && !validarCNPJ(f.EMPREGADOR_CNPJ)) erros.push('O CNPJ do hotel não é válido.');
  if (f.EMPRESA_SOCIOS_COMUNS_CNPJ && !validarCNPJ(f.EMPRESA_SOCIOS_COMUNS_CNPJ)) erros.push('O CNPJ da empresa com sócios em comum não é válido.');
  const salario = lerValorDinheiro(f.SALARIO_VALOR);
  if (f.SALARIO_VALOR && salario === null) erros.push('O salário não está num formato válido (ex.: 1.665,00).');
  if (salario !== null && salario > 0 && salario < PISO_SALARIAL) {
    erros.push(`O salário não pode ser menor que o piso da categoria (R$ ${formatarDinheiro(PISO_SALARIAL)}).`);
  }
  if (f.EXPERIENCIA_INICIO && f.EXPERIENCIA_TERMINO && f.EXPERIENCIA_TERMINO < f.EXPERIENCIA_INICIO) {
    erros.push('O término da experiência está antes do início.');
  }
  if (f.EXPERIENCIA_TERMINO && f.PRORROGACAO_TERMINO && f.PRORROGACAO_TERMINO <= f.EXPERIENCIA_TERMINO) {
    erros.push('O término da prorrogação precisa ser depois do término da experiência.');
  }
  const diasPeriodo = diasEntre(f.EXPERIENCIA_INICIO, f.EXPERIENCIA_TERMINO);
  const dias = inteiroPositivo(f.EXPERIENCIA_DIAS);
  if (dias && diasPeriodo && dias !== diasPeriodo) {
    avisos.push(`Do início ao término da experiência são ${diasPeriodo} dias, mas o campo "dias" diz ${dias}.`);
  }
  const fimTotal = f.PRORROGACAO_TERMINO || f.EXPERIENCIA_TERMINO;
  const total = diasEntre(f.EXPERIENCIA_INICIO, fimTotal);
  const totalDigitado = (dias || 0) + (inteiroPositivo(f.PRORROGACAO_DIAS) || 0);
  if ((total && total > 90) || totalDigitado > 90) {
    avisos.push('Atenção: a experiência com a prorrogação passa de 90 dias. A lei (art. 445 da CLT) não permite mais que 90 dias no total.');
  }
  return { erros, avisos };
}

function camposVazios(f) {
  const ignorar = ['PRORROGACAO_DATA_ASSINATURA']; // normalmente é assinado depois, na prorrogação
  return [...CAMPOS_DO_HOTEL, ...CAMPOS_DO_COLABORADOR]
    .filter((c) => !ignorar.includes(c) && !String(f[c] || '').trim())
    .map((c) => ROTULOS[c] || c);
}

function mensagemBanco(error) {
  const m = String(error?.message || '');
  if (/contratos_trabalho|schema cache|does not exist|relation/i.test(m)) {
    return 'A tela ainda não foi ativada no banco de dados (falta rodar o SQL dos Contratos de Trabalho no Supabase).';
  }
  return 'Não foi possível concluir. Detalhe técnico: ' + m;
}

export default function ContratosTrabalhoPagina() {
  const router = useRouter();
  const [usuario, setUsuario] = useState(null);
  const [verificandoLogin, setVerificandoLogin] = useState(true);
  const [montado, setMontado] = useState(false);

  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');
  const [padraoHotel, setPadraoHotel] = useState({});

  const [modo, setModo] = useState('lista'); // 'lista' | 'form'
  const [form, setForm] = useState(() => formularioVazio({}));
  const [editandoId, setEditandoId] = useState(null);
  const [opcoes, setOpcoes] = useState({ contrato: true, manual: true, termo: true });
  const [mesmoEmail, setMesmoEmail] = useState(true);

  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [buscandoCep, setBuscandoCep] = useState('');
  const [previa, setPrevia] = useState(false);
  const [impressao, setImpressao] = useState(null); // { valores, atribuicoes, opcoes }

  const autoTermino = useRef('');
  const autoProrrogacao = useRef('');
  const previaRef = useRef(null);

  function mostrarAviso(texto) { setAviso(texto); setTimeout(() => setAviso(''), 5000); }

  // ---- Acesso: só ADMIN ----------------------------------------------------
  useEffect(() => {
    setMontado(true);
    let ativo = true;
    async function verificar() {
      const { data: sessao } = await supabase.auth.getSession();
      if (!sessao?.session) { router.push('/login'); return; }
      const { data: dadosUsuario, error } = await supabase
        .from('usuarios').select('*').eq('auth_id', sessao.session.user.id).single();
      if (error || !dadosUsuario) { router.push('/login'); return; }
      if (bloquearSeNaoPermitido(dadosUsuario.papel, router)) return;
      if (dadosUsuario.papel !== 'ADMIN') { router.push('/'); return; }
      if (!ativo) return;
      setUsuario(dadosUsuario);
      setVerificandoLogin(false);
    }
    verificar();
    return () => { ativo = false; };
  }, [router]);

  // ---- Carregar lista e dados padrão do hotel -------------------------------
  const carregar = useCallback(async (u) => {
    setCarregando(true);
    setErro('');
    const [contratos, config, hotel] = await Promise.all([
      buscarTodos(() => supabase.from('contratos_trabalho')
        .select('id, empregado_nome, empregado_cpf, funcao, data_inicio, criado_em, atualizado_em, impresso_em')
        .eq('hotel_id', u.hotel_id)
        .order('criado_em', { ascending: false })),
      supabase.from('contratos_trabalho_config').select('dados').eq('hotel_id', u.hotel_id).maybeSingle(),
      supabase.from('hoteis').select('*').eq('id', u.hotel_id).maybeSingle(),
    ]);
    if (contratos.error) setErro(mensagemBanco(contratos.error));
    setLista(contratos.data || []);

    // Padrão: o que já foi salvo para os contratos; o que faltar vem do cadastro do hotel
    const h = hotel.data || {};
    const doCadastro = {
      EMPREGADOR_RAZAO_SOCIAL: h.razao_social || '',
      EMPREGADOR_NOME_FANTASIA: h.nome_fantasia || h.nome || '',
      EMPREGADOR_CNPJ: h.documento ? formatarDocumento(h.documento) : '',
      EMPREGADOR_LOGRADOURO: h.endereco || '',
      EMPREGADOR_CIDADE: h.cidade || '',
    };
    const salvo = config.data?.dados || {};
    const padrao = { ...doCadastro };
    Object.keys(salvo).forEach((k) => { if (String(salvo[k] || '').trim()) padrao[k] = salvo[k]; });
    setPadraoHotel(padrao);
    setCarregando(false);
  }, []);

  useEffect(() => { if (usuario) carregar(usuario); }, [usuario, carregar]);

  // ---- Edição dos campos (com cálculo sugerido das datas) --------------------
  function mudar(campo, valor) {
    setForm((atual) => {
      const novo = { ...atual, [campo]: valor };
      if (campo === 'EMPREGADO_EMAIL' && mesmoEmail) novo.EMPREGADO_EMAIL_CONTRACHEQUE = valor;

      // Término da experiência = início + dias − 1 (só se a pessoa não digitou outra data)
      if (['EXPERIENCIA_INICIO', 'EXPERIENCIA_DIAS'].includes(campo)) {
        const dias = inteiroPositivo(novo.EXPERIENCIA_DIAS);
        const sugestao = novo.EXPERIENCIA_INICIO && dias ? somarDias(novo.EXPERIENCIA_INICIO, dias - 1) : '';
        if (!atual.EXPERIENCIA_TERMINO || atual.EXPERIENCIA_TERMINO === autoTermino.current) {
          novo.EXPERIENCIA_TERMINO = sugestao;
          autoTermino.current = sugestao;
        }
      }
      // Término da prorrogação = término da experiência + dias da prorrogação
      if (['EXPERIENCIA_INICIO', 'EXPERIENCIA_DIAS', 'EXPERIENCIA_TERMINO', 'PRORROGACAO_DIAS'].includes(campo)) {
        const dias = inteiroPositivo(novo.PRORROGACAO_DIAS);
        const sugestao = novo.EXPERIENCIA_TERMINO && dias ? somarDias(novo.EXPERIENCIA_TERMINO, dias) : '';
        if (!atual.PRORROGACAO_TERMINO || atual.PRORROGACAO_TERMINO === autoProrrogacao.current) {
          novo.PRORROGACAO_TERMINO = sugestao;
          autoProrrogacao.current = sugestao;
        }
      }
      return novo;
    });
  }

  async function buscarCep(qual) {
    const campoCep = qual === 'hotel' ? 'EMPREGADOR_CEP' : 'EMPREGADO_CEP';
    const digitos = soDigitos(form[campoCep]);
    if (digitos.length !== 8) return;
    setBuscandoCep(qual);
    try {
      const resposta = await fetch(`https://viacep.com.br/ws/${digitos}/json/`);
      const d = await resposta.json();
      if (!d?.erro) {
        setForm((atual) => (qual === 'hotel'
          ? {
            ...atual,
            EMPREGADOR_LOGRADOURO: d.logradouro || atual.EMPREGADOR_LOGRADOURO,
            EMPREGADOR_BAIRRO: d.bairro || atual.EMPREGADOR_BAIRRO,
            EMPREGADOR_CIDADE: d.localidade || atual.EMPREGADOR_CIDADE,
            EMPREGADOR_UF: d.uf || atual.EMPREGADOR_UF,
          }
          : {
            ...atual,
            EMPREGADO_ENDERECO: d.logradouro ? `${d.logradouro}, ` : atual.EMPREGADO_ENDERECO,
            EMPREGADO_BAIRRO: d.bairro || atual.EMPREGADO_BAIRRO,
            EMPREGADO_CIDADE: d.localidade || atual.EMPREGADO_CIDADE,
            EMPREGADO_UF: d.uf || atual.EMPREGADO_UF,
          }));
      }
    } catch (e) { /* silencioso — dá para preencher à mão */ }
    setBuscandoCep('');
  }

  // ---- Abrir / novo / excluir ------------------------------------------------
  function novoContrato() {
    autoTermino.current = '';
    autoProrrogacao.current = '';
    setForm(formularioVazio(padraoHotel));
    setEditandoId(null);
    setMesmoEmail(true);
    setErro('');
    setModo('form');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function abrirContrato(id, imprimirDepois) {
    setErro('');
    const { data, error } = await supabase.from('contratos_trabalho').select('*').eq('id', id).single();
    if (error || !data) { setErro(mensagemBanco(error)); return; }
    const f = { ...formularioVazio({}), ...(data.dados || {}) };
    autoTermino.current = '';
    autoProrrogacao.current = '';
    setForm(f);
    setEditandoId(data.id);
    setMesmoEmail(!f.EMPREGADO_EMAIL_CONTRACHEQUE || f.EMPREGADO_EMAIL_CONTRACHEQUE === f.EMPREGADO_EMAIL);
    if (imprimirDepois) {
      setPrevia(true);
    } else {
      setModo('form');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  async function excluirContrato(item) {
    if (!window.confirm(`Excluir o contrato de ${item.empregado_nome}? Isso não pode ser desfeito.`)) return;
    const { error } = await supabase.from('contratos_trabalho').delete().eq('id', item.id);
    if (error) { setErro(mensagemBanco(error)); return; }
    mostrarAviso('Contrato excluído.');
    carregar(usuario);
  }

  // ---- Salvar ----------------------------------------------------------------
  async function salvar({ silencioso } = {}) {
    setErro('');
    const { erros } = conferir(form);
    if (erros.length) { setErro(erros.join(' ')); window.scrollTo({ top: 0, behavior: 'smooth' }); return null; }

    setSalvando(true);
    const linha = {
      hotel_id: usuario.hotel_id,
      empregado_nome: form.EMPREGADO_NOME.trim(),
      empregado_cpf: soDigitos(form.EMPREGADO_CPF) || null,
      funcao: form.FUNCAO.trim() || null,
      data_inicio: form.EXPERIENCIA_INICIO || null,
      dados: form,
      atualizado_por_id: usuario.id,
      atualizado_em: new Date().toISOString(),
    };
    let id = editandoId;
    if (editandoId) {
      const { error } = await supabase.from('contratos_trabalho').update(linha).eq('id', editandoId);
      if (error) { setSalvando(false); setErro(mensagemBanco(error)); return null; }
    } else {
      const { data, error } = await supabase.from('contratos_trabalho')
        .insert({ ...linha, criado_por_id: usuario.id }).select('id').single();
      if (error) { setSalvando(false); setErro(mensagemBanco(error)); return null; }
      id = data.id;
      setEditandoId(id);
    }

    // Guarda os dados do hotel como padrão para os próximos contratos
    const padrao = {};
    CAMPOS_DO_HOTEL.forEach((c) => { padrao[c] = form[c] || ''; });
    const { error: erroConfig } = await supabase.from('contratos_trabalho_config').upsert({
      hotel_id: usuario.hotel_id, dados: padrao, atualizado_por_id: usuario.id, atualizado_em: new Date().toISOString(),
    });
    if (!erroConfig) setPadraoHotel(padrao);

    setSalvando(false);
    if (!silencioso) mostrarAviso('Contrato salvo!');
    carregar(usuario);
    return id;
  }

  // ---- Imprimir --------------------------------------------------------------
  function abrirPrevia() {
    setErro('');
    const { erros } = conferir(form);
    if (erros.length) { setErro(erros.join(' ')); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    setPrevia(true);
  }

  async function imprimir() {
    if (!opcoes.contrato && !opcoes.manual && !opcoes.termo) {
      setErro('Marque pelo menos um documento para imprimir.');
      return;
    }
    const { erros } = conferir(form);
    if (erros.length) { setPrevia(false); setErro(erros.join(' ')); return; }
    const vazios = camposVazios(form);
    if (vazios.length && !window.confirm(
      `${vazios.length} campo(s) estão vazios e vão sair com linha em branco para preencher à mão:\n\n• ${vazios.slice(0, 12).join('\n• ')}${vazios.length > 12 ? '\n• ...' : ''}\n\nImprimir mesmo assim?`
    )) return;

    const id = await salvar({ silencioso: true });
    if (!id) { setPrevia(false); return; }
    await supabase.from('contratos_trabalho').update({ impresso_em: new Date().toISOString() }).eq('id', id);
    setImpressao({ valores: montarValores(form), atribuicoes: String(form.DESCRICAO_ATRIBUICOES || '').trim(), opcoes: { ...opcoes } });
  }

  // Quando a área de impressão está pronta: ajusta o manual e abre a janela de impressão
  useEffect(() => {
    if (!impressao) return undefined;
    const raiz = document.querySelector('.ct-impressao');
    ajustarPaginasManual(raiz);
    const terminar = () => setImpressao(null);
    window.addEventListener('afterprint', terminar, { once: true });
    const espera = setTimeout(() => window.print(), 200);
    return () => { clearTimeout(espera); window.removeEventListener('afterprint', terminar); };
  }, [impressao]);

  useEffect(() => {
    if (previa) setTimeout(() => ajustarPaginasManual(previaRef.current), 50);
  }, [previa, form, opcoes]);

  const valoresPrevia = useMemo(() => montarValores(form), [form]);
  const conferencia = useMemo(() => conferir(form), [form]);
  const listaFiltrada = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const digitos = soDigitos(busca);
    if (!termo) return lista;
    return lista.filter((c) => (c.empregado_nome || '').toLowerCase().includes(termo)
      || (c.funcao || '').toLowerCase().includes(termo)
      || (digitos && (c.empregado_cpf || '').includes(digitos)));
  }, [lista, busca]);

  if (verificandoLogin) {
    return (
      <main className="conteudo">
        <p className="texto-suave">Verificando seu acesso…</p>
      </main>
    );
  }

  // ---- Pedacinhos do formulário ---------------------------------------------
  const campo = (nome, rotulo, extra = {}) => {
    const { tipo = 'text', dica, obrigatorio, mascara, aoSair, placeholder, maxLength, larga, lista: opcoesLista } = extra;
    const id = `ct-${nome}`;
    return (
      <div className={larga ? 'ct-campo ct-larga' : 'ct-campo'}>
        <label className="rotulo" htmlFor={id}>{rotulo}{obrigatorio ? ' *' : ''}</label>
        {opcoesLista ? (
          <select id={id} className="campo" value={form[nome] || ''} onChange={(e) => mudar(nome, e.target.value)}>
            <option value="">— escolha —</option>
            {opcoesLista.map((o) => <option key={o} value={o}>{o}</option>)}
            {form[nome] && !opcoesLista.includes(form[nome]) && <option value={form[nome]}>{form[nome]}</option>}
          </select>
        ) : (
          <input
            id={id}
            className="campo"
            type={tipo}
            inputMode={mascara ? 'numeric' : undefined}
            value={form[nome] || ''}
            placeholder={placeholder}
            maxLength={maxLength}
            onChange={(e) => mudar(nome, mascara ? mascara(e.target.value) : e.target.value)}
            onBlur={aoSair}
          />
        )}
        {dica && <small className="ct-dica">{dica}</small>}
      </div>
    );
  };

  const cpfInvalido = form.EMPREGADO_CPF && soDigitos(form.EMPREGADO_CPF).length === 11 && !validarCPF(form.EMPREGADO_CPF);
  const pisInvalido = form.EMPREGADO_PIS && soDigitos(form.EMPREGADO_PIS).length === 11 && !validarPIS(form.EMPREGADO_PIS);
  const salarioNumero = lerValorDinheiro(form.SALARIO_VALOR);

  const documentos = (valores, atribuicoes, op) => (
    <div className="dc-docs">
      {op.contrato && <ContratoExperiencia valores={valores} atribuicoes={atribuicoes} />}
      {(op.manual || op.termo) && <ManualProcedimentos valores={valores} incluirManual={op.manual} incluirTermo={op.termo} />}
    </div>
  );

  return (
    <main className="conteudo">
      <span className="olho">Administração</span>
      <div className="barra-pagina">
        <h1 style={{ margin: 0 }}>Contratos de Trabalho</h1>
        {modo === 'lista' ? (
          <button type="button" className="botao botao-principal" onClick={novoContrato}>+ Novo colaborador</button>
        ) : (
          <button type="button" className="botao botao-contorno" onClick={() => { setModo('lista'); setErro(''); }}>← Voltar para a lista</button>
        )}
      </div>

      {aviso && <div className="aviso-sucesso">{aviso}</div>}
      {erro && <div className="aviso-erro">{erro}</div>}

      {/* ================================ LISTA ================================ */}
      {modo === 'lista' && (
        <div className="cartao">
          <p className="texto-suave" style={{ marginTop: 0 }}>
            Preencha os dados do novo colaborador e imprima o <strong>Contrato de Experiência</strong>, o{' '}
            <strong>Manual de Procedimentos Internos</strong> e o <strong>Termo de Ciência</strong> já preenchidos.
          </p>
          <input
            className="campo"
            type="search"
            placeholder="Buscar por nome, CPF ou função…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          {carregando ? (
            <p className="texto-suave">Carregando…</p>
          ) : listaFiltrada.length === 0 ? (
            <p className="texto-suave">{lista.length ? 'Nenhum contrato encontrado nessa busca.' : 'Nenhum contrato cadastrado ainda.'}</p>
          ) : (
            <div className="ct-lista">
              {listaFiltrada.map((c) => (
                <div key={c.id} className="ct-item">
                  <div className="ct-item-info">
                    <strong>{c.empregado_nome}</strong>
                    <span className="texto-suave">
                      {c.funcao || 'Função não informada'}
                      {c.empregado_cpf ? ` · CPF ${formatarCPF(c.empregado_cpf)}` : ''}
                    </span>
                    <span className="texto-suave ct-item-datas">
                      {c.data_inicio ? `Início ${dataCurta(c.data_inicio)} · ` : ''}
                      Criado em {dataCurta(new Date(c.criado_em).toLocaleDateString('en-CA', { timeZone: 'America/Fortaleza' }))}
                      {c.impresso_em ? ' · 🖨️ já impresso' : ''}
                    </span>
                  </div>
                  <div className="ct-item-acoes">
                    <button type="button" className="botao botao-suave" onClick={() => abrirContrato(c.id, false)}>✏️ Abrir</button>
                    <button type="button" className="botao botao-contorno" onClick={() => abrirContrato(c.id, true)}>🖨️ Imprimir</button>
                    <button type="button" className="botao botao-perigo" onClick={() => excluirContrato(c)} aria-label="Excluir">🗑️</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ============================== FORMULÁRIO ============================== */}
      {modo === 'form' && (
        <form onSubmit={(e) => { e.preventDefault(); salvar(); }}>
          <p className="texto-suave">
            {editandoId ? 'Editando contrato salvo.' : 'Novo contrato.'} Campos com * são obrigatórios. O que ficar
            vazio sai no papel como uma linha em branco, para preencher à mão.
          </p>

          {/* --- 1. Colaborador --- */}
          <section className="cartao ct-secao">
            <h2 className="ct-titulo-secao">1. Dados do colaborador</h2>
            <div className="ct-grade">
              {campo('EMPREGADO_NOME', 'Nome completo', { obrigatorio: true, larga: true })}
              {campo('EMPREGADO_NACIONALIDADE', 'Nacionalidade', { placeholder: 'brasileiro(a)' })}
              {campo('EMPREGADO_ESTADO_CIVIL', 'Estado civil', { lista: ESTADOS_CIVIS })}
              {campo('EMPREGADO_CPF', 'CPF', {
                mascara: formatarCPF, placeholder: '000.000.000-00',
                dica: cpfInvalido ? <span className="ct-erro-campo">CPF inválido</span> : null,
              })}
              {campo('EMPREGADO_RG', 'RG (número e órgão)', { placeholder: 'ex.: 1.234.567 SSP/PB' })}
              {campo('EMPREGADO_CTPS_NUMERO', 'Carteira de Trabalho Digital — nº', {
                dica: (
                  <button type="button" className="ct-link" onClick={() => mudar('EMPREGADO_CTPS_NUMERO', form.EMPREGADO_CPF)}>
                    Na carteira digital o número é o CPF — usar o CPF
                  </button>
                ),
              })}
              {campo('EMPREGADO_CTPS_SERIE', 'Carteira de Trabalho — série')}
              {campo('EMPREGADO_PIS', 'PIS/NIS', {
                mascara: formatarPIS, placeholder: '000.00000.00-0',
                dica: pisInvalido ? <span className="ct-erro-campo">PIS/NIS inválido</span> : null,
              })}
              {campo('EMPREGADO_TELEFONE', 'Telefone', { mascara: formatarTelefone, placeholder: '(83) 90000-0000' })}
              {campo('EMPREGADO_CEP', 'CEP', {
                mascara: formatarCEP, placeholder: '00000-000', aoSair: () => buscarCep('colaborador'),
                dica: buscandoCep === 'colaborador' ? 'Buscando endereço…' : 'O endereço é preenchido pelo CEP',
              })}
              {campo('EMPREGADO_ENDERECO', 'Endereço (rua, número e complemento)', { larga: true })}
              {campo('EMPREGADO_BAIRRO', 'Bairro')}
              {campo('EMPREGADO_CIDADE', 'Cidade')}
              {campo('EMPREGADO_UF', 'UF', { lista: UFS })}
              {campo('EMPREGADO_EMAIL', 'E-mail', { tipo: 'email' })}
              <div className="ct-campo">
                <label className="rotulo" htmlFor="ct-EMPREGADO_EMAIL_CONTRACHEQUE">E-mail para receber o contracheque</label>
                <input
                  id="ct-EMPREGADO_EMAIL_CONTRACHEQUE"
                  className="campo"
                  type="email"
                  value={form.EMPREGADO_EMAIL_CONTRACHEQUE || ''}
                  disabled={mesmoEmail}
                  onChange={(e) => mudar('EMPREGADO_EMAIL_CONTRACHEQUE', e.target.value)}
                />
                <label className="ct-check">
                  <input
                    type="checkbox"
                    checked={mesmoEmail}
                    onChange={(e) => {
                      setMesmoEmail(e.target.checked);
                      if (e.target.checked) setForm((a) => ({ ...a, EMPREGADO_EMAIL_CONTRACHEQUE: a.EMPREGADO_EMAIL }));
                    }}
                  />
                  É o mesmo e-mail de cima
                </label>
              </div>
            </div>
          </section>

          {/* --- 2. Função e salário --- */}
          <section className="cartao ct-secao">
            <h2 className="ct-titulo-secao">2. Função e salário</h2>
            <div className="ct-grade">
              {campo('FUNCAO', 'Função', { placeholder: 'ex.: Recepcionista' })}
              {campo('CBO', 'CBO', { placeholder: '0000-00', dica: 'Código da Classificação Brasileira de Ocupações' })}
              {campo('SETOR', 'Setor', { placeholder: 'ex.: Recepção' })}
              {campo('SALARIO_VALOR', 'Salário mensal (R$)', {
                placeholder: '1.665,00',
                dica: salarioNumero
                  ? (salarioNumero < PISO_SALARIAL
                    ? <span className="ct-erro-campo">Menor que o piso (R$ {formatarDinheiro(PISO_SALARIAL)})</span>
                    : <>Por extenso: <em>{reaisPorExtenso(salarioNumero)}</em></>)
                  : `Piso da categoria: R$ ${formatarDinheiro(PISO_SALARIAL)}`,
              })}
              <div className="ct-campo ct-larga">
                <label className="rotulo" htmlFor="ct-DESCRICAO_ATRIBUICOES">Atribuições da função (§ 1º da Cláusula 1ª)</label>
                <textarea
                  id="ct-DESCRICAO_ATRIBUICOES"
                  className="campo"
                  rows={7}
                  value={form.DESCRICAO_ATRIBUICOES || ''}
                  placeholder={'Escreva uma atribuição por linha, por exemplo:\na) Realizar check-in e check-out dos hóspedes;\nb) Atender telefone, WhatsApp e e-mail do hotel;'}
                  onChange={(e) => mudar('DESCRICAO_ATRIBUICOES', e.target.value)}
                />
                <small className="ct-dica">As quebras de linha são mantidas na impressão.</small>
              </div>
            </div>
          </section>

          {/* --- 3. Prazo de experiência --- */}
          <section className="cartao ct-secao">
            <h2 className="ct-titulo-secao">3. Prazo de experiência (Cláusula 5ª)</h2>
            <div className="ct-grade">
              {campo('EXPERIENCIA_DIAS', 'Dias de experiência', { mascara: (t) => soDigitos(t, 2), placeholder: 'ex.: 45' })}
              {campo('EXPERIENCIA_INICIO', 'Data de início', { tipo: 'date' })}
              {campo('EXPERIENCIA_TERMINO', 'Data de término', { tipo: 'date', dica: 'Sugerida pelo início e pelos dias; pode trocar' })}
              {campo('PRORROGACAO_DIAS', 'Dias da prorrogação', { mascara: (t) => soDigitos(t, 2), placeholder: 'ex.: 45' })}
              {campo('PRORROGACAO_TERMINO', 'Término da prorrogação', { tipo: 'date', dica: 'Sugerido pelo término + dias; pode trocar' })}
              {campo('PRORROGACAO_DATA_ASSINATURA', 'Data de assinatura da prorrogação', { tipo: 'date', dica: 'Normalmente fica em branco (assina-se depois)' })}
            </div>
            {conferencia.avisos.map((a) => <div key={a} className="ct-alerta">{a}</div>)}
          </section>

          {/* --- 4. Dados do hotel --- */}
          <section className="cartao ct-secao">
            <h2 className="ct-titulo-secao">4. Dados do hotel (empregador)</h2>
            <p className="texto-suave ct-sub">Já vêm preenchidos e ficam guardados como padrão deste hotel para os próximos contratos.</p>
            <div className="ct-grade">
              {campo('EMPREGADOR_RAZAO_SOCIAL', 'Razão social', { larga: true })}
              {campo('EMPREGADOR_NOME_FANTASIA', 'Nome fantasia')}
              {campo('EMPREGADOR_CNPJ', 'CNPJ', { mascara: formatarDocumento, placeholder: '00.000.000/0000-00' })}
              {campo('EMPREGADOR_CEP', 'CEP', {
                mascara: formatarCEP, placeholder: '00000-000', aoSair: () => buscarCep('hotel'),
                dica: buscandoCep === 'hotel' ? 'Buscando endereço…' : null,
              })}
              {campo('EMPREGADOR_LOGRADOURO', 'Rua / Avenida', { larga: true })}
              {campo('EMPREGADOR_NUMERO', 'Número')}
              {campo('EMPREGADOR_BAIRRO', 'Bairro')}
              {campo('EMPREGADOR_CIDADE', 'Cidade')}
              {campo('EMPREGADOR_UF', 'UF', { lista: UFS })}
              {campo('EMPREGADOR_REPRESENTANTE_LEGAL', 'Representante legal (quem assina pelo hotel)', { larga: true })}
            </div>
          </section>

          {/* --- 5. Outras informações --- */}
          <section className="cartao ct-secao">
            <h2 className="ct-titulo-secao">5. Outras informações do contrato</h2>
            <p className="texto-suave ct-sub">Também ficam guardadas como padrão deste hotel.</p>
            <div className="ct-grade">
              {campo('CANAL_DENUNCIAS', 'Canal de denúncias (Cláusula 28ª)', { placeholder: 'ex.: e-mail ou WhatsApp para denúncias', larga: true })}
              {campo('EMAIL_ENCARREGADO_LGPD', 'E-mail do encarregado LGPD (Cláusula 37ª)', { tipo: 'email' })}
              {campo('MANUAL_VERSAO', 'Versão do Manual (Cláusula 47ª)')}
              {campo('MANUAL_PAGINAS', 'Nº de páginas do Manual', { placeholder: '09 (nove)' })}
              {campo('EMPRESA_SOCIOS_COMUNS_RAZAO_SOCIAL', 'Empresa com sócios em comum — razão social (Cláusula 59ª)', { larga: true })}
              {campo('EMPRESA_SOCIOS_COMUNS_CNPJ', 'Empresa com sócios em comum — CNPJ', { mascara: formatarDocumento })}
              {campo('DATA_ASSINATURA', 'Data de assinatura do contrato', { tipo: 'date' })}
            </div>
          </section>

          {/* --- 6. Impressão --- */}
          <section className="cartao ct-secao">
            <h2 className="ct-titulo-secao">6. O que imprimir</h2>
            <div className="ct-opcoes">
              <label className="ct-check"><input type="checkbox" checked={opcoes.contrato} onChange={(e) => setOpcoes({ ...opcoes, contrato: e.target.checked })} /> Contrato de Experiência</label>
              <label className="ct-check"><input type="checkbox" checked={opcoes.manual} onChange={(e) => setOpcoes({ ...opcoes, manual: e.target.checked })} /> Manual de Procedimentos Internos (8 páginas)</label>
              <label className="ct-check"><input type="checkbox" checked={opcoes.termo} onChange={(e) => setOpcoes({ ...opcoes, termo: e.target.checked })} /> Termo de Ciência do Manual (página 9)</label>
            </div>
            <p className="texto-suave ct-sub">Dica: o contrato é em duas vias — na janela de impressão, escolha <strong>2 cópias</strong>.</p>
            <div className="ct-botoes">
              <button type="submit" className="botao botao-contorno" disabled={salvando}>{salvando ? 'Salvando…' : '💾 Salvar'}</button>
              <button type="button" className="botao botao-principal" onClick={abrirPrevia} disabled={salvando}>👁️ Ver e imprimir</button>
            </div>
          </section>
        </form>
      )}

      {/* ================================ PRÉVIA ================================ */}
      {previa && (
        <div className="ct-overlay" role="dialog" aria-modal="true" aria-label="Prévia dos documentos">
          <div className="ct-previa-barra">
            <strong>Prévia — {form.EMPREGADO_NOME || 'novo colaborador'}</strong>
            <div className="ct-previa-opcoes">
              <label className="ct-check"><input type="checkbox" checked={opcoes.contrato} onChange={(e) => setOpcoes({ ...opcoes, contrato: e.target.checked })} /> Contrato</label>
              <label className="ct-check"><input type="checkbox" checked={opcoes.manual} onChange={(e) => setOpcoes({ ...opcoes, manual: e.target.checked })} /> Manual</label>
              <label className="ct-check"><input type="checkbox" checked={opcoes.termo} onChange={(e) => setOpcoes({ ...opcoes, termo: e.target.checked })} /> Termo</label>
            </div>
            <div className="ct-botoes">
              <button type="button" className="botao botao-principal" onClick={imprimir} disabled={salvando}>🖨️ Imprimir</button>
              <button type="button" className="botao botao-suave" onClick={() => setPrevia(false)} aria-label="Fechar">✕</button>
            </div>
          </div>
          <div className="ct-previa-rolagem" ref={previaRef}>
            <p className="ct-previa-nota">Na tela o contrato aparece numa folha só; a divisão em páginas A4 acontece na impressão.</p>
            {opcoes.contrato && (
              <div className="ct-folha dc-docs">
                <ContratoExperiencia valores={valoresPrevia} atribuicoes={String(form.DESCRICAO_ATRIBUICOES || '').trim()} />
              </div>
            )}
            {(opcoes.manual || opcoes.termo) && (
              <div className="ct-folhas-manual dc-docs">
                <ManualProcedimentos valores={valoresPrevia} incluirManual={opcoes.manual} incluirTermo={opcoes.termo} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Área usada só no papel (fica fora da tela, direto no <body>) */}
      {montado && impressao && createPortal(
        <div className="ct-impressao">{documentos(impressao.valores, impressao.atribuicoes, impressao.opcoes)}</div>,
        document.body
      )}

      <Estilos />
    </main>
  );
}

function Estilos() {
  return (
    <style>{`
      ${ESTILOS_DOCUMENTOS}

      .ct-secao { margin-bottom: 16px; }
      .ct-titulo-secao { font-size: 18px; margin: 0 0 4px; }
      .ct-sub { margin: 0 0 4px; font-size: 14px; }
      .ct-grade { display: grid; grid-template-columns: 1fr; column-gap: 16px; }
      .ct-campo { min-width: 0; }
      .ct-dica { display: block; margin-top: 4px; font-size: 12.5px; color: var(--texto-suave); }
      .ct-erro-campo { color: var(--erro-texto); font-weight: 600; }
      .ct-link { background: none; border: none; padding: 0; color: var(--marca); text-decoration: underline; cursor: pointer; font-size: 12.5px; font-family: inherit; }
      .ct-check { display: flex; align-items: center; gap: 8px; font-size: 14px; margin-top: 8px; cursor: pointer; }
      .ct-check input { width: 18px; height: 18px; accent-color: var(--marca); }
      .ct-opcoes { display: flex; flex-direction: column; gap: 2px; margin-bottom: 10px; }
      .ct-alerta { margin-top: 12px; padding: 10px 12px; border-radius: 10px; background: #FFF4D6; color: #7A5600; font-size: 14px; }
      .ct-botoes { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }

      .ct-lista { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; }
      .ct-item { display: flex; flex-direction: column; gap: 10px; padding: 14px; border: 1px solid var(--borda); border-radius: 12px; }
      .ct-item-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .ct-item-info span { font-size: 14px; }
      .ct-item-datas { font-size: 13px !important; }
      .ct-item-acoes { display: flex; flex-wrap: wrap; gap: 8px; }

      /* Prévia em tela cheia (z-index 80: acima do menu) */
      .ct-overlay { position: fixed; inset: 0; z-index: 80; background: rgba(20, 30, 27, 0.92); display: flex; flex-direction: column; }
      .ct-previa-barra { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; padding: 10px 16px; background: var(--branco); border-bottom: 1px solid var(--borda); }
      .ct-previa-opcoes { display: flex; flex-wrap: wrap; gap: 14px; }
      .ct-previa-opcoes .ct-check { margin-top: 0; }
      .ct-previa-rolagem { flex: 1; overflow: auto; padding: 16px 8px 40px; }
      .ct-previa-nota { text-align: center; color: #fff; font-size: 13px; margin: 0 0 12px; }
      .ct-folha { width: 210mm; max-width: none; margin: 0 auto 18px; padding: 16mm 16mm 18mm 18mm; background: #fff; box-shadow: 0 4px 18px rgba(0,0,0,0.25); }
      .ct-folhas-manual { width: 210mm; margin: 0 auto; }
      .ct-folhas-manual .dc-mp { margin-bottom: 18px; box-shadow: 0 4px 18px rgba(0,0,0,0.25); }

      @media (min-width: 640px) {
        .ct-grade { grid-template-columns: 1fr 1fr; }
        .ct-larga { grid-column: 1 / -1; }
        .ct-item { flex-direction: row; align-items: center; justify-content: space-between; }
      }
      @media (min-width: 900px) {
        .ct-grade { grid-template-columns: 1fr 1fr 1fr; }
      }

      /* Papel: só a área de impressão aparece */
      @media screen { .ct-impressao { display: none; } }
      @media print {
        body > *:not(.ct-impressao) { display: none !important; }
        html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
        .ct-impressao { display: block; }
      }
    `}</style>
  );
}
