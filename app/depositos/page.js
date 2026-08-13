'use client';

// ============================================================================
// DEPÓSITOS BANCÁRIOS
// - Registro dos depósitos que caem na conta do hotel, para conferência
//   e vínculo (baixa) com o hóspede/fatura correspondente
// - Cadastro manual e Importação de CSV: SÓ ADMIN (com prévia e
//   anti-duplicidade por documento + valor + data, inclusive dentro do
//   próprio arquivo)
// - "Fazer Lançamento" (baixa): toda a equipe pode
// - Estorno: SÓ ADMIN (garantido também no banco, via RLS)
// - Lista padrão mostra só PENDENTES; a busca avançada mostra tudo,
//   inclusive os já baixados
// - Logs de Lançamentos: imutável, visível só para o ADMIN
// ============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

// ---- Constantes (mesmas do protótipo) ---------------------------------------

const TIPO_DEPOSITO_LABEL = {
  PIX: 'Pix', TED: 'TED', DOC: 'DOC', DINHEIRO: 'Dinheiro', CREDITO_CONTA: 'Crédito em Conta',
};
const BANCOS_SUGERIDOS = [
  'Banco do Brasil', 'Caixa Econômica', 'Bradesco', 'Itaú', 'Santander',
  'Nubank', 'Stone', 'Banco Cora', 'Inter', 'Sicoob', 'Outro',
];

// ---- Funções de apoio -------------------------------------------------------

function dinheiro(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(valor || 0));
}

function formatarData(valor) {
  if (!valor) return '—';
  const [ano, mes, dia] = String(valor).slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

function formatarDataHora(valor) {
  if (!valor) return '—';
  try {
    return new Date(valor).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch (e) { return String(valor); }
}

// Aceita "DD/MM/AAAA" ou "AAAA-MM-DD"; devolve "AAAA-MM-DD" ou null
function normalizarDataImportada(texto) {
  const t = String(texto || '').trim();
  let m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return t;
  return null;
}

// Aceita "1.234,56", "1234,56" e "1234.56"; devolve número ou null
function normalizarValorImportado(texto) {
  let t = String(texto || '').trim().replace(/R\$\s?/i, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function normalizarTipoImportado(texto) {
  const t = String(texto || '');
  if (/pix/i.test(t)) return 'PIX';
  if (/ted/i.test(t)) return 'TED';
  if (/doc/i.test(t)) return 'DOC';
  if (/dinheiro/i.test(t)) return 'DINHEIRO';
  if (/cr[eé]dito/i.test(t)) return 'CREDITO_CONTA';
  return 'PIX';
}

// Leitor de CSV simples e robusto: detecta ; ou , e respeita aspas
function lerCSV(textoCsv) {
  const linhasBrutas = textoCsv.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
    .filter((l) => l.trim() !== '');
  if (linhasBrutas.length === 0) return { cabecalho: [], linhas: [] };

  const cabecalhoBruto = linhasBrutas[0];
  const delim = (cabecalhoBruto.match(/;/g) || []).length > (cabecalhoBruto.match(/,/g) || []).length ? ';' : ',';

  function quebrarLinha(linha) {
    const campos = [];
    let atual = '';
    let dentroAspas = false;
    for (let i = 0; i < linha.length; i++) {
      const ch = linha[i];
      if (ch === '"') {
        if (dentroAspas && linha[i + 1] === '"') { atual += '"'; i++; }
        else dentroAspas = !dentroAspas;
      } else if (ch === delim && !dentroAspas) {
        campos.push(atual); atual = '';
      } else {
        atual += ch;
      }
    }
    campos.push(atual);
    return campos.map((c) => c.trim());
  }

  const cabecalho = quebrarLinha(linhasBrutas[0]);
  const linhas = linhasBrutas.slice(1).map(quebrarLinha);
  return { cabecalho, linhas };
}

// Descobre qual coluna do CSV corresponde a cada campo (pelo nome do cabeçalho;
// se não reconhecer, usa a ordem padrão do modelo)
function mapearColunas(cabecalho) {
  const norm = cabecalho.map((c) =>
    c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  );
  function acha(...palavras) {
    return norm.findIndex((c) => palavras.some((p) => c.includes(p)));
  }
  const mapa = {
    data: acha('data'),
    nome: acha('depositante', 'nome'),
    valor: acha('valor'),
    documento: acha('documento', 'comprovante'),
    banco: acha('banco'),
    tipo: acha('tipo'),
  };
  // Ordem padrão do modelo, caso o cabeçalho não seja reconhecido:
  if (mapa.data < 0) mapa.data = 0;
  if (mapa.nome < 0) mapa.nome = 1;
  if (mapa.valor < 0) mapa.valor = 2;
  if (mapa.documento < 0) mapa.documento = 3;
  if (mapa.banco < 0) mapa.banco = 4;
  if (mapa.tipo < 0) mapa.tipo = 5;
  return mapa;
}

function chaveDuplicidade(doc, valor, data) {
  return `${String(doc || '').trim().toLowerCase()}|${Number(valor).toFixed(2)}|${data}`;
}

// ---- Componente principal ---------------------------------------------------

export default function DepositosBancarios() {
  const router = useRouter();

  const [verificandoLogin, setVerificandoLogin] = useState(true);
  const [usuario, setUsuario] = useState(null);
  const [nomesUsuarios, setNomesUsuarios] = useState({});

  const [subAba, setSubAba] = useState('depositos'); // 'depositos' | 'importar' | 'logs'
  const [depositos, setDepositos] = useState([]);
  const [logs, setLogs] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);

  // Cadastro manual (admin)
  const [mostrarForm, setMostrarForm] = useState(false);
  const [fData, setFData] = useState('');
  const [fNome, setFNome] = useState('');
  const [fValor, setFValor] = useState('');
  const [fDocumento, setFDocumento] = useState('');
  const [fBanco, setFBanco] = useState('Banco do Brasil');
  const [fBancoOutro, setFBancoOutro] = useState('');
  const [fTipo, setFTipo] = useState('PIX');
  const [erroForm, setErroForm] = useState('');

  // Busca avançada
  const [bNome, setBNome] = useState('');
  const [bValor, setBValor] = useState('');
  const [bDataExata, setBDataExata] = useState('');
  const [bDataDe, setBDataDe] = useState('');
  const [bDataAte, setBDataAte] = useState('');
  const [bBanco, setBBanco] = useState('');
  const [bDocumento, setBDocumento] = useState('');
  const [buscaAtiva, setBuscaAtiva] = useState(null);
  const [mostrarBusca, setMostrarBusca] = useState(false);

  // Baixa / estorno / detalhes
  const [baixando, setBaixando] = useState(null);
  const [baixaPax, setBaixaPax] = useState('');
  const [baixaFatura, setBaixaFatura] = useState('');
  const [erroBaixa, setErroBaixa] = useState('');
  const [estornando, setEstornando] = useState(null);
  const [verDetalhe, setVerDetalhe] = useState(null);

  // Importação de CSV (admin)
  const [csvNomeArquivo, setCsvNomeArquivo] = useState('');
  const [csvPrevia, setCsvPrevia] = useState(null); // { prontas: [], ignoradas: [] }
  const [csvResultado, setCsvResultado] = useState('');

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

    const { data: lista, error: e1 } = await supabase
      .from('depositos')
      .select('*')
      .order('data_deposito', { ascending: false })
      .order('criado_em', { ascending: false });
    if (e1) setErro('Não foi possível carregar os depósitos. Detalhe técnico: ' + e1.message);
    else setDepositos(lista || []);

    if (u.papel === 'ADMIN') {
      const { data: ls } = await supabase
        .from('depositos_log')
        .select('*')
        .order('data_hora', { ascending: false })
        .limit(300);
      setLogs(ls || []);
    }
    setCarregando(false);
  }, []);

  useEffect(() => {
    if (usuario) carregarTudo(usuario);
  }, [usuario, carregarTudo]);

  async function registrarLog(acao, detalhe) {
    await supabase.from('depositos_log').insert({
      usuario_id: usuario.id, acao, detalhe, hotel_id: usuario.hotel_id,
    });
  }

  // ---- Cadastro manual (admin) ----
  async function salvarDeposito(evento) {
    evento.preventDefault();
    if (salvando) return;
    setErroForm('');

    const bancoFinal = fBanco === 'Outro' ? fBancoOutro.trim() : fBanco;
    if (!fData) { setErroForm('Informe a data do depósito.'); return; }
    if (!fNome.trim()) { setErroForm('Informe o nome do depositante.'); return; }
    if (!(Number(fValor) > 0)) { setErroForm('Informe um valor maior que zero.'); return; }
    if (!bancoFinal) { setErroForm('Informe o banco.'); return; }

    // Aviso de possível duplicidade (documento + valor + data)
    if (fDocumento.trim()) {
      const chave = chaveDuplicidade(fDocumento, Number(fValor), fData);
      const jaExiste = depositos.some((d) =>
        d.numero_documento && chaveDuplicidade(d.numero_documento, d.valor, d.data_deposito) === chave
      );
      if (jaExiste) {
        setErroForm('Já existe um depósito com este mesmo documento, valor e data — provável duplicidade. Confira antes de salvar de novo.');
        return;
      }
    }

    setSalvando(true);
    const { error } = await supabase.from('depositos').insert({
      data_deposito: fData,
      nome_depositante: fNome.trim(),
      valor: Number(fValor),
      numero_documento: fDocumento.trim() || null,
      banco: bancoFinal,
      tipo_deposito: fTipo,
      origem: 'MANUAL',
      criado_por_id: usuario.id,
      hotel_id: usuario.hotel_id,
    });
    setSalvando(false);
    if (error) { setErroForm('Não foi possível salvar. Detalhe técnico: ' + error.message); return; }

    await registrarLog('Cadastro Manual',
      `Depósito de ${fNome.trim()} — ${dinheiro(fValor)} em ${formatarData(fData)}. Doc: ${fDocumento.trim() || '—'}.`);

    setFData(''); setFNome(''); setFValor(''); setFDocumento('');
    setFBanco('Banco do Brasil'); setFBancoOutro(''); setFTipo('PIX');
    setMostrarForm(false);
    mostrarAviso('Depósito cadastrado!');
    carregarTudo(usuario);
  }

  // ---- Baixa (Fazer Lançamento) ----
  async function confirmarBaixa() {
    if (!baixando || salvando) return;
    setErroBaixa('');
    if (!baixaPax.trim()) { setErroBaixa('Informe o nome do hóspede vinculado.'); return; }

    setSalvando(true);
    const { error } = await supabase
      .from('depositos')
      .update({
        status_baixa: true,
        nome_pax: baixaPax.trim(),
        numero_fatura_reserva: baixaFatura.trim() || null,
        baixado_por_id: usuario.id,
        baixado_em: new Date().toISOString(),
      })
      .eq('id', baixando.id);
    setSalvando(false);
    if (error) { setErroBaixa('Não foi possível dar baixa. Detalhe técnico: ' + error.message); return; }

    await registrarLog('Baixa de Depósito',
      `Depósito de ${baixando.nome_depositante} (${dinheiro(baixando.valor)}) vinculado a ${baixaPax.trim()}. Fatura/reserva: ${baixaFatura.trim() || '—'}.`);

    setBaixando(null); setBaixaPax(''); setBaixaFatura('');
    mostrarAviso('Baixa registrada! O depósito saiu da lista de pendentes.');
    carregarTudo(usuario);
  }

  // ---- Estorno (admin) ----
  async function confirmarEstorno() {
    if (!estornando || salvando) return;
    setSalvando(true);
    const { error } = await supabase
      .from('depositos')
      .update({
        status_baixa: false,
        nome_pax: null,
        numero_fatura_reserva: null,
        baixado_por_id: null,
        baixado_em: null,
      })
      .eq('id', estornando.id);
    setSalvando(false);
    if (error) { setErro('Não foi possível estornar. Detalhe técnico: ' + error.message); setEstornando(null); return; }

    await registrarLog('Estorno de Lançamento',
      `Baixa desfeita: depósito de ${estornando.nome_depositante} (${dinheiro(estornando.valor)}), antes vinculado a ${estornando.nome_pax || '—'}. Voltou para pendentes.`);

    setEstornando(null);
    mostrarAviso('Lançamento estornado — o depósito voltou para a lista de pendentes.');
    carregarTudo(usuario);
  }

  // ---- Busca avançada ----
  function pesquisar() {
    setBuscaAtiva({
      nome: bNome.trim().toLowerCase(),
      valor: bValor ? Number(bValor) : null,
      dataExata: bDataExata || null,
      dataDe: bDataDe || null,
      dataAte: bDataAte || null,
      banco: bBanco.trim().toLowerCase(),
      documento: bDocumento.trim().toLowerCase(),
    });
  }

  function limparBusca() {
    setBNome(''); setBValor(''); setBDataExata(''); setBDataDe('');
    setBDataAte(''); setBBanco(''); setBDocumento('');
    setBuscaAtiva(null);
  }

  const listaVisivel = depositos.filter((d) => {
    if (!buscaAtiva) return !d.status_baixa; // padrão: só pendentes
    const b = buscaAtiva;
    if (b.nome && !(d.nome_depositante || '').toLowerCase().includes(b.nome)
      && !(d.nome_pax || '').toLowerCase().includes(b.nome)) return false;
    if (b.valor !== null && Number(d.valor) !== b.valor) return false;
    if (b.dataExata && String(d.data_deposito).slice(0, 10) !== b.dataExata) return false;
    if (b.dataDe && String(d.data_deposito).slice(0, 10) < b.dataDe) return false;
    if (b.dataAte && String(d.data_deposito).slice(0, 10) > b.dataAte) return false;
    if (b.banco && !(d.banco || '').toLowerCase().includes(b.banco)) return false;
    if (b.documento && !(d.numero_documento || '').toLowerCase().includes(b.documento)) return false;
    return true;
  });

  const totalPendentes = depositos.filter((d) => !d.status_baixa).length;

  // ---- Importação de CSV (admin) ----
  function processarCSV(arquivo) {
    setCsvResultado('');
    setCsvPrevia(null);
    if (!arquivo) return;
    setCsvNomeArquivo(arquivo.name);

    const leitor = new FileReader();
    leitor.onload = () => {
      const { linhas, cabecalho } = lerCSV(String(leitor.result || ''));
      const mapa = mapearColunas(cabecalho);

      const chavesExistentes = new Set(
        depositos
          .filter((d) => d.numero_documento)
          .map((d) => chaveDuplicidade(d.numero_documento, d.valor, String(d.data_deposito).slice(0, 10)))
      );
      const chavesDoArquivo = new Set();

      const prontas = [];
      const ignoradas = [];

      linhas.forEach((campos, indice) => {
        const bruto = {
          data: campos[mapa.data], nome: campos[mapa.nome], valor: campos[mapa.valor],
          documento: campos[mapa.documento], banco: campos[mapa.banco], tipo: campos[mapa.tipo],
        };
        const numeroLinha = indice + 2; // +2 por causa do cabeçalho

        const data = normalizarDataImportada(bruto.data);
        if (!data) { ignoradas.push({ linha: numeroLinha, bruto, motivo: 'Data inválida (use DD/MM/AAAA)' }); return; }
        const valor = normalizarValorImportado(bruto.valor);
        if (valor === null) { ignoradas.push({ linha: numeroLinha, bruto, motivo: 'Valor inválido' }); return; }
        if (!String(bruto.nome || '').trim()) { ignoradas.push({ linha: numeroLinha, bruto, motivo: 'Nome do depositante vazio' }); return; }

        const doc = String(bruto.documento || '').trim();
        if (doc) {
          const chave = chaveDuplicidade(doc, valor, data);
          if (chavesExistentes.has(chave)) {
            ignoradas.push({ linha: numeroLinha, bruto, motivo: 'Duplicada: já existe no sistema (mesmo documento, valor e data)' });
            return;
          }
          if (chavesDoArquivo.has(chave)) {
            ignoradas.push({ linha: numeroLinha, bruto, motivo: 'Duplicada dentro do próprio arquivo' });
            return;
          }
          chavesDoArquivo.add(chave);
        }

        prontas.push({
          data_deposito: data,
          nome_depositante: String(bruto.nome).trim(),
          valor,
          numero_documento: doc || null,
          banco: String(bruto.banco || '').trim() || null,
          tipo_deposito: normalizarTipoImportado(bruto.tipo),
        });
      });

      setCsvPrevia({ prontas, ignoradas });
    };
    leitor.onerror = () => setErro('Não foi possível ler o arquivo CSV.');
    leitor.readAsText(arquivo);
  }

  async function confirmarImportacao() {
    if (!csvPrevia || csvPrevia.prontas.length === 0 || salvando) return;
    setSalvando(true);

    const registros = csvPrevia.prontas.map((r) => ({
      ...r, origem: 'CSV', criado_por_id: usuario.id, hotel_id: usuario.hotel_id,
    }));

    // Insere em blocos de 100 para não pesar
    let inseridos = 0;
    let falha = null;
    for (let i = 0; i < registros.length; i += 100) {
      const bloco = registros.slice(i, i + 100);
      const { error } = await supabase.from('depositos').insert(bloco);
      if (error) { falha = error.message; break; }
      inseridos += bloco.length;
    }
    setSalvando(false);

    if (falha && inseridos === 0) {
      setErro('A importação falhou. Detalhe técnico: ' + falha);
      return;
    }

    await registrarLog('Importação de CSV',
      `Arquivo "${csvNomeArquivo}": ${inseridos} linha(s) importadas, ${csvPrevia.ignoradas.length} ignoradas.`);

    setCsvResultado(
      `Importação concluída: ${inseridos} depósito(s) importado(s)` +
      (csvPrevia.ignoradas.length ? `, ${csvPrevia.ignoradas.length} linha(s) ignorada(s).` : '.') +
      (falha ? ` Atenção: parte do arquivo falhou (${falha}).` : '')
    );
    setCsvPrevia(null);
    setCsvNomeArquivo('');
    carregarTudo(usuario);
  }

  if (verificandoLogin) {
    return (
      <main className="conteudo">
        <p className="texto-suave">Verificando seu acesso…</p>
      </main>
    );
  }

  // ---- Interface -------------------------------------------------------------

  return (
    <main className="conteudo">
      <EstilosDepositos />

      <span className="olho">Conferência financeira</span>
      <div className="barra-pagina">
        <h1 style={{ margin: 0 }}>Depósitos Bancários</h1>
        {souAdmin && subAba === 'depositos' && (
          <button type="button" className="botao botao-principal"
            onClick={() => { setMostrarForm(!mostrarForm); setErroForm(''); }}>
            {mostrarForm ? 'Fechar' : '+ Novo Depósito'}
          </button>
        )}
      </div>

      {aviso && <div className="aviso-sucesso">{aviso}</div>}
      {erro && <div className="aviso-erro">{erro}</div>}

      {/* Sub-abas */}
      <nav className="dp-abas" aria-label="Seções">
        <button type="button" className={subAba === 'depositos' ? 'dp-aba dp-aba-ativa' : 'dp-aba'}
          onClick={() => setSubAba('depositos')}>
          Depósitos <span className="dp-contador">{totalPendentes} pendentes</span>
        </button>
        {souAdmin && (
          <button type="button" className={subAba === 'importar' ? 'dp-aba dp-aba-ativa' : 'dp-aba'}
            onClick={() => { setSubAba('importar'); setCsvResultado(''); }}>
            Importar CSV
          </button>
        )}
        {souAdmin && (
          <button type="button" className={subAba === 'logs' ? 'dp-aba dp-aba-ativa' : 'dp-aba'}
            onClick={() => setSubAba('logs')}>
            Logs de Lançamentos
          </button>
        )}
      </nav>

      {/* ================= DEPÓSITOS ================= */}
      {subAba === 'depositos' && (
        <section>
          {/* Cadastro manual (admin) */}
          {mostrarForm && souAdmin && (
            <form className="cartao" style={{ marginBottom: 16 }} onSubmit={salvarDeposito}>
              <h2 style={{ fontSize: '1.15rem', marginBottom: 4 }}>Novo depósito</h2>

              <div className="dp-duas">
                <div>
                  <label className="rotulo">Data do depósito *</label>
                  <input className="campo" type="date" value={fData} onChange={(e) => setFData(e.target.value)} />
                </div>
                <div>
                  <label className="rotulo">Valor (R$) *</label>
                  <input className="campo" type="number" min="0.01" step="0.01" value={fValor}
                    onChange={(e) => setFValor(e.target.value)} placeholder="0,00" />
                </div>
              </div>

              <label className="rotulo">Nome do depositante *</label>
              <input className="campo" type="text" value={fNome}
                onChange={(e) => setFNome(e.target.value)} placeholder="Nome completo de quem depositou" />

              <div className="dp-duas">
                <div>
                  <label className="rotulo">Banco *</label>
                  <select className="campo" value={fBanco} onChange={(e) => setFBanco(e.target.value)}>
                    {BANCOS_SUGERIDOS.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <label className="rotulo">Tipo de depósito</label>
                  <select className="campo" value={fTipo} onChange={(e) => setFTipo(e.target.value)}>
                    {Object.entries(TIPO_DEPOSITO_LABEL).map(([chave, rotulo]) => (
                      <option key={chave} value={chave}>{rotulo}</option>
                    ))}
                  </select>
                </div>
              </div>

              {fBanco === 'Outro' && (
                <>
                  <label className="rotulo">Nome do banco *</label>
                  <input className="campo" type="text" value={fBancoOutro}
                    onChange={(e) => setFBancoOutro(e.target.value)} placeholder="Digite o nome do banco" />
                </>
              )}

              <label className="rotulo">Número do documento / comprovante</label>
              <input className="campo" type="text" value={fDocumento}
                onChange={(e) => setFDocumento(e.target.value)} placeholder="Nº do comprovante" />

              {erroForm && <div className="aviso-erro">{erroForm}</div>}

              <button type="submit" className="botao botao-principal" disabled={salvando} style={{ marginTop: 16 }}>
                {salvando ? 'Salvando…' : 'Salvar'}
              </button>
            </form>
          )}

          {/* Busca avançada */}
          <div className="cartao dp-busca">
            <button type="button" className="dp-busca-titulo"
              onClick={() => setMostrarBusca(!mostrarBusca)} aria-expanded={mostrarBusca}>
              🔎 Busca avançada {buscaAtiva ? '(ativa — mostrando inclusive baixados)' : ''}
              <span>{mostrarBusca ? '▲' : '▼'}</span>
            </button>
            {mostrarBusca && (
              <div>
                <div className="dp-busca-grade">
                  <input className="campo" type="text" value={bNome}
                    onChange={(e) => setBNome(e.target.value)} placeholder="Busca parcial... (depositante ou hóspede)" />
                  <input className="campo" type="number" step="0.01" value={bValor}
                    onChange={(e) => setBValor(e.target.value)} placeholder="Valor exato (R$)" />
                  <input className="campo" type="text" value={bDocumento}
                    onChange={(e) => setBDocumento(e.target.value)} placeholder="Nº do documento" />
                  <input className="campo" type="text" value={bBanco}
                    onChange={(e) => setBBanco(e.target.value)} placeholder="Banco" />
                </div>
                <div className="dp-busca-datas">
                  <label className="rotulo-mini">Data exata</label>
                  <input className="campo" type="date" value={bDataExata} onChange={(e) => setBDataExata(e.target.value)} />
                  <label className="rotulo-mini">De</label>
                  <input className="campo" type="date" value={bDataDe} onChange={(e) => setBDataDe(e.target.value)} />
                  <label className="rotulo-mini">Até</label>
                  <input className="campo" type="date" value={bDataAte} onChange={(e) => setBDataAte(e.target.value)} />
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                  <button type="button" className="botao botao-principal" onClick={pesquisar}>Pesquisar</button>
                  <button type="button" className="botao botao-suave" onClick={limparBusca}>Limpar</button>
                </div>
              </div>
            )}
          </div>

          {!buscaAtiva && (
            <p className="texto-suave" style={{ fontSize: 13 }}>
              Mostrando só os depósitos <strong>pendentes</strong>. Para ver os já baixados, use a busca avançada.
            </p>
          )}

          {/* Lista */}
          {carregando ? (
            <p className="texto-suave">Carregando depósitos…</p>
          ) : listaVisivel.length === 0 ? (
            <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
              {buscaAtiva
                ? 'Nenhum depósito encontrado com esses critérios.'
                : 'Nenhum depósito pendente. Tudo conferido! ✔'}
            </div>
          ) : (
            <div className="dp-lista">
              {listaVisivel.map((d) => (
                <div key={d.id} className="cartao dp-item">
                  <div className="dp-item-esq">
                    <div className="dp-item-topo">
                      <strong>{d.nome_depositante}</strong>
                      <span className="dp-tag" style={d.status_baixa
                        ? { background: '#DDF2E4', color: '#1E6B3C' }
                        : { background: '#FBDDDD', color: '#A31212' }}>
                        {d.status_baixa ? 'Baixado' : 'Pendente'}
                      </span>
                      <span className="dp-tag dp-tag-tipo">{TIPO_DEPOSITO_LABEL[d.tipo_deposito] || d.tipo_deposito}</span>
                      {d.origem === 'CSV' && <span className="dp-tag dp-tag-csv">Importado</span>}
                    </div>
                    <div className="dp-item-meta">
                      {formatarData(d.data_deposito)} · {d.banco || '—'} · Doc: {d.numero_documento || '—'}
                    </div>
                    {d.status_baixa && (
                      <div className="dp-item-baixa">
                        Vinculado a <strong>{d.nome_pax}</strong> · Fatura/reserva: {d.numero_fatura_reserva || '—'} · por {nomeDe(d.baixado_por_id)} em {formatarDataHora(d.baixado_em)}
                      </div>
                    )}
                  </div>
                  <div className="dp-item-dir">
                    <div className="dp-valor">{dinheiro(d.valor)}</div>
                    <div className="dp-item-acoes">
                      <button type="button" className="botao botao-suave" onClick={() => setVerDetalhe(d)}>
                        Detalhes
                      </button>
                      {!d.status_baixa && (
                        <button type="button" className="botao botao-principal"
                          onClick={() => { setBaixando(d); setBaixaPax(''); setBaixaFatura(''); setErroBaixa(''); }}>
                          Fazer Lançamento
                        </button>
                      )}
                      {d.status_baixa && souAdmin && (
                        <button type="button" className="botao botao-perigo" onClick={() => setEstornando(d)}>
                          Estornar
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ================= IMPORTAR CSV (admin) ================= */}
      {subAba === 'importar' && souAdmin && (
        <section>
          <div className="cartao">
            <h2 style={{ fontSize: '1.15rem', marginBottom: 4 }}>Importar depósitos por CSV</h2>
            <p className="texto-suave" style={{ fontSize: 14 }}>
              O arquivo deve ter as colunas: <strong>Data do deposito, Nome do depositante, Valor,
              Numero do documento, Banco, Tipo de deposito</strong> (com cabeçalho na primeira linha).
              Datas em DD/MM/AAAA e valores como 150,00. Linhas duplicadas (mesmo documento + valor + data),
              contra o sistema ou dentro do próprio arquivo, são detectadas e ignoradas.
            </p>

            <label className="rotulo">Arquivo CSV</label>
            <input className="campo" type="file" accept=".csv,text/csv"
              onChange={(e) => processarCSV(e.target.files?.[0])} />

            {csvResultado && <div className="aviso-sucesso">{csvResultado}</div>}

            {csvPrevia && (
              <div style={{ marginTop: 16 }}>
                <div className="dp-previa-resumo">
                  <span className="dp-previa-ok">✔ {csvPrevia.prontas.length} linha(s) prontas para importar</span>
                  {csvPrevia.ignoradas.length > 0 && (
                    <span className="dp-previa-ig">✖ {csvPrevia.ignoradas.length} linha(s) serão ignoradas</span>
                  )}
                </div>

                {csvPrevia.ignoradas.length > 0 && (
                  <div className="dp-ignoradas">
                    {csvPrevia.ignoradas.map((ig, i) => (
                      <div key={i} className="dp-ignorada">
                        <strong>Linha {ig.linha}:</strong> {ig.bruto.nome || '(sem nome)'} — {ig.motivo}
                      </div>
                    ))}
                  </div>
                )}

                {csvPrevia.prontas.length > 0 && (
                  <div className="dp-previa-lista">
                    {csvPrevia.prontas.slice(0, 8).map((p, i) => (
                      <div key={i} className="dp-previa-linha">
                        {formatarData(p.data_deposito)} · {p.nome_depositante} · {dinheiro(p.valor)} · {p.banco || '—'} · Doc: {p.numero_documento || '—'}
                      </div>
                    ))}
                    {csvPrevia.prontas.length > 8 && (
                      <div className="texto-suave" style={{ fontSize: 13 }}>
                        … e mais {csvPrevia.prontas.length - 8} linha(s).
                      </div>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                  <button type="button" className="botao botao-principal"
                    onClick={confirmarImportacao}
                    disabled={salvando || csvPrevia.prontas.length === 0}>
                    {salvando ? 'Importando…' : 'Confirmar importação'}
                  </button>
                  <button type="button" className="botao botao-suave"
                    onClick={() => { setCsvPrevia(null); setCsvNomeArquivo(''); }}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ================= LOGS (admin) ================= */}
      {subAba === 'logs' && souAdmin && (
        <section className="dp-lista">
          {logs.length === 0 ? (
            <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
              Nenhum registro no log ainda.
            </div>
          ) : (
            logs.map((l) => (
              <div key={l.id} className="cartao" style={{ padding: '12px 16px' }}>
                <div>
                  <strong>{nomeDe(l.usuario_id)}</strong>{' '}
                  <span className="dp-log-acao">{l.acao}</span>
                </div>
                {l.detalhe && <div style={{ fontSize: 14, marginTop: 3 }}>{l.detalhe}</div>}
                <div className="texto-suave" style={{ fontSize: 12 }}>{formatarDataHora(l.data_hora)}</div>
              </div>
            ))
          )}
        </section>
      )}

      {/* ================= MODAIS ================= */}

      {/* Fazer Lançamento (baixa) */}
      {baixando && (
        <div className="dp-overlay" role="dialog" aria-modal="true">
          <div className="dp-modal">
            <div className="dp-modal-topo">
              <h2 style={{ fontSize: '1.15rem', margin: 0 }}>Fazer Lançamento</h2>
              <button type="button" className="dp-fechar" onClick={() => setBaixando(null)} aria-label="Fechar">✕</button>
            </div>
            <p className="texto-suave" style={{ fontSize: 14 }}>
              Depósito de <strong>{baixando.nome_depositante}</strong> — {dinheiro(baixando.valor)} em {formatarData(baixando.data_deposito)}
            </p>

            <label className="rotulo">A qual hóspede este depósito pertence? *</label>
            <input className="campo" type="text" value={baixaPax}
              onChange={(e) => setBaixaPax(e.target.value)} placeholder="Nome do hóspede" />

            <label className="rotulo">Número da fatura/reserva</label>
            <input className="campo" type="text" value={baixaFatura}
              onChange={(e) => setBaixaFatura(e.target.value)} placeholder="Número da fatura/reserva" />

            {erroBaixa && <div className="aviso-erro">{erroBaixa}</div>}

            <div className="dp-modal-botoes">
              <button type="button" className="botao botao-principal" onClick={confirmarBaixa} disabled={salvando}>
                {salvando ? 'Salvando…' : 'Confirmar Baixa'}
              </button>
              <button type="button" className="botao botao-suave" onClick={() => setBaixando(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Estorno (admin) */}
      {estornando && (
        <div className="dp-overlay" role="dialog" aria-modal="true">
          <div className="dp-modal">
            <div className="dp-modal-topo">
              <h2 style={{ fontSize: '1.15rem', margin: 0 }}>Estornar lançamento?</h2>
              <button type="button" className="dp-fechar" onClick={() => setEstornando(null)} aria-label="Fechar">✕</button>
            </div>
            <p style={{ fontSize: 14 }}>
              Isso vai desfazer a baixa deste depósito (atualmente vinculado a{' '}
              <strong>"{estornando.nome_pax}"</strong>) e ele voltará para a lista de pendentes.
            </p>
            <div className="dp-modal-botoes">
              <button type="button" className="botao botao-perigo" onClick={confirmarEstorno} disabled={salvando}>
                {salvando ? 'Estornando…' : 'Estornar'}
              </button>
              <button type="button" className="botao botao-suave" onClick={() => setEstornando(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Detalhes */}
      {verDetalhe && (
        <div className="dp-overlay" role="dialog" aria-modal="true">
          <div className="dp-modal">
            <div className="dp-modal-topo">
              <h2 style={{ fontSize: '1.15rem', margin: 0 }}>Detalhes do depósito</h2>
              <button type="button" className="dp-fechar" onClick={() => setVerDetalhe(null)} aria-label="Fechar">✕</button>
            </div>
            <div className="dp-ficha">
              <Linha rotulo="Depositante" valor={verDetalhe.nome_depositante} />
              <Linha rotulo="Valor" valor={dinheiro(verDetalhe.valor)} />
              <Linha rotulo="Data do depósito" valor={formatarData(verDetalhe.data_deposito)} />
              <Linha rotulo="Banco" valor={verDetalhe.banco} />
              <Linha rotulo="Tipo" valor={TIPO_DEPOSITO_LABEL[verDetalhe.tipo_deposito]} />
              <Linha rotulo="Nº do documento" valor={verDetalhe.numero_documento} />
              <Linha rotulo="Origem" valor={verDetalhe.origem === 'CSV' ? 'Importação de CSV' : 'Cadastro manual'} />
              <Linha rotulo="Cadastrado por" valor={`${nomeDe(verDetalhe.criado_por_id)} em ${formatarDataHora(verDetalhe.criado_em)}`} />
              <Linha rotulo="Status" valor={verDetalhe.status_baixa ? 'Baixado' : 'Pendente'} />
              {verDetalhe.status_baixa && (
                <>
                  <Linha rotulo="Hóspede vinculado" valor={verDetalhe.nome_pax} />
                  <Linha rotulo="Fatura/reserva" valor={verDetalhe.numero_fatura_reserva} />
                  <Linha rotulo="Baixado por" valor={`${nomeDe(verDetalhe.baixado_por_id)} em ${formatarDataHora(verDetalhe.baixado_em)}`} />
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// Linha de rótulo + valor da ficha
function Linha({ rotulo, valor }) {
  return (
    <div className="dp-linha">
      <span className="dp-linha-rotulo">{rotulo}</span>
      <span className="dp-linha-valor">{valor || '—'}</span>
    </div>
  );
}

// ---- Estilos específicos deste módulo ---------------------------------------

function EstilosDepositos() {
  return (
    <style>{`
      .dp-abas { display: flex; gap: 6px; overflow-x: auto; margin: 14px 0 16px; padding-bottom: 4px; }
      .dp-aba {
        border: 1px solid var(--borda); background: var(--branco); color: var(--tinta);
        border-radius: 999px; padding: 10px 16px; font-size: 14px; font-weight: 600;
        cursor: pointer; white-space: nowrap; min-height: 42px;
      }
      .dp-aba-ativa { background: var(--marca); border-color: var(--marca); color: var(--branco); }
      .dp-contador {
        display: inline-block; margin-left: 6px; font-size: 12px;
        background: rgba(0,0,0,0.10); border-radius: 999px; padding: 1px 8px;
      }
      .dp-aba-ativa .dp-contador { background: rgba(255,255,255,0.22); }

      .dp-duas { display: grid; grid-template-columns: 1fr; gap: 0 14px; }

      .dp-busca { padding: 0; overflow: hidden; margin-bottom: 14px; }
      .dp-busca-titulo {
        width: 100%; display: flex; justify-content: space-between; align-items: center;
        border: none; background: none; cursor: pointer; padding: 14px 16px;
        font-family: inherit; font-size: 15px; font-weight: 600; color: var(--tinta);
      }
      .dp-busca > div { padding: 0 16px 16px; }
      .dp-busca-grade { display: grid; grid-template-columns: 1fr; gap: 8px; }
      .dp-busca-datas { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
      .dp-busca-datas .campo { width: auto; flex: 1; min-width: 130px; }
      .rotulo-mini { font-size: 13px; color: var(--texto-suave); }

      .dp-lista { display: flex; flex-direction: column; gap: 12px; }
      .dp-item { display: flex; flex-direction: column; gap: 10px; padding: 16px; }
      .dp-item-topo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .dp-item-topo strong { font-size: 16px; }
      .dp-tag { display: inline-block; font-size: 12px; font-weight: 700; border-radius: 999px; padding: 3px 10px; }
      .dp-tag-tipo { background: #EDEFEC; color: var(--texto-suave); }
      .dp-tag-csv { background: #F4ECD7; color: var(--latao-texto); }
      .dp-item-meta { font-size: 13px; color: var(--texto-suave); margin-top: 4px; }
      .dp-item-baixa {
        font-size: 13px; color: var(--sucesso-texto); background: var(--sucesso-fundo);
        border-radius: 10px; padding: 8px 12px; margin-top: 8px;
      }
      .dp-valor { font-family: var(--fonte-titulo); font-weight: 700; font-size: 22px; color: var(--marca); }
      .dp-item-acoes { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }

      .dp-previa-resumo { display: flex; gap: 8px 20px; flex-wrap: wrap; font-weight: 700; font-size: 14px; }
      .dp-previa-ok { color: var(--sucesso-texto); }
      .dp-previa-ig { color: var(--erro-texto); }
      .dp-ignoradas {
        background: var(--erro-fundo); border: 1px solid #F0B4B4; border-radius: 10px;
        padding: 10px 12px; margin-top: 10px; display: flex; flex-direction: column; gap: 4px;
        font-size: 13px; color: var(--erro-texto); max-height: 200px; overflow-y: auto;
      }
      .dp-ignorada { padding: 3px 0; border-bottom: 1px dashed rgba(163, 18, 18, 0.25); }
      .dp-ignorada:last-child { border-bottom: none; }
      .dp-previa-lista {
        background: var(--fundo); border-radius: 10px; padding: 10px 12px; margin-top: 10px;
        display: flex; flex-direction: column; gap: 4px; font-size: 13px;
        max-height: 220px; overflow-y: auto;
      }
      .dp-previa-linha { padding: 3px 0; border-bottom: 1px dashed var(--borda); }
      .dp-previa-linha:last-child { border-bottom: none; }

      .dp-log-acao {
        font-size: 12px; font-weight: 700; color: var(--marca);
        background: var(--marca-clara); border-radius: 999px; padding: 2px 9px; margin-left: 6px;
      }

      .dp-overlay {
        position: fixed; inset: 0; background: rgba(15, 25, 22, 0.45);
        display: flex; align-items: flex-end; justify-content: center; z-index: 70;
      }
      .dp-modal {
        background: var(--branco); width: 100%; max-height: 92vh; overflow-y: auto;
        border-radius: 18px 18px 0 0; padding: 18px;
      }
      .dp-modal-topo { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 6px; }
      .dp-fechar {
        border: none; background: #E9ECE8; border-radius: 999px;
        width: 40px; height: 40px; font-size: 16px; cursor: pointer; flex-shrink: 0;
      }
      .dp-modal-botoes { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 18px; }

      .dp-ficha { margin-top: 8px; }
      .dp-linha { display: flex; justify-content: space-between; gap: 14px; padding: 7px 0; border-bottom: 1px dashed var(--borda); font-size: 14px; }
      .dp-linha-rotulo { color: var(--texto-suave); flex-shrink: 0; }
      .dp-linha-valor { text-align: right; font-weight: 600; overflow-wrap: anywhere; }

      @media (min-width: 640px) {
        .dp-duas { grid-template-columns: 1fr 1fr; }
        .dp-busca-grade { grid-template-columns: 1fr 1fr; }
        .dp-item { flex-direction: row; justify-content: space-between; }
        .dp-item-dir { text-align: right; }
        .dp-item-acoes { justify-content: flex-end; }
        .dp-overlay { align-items: center; padding: 24px; }
        .dp-modal { max-width: 560px; border-radius: 18px; padding: 24px; }
      }
      @media (min-width: 900px) {
        .dp-busca-grade { grid-template-columns: 1fr 1fr 1fr 1fr; }
      }
    `}</style>
  );
}
