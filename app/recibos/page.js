'use client';

// ============================================================================
// RECIBOS
// - Gera recibo de pagamento nos dois sentidos: o hotel PAGANDO alguém
//   ou o hotel RECEBENDO de alguém (os papéis se invertem sozinhos)
// - Valor por extenso em português correto (inclusive "um milhão DE reais")
// - Numeração sequencial automática por hotel e ano: REC-2026-0001
// - Impressão formatada (window.print) e Reimprimir com rastreio
//   (guarda quem reimprimiu e quando)
// - A cidade do hotel sai no rodapé; se não estiver cadastrada, o ADMIN
//   preenche na própria tela
// ============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { bloquearSeNaoPermitido } from '../../lib/restricaoAcesso';

// ---- Constantes -------------------------------------------------------------

const METODOS_PAGAMENTO = ['Dinheiro', 'Pix', 'Transferência', 'Cartão', 'Boleto', 'Cheque'];
const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

// ---- Funções de apoio -------------------------------------------------------

function dinheiro(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(valor || 0));
}

function formatarDataHora(valor) {
  if (!valor) return '—';
  try {
    return new Date(valor).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch (e) { return String(valor); }
}

function dataPorExtenso(data) {
  const d = data ? new Date(data) : new Date();
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

// Formata CPF (11 dígitos) ou CNPJ (14 dígitos) automaticamente
function formatarDocumento(texto) {
  const d = String(texto || '').replace(/\D/g, '').slice(0, 14);
  if (d.length <= 11) {
    // CPF: 000.000.000-00
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  // CNPJ: 00.000.000/0000-00
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

// Validação REAL de CPF (dígitos verificadores)
function validarCPF(cpf) {
  const d = String(cpf || '').replace(/\D/g, '');
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false; // todos iguais (111.111.111-11 etc.)
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += Number(d[i]) * (10 - i);
  let dv1 = (soma * 10) % 11;
  if (dv1 === 10) dv1 = 0;
  if (dv1 !== Number(d[9])) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += Number(d[i]) * (11 - i);
  let dv2 = (soma * 10) % 11;
  if (dv2 === 10) dv2 = 0;
  return dv2 === Number(d[10]);
}

// Validação REAL de CNPJ (dígitos verificadores)
function validarCNPJ(cnpj) {
  const d = String(cnpj || '').replace(/\D/g, '');
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false; // todos iguais
  function calcularDV(base) {
    const tamanho = base.length;
    let pos = tamanho - 7;
    let soma = 0;
    for (let i = tamanho; i >= 1; i--) {
      soma += Number(base.charAt(tamanho - i)) * pos--;
      if (pos < 2) pos = 9;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  }
  if (calcularDV(d.substring(0, 12)) !== Number(d.charAt(12))) return false;
  return calcularDV(d.substring(0, 13)) === Number(d.charAt(13));
}

// Confere CPF (11 dígitos) ou CNPJ (14) automaticamente, conforme o tamanho
function validarDocumento(texto) {
  const d = String(texto || '').replace(/\D/g, '');
  if (d.length === 11) return validarCPF(d);
  if (d.length === 14) return validarCNPJ(d);
  return null; // incompleto — ainda não dá pra saber
}

// Valor monetário por extenso, em português (validado no protótipo)
function valorPorExtenso(valor) {
  const unidades = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
  const dezA19 = ['dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const dezenas = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const centenas = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

  function ate999(n) {
    if (n === 0) return '';
    if (n === 100) return 'cem';
    const partes = [];
    const c = Math.floor(n / 100);
    const resto = n % 100;
    if (c > 0) partes.push(centenas[c]);
    if (resto > 0) {
      if (partes.length) partes.push('e');
      if (resto < 10) partes.push(unidades[resto]);
      else if (resto < 20) partes.push(dezA19[resto - 10]);
      else {
        const d = Math.floor(resto / 10);
        const u = resto % 10;
        partes.push(u > 0 ? `${dezenas[d]} e ${unidades[u]}` : dezenas[d]);
      }
    }
    return partes.join(' ');
  }

  function completo(n) {
    if (n === 0) return 'zero';
    const milhoes = Math.floor(n / 1000000);
    const milhares = Math.floor((n % 1000000) / 1000);
    const resto = n % 1000;
    const partes = [];
    if (milhoes > 0) partes.push(milhoes === 1 ? 'um milhão' : `${ate999(milhoes)} milhões`);
    if (milhares > 0) partes.push(milhares === 1 ? 'mil' : `${ate999(milhares)} mil`);
    if (resto > 0) partes.push(ate999(resto));
    return partes.join(' e ');
  }

  const numero = Math.floor(Math.abs(valor));
  const centavos = Math.round((Math.abs(valor) - numero) * 100);

  let resultado;
  if (numero === 0 && centavos > 0) {
    resultado = '';
  } else {
    // "um milhão de reais" (o "de" só entra quando o valor é milhão redondo)
    const ehMilhaoRedondo = numero >= 1000000 && numero % 1000000 === 0;
    resultado = `${completo(numero)} ${ehMilhaoRedondo ? 'de ' : ''}${numero === 1 ? 'real' : 'reais'}`;
  }
  if (centavos > 0) {
    resultado += `${resultado ? ' e ' : ''}${completo(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`;
  }
  return resultado || 'zero reais';
}

// ---- Componente principal ---------------------------------------------------

export default function Recibos() {
  const router = useRouter();

  const [verificandoLogin, setVerificandoLogin] = useState(true);
  const [usuario, setUsuario] = useState(null);
  const [nomesUsuarios, setNomesUsuarios] = useState({});
  const [hotel, setHotel] = useState(null); // { nome_fantasia, razao_social, documento, cidade }

  const [subAba, setSubAba] = useState('novo'); // 'novo' | 'emitidos'
  const [recibos, setRecibos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);

  // Formulário de novo recibo
  const [direcao, setDirecao] = useState('HOTEL_PAGOU');
  const [fNome, setFNome] = useState('');
  const [fDocumento, setFDocumento] = useState('');
  const [fValor, setFValor] = useState('');
  const [fReferente, setFReferente] = useState('');
  const [fMetodo, setFMetodo] = useState('Dinheiro');
  const [erroForm, setErroForm] = useState('');

  // Cidade do hotel (admin preenche se faltar)
  const [cidadeNova, setCidadeNova] = useState('');

  // Recibo aberto (impressão)
  const [reciboAberto, setReciboAberto] = useState(null);

  // Busca nos emitidos
  const [busca, setBusca] = useState('');

  const souAdmin = usuario?.papel === 'ADMIN';

  function mostrarAviso(texto) {
    setAviso(texto);
    setTimeout(() => setAviso(''), 5000);
  }

  const nomeDe = useCallback(
    (id) => (id ? nomesUsuarios[id] || `Usuário #${id}` : '—'),
    [nomesUsuarios]
  );

  // ---- Login e carregamento ----
  useEffect(() => {
    let ativo = true;
    async function verificar() {
      const { data: sessao } = await supabase.auth.getSession();
      if (!sessao?.session) { router.push('/login'); return; }
      const { data: dadosUsuario, error } = await supabase
        .from('usuarios').select('*').eq('auth_id', sessao.session.user.id).single();
      if (error || !dadosUsuario) { router.push('/login'); return; }
      if (!ativo) return;
      setUsuario(dadosUsuario);
      if (bloquearSeNaoPermitido(dadosUsuario.papel, router)) return;
      setVerificandoLogin(false);
    }
    verificar();
    return () => { ativo = false; };
  }, [router]);

  const carregarTudo = useCallback(async (u) => {
    setCarregando(true);
    setErro('');

    const { data: pessoas } = await supabase.from('usuarios').select('id, nome').eq('hotel_id', u.hotel_id);
    if (pessoas) {
      const mapa = {};
      pessoas.forEach((p) => { mapa[p.id] = p.nome; });
      setNomesUsuarios(mapa);
    }

    const { data: h } = await supabase
      .from('hoteis')
      .select('*')
      .eq('id', u.hotel_id)
      .single();
    if (h) setHotel(h);

    const { data: lista, error: e1 } = await supabase
      .from('recibos')
      .select('*')
      .order('emitido_em', { ascending: false });
    if (e1) setErro('Não foi possível carregar os recibos. Detalhe técnico: ' + e1.message);
    else setRecibos(lista || []);

    setCarregando(false);
  }, []);

  useEffect(() => {
    if (usuario) carregarTudo(usuario);
  }, [usuario, carregarTudo]);

  // ---- Cidade do hotel (admin) ----
  async function salvarCidade() {
    if (!cidadeNova.trim() || salvando) return;
    setSalvando(true);
    const { error } = await supabase
      .from('hoteis')
      .update({ cidade: cidadeNova.trim() })
      .eq('id', usuario.hotel_id);
    setSalvando(false);
    if (error) {
      setErro('Não foi possível salvar a cidade. Detalhe técnico: ' + error.message);
      return;
    }
    setHotel({ ...hotel, cidade: cidadeNova.trim() });
    setCidadeNova('');
    mostrarAviso('Cidade salva! Ela vai aparecer no rodapé dos recibos.');
  }

  // ---- Gerar número sequencial: REC-AAAA-0001 ----
  function proximoNumero(tentativaExtra = 0) {
    const ano = new Date().getFullYear();
    const prefixo = `REC-${ano}-`;
    let maior = 0;
    recibos.forEach((r) => {
      if (r.numero && r.numero.startsWith(prefixo)) {
        const n = Number(r.numero.slice(prefixo.length));
        if (isFinite(n) && n > maior) maior = n;
      }
    });
    return `${prefixo}${String(maior + 1 + tentativaExtra).padStart(4, '0')}`;
  }

  // ---- Gerar e imprimir recibo ----
  async function gerarRecibo(evento) {
    evento.preventDefault();
    if (salvando) return;
    setErroForm('');

    if (!fNome.trim()) { setErroForm('Informe o nome completo ou razão social.'); return; }
    if (!(Number(fValor) > 0)) { setErroForm('Informe um valor maior que zero.'); return; }
    if (!fReferente.trim()) { setErroForm('Descreva a que se refere o pagamento.'); return; }
    if (fDocumento.trim()) {
      const documentoValido = validarDocumento(fDocumento);
      if (documentoValido === null) { setErroForm('O CPF/CNPJ está incompleto — confira os números.'); return; }
      if (documentoValido === false) { setErroForm('O CPF/CNPJ digitado é inválido — confira os números.'); return; }
    }

    setSalvando(true);
    let salvo = null;
    let erroFinal = null;

    // Tenta salvar; se o número já existir (duas pessoas ao mesmo tempo),
    // tenta de novo com o número seguinte
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const { data, error } = await supabase
        .from('recibos')
        .insert({
          numero: proximoNumero(tentativa),
          direcao,
          nome_contraparte: fNome.trim(),
          documento_contraparte: fDocumento.trim() || null,
          valor: Number(fValor),
          referente_a: fReferente.trim(),
          metodo_pagamento: fMetodo,
          emitido_por_id: usuario.id,
          hotel_id: usuario.hotel_id,
        })
        .select()
        .single();
      if (!error) { salvo = data; break; }
      erroFinal = error.message;
      if (!/duplicate|unique/i.test(error.message)) break;
    }
    setSalvando(false);

    if (!salvo) {
      setErroForm('Não foi possível gerar o recibo. Detalhe técnico: ' + erroFinal);
      return;
    }

    setFNome(''); setFDocumento(''); setFValor(''); setFReferente(''); setFMetodo('Dinheiro');
    setRecibos([salvo, ...recibos]);
    setReciboAberto(salvo);
    mostrarAviso(`Recibo ${salvo.numero} gerado!`);
  }

  // ---- Reimprimir ----
  async function reimprimir(recibo) {
    const agora = new Date().toISOString();
    await supabase
      .from('recibos')
      .update({ reimpresso_por_id: usuario.id, reimpresso_em: agora })
      .eq('id', recibo.id);
    const atualizado = { ...recibo, reimpresso_por_id: usuario.id, reimpresso_em: agora };
    setRecibos(recibos.map((r) => (r.id === recibo.id ? atualizado : r)));
    setReciboAberto(atualizado);
  }

  // ---- Busca ----
  const termo = busca.trim().toLowerCase();
  const recibosFiltrados = recibos.filter((r) => {
    if (!termo) return true;
    return (
      (r.nome_contraparte || '').toLowerCase().includes(termo) ||
      (r.numero || '').toLowerCase().includes(termo) ||
      String(Number(r.valor).toFixed(2)).includes(termo.replace(',', '.'))
    );
  });

  if (verificandoLogin) {
    return (
      <main className="conteudo">
        <p className="texto-suave">Verificando seu acesso…</p>
      </main>
    );
  }

  const nomeHotel = hotel?.nome_fantasia || 'Hotel';
  const cidadeHotel = hotel?.cidade || '';

  // Papéis conforme a direção do recibo aberto
  const pagador = reciboAberto
    ? (reciboAberto.direcao === 'HOTEL_PAGOU'
        ? { nome: nomeHotel, doc: hotel?.documento }
        : { nome: reciboAberto.nome_contraparte, doc: reciboAberto.documento_contraparte })
    : null;
  const recebedor = reciboAberto
    ? (reciboAberto.direcao === 'HOTEL_PAGOU'
        ? { nome: reciboAberto.nome_contraparte, doc: reciboAberto.documento_contraparte }
        : { nome: nomeHotel, doc: hotel?.documento })
    : null;

  return (
    <main className="conteudo">
      <EstilosRecibos />

      <span className="olho">Documentos</span>
      <h1 style={{ marginBottom: 6 }}>Recibos</h1>
      <p className="texto-suave" style={{ maxWidth: 620 }}>
        Gere recibos de pagamento com valor por extenso e numeração automática —
        tanto quando o hotel paga alguém quanto quando recebe de alguém.
      </p>

      {aviso && <div className="aviso-sucesso">{aviso}</div>}
      {erro && <div className="aviso-erro">{erro}</div>}

      {/* Cidade do hotel faltando */}
      {hotel && !cidadeHotel && (
        <div className="aviso-erro">
          A <strong>cidade do hotel</strong> ainda não está cadastrada — ela aparece no rodapé
          do recibo ("Cidade, {dataPorExtenso()}").{' '}
          {souAdmin ? (
            <span className="rc-cidade-form">
              <input className="campo" type="text" value={cidadeNova}
                onChange={(e) => setCidadeNova(e.target.value)} placeholder="Ex.: João Pessoa - PB" />
              <button type="button" className="botao botao-principal" onClick={salvarCidade} disabled={salvando}>
                Salvar cidade
              </button>
            </span>
          ) : (
            'Peça ao administrador para preencher.'
          )}
        </div>
      )}

      {/* Sub-abas */}
      <nav className="rc-abas" aria-label="Seções">
        <button type="button" className={subAba === 'novo' ? 'rc-aba rc-aba-ativa' : 'rc-aba'}
          onClick={() => setSubAba('novo')}>
          + Novo Recibo
        </button>
        <button type="button" className={subAba === 'emitidos' ? 'rc-aba rc-aba-ativa' : 'rc-aba'}
          onClick={() => setSubAba('emitidos')}>
          Recibos Emitidos <span className="rc-contador">{recibos.length}</span>
        </button>
      </nav>

      {/* ================= NOVO RECIBO ================= */}
      {subAba === 'novo' && (
        <form className="cartao" onSubmit={gerarRecibo}>
          <label className="rotulo">Qual a situação?</label>
          <div className="rc-direcao">
            <button type="button"
              className={direcao === 'HOTEL_PAGOU' ? 'rc-dir-botao rc-dir-ativo' : 'rc-dir-botao'}
              onClick={() => setDirecao('HOTEL_PAGOU')}>
              O hotel está <strong>pagando</strong> alguém
            </button>
            <button type="button"
              className={direcao === 'HOTEL_RECEBEU' ? 'rc-dir-botao rc-dir-ativo' : 'rc-dir-botao'}
              onClick={() => setDirecao('HOTEL_RECEBEU')}>
              O hotel está <strong>recebendo de alguém</strong>
            </button>
          </div>

          <label className="rotulo">
            {direcao === 'HOTEL_PAGOU' ? 'Quem está recebendo do hotel? *' : 'Quem está pagando o hotel? *'}
          </label>
          <input className="campo" type="text" value={fNome}
            onChange={(e) => setFNome(e.target.value)} placeholder="Nome completo ou razão social" />

          <div className="rc-duas">
            <div>
              <label className="rotulo">CPF ou CNPJ</label>
              <input className="campo" type="text" inputMode="numeric" value={fDocumento}
                onChange={(e) => setFDocumento(formatarDocumento(e.target.value))}
                placeholder="000.000.000-00" />
              {(() => {
                const status = fDocumento.trim() ? validarDocumento(fDocumento) : null;
                if (status === true) return <p className="rc-doc-ok">✓ documento válido</p>;
                if (status === false) return <p className="rc-doc-erro">✗ documento inválido</p>;
                return null;
              })()}
            </div>
            <div>
              <label className="rotulo">Valor (R$) *</label>
              <input className="campo" type="number" min="0.01" step="0.01" value={fValor}
                onChange={(e) => setFValor(e.target.value)} placeholder="0,00" />
            </div>
          </div>

          {Number(fValor) > 0 && (
            <p className="rc-extenso-previa">Por extenso: <em>{valorPorExtenso(Number(fValor))}</em></p>
          )}

          <label className="rotulo">Referente a *</label>
          <input className="campo" type="text" value={fReferente}
            onChange={(e) => setFReferente(e.target.value)} placeholder="Ex: pagamento de duas passagens" />

          <label className="rotulo">Método de pagamento</label>
          <select className="campo" value={fMetodo} onChange={(e) => setFMetodo(e.target.value)}>
            {METODOS_PAGAMENTO.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>

          {erroForm && <div className="aviso-erro">{erroForm}</div>}

          <button type="submit" className="botao botao-principal" disabled={salvando} style={{ marginTop: 16 }}>
            {salvando ? 'Gerando…' : 'Gerar e Imprimir Recibo'}
          </button>
        </form>
      )}

      {/* ================= RECIBOS EMITIDOS ================= */}
      {subAba === 'emitidos' && (
        <section>
          <input className="campo" type="search" value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, valor ou número do recibo…"
            aria-label="Buscar recibos" style={{ marginBottom: 14 }} />

          {carregando ? (
            <p className="texto-suave">Carregando recibos…</p>
          ) : recibosFiltrados.length === 0 ? (
            <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
              {busca ? 'Nenhum recibo encontrado com essa busca.' : 'Nenhum recibo emitido ainda.'}
            </div>
          ) : (
            <div className="rc-lista">
              {recibosFiltrados.map((r) => (
                <div key={r.id} className="cartao rc-item">
                  <div className="rc-item-esq">
                    <div className="rc-item-topo">
                      <span className="rc-numero">{r.numero}</span>
                      <span className="rc-tag" style={r.direcao === 'HOTEL_PAGOU'
                        ? { background: '#FCE8D9', color: '#A34E00' }
                        : { background: '#DDF2E4', color: '#1E6B3C' }}>
                        {r.direcao === 'HOTEL_PAGOU' ? 'Hotel pagou' : 'Hotel recebeu'}
                      </span>
                    </div>
                    <div className="rc-item-nome">{r.nome_contraparte}</div>
                    <div className="rc-item-meta">
                      {r.referente_a} · {r.metodo_pagamento} · Emitido por {nomeDe(r.emitido_por_id)} em {formatarDataHora(r.emitido_em)}
                    </div>
                    {r.reimpresso_em && (
                      <div className="rc-item-reimp">
                        Reimpresso por {nomeDe(r.reimpresso_por_id)} em {formatarDataHora(r.reimpresso_em)}
                      </div>
                    )}
                  </div>
                  <div className="rc-item-dir">
                    <div className="rc-valor">{dinheiro(r.valor)}</div>
                    <button type="button" className="botao botao-contorno" onClick={() => reimprimir(r)}>
                      Reimprimir
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ================= RECIBO (visualização + impressão) ================= */}
      {reciboAberto && pagador && recebedor && (
        <div className="rc-overlay" role="dialog" aria-modal="true">
          <div className="rc-modal">
            <div className="rc-modal-topo rc-nao-imprimir">
              <h2 style={{ fontSize: '1.15rem', margin: 0 }}>Recibo de pagamento</h2>
              <button type="button" className="rc-fechar" onClick={() => setReciboAberto(null)} aria-label="Fechar">✕</button>
            </div>

            {/* Folha do recibo (é o que sai na impressão) */}
            <div className="recibo-folha">
              <div className="rc-folha-cabecalho">
                <div>
                  <div style={{ fontWeight: 700, fontSize: 17 }}>{nomeHotel}</div>
                  {hotel?.razao_social && <div style={{ fontSize: 11, color: '#555' }}>{hotel.razao_social}</div>}
                  {hotel?.documento && <div style={{ fontSize: 11, color: '#555' }}>C.N.P.J: {hotel.documento}</div>}
                </div>
                <div className="rc-folha-caixa">
                  <div style={{ fontSize: 11, color: '#555' }}>RECIBO Nº</div>
                  <div style={{ fontWeight: 700 }}>{reciboAberto.numero}</div>
                  <div style={{ fontSize: 11, color: '#555', marginTop: 6 }}>VALOR</div>
                  <div style={{ fontWeight: 700 }}>{dinheiro(reciboAberto.valor)}</div>
                </div>
              </div>

              <h3 style={{ textAlign: 'center', margin: '18px 0 14px', fontSize: 15, letterSpacing: '0.08em' }}>
                RECIBO DE PAGAMENTO
              </h3>

              <p style={{ fontSize: 13, lineHeight: 1.8, textAlign: 'justify' }}>
                Recebemos de <strong>{pagador.nome}</strong>
                {pagador.doc ? <>, C.P.F/C.N.P.J nº <strong>{pagador.doc}</strong></> : null}, a importância de{' '}
                <strong>{dinheiro(reciboAberto.valor)} ({valorPorExtenso(Number(reciboAberto.valor))})</strong>,
                referente a <strong>{reciboAberto.referente_a}</strong>, paga por meio de{' '}
                <strong>{reciboAberto.metodo_pagamento}</strong>.
              </p>
              <p style={{ fontSize: 13, lineHeight: 1.8 }}>
                Para maior clareza, firmamos o presente recibo, dando plena e total quitação do valor recebido.
              </p>

              <p style={{ fontSize: 13, marginTop: 22 }}>
                {cidadeHotel || '[cidade não cadastrada]'}, {dataPorExtenso(reciboAberto.emitido_em)}.
              </p>

              <div style={{ marginTop: 52, textAlign: 'center' }}>
                <div style={{ borderTop: '1px solid #333', width: '70%', margin: '0 auto', paddingTop: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{recebedor.nome}</div>
                  <div style={{ fontSize: 11, color: '#555' }}>
                    C.N.P.J / C.P.F: {recebedor.doc || '________________________'}
                  </div>
                </div>
              </div>
            </div>

            <div className="rc-modal-botoes rc-nao-imprimir">
              <button type="button" className="botao botao-principal" onClick={() => window.print()}>
                🖨️ Imprimir
              </button>
              <button type="button" className="botao botao-suave" onClick={() => setReciboAberto(null)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// ---- Estilos específicos deste módulo ---------------------------------------

function EstilosRecibos() {
  return (
    <style>{`
      .rc-abas { display: flex; gap: 6px; margin: 14px 0 16px; }
      .rc-aba {
        border: 1px solid var(--borda); background: var(--branco); color: var(--tinta);
        border-radius: 999px; padding: 10px 16px; font-size: 14px; font-weight: 600;
        cursor: pointer; min-height: 42px;
      }
      .rc-aba-ativa { background: var(--marca); border-color: var(--marca); color: var(--branco); }
      .rc-contador {
        display: inline-block; margin-left: 6px; font-size: 12px;
        background: rgba(0,0,0,0.10); border-radius: 999px; padding: 1px 8px;
      }
      .rc-aba-ativa .rc-contador { background: rgba(255,255,255,0.22); }

      .rc-direcao { display: grid; grid-template-columns: 1fr; gap: 8px; }
      .rc-dir-botao {
        border: 2px solid var(--borda); background: var(--branco); color: var(--tinta);
        border-radius: 12px; padding: 14px; font-size: 15px; cursor: pointer;
        font-family: inherit; text-align: left; min-height: 52px;
      }
      .rc-dir-ativo { border-color: var(--marca); background: var(--marca-clara); }

      .rc-duas { display: grid; grid-template-columns: 1fr; gap: 0 14px; }
      .rc-extenso-previa {
        font-size: 13px; color: var(--marca); background: var(--marca-clara);
        border-radius: 10px; padding: 8px 12px; margin: 8px 0 0;
      }
      .rc-doc-ok { color: var(--sucesso-texto); font-weight: 700; font-size: 13px; margin: 6px 0 0; }
      .rc-doc-erro { color: var(--erro-texto); font-weight: 700; font-size: 13px; margin: 6px 0 0; }

      .rc-cidade-form { display: inline-flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
      .rc-cidade-form .campo { width: auto; flex: 1; min-width: 180px; }

      .rc-lista { display: flex; flex-direction: column; gap: 12px; }
      .rc-item { display: flex; flex-direction: column; gap: 10px; padding: 16px; }
      .rc-item-topo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .rc-numero { font-family: var(--fonte-titulo); font-weight: 700; font-size: 14px; color: var(--texto-suave); }
      .rc-tag { display: inline-block; font-size: 12px; font-weight: 700; border-radius: 999px; padding: 3px 10px; }
      .rc-item-nome { font-weight: 700; font-size: 16px; }
      .rc-item-meta { font-size: 13px; color: var(--texto-suave); }
      .rc-item-reimp {
        font-size: 12px; color: var(--latao-texto); background: #F4ECD7;
        border-radius: 8px; padding: 5px 10px; margin-top: 6px; display: inline-block;
      }
      .rc-valor { font-family: var(--fonte-titulo); font-weight: 700; font-size: 22px; color: var(--marca); }

      .rc-overlay {
        position: fixed; inset: 0; background: rgba(15, 25, 22, 0.45);
        display: flex; align-items: flex-end; justify-content: center; z-index: 70;
      }
      .rc-modal {
        background: var(--branco); width: 100%; max-height: 92vh; overflow-y: auto;
        border-radius: 18px 18px 0 0; padding: 18px;
      }
      .rc-modal-topo { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
      .rc-fechar {
        border: none; background: #E9ECE8; border-radius: 999px;
        width: 40px; height: 40px; font-size: 16px; cursor: pointer; flex-shrink: 0;
      }
      .rc-modal-botoes { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }

      .recibo-folha {
        border: 1px solid var(--borda); border-radius: 12px; padding: 22px;
        background: #FFFFFF; color: #1a1a1a;
      }
      .rc-folha-cabecalho { display: flex; justify-content: space-between; gap: 14px; align-items: flex-start; }
      .rc-folha-caixa {
        border: 1px solid #333; border-radius: 8px; padding: 8px 14px; text-align: center;
        font-size: 14px; flex-shrink: 0;
      }

      @media (min-width: 640px) {
        .rc-direcao { grid-template-columns: 1fr 1fr; }
        .rc-duas { grid-template-columns: 1fr 1fr; }
        .rc-item { flex-direction: row; justify-content: space-between; align-items: flex-start; }
        .rc-item-dir { text-align: right; display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }
        .rc-overlay { align-items: center; padding: 24px; }
        .rc-modal { max-width: 680px; border-radius: 18px; padding: 24px; }
      }

      /* Impressão: só a folha do recibo sai no papel */
      @media print {
        body * { visibility: hidden; }
        .recibo-folha, .recibo-folha * { visibility: visible; }
        .recibo-folha { position: fixed; top: 0; left: 0; width: 100%; border: none; padding: 24px; }
        .rc-nao-imprimir { display: none !important; }
      }
    `}</style>
  );
}
