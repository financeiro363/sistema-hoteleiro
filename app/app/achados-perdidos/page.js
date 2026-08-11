'use client';

// ============================================================================
// ACHADOS E PERDIDOS
// - Registro ágil: foto OBRIGATÓRIA (no celular abre a câmera), categoria,
//   descrição e local (lista dos locais já usados + novo local)
// - Fluxo antifraude de devolução em 3 etapas, com barra de progresso:
//   1) Validação de propriedade  2) Meio de entrega (4 opções, com CPF
//   validado de verdade para terceiros)  3) Recibo para impressão/assinatura
// - "Confirmar Entrega" só libera depois de imprimir o recibo ao menos 1 vez
// - Fotos no Supabase Storage (bucket "anexos", pasta do hotel)
// - Log de auditoria imutável (visível só para o ADMIN)
// ============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

// ---- Constantes -------------------------------------------------------------

const CATEGORIA_ACHADO_LABEL = {
  ELETRONICOS: 'Eletrônicos',
  ROUPAS: 'Roupas e Acessórios',
  DOCUMENTOS: 'Documentos',
  JOIAS: 'Joias e Valores',
  OUTROS: 'Outros',
};

const MEIO_ENTREGA_LABEL = {
  MAOS: 'Entregue em Mãos (ao próprio hóspede)',
  CORREIOS: 'Enviado pelos Correios',
  TERCEIRO: 'Entregue a Terceiro',
  OUTRO: 'Outro',
};

const STATUS_ACHADO_LABEL = { AGUARDANDO: 'Aguardando Reivindicação', ENTREGUE: 'Entregue' };
const STATUS_ACHADO_COR = {
  AGUARDANDO: { fundo: '#FBDDDD', texto: '#A31212' },
  ENTREGUE: { fundo: '#DDF2E4', texto: '#1E6B3C' },
};

const LIMITE_FOTO_MB = 8;

// ---- Funções de apoio -------------------------------------------------------

function formatarDataHora(valor) {
  if (!valor) return '—';
  try {
    return new Date(valor).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch (e) {
    return String(valor);
  }
}

function limparNomeArquivo(nome) {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
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

function formatarCPF(cpf) {
  const d = String(cpf || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

// ---- Componente principal ---------------------------------------------------

export default function AchadosPerdidos() {
  const router = useRouter();

  const [verificandoLogin, setVerificandoLogin] = useState(true);
  const [usuario, setUsuario] = useState(null);
  const [nomesUsuarios, setNomesUsuarios] = useState({});
  const [nomeHotel, setNomeHotel] = useState('');

  const [subAba, setSubAba] = useState('itens'); // 'itens' | 'log'
  const [itens, setItens] = useState([]);
  const [fotosUrl, setFotosUrl] = useState({}); // foto_caminho -> URL assinada
  const [logs, setLogs] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);

  // Filtros
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('TODOS');
  const [filtroCategoria, setFiltroCategoria] = useState('TODAS');

  // Formulário de registro
  const [mostrarForm, setMostrarForm] = useState(false);
  const [foto, setFoto] = useState(null); // File
  const [fotoPreview, setFotoPreview] = useState('');
  const [categoria, setCategoria] = useState('OUTROS');
  const [descricao, setDescricao] = useState('');
  const [localSelecionado, setLocalSelecionado] = useState('');
  const [novoLocal, setNovoLocal] = useState('');
  const [erroForm, setErroForm] = useState('');

  // Wizard de devolução
  const [devolucaoItem, setDevolucaoItem] = useState(null);
  const [etapa, setEtapa] = useState('validacao'); // 'validacao' | 'entrega' | 'recibo'
  const [confirmacao, setConfirmacao] = useState('');
  const [meioEntrega, setMeioEntrega] = useState('MAOS');
  const [enderecoCorreios, setEnderecoCorreios] = useState('');
  const [codigoRastreio, setCodigoRastreio] = useState('');
  const [nomeTerceiro, setNomeTerceiro] = useState('');
  const [cpfTerceiro, setCpfTerceiro] = useState('');
  const [detalheOutro, setDetalheOutro] = useState('');
  const [reciboImpresso, setReciboImpresso] = useState(false);
  const [erroWizard, setErroWizard] = useState('');

  // Exclusão (admin)
  const [excluindoId, setExcluindoId] = useState(null);

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

      const { data: hotel } = await supabase
        .from('hoteis').select('nome_fantasia').eq('id', dadosUsuario.hotel_id).single();
      if (ativo && hotel?.nome_fantasia) setNomeHotel(hotel.nome_fantasia);
    }
    verificar();
    return () => { ativo = false; };
  }, [router]);

  const carregarTudo = useCallback(async (u) => {
    setCarregando(true);
    setErro('');

    const { data: pessoas } = await supabase.from('usuarios').select('id, nome');
    if (pessoas) {
      const mapa = {};
      pessoas.forEach((p) => { mapa[p.id] = p.nome; });
      setNomesUsuarios(mapa);
    }

    const { data: lista, error: e1 } = await supabase
      .from('achados_perdidos')
      .select('*')
      .order('registrado_em', { ascending: false });
    if (e1) {
      setErro('Não foi possível carregar os itens. Detalhe técnico: ' + e1.message);
    } else {
      setItens(lista || []);
      // Gera as URLs assinadas das fotos (valem 1 hora)
      const caminhos = (lista || []).map((i) => i.foto_caminho).filter(Boolean);
      if (caminhos.length > 0) {
        const { data: urls } = await supabase.storage
          .from('anexos')
          .createSignedUrls(caminhos, 3600);
        const mapaUrl = {};
        (urls || []).forEach((r) => { if (r.signedUrl && r.path) mapaUrl[r.path] = r.signedUrl; });
        setFotosUrl(mapaUrl);
      } else {
        setFotosUrl({});
      }
    }

    if (u.papel === 'ADMIN') {
      const { data: ls } = await supabase
        .from('achados_perdidos_log')
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
    await supabase.from('achados_perdidos_log').insert({
      usuario_id: usuario.id,
      acao,
      detalhe,
      hotel_id: usuario.hotel_id,
    });
  }

  // ---- Foto do formulário ----
  function escolherFoto(arquivo) {
    setErroForm('');
    if (!arquivo) return;
    if (!arquivo.type.startsWith('image/')) {
      setErroForm('Envie um arquivo de imagem (foto).');
      return;
    }
    if (arquivo.size > LIMITE_FOTO_MB * 1024 * 1024) {
      setErroForm(`Imagem muito grande (máximo ${LIMITE_FOTO_MB}MB).`);
      return;
    }
    setFoto(arquivo);
    setFotoPreview(URL.createObjectURL(arquivo));
  }

  // Locais já usados (para o dropdown)
  const locaisUsados = Array.from(
    new Set(itens.map((i) => i.local_encontrado).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  // ---- Registrar item ----
  async function registrarItem(evento) {
    evento.preventDefault();
    if (salvando) return;
    setErroForm('');

    const localFinal = localSelecionado === '__novo__' ? novoLocal.trim() : localSelecionado;
    if (!foto) { setErroForm('A foto do item é obrigatória.'); return; }
    if (!descricao.trim()) { setErroForm('Descreva o item encontrado.'); return; }
    if (!localFinal) { setErroForm('Informe o local onde o item foi encontrado.'); return; }

    setSalvando(true);
    try {
      // 1) Envia a foto para o Storage (pasta do hotel)
      const caminho = `${usuario.hotel_id}/achados/${Date.now()}-${limparNomeArquivo(foto.name)}`;
      const { error: erroUpload } = await supabase.storage.from('anexos').upload(caminho, foto);
      if (erroUpload) {
        throw new Error('Falha ao enviar a foto. Detalhe técnico: ' + erroUpload.message);
      }

      // 2) Salva o item
      const { error } = await supabase.from('achados_perdidos').insert({
        foto_caminho: caminho,
        foto_nome: foto.name,
        categoria,
        descricao: descricao.trim(),
        local_encontrado: localFinal,
        origem: 'MANUAL',
        registrado_por_id: usuario.id,
        hotel_id: usuario.hotel_id,
      });
      if (error) throw new Error('Não foi possível salvar o item. Detalhe técnico: ' + error.message);

      await registrarLog(
        'Cadastrou Item',
        `Item "${descricao.trim()}" (${CATEGORIA_ACHADO_LABEL[categoria]}). Encontrado em "${localFinal}", com foto.`
      );

      setFoto(null); setFotoPreview(''); setCategoria('OUTROS');
      setDescricao(''); setLocalSelecionado(''); setNovoLocal('');
      setMostrarForm(false);
      mostrarAviso('Item registrado!');
      carregarTudo(usuario);
    } catch (e) {
      setErroForm(e.message);
    } finally {
      setSalvando(false);
    }
  }

  // ---- Wizard de devolução ----
  function abrirDevolucao(item) {
    setDevolucaoItem(item);
    setEtapa(item.confirmacao_propriedade ? 'entrega' : 'validacao');
    setConfirmacao(item.confirmacao_propriedade || '');
    setMeioEntrega(item.meio_entrega || 'MAOS');
    setEnderecoCorreios(item.endereco_correios || '');
    setCodigoRastreio(item.codigo_rastreio || '');
    setNomeTerceiro(item.nome_terceiro || '');
    setCpfTerceiro(item.cpf_terceiro || '');
    setDetalheOutro(item.detalhe_outro_meio || '');
    setReciboImpresso(!!item.recibo_impresso_em);
    setErroWizard('');
  }

  // Etapa 1 → 2
  async function salvarValidacao() {
    if (salvando) return;
    setErroWizard('');
    if (!confirmacao.trim()) {
      setErroWizard('Descreva como foi validada a propriedade do item.');
      return;
    }
    setSalvando(true);
    const { error } = await supabase
      .from('achados_perdidos')
      .update({ confirmacao_propriedade: confirmacao.trim() })
      .eq('id', devolucaoItem.id);
    setSalvando(false);
    if (error) { setErroWizard('Não foi possível salvar. Detalhe técnico: ' + error.message); return; }
    await registrarLog('Iniciou Devolução', `Item "${devolucaoItem.descricao}". Validação: ${confirmacao.trim()}`);
    setDevolucaoItem({ ...devolucaoItem, confirmacao_propriedade: confirmacao.trim() });
    setEtapa('entrega');
  }

  // Etapa 2 → 3
  async function salvarMeioEntrega() {
    if (salvando) return;
    setErroWizard('');

    if (meioEntrega === 'CORREIOS' && !enderecoCorreios.trim()) {
      setErroWizard('Informe o endereço de envio pelos Correios.');
      return;
    }
    if (meioEntrega === 'TERCEIRO') {
      if (!nomeTerceiro.trim()) { setErroWizard('Informe o nome completo do representante.'); return; }
      if (!validarCPF(cpfTerceiro)) { setErroWizard('CPF do representante inválido. Confira os números.'); return; }
    }
    if (meioEntrega === 'OUTRO' && !detalheOutro.trim()) {
      setErroWizard('Descreva o meio de entrega.');
      return;
    }

    const dados = {
      meio_entrega: meioEntrega,
      endereco_correios: meioEntrega === 'CORREIOS' ? enderecoCorreios.trim() : null,
      codigo_rastreio: meioEntrega === 'CORREIOS' ? codigoRastreio.trim() || null : null,
      nome_terceiro: meioEntrega === 'TERCEIRO' ? nomeTerceiro.trim() : null,
      cpf_terceiro: meioEntrega === 'TERCEIRO' ? formatarCPF(cpfTerceiro) : null,
      detalhe_outro_meio: meioEntrega === 'OUTRO' ? detalheOutro.trim() : null,
    };

    setSalvando(true);
    const { error } = await supabase
      .from('achados_perdidos')
      .update(dados)
      .eq('id', devolucaoItem.id);
    setSalvando(false);
    if (error) { setErroWizard('Não foi possível salvar. Detalhe técnico: ' + error.message); return; }

    let detalhe = `Item "${devolucaoItem.descricao}". Método: ${MEIO_ENTREGA_LABEL[meioEntrega]}.`;
    if (meioEntrega === 'TERCEIRO') detalhe += ` Representante: ${dados.nome_terceiro} (CPF: ${dados.cpf_terceiro}).`;
    if (meioEntrega === 'CORREIOS') detalhe += ` Endereço: ${dados.endereco_correios}. Rastreio: ${dados.codigo_rastreio || '—'}.`;
    if (meioEntrega === 'OUTRO') detalhe += ` ${dados.detalhe_outro_meio}`;
    await registrarLog('Selecionou Meio de Entrega', detalhe);

    setDevolucaoItem({ ...devolucaoItem, ...dados });
    setEtapa('recibo');
  }

  // Etapa 3: imprimir
  async function imprimirRecibo() {
    window.print();
    const agora = new Date().toISOString();
    await supabase
      .from('achados_perdidos')
      .update({ recibo_impresso_em: agora })
      .eq('id', devolucaoItem.id);
    await registrarLog('Imprimiu Documento', `Item "${devolucaoItem.descricao}". Recibo de entrega gerado para assinatura.`);
    setDevolucaoItem({ ...devolucaoItem, recibo_impresso_em: agora });
    setReciboImpresso(true);
  }

  // Etapa 3: confirmar entrega
  async function confirmarEntrega() {
    if (salvando || !reciboImpresso) return;
    setSalvando(true);
    const agora = new Date().toISOString();
    const { error } = await supabase
      .from('achados_perdidos')
      .update({ status: 'ENTREGUE', devolvido_por_id: usuario.id, devolvido_em: agora })
      .eq('id', devolucaoItem.id);
    setSalvando(false);
    if (error) { setErroWizard('Não foi possível finalizar. Detalhe técnico: ' + error.message); return; }
    await registrarLog('Finalizou Devolução', `Item "${devolucaoItem.descricao}". Status alterado com sucesso para "Entregue".`);
    setDevolucaoItem(null);
    mostrarAviso('Entrega confirmada! Item marcado como Entregue.');
    carregarTudo(usuario);
  }

  // ---- Excluir (admin) ----
  async function excluirItem(item) {
    setExcluindoId(null);
    await registrarLog('Excluiu Item', `Item "${item.descricao}". Registro removido do sistema.`);
    const { error } = await supabase.from('achados_perdidos').delete().eq('id', item.id);
    if (error) {
      setErro('Não foi possível excluir. Detalhe técnico: ' + error.message);
      return;
    }
    mostrarAviso('Item excluído.');
    carregarTudo(usuario);
  }

  // ---- Filtros ----
  const termo = busca.trim().toLowerCase();
  const itensFiltrados = itens
    .filter((i) => (filtroStatus === 'TODOS' ? true : i.status === filtroStatus))
    .filter((i) => (filtroCategoria === 'TODAS' ? true : i.categoria === filtroCategoria))
    .filter((i) =>
      termo
        ? (i.descricao || '').toLowerCase().includes(termo) ||
          (i.local_encontrado || '').toLowerCase().includes(termo)
        : true
    );

  if (verificandoLogin) {
    return (
      <main className="conteudo">
        <p className="texto-suave">Verificando seu acesso…</p>
      </main>
    );
  }

  const cpfOk = cpfTerceiro.replace(/\D/g, '').length === 11 ? validarCPF(cpfTerceiro) : null;

  return (
    <main className="conteudo">
      <EstilosAchados />

      <span className="olho">Pertences de hóspedes</span>
      <div className="barra-pagina">
        <h1 style={{ margin: 0 }}>Achados e Perdidos</h1>
        <button type="button" className="botao botao-principal"
          onClick={() => { setMostrarForm(!mostrarForm); setErroForm(''); }}>
          {mostrarForm ? 'Fechar formulário' : '+ Registrar Item Encontrado'}
        </button>
      </div>

      {aviso && <div className="aviso-sucesso">{aviso}</div>}
      {erro && <div className="aviso-erro">{erro}</div>}

      {/* Sub-abas (log só para admin) */}
      {souAdmin && (
        <nav className="ap-abas" aria-label="Seções">
          <button type="button" className={subAba === 'itens' ? 'ap-aba ap-aba-ativa' : 'ap-aba'}
            onClick={() => setSubAba('itens')}>
            Itens
          </button>
          <button type="button" className={subAba === 'log' ? 'ap-aba ap-aba-ativa' : 'ap-aba'}
            onClick={() => setSubAba('log')}>
            Log de Auditoria
          </button>
        </nav>
      )}

      {subAba === 'itens' && (
        <>
          {/* Formulário de registro */}
          {mostrarForm && (
            <form className="cartao" style={{ marginBottom: 16 }} onSubmit={registrarItem}>
              <h2 style={{ fontSize: '1.15rem', marginBottom: 4 }}>Registrar item encontrado</h2>

              <label className="rotulo">Foto do item * <span className="texto-suave">(no celular, abre a câmera)</span></label>
              <label className={fotoPreview ? 'ap-foto-area ap-foto-area-cheia' : 'ap-foto-area'}>
                {fotoPreview ? (
                  <img src={fotoPreview} alt="Foto do item" className="ap-foto-preview" />
                ) : (
                  <span>📷 Toque para tirar/enviar a foto</span>
                )}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: 'none' }}
                  onChange={(e) => escolherFoto(e.target.files?.[0])}
                />
              </label>

              <div className="ap-duas">
                <div>
                  <label className="rotulo" htmlFor="ap-cat">Categoria</label>
                  <select id="ap-cat" className="campo" value={categoria}
                    onChange={(e) => setCategoria(e.target.value)}>
                    {Object.entries(CATEGORIA_ACHADO_LABEL).map(([chave, rotulo]) => (
                      <option key={chave} value={chave}>{rotulo}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="rotulo" htmlFor="ap-local">Local onde foi encontrado *</label>
                  <select id="ap-local" className="campo" value={localSelecionado}
                    onChange={(e) => setLocalSelecionado(e.target.value)}>
                    <option value="">Escolha o local…</option>
                    {locaisUsados.map((l) => <option key={l} value={l}>{l}</option>)}
                    <option value="__novo__">+ Novo local…</option>
                  </select>
                </div>
              </div>

              {localSelecionado === '__novo__' && (
                <>
                  <label className="rotulo" htmlFor="ap-novo-local">Nome do novo local *</label>
                  <input id="ap-novo-local" className="campo" type="text" value={novoLocal}
                    onChange={(e) => setNovoLocal(e.target.value)} placeholder="Ex.: Sala 101, Recepção, Apartamento 204…" />
                </>
              )}

              <label className="rotulo" htmlFor="ap-desc">Descrição do item *</label>
              <textarea id="ap-desc" className="campo" rows={3} value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder="Ex.: iPhone 13 preto com capa azul e tela trincada" />

              {erroForm && <div className="aviso-erro">{erroForm}</div>}

              <button type="submit" className="botao botao-principal" disabled={salvando} style={{ marginTop: 16 }}>
                {salvando ? 'Salvando…' : 'Registrar Item'}
              </button>
            </form>
          )}

          {/* Filtros */}
          <div className="ap-barra">
            <input className="campo" type="search" value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por descrição ou local…" aria-label="Buscar itens" />
            <select className="campo" value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value)} aria-label="Filtrar por status">
              <option value="TODOS">Todos os status</option>
              <option value="AGUARDANDO">Aguardando Reivindicação</option>
              <option value="ENTREGUE">Entregue</option>
            </select>
            <select className="campo" value={filtroCategoria}
              onChange={(e) => setFiltroCategoria(e.target.value)} aria-label="Filtrar por categoria">
              <option value="TODAS">Todas as categorias</option>
              {Object.entries(CATEGORIA_ACHADO_LABEL).map(([chave, rotulo]) => (
                <option key={chave} value={chave}>{rotulo}</option>
              ))}
            </select>
          </div>

          {/* Lista de itens */}
          {carregando ? (
            <p className="texto-suave">Carregando itens…</p>
          ) : itensFiltrados.length === 0 ? (
            <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
              Nenhum item {busca || filtroStatus !== 'TODOS' || filtroCategoria !== 'TODAS'
                ? 'encontrado com esses filtros'
                : 'registrado ainda'}.
            </div>
          ) : (
            <div className="ap-lista">
              {itensFiltrados.map((i) => (
                <div key={i.id} className="cartao ap-item">
                  {fotosUrl[i.foto_caminho] ? (
                    <img src={fotosUrl[i.foto_caminho]} alt={i.descricao} className="ap-item-foto" />
                  ) : (
                    <div className="ap-item-foto ap-item-foto-vazia">📦</div>
                  )}
                  <div className="ap-item-corpo">
                    <div className="ap-item-topo">
                      <span className="ap-tag" style={{
                        background: STATUS_ACHADO_COR[i.status].fundo,
                        color: STATUS_ACHADO_COR[i.status].texto,
                      }}>
                        {STATUS_ACHADO_LABEL[i.status]}
                      </span>
                      <span className="ap-tag ap-tag-cat">{CATEGORIA_ACHADO_LABEL[i.categoria]}</span>
                      {i.origem === 'GOVERNANCA' && (
                        <span className="ap-tag ap-tag-gov">Via checklist da governança</span>
                      )}
                    </div>
                    <div className="ap-item-desc">{i.descricao}</div>
                    <div className="ap-item-meta">
                      <span>📍 {i.local_encontrado}</span>
                      <span>Registrado por {nomeDe(i.registrado_por_id)} em {formatarDataHora(i.registrado_em)}</span>
                      {i.status === 'ENTREGUE' && (
                        <span>✅ Entregue via {MEIO_ENTREGA_LABEL[i.meio_entrega] || '—'} por {nomeDe(i.devolvido_por_id)} em {formatarDataHora(i.devolvido_em)}</span>
                      )}
                    </div>
                    <div className="ap-item-acoes">
                      {i.status === 'AGUARDANDO' && (
                        <button type="button" className="botao botao-principal"
                          onClick={() => abrirDevolucao(i)}>
                          Iniciar Devolução
                        </button>
                      )}
                      {souAdmin && (
                        excluindoId === i.id ? (
                          <span className="ap-confirmar">
                            Excluir mesmo?
                            <button type="button" className="botao botao-perigo" onClick={() => excluirItem(i)}>Sim</button>
                            <button type="button" className="botao botao-suave" onClick={() => setExcluindoId(null)}>Não</button>
                          </span>
                        ) : (
                          <button type="button" className="botao botao-suave" onClick={() => setExcluindoId(i.id)}>
                            Excluir
                          </button>
                        )
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Log de auditoria (só admin) */}
      {subAba === 'log' && souAdmin && (
        <div className="ap-lista">
          {logs.length === 0 ? (
            <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
              Nenhum registro no log ainda.
            </div>
          ) : (
            logs.map((l) => (
              <div key={l.id} className="cartao" style={{ padding: '12px 16px' }}>
                <div>
                  <strong>{nomeDe(l.usuario_id)}</strong>{' '}
                  <span className="ap-log-acao">{l.acao}</span>
                </div>
                {l.detalhe && <div style={{ fontSize: 14, marginTop: 3 }}>{l.detalhe}</div>}
                <div className="texto-suave" style={{ fontSize: 12 }}>{formatarDataHora(l.data_hora)}</div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ================= WIZARD DE DEVOLUÇÃO ================= */}
      {devolucaoItem && (
        <div className="ap-overlay" role="dialog" aria-modal="true">
          <div className="ap-modal">
            <div className="ap-modal-topo ap-nao-imprimir">
              <h2 style={{ fontSize: '1.15rem', margin: 0 }}>Devolução — {devolucaoItem.descricao}</h2>
              <button type="button" className="ap-fechar" onClick={() => setDevolucaoItem(null)} aria-label="Fechar">✕</button>
            </div>

            {/* Barra de progresso */}
            <div className="ap-progresso ap-nao-imprimir" aria-hidden="true">
              {['validacao', 'entrega', 'recibo'].map((e, idx) => (
                <div key={e} className={`ap-passo ${etapa === e ? 'ap-passo-ativo' : ''} ${
                  ['validacao', 'entrega', 'recibo'].indexOf(etapa) > idx ? 'ap-passo-feito' : ''
                }`}>
                  <span className="ap-passo-num">{idx + 1}</span>
                  {e === 'validacao' ? 'Validação' : e === 'entrega' ? 'Meio de Entrega' : 'Recibo'}
                </div>
              ))}
            </div>

            {/* Etapa 1: validação de propriedade */}
            {etapa === 'validacao' && (
              <div className="ap-nao-imprimir">
                <p className="texto-suave" style={{ fontSize: 14 }}>
                  Antes de entregar, valide que a pessoa é mesmo a dona do item e descreva como foi essa validação.
                </p>
                <label className="rotulo">Como a propriedade foi validada? *</label>
                <textarea className="campo" rows={3} value={confirmacao}
                  onChange={(e) => setConfirmacao(e.target.value)}
                  placeholder="Ex.: O dono desbloqueou o celular com a senha na minha frente." />
                {erroWizard && <div className="aviso-erro">{erroWizard}</div>}
                <div className="ap-modal-botoes">
                  <button type="button" className="botao botao-principal" onClick={salvarValidacao} disabled={salvando}>
                    {salvando ? 'Salvando…' : 'Continuar'}
                  </button>
                </div>
              </div>
            )}

            {/* Etapa 2: meio de entrega */}
            {etapa === 'entrega' && (
              <div className="ap-nao-imprimir">
                <label className="rotulo">Meio de Entrega *</label>
                <select className="campo" value={meioEntrega} onChange={(e) => setMeioEntrega(e.target.value)}>
                  {Object.entries(MEIO_ENTREGA_LABEL).map(([chave, rotulo]) => (
                    <option key={chave} value={chave}>{rotulo}</option>
                  ))}
                </select>

                {meioEntrega === 'CORREIOS' && (
                  <>
                    <label className="rotulo">Endereço de envio *</label>
                    <textarea className="campo" rows={2} value={enderecoCorreios}
                      onChange={(e) => setEnderecoCorreios(e.target.value)}
                      placeholder="Rua, número, bairro, cidade/UF, CEP" />
                    <label className="rotulo">Código de rastreio (se já tiver)</label>
                    <input className="campo" type="text" value={codigoRastreio}
                      onChange={(e) => setCodigoRastreio(e.target.value)} placeholder="BR000000000BR" />
                  </>
                )}

                {meioEntrega === 'TERCEIRO' && (
                  <>
                    <label className="rotulo">Nome completo do representante *</label>
                    <input className="campo" type="text" value={nomeTerceiro}
                      onChange={(e) => setNomeTerceiro(e.target.value)} placeholder="Nome completo de quem vai retirar" />
                    <label className="rotulo">CPF do representante *</label>
                    <input className="campo" type="text" inputMode="numeric" value={cpfTerceiro}
                      onChange={(e) => setCpfTerceiro(formatarCPF(e.target.value))} placeholder="000.000.000-00" />
                    {cpfOk === true && <p className="ap-cpf-ok">✓ CPF válido</p>}
                    {cpfOk === false && <p className="ap-cpf-erro">✗ CPF inválido</p>}
                  </>
                )}

                {meioEntrega === 'OUTRO' && (
                  <>
                    <label className="rotulo">Descreva o meio de entrega *</label>
                    <textarea className="campo" rows={2} value={detalheOutro}
                      onChange={(e) => setDetalheOutro(e.target.value)}
                      placeholder="Ex.: Entregue ao motorista do transfer autorizado pelo hóspede por telefone." />
                  </>
                )}

                {erroWizard && <div className="aviso-erro">{erroWizard}</div>}
                <div className="ap-modal-botoes">
                  <button type="button" className="botao botao-principal" onClick={salvarMeioEntrega} disabled={salvando}>
                    {salvando ? 'Salvando…' : 'Gerar Recibo'}
                  </button>
                  <button type="button" className="botao botao-suave" onClick={() => setEtapa('validacao')}>Voltar</button>
                </div>
              </div>
            )}

            {/* Etapa 3: recibo */}
            {etapa === 'recibo' && (
              <div>
                {/* Folha do recibo (é o que sai na impressão) */}
                <div className="recibo-imprimir">
                  <div style={{ textAlign: 'center', marginBottom: 16 }}>
                    <div style={{ fontWeight: 700, fontSize: 18 }}>{nomeHotel || 'Hotel'}</div>
                    <div style={{ fontSize: 12, color: '#555' }}>Recibo de Entrega — Achados e Perdidos</div>
                  </div>
                  {fotosUrl[devolucaoItem.foto_caminho] && (
                    <img src={fotosUrl[devolucaoItem.foto_caminho]} alt={devolucaoItem.descricao}
                      style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8, display: 'block', margin: '0 auto 14px' }} />
                  )}
                  <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                    <tbody>
                      <tr><td className="ap-rec-rot">Item</td><td>{CATEGORIA_ACHADO_LABEL[devolucaoItem.categoria]} — {devolucaoItem.descricao}</td></tr>
                      <tr><td className="ap-rec-rot">Local onde foi encontrado</td><td>{devolucaoItem.local_encontrado}</td></tr>
                      <tr><td className="ap-rec-rot">Registrado em</td><td>{formatarDataHora(devolucaoItem.registrado_em)} por {nomeDe(devolucaoItem.registrado_por_id)}</td></tr>
                      <tr><td className="ap-rec-rot">Validação de propriedade</td><td>{devolucaoItem.confirmacao_propriedade}</td></tr>
                      <tr><td className="ap-rec-rot">Meio de entrega</td><td>{MEIO_ENTREGA_LABEL[devolucaoItem.meio_entrega]}</td></tr>
                      {devolucaoItem.meio_entrega === 'TERCEIRO' && (
                        <>
                          <tr><td className="ap-rec-rot">Representante</td><td>{devolucaoItem.nome_terceiro}</td></tr>
                          <tr><td className="ap-rec-rot">CPF do representante</td><td>{devolucaoItem.cpf_terceiro}</td></tr>
                        </>
                      )}
                      {devolucaoItem.meio_entrega === 'CORREIOS' && (
                        <>
                          <tr><td className="ap-rec-rot">Endereço de envio</td><td>{devolucaoItem.endereco_correios}</td></tr>
                          <tr><td className="ap-rec-rot">Código de rastreio</td><td>{devolucaoItem.codigo_rastreio || '—'}</td></tr>
                        </>
                      )}
                      {devolucaoItem.meio_entrega === 'OUTRO' && (
                        <tr><td className="ap-rec-rot">Detalhes da entrega</td><td>{devolucaoItem.detalhe_outro_meio}</td></tr>
                      )}
                      <tr><td className="ap-rec-rot">Data da entrega</td><td>{new Date().toLocaleDateString('pt-BR')}</td></tr>
                    </tbody>
                  </table>
                  <p style={{ fontSize: 12, margin: '16px 0', lineHeight: 1.5 }}>
                    <strong>Termo de responsabilidade:</strong> declaro que recebi o item acima descrito,
                    em bom estado de conservação, e que sou seu legítimo proprietário ou representante
                    autorizado, nada mais tendo a reclamar do estabelecimento a respeito deste pertence.
                  </p>
                  <div style={{ marginTop: 40, borderTop: '1px solid #999', paddingTop: 6, fontSize: 12, textAlign: 'center' }}>
                    Assinatura de quem recebeu
                  </div>
                </div>

                {erroWizard && <div className="aviso-erro ap-nao-imprimir">{erroWizard}</div>}

                <div className="ap-modal-botoes ap-nao-imprimir">
                  <button type="button" className="botao botao-contorno" onClick={imprimirRecibo}>
                    🖨️ Imprimir Recibo
                  </button>
                  <button type="button" className="botao botao-principal" onClick={confirmarEntrega}
                    disabled={!reciboImpresso || salvando}
                    title={reciboImpresso ? '' : 'Imprima o recibo primeiro'}>
                    {salvando ? 'Finalizando…' : 'Confirmar Entrega'}
                  </button>
                  <button type="button" className="botao botao-suave" onClick={() => setEtapa('entrega')}>Voltar</button>
                </div>
                {!reciboImpresso && (
                  <p className="texto-suave ap-nao-imprimir" style={{ fontSize: 12, marginTop: 8 }}>
                    O botão "Confirmar Entrega" libera depois que o recibo for impresso (para colher a assinatura).
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

// ---- Estilos específicos deste módulo ---------------------------------------

function EstilosAchados() {
  return (
    <style>{`
      .ap-abas { display: flex; gap: 6px; margin: 14px 0 16px; }
      .ap-aba {
        border: 1px solid var(--borda); background: var(--branco); color: var(--tinta);
        border-radius: 999px; padding: 10px 16px; font-size: 14px; font-weight: 600;
        cursor: pointer; min-height: 42px;
      }
      .ap-aba-ativa { background: var(--marca); border-color: var(--marca); color: var(--branco); }

      .ap-barra { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }

      .ap-foto-area {
        display: flex; align-items: center; justify-content: center;
        border: 2px dashed #C7CEC9; border-radius: 12px; padding: 28px 12px;
        cursor: pointer; color: var(--texto-suave); font-size: 15px;
        background: var(--fundo);
      }
      .ap-foto-area-cheia { padding: 0; border-style: solid; overflow: hidden; }
      .ap-foto-preview { width: 100%; max-height: 260px; object-fit: cover; display: block; }

      .ap-duas { display: grid; grid-template-columns: 1fr; gap: 0 14px; }

      .ap-lista { display: flex; flex-direction: column; gap: 12px; }
      .ap-item { display: flex; gap: 14px; padding: 14px; }
      .ap-item-foto {
        width: 84px; height: 84px; border-radius: 10px; object-fit: cover; flex-shrink: 0;
        border: 1px solid var(--borda);
      }
      .ap-item-foto-vazia {
        display: flex; align-items: center; justify-content: center;
        background: var(--fundo); font-size: 26px;
      }
      .ap-item-corpo { flex: 1; min-width: 0; }
      .ap-item-topo { display: flex; flex-wrap: wrap; gap: 6px; }
      .ap-tag {
        display: inline-block; font-size: 12px; font-weight: 700;
        border-radius: 999px; padding: 3px 10px;
      }
      .ap-tag-cat { background: var(--marca-clara); color: var(--marca); }
      .ap-tag-gov { background: #F4ECD7; color: var(--latao-texto); }
      .ap-item-desc { font-weight: 600; font-size: 15px; margin: 6px 0 4px; overflow-wrap: anywhere; }
      .ap-item-meta { display: flex; flex-direction: column; gap: 2px; font-size: 13px; color: var(--texto-suave); }
      .ap-item-acoes { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; align-items: center; }
      .ap-confirmar { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; color: var(--erro-texto); flex-wrap: wrap; }

      .ap-log-acao {
        font-size: 12px; font-weight: 700; color: var(--marca);
        background: var(--marca-clara); border-radius: 999px; padding: 2px 9px; margin-left: 6px;
      }

      .ap-overlay {
        position: fixed; inset: 0; background: rgba(15, 25, 22, 0.45);
        display: flex; align-items: flex-end; justify-content: center; z-index: 70;
      }
      .ap-modal {
        background: var(--branco); width: 100%; max-height: 92vh; overflow-y: auto;
        border-radius: 18px 18px 0 0; padding: 18px;
      }
      .ap-modal-topo { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
      .ap-fechar {
        border: none; background: #E9ECE8; border-radius: 999px;
        width: 40px; height: 40px; font-size: 16px; cursor: pointer; flex-shrink: 0;
      }
      .ap-modal-botoes { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }

      .ap-progresso { display: flex; gap: 6px; margin-bottom: 16px; }
      .ap-passo {
        flex: 1; display: flex; align-items: center; gap: 6px; justify-content: center;
        font-size: 12px; font-weight: 700; color: var(--texto-suave);
        border-top: 3px solid var(--borda); padding-top: 8px;
      }
      .ap-passo-num {
        display: inline-flex; align-items: center; justify-content: center;
        width: 22px; height: 22px; border-radius: 999px; background: var(--borda);
        color: var(--tinta); font-size: 12px;
      }
      .ap-passo-ativo { color: var(--marca); border-top-color: var(--marca); }
      .ap-passo-ativo .ap-passo-num { background: var(--marca); color: var(--branco); }
      .ap-passo-feito { color: var(--marca); border-top-color: var(--marca-clara); }
      .ap-passo-feito .ap-passo-num { background: var(--marca-clara); color: var(--marca); }

      .ap-cpf-ok { color: var(--sucesso-texto); font-weight: 700; font-size: 14px; margin: 6px 0 0; }
      .ap-cpf-erro { color: var(--erro-texto); font-weight: 700; font-size: 14px; margin: 6px 0 0; }

      .ap-rec-rot { padding: 4px 8px 4px 0; color: #555; width: 45%; vertical-align: top; }

      @media (min-width: 640px) {
        .ap-barra { flex-direction: row; align-items: center; }
        .ap-barra .campo { width: auto; }
        .ap-barra input.campo { flex: 2; min-width: 200px; }
        .ap-barra select.campo { flex: 1; min-width: 170px; }
        .ap-duas { grid-template-columns: 1fr 1fr; }
        .ap-overlay { align-items: center; padding: 24px; }
        .ap-modal { max-width: 640px; border-radius: 18px; padding: 24px; }
        .ap-item-foto { width: 110px; height: 110px; }
      }

      /* Impressão do recibo: só a folha do recibo aparece no papel */
      @media print {
        body * { visibility: hidden; }
        .recibo-imprimir, .recibo-imprimir * { visibility: visible; }
        .recibo-imprimir { position: fixed; top: 0; left: 0; width: 100%; padding: 24px; background: #fff; }
        .ap-nao-imprimir { display: none !important; }
      }
    `}</style>
  );
}
