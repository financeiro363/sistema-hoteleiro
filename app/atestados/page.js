'use client';

// ============================================================================
// ATESTADOS MÉDICOS E ODONTOLÓGICOS
// - 3 visões possíveis, conforme quem está logado:
//   • ADMIN: acesso completo (incluir, ver listagem, ver fotos, mudar
//     status, excluir, ver log de auditoria)
//   • CONTADOR: só visualização — vê a listagem e as fotos (para conferir
//     a folha de pagamento/eSocial), mas não inclui, edita nem exclui
//   • Quem tem a permissão customizada "pode_incluir_atestado" (ligada
//     por fora do papel, na tela de Usuários): SÓ enxerga o formulário de
//     incluir um atestado novo — não vê listagem, histórico nem fotos
//     depois de salvar (só o recibo da hora, que ele mesmo gerou)
// - Recibo em 2 vias (A4): via de cima é do colaborador (SEM foto), via de
//   baixo é do hotel (COM foto), separadas por linha de corte
// - Fotos ficam num bucket de Storage EXCLUSIVO ("atestados"), com regras
//   de segurança próprias — mais restritas que o bucket genérico do resto
//   do sistema
// - Log de auditoria (só ADMIN lê): toda inclusão, visualização de foto e
//   mudança de status fica registrada com usuário, data/hora e IP
// ============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

// ---- Constantes -------------------------------------------------------------

const STATUS_LABEL = {
  AGUARDANDO_HOMOLOGACAO: 'Aguardando Homologação',
  HOMOLOGADO: 'Homologado',
  RECUSADO: 'Recusado / Não Homologado',
};
const STATUS_COR = {
  AGUARDANDO_HOMOLOGACAO: { fundo: '#FDF3D7', texto: '#8A6100' },
  HOMOLOGADO: { fundo: '#DDF2E4', texto: '#1E6B3C' },
  RECUSADO: { fundo: '#FBDDDD', texto: '#A31212' },
};
const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

// ---- Funções de apoio -------------------------------------------------------

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
function hoje() { return new Date().toISOString().slice(0, 10); }

function formatarCPF(texto) {
  const d = String(texto || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}
function validarCPF(cpf) {
  const d = String(cpf || '').replace(/\D/g, '');
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += Number(d[i]) * (10 - i);
  let dv1 = (soma * 10) % 11; if (dv1 === 10) dv1 = 0;
  if (dv1 !== Number(d[9])) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += Number(d[i]) * (11 - i);
  let dv2 = (soma * 10) % 11; if (dv2 === 10) dv2 = 0;
  return dv2 === Number(d[10]);
}

function proximoProtocolo(atestados, ano, extra = 0) {
  const prefixo = `${ano}-ATST-`;
  let maior = 0;
  atestados.forEach((a) => {
    if (a.protocolo && a.protocolo.startsWith(prefixo)) {
      const n = Number(a.protocolo.slice(prefixo.length));
      if (isFinite(n) && n > maior) maior = n;
    }
  });
  return `${prefixo}${String(maior + 1 + extra).padStart(5, '0')}`;
}

function periodoSobrepoe(a, b) {
  const inicioA = new Date(a.data_emissao + 'T00:00:00');
  const fimA = new Date(inicioA); fimA.setDate(fimA.getDate() + Math.ceil(Number(a.dias_afastamento)) - 1);
  const inicioB = new Date(b.data_emissao + 'T00:00:00');
  const fimB = new Date(inicioB); fimB.setDate(fimB.getDate() + Math.ceil(Number(b.dias_afastamento)) - 1);
  return inicioA <= fimB && fimA >= inicioB;
}

async function meuIP() {
  try {
    const resposta = await fetch('/api/meu-ip');
    const dados = await resposta.json();
    return dados.ip || 'desconhecido';
  } catch (e) { return 'desconhecido'; }
}

// ---- Componente principal ---------------------------------------------------

export default function Atestados() {
  const router = useRouter();

  const [verificandoLogin, setVerificandoLogin] = useState(true);
  const [usuario, setUsuario] = useState(null);
  const [nomeHotel, setNomeHotel] = useState('');

  // ---- Login: precisa ser ADMIN, CONTADOR, ou ter a permissão customizada ----
  useEffect(() => {
    let ativo = true;
    async function verificar() {
      const { data: sessao } = await supabase.auth.getSession();
      if (!sessao?.session) { router.push('/login'); return; }
      const { data: dadosUsuario, error } = await supabase
        .from('usuarios').select('*').eq('auth_id', sessao.session.user.id).single();
      if (error || !dadosUsuario) { router.push('/login'); return; }
      const temAcesso = dadosUsuario.papel === 'ADMIN' || dadosUsuario.papel === 'CONTADOR' || dadosUsuario.pode_incluir_atestado === true;
      if (!temAcesso) { router.push('/'); return; }
      if (!ativo) return;
      setUsuario(dadosUsuario);
      setVerificandoLogin(false);

      const { data: h } = await supabase.from('hoteis').select('nome_fantasia').eq('id', dadosUsuario.hotel_id).single();
      if (ativo && h?.nome_fantasia) setNomeHotel(h.nome_fantasia);
    }
    verificar();
    return () => { ativo = false; };
  }, [router]);

  if (verificandoLogin) {
    return <main className="conteudo"><p className="texto-suave">Verificando seu acesso…</p></main>;
  }

  const souAdmin = usuario.papel === 'ADMIN';
  const souContador = usuario.papel === 'CONTADOR';
  const souIncluidor = !souAdmin && usuario.pode_incluir_atestado === true;

  return (
    <main className="conteudo">
      <EstilosAtestados />
      <span className="olho">Recursos Humanos</span>
      <h1 style={{ marginBottom: 6 }}>Atestados Médicos e Odontológicos</h1>
      <p className="texto-suave" style={{ fontSize: 13, marginTop: -4 }}>
        {souAdmin && 'Acesso completo — administrador.'}
        {souContador && 'Acesso de consulta — contador (visualização e conferência para a folha de pagamento).'}
        {souIncluidor && 'Acesso para registrar atendimentos — você não visualiza o histórico depois de salvo.'}
      </p>

      {souAdmin && <VisaoAdmin usuario={usuario} nomeHotel={nomeHotel} />}
      {souContador && !souAdmin && <VisaoContador usuario={usuario} />}
      {souIncluidor && <FormularioNovoAtestado usuario={usuario} nomeHotel={nomeHotel} soFormulario />}
    </main>
  );
}

// ============================================================================
// VISÃO ADMIN — abas: Novo Atestado / Listagem / Log de Auditoria
// ============================================================================

function VisaoAdmin({ usuario, nomeHotel }) {
  const [subAba, setSubAba] = useState('novo');
  const [atestados, setAtestados] = useState([]);
  const [funcionarios, setFuncionarios] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [logs, setLogs] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  function mostrarAviso(texto) { setAviso(texto); setTimeout(() => setAviso(''), 5000); }

  const carregarTudo = useCallback(async (mostrarCarregando = true) => {
    if (mostrarCarregando) setCarregando(true);
    setErro('');
    const [a, f, u, l] = await Promise.all([
      supabase.from('atestados').select('*').order('criado_em', { ascending: false }),
      supabase.from('funcionarios').select('id, nome, matricula').order('nome', { ascending: true }),
      supabase.from('usuarios').select('id, nome'),
      supabase.from('atestados_log').select('*').order('data_hora', { ascending: false }).limit(300),
    ]);
    if (a.error) setErro('Não foi possível carregar. Detalhe técnico: ' + a.error.message);
    setAtestados(a.data || []);
    setFuncionarios(f.data || []);
    setUsuarios(u.data || []);
    setLogs(l.data || []);
    if (mostrarCarregando) setCarregando(false);
  }, []);

  useEffect(() => { carregarTudo(true); }, [carregarTudo]);

  // Usado depois de salvar/editar algo: atualiza os dados por baixo dos
  // panos, SEM mostrar "Carregando…" — isso evita que a tela pisque e
  // derrube modais abertos (como o recibo recém-emitido).
  const recarregarEmSilencio = useCallback(() => carregarTudo(false), [carregarTudo]);

  const nomeFuncionario = useCallback((id) => funcionarios.find((f) => f.id === id)?.nome || `#${id}`, [funcionarios]);
  const nomeUsuario = useCallback((id) => usuarios.find((u) => u.id === id)?.nome || `Usuário #${id}`, [usuarios]);

  return (
    <>
      {aviso && <div className="aviso-sucesso">{aviso}</div>}
      {erro && <div className="aviso-erro">{erro}</div>}

      <nav className="at-abas" aria-label="Seções">
        <button type="button" className={subAba === 'novo' ? 'at-aba at-aba-ativa' : 'at-aba'} onClick={() => setSubAba('novo')}>+ Novo Atestado</button>
        <button type="button" className={subAba === 'listagem' ? 'at-aba at-aba-ativa' : 'at-aba'} onClick={() => setSubAba('listagem')}>Listagem</button>
        <button type="button" className={subAba === 'log' ? 'at-aba at-aba-ativa' : 'at-aba'} onClick={() => setSubAba('log')}>Log de Auditoria</button>
      </nav>

      {carregando ? <p className="texto-suave">Carregando…</p> : (
        <>
          {subAba === 'novo' && (
            <FormularioNovoAtestado usuario={usuario} nomeHotel={nomeHotel} atestadosExistentes={atestados}
              funcionarios={funcionarios} mostrarAviso={mostrarAviso} recarregar={recarregarEmSilencio} />
          )}
          {subAba === 'listagem' && (
            <ListagemAtestados atestados={atestados} usuario={usuario} nomeHotel={nomeHotel} nomeFuncionario={nomeFuncionario}
              nomeUsuario={nomeUsuario} mostrarAviso={mostrarAviso} setErro={setErro} recarregar={recarregarEmSilencio} souAdmin />
          )}
          {subAba === 'log' && <LogAuditoria logs={logs} nomeUsuario={nomeUsuario} />}
        </>
      )}
    </>
  );
}

// ============================================================================
// VISÃO CONTADOR — só leitura + fotos
// ============================================================================

function VisaoContador({ usuario }) {
  const [atestados, setAtestados] = useState([]);
  const [funcionarios, setFuncionarios] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  function mostrarAviso(texto) { setAviso(texto); setTimeout(() => setAviso(''), 5000); }

  const carregarTudo = useCallback(async (mostrarCarregando = true) => {
    if (mostrarCarregando) setCarregando(true);
    const [a, f, u] = await Promise.all([
      supabase.from('atestados').select('*').order('criado_em', { ascending: false }),
      supabase.from('funcionarios').select('id, nome, matricula').order('nome', { ascending: true }),
      supabase.from('usuarios').select('id, nome'),
    ]);
    if (a.error) setErro('Não foi possível carregar. Detalhe técnico: ' + a.error.message);
    setAtestados(a.data || []);
    setFuncionarios(f.data || []);
    setUsuarios(u.data || []);
    if (mostrarCarregando) setCarregando(false);
  }, []);

  useEffect(() => { carregarTudo(true); }, [carregarTudo]);
  const recarregarEmSilencio = useCallback(() => carregarTudo(false), [carregarTudo]);

  const nomeFuncionario = useCallback((id) => funcionarios.find((f) => f.id === id)?.nome || `#${id}`, [funcionarios]);
  const nomeUsuario = useCallback((id) => usuarios.find((u) => u.id === id)?.nome || `Usuário #${id}`, [usuarios]);

  return (
    <>
      {aviso && <div className="aviso-sucesso">{aviso}</div>}
      {erro && <div className="aviso-erro">{erro}</div>}
      {carregando ? <p className="texto-suave">Carregando…</p> : (
        <ListagemAtestados atestados={atestados} usuario={usuario} nomeFuncionario={nomeFuncionario} nomeUsuario={nomeUsuario}
          mostrarAviso={mostrarAviso} setErro={setErro} recarregar={recarregarEmSilencio} souAdmin={false} />
      )}
    </>
  );
}

// ============================================================================
// FORMULÁRIO — Novo Atestado (usado pelo Admin e por quem tem a permissão)
// ============================================================================

function FormularioNovoAtestado({ usuario, nomeHotel, atestadosExistentes, funcionarios: funcionariosProp, mostrarAviso, recarregar, soFormulario }) {
  const [funcionarios, setFuncionarios] = useState(funcionariosProp || []);
  const [buscaFuncionario, setBuscaFuncionario] = useState('');
  const [funcionarioId, setFuncionarioId] = useState('');
  const [apresentadorTipo, setApresentadorTipo] = useState('PROPRIO');
  const [apresentadorNome, setApresentadorNome] = useState('');
  const [apresentadorCpf, setApresentadorCpf] = useState('');
  const [profissionalTipo, setProfissionalTipo] = useState('MEDICO');
  const [profissionalNome, setProfissionalNome] = useState('');
  const [profissionalConselho, setProfissionalConselho] = useState('');
  const [profissionalUf, setProfissionalUf] = useState('PB');
  const [dataEmissao, setDataEmissao] = useState(hoje());
  const [diasAfastamento, setDiasAfastamento] = useState('');
  const [cid, setCid] = useState('');
  const [foto, setFoto] = useState(null);
  const [fotoPreview, setFotoPreview] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState('');
  const [avisoDuplicidade, setAvisoDuplicidade] = useState('');
  const [reciboAberto, setReciboAberto] = useState(null);
  const [erroLocal, setErroLocal] = useState('');

  // Se não veio a lista de funcionários pronta (visão "só incluir"), busca aqui
  useEffect(() => {
    if (funcionariosProp) return;
    supabase.from('funcionarios').select('id, nome, matricula').order('nome', { ascending: true })
      .then(({ data }) => setFuncionarios(data || []));
  }, [funcionariosProp]);

  function escolherFoto(arquivo) {
    setFoto(arquivo);
    setFotoPreview(arquivo ? URL.createObjectURL(arquivo) : null);
  }

  function verificarDuplicidade(fId, data, dias) {
    if (!atestadosExistentes || !fId || !data || !dias) { setAvisoDuplicidade(''); return; }
    const conflito = atestadosExistentes.find((a) =>
      a.funcionario_id === Number(fId) && periodoSobrepoe({ data_emissao: data, dias_afastamento: dias }, a)
    );
    setAvisoDuplicidade(conflito
      ? `⚠️ Este colaborador já tem um atestado (protocolo ${conflito.protocolo}) cobrindo um período que se sobrepõe a este.`
      : '');
  }

  const funcionariosFiltrados = funcionarios.filter((f) => {
    const termo = buscaFuncionario.trim().toLowerCase();
    if (!termo) return true;
    return f.nome.toLowerCase().includes(termo) || (f.matricula || '').toLowerCase().includes(termo);
  });

  async function salvar(evento) {
    evento.preventDefault();
    if (salvando) return;
    setErroForm('');

    if (!funcionarioId) { setErroForm('Escolha o colaborador.'); return; }
    if (apresentadorTipo === 'TERCEIRO' && (!apresentadorNome.trim() || !validarCPF(apresentadorCpf))) {
      setErroForm('Informe o nome do terceiro e um CPF válido.'); return;
    }
    if (!profissionalNome.trim() || !profissionalConselho.trim()) { setErroForm('Informe os dados do profissional emissor.'); return; }
    if (!dataEmissao) { setErroForm('Informe a data de emissão.'); return; }
    if (dataEmissao > hoje()) { setErroForm('A data de emissão não pode ser no futuro — confira a data digitada.'); return; }
    if (!(Number(diasAfastamento) > 0)) { setErroForm('Informe a quantidade de dias de afastamento.'); return; }
    if (!foto) { setErroForm('A foto do atestado é obrigatória.'); return; }

    setSalvando(true);

    // Sobe a foto primeiro (bucket exclusivo "atestados")
    const extensao = (foto.name || 'foto.jpg').split('.').pop() || 'jpg';
    const caminhoFoto = `${usuario.hotel_id}/${Date.now()}.${extensao}`;
    const { error: erroUpload } = await supabase.storage.from('atestados').upload(caminhoFoto, foto);
    if (erroUpload) {
      setSalvando(false);
      setErroForm('Não foi possível enviar a foto do atestado. Detalhe técnico: ' + erroUpload.message);
      return;
    }

    // O protocolo é gerado sozinho pelo banco de dados (trigger), sempre
    // único — não depende de conseguir ler a lista de outros atestados.
    const { data: salvo, error: erroInsert } = await supabase.from('atestados').insert({
      protocolo: 'temp', // o banco substitui este valor automaticamente
      funcionario_id: Number(funcionarioId),
      apresentador_tipo: apresentadorTipo,
      apresentador_nome: apresentadorTipo === 'TERCEIRO' ? apresentadorNome.trim() : null,
      apresentador_cpf: apresentadorTipo === 'TERCEIRO' ? apresentadorCpf.replace(/\D/g, '') : null,
      profissional_tipo: profissionalTipo,
      profissional_nome: profissionalNome.trim(),
      profissional_conselho: profissionalConselho.trim(),
      profissional_uf: profissionalUf,
      data_emissao: dataEmissao,
      dias_afastamento: Number(diasAfastamento),
      cid: cid.trim() || null,
      foto_caminho: caminhoFoto,
      criado_por_id: usuario.id,
      hotel_id: usuario.hotel_id,
    }).select().single();
    setSalvando(false);

    if (!salvo) { setErroForm('Não foi possível salvar. Detalhe técnico: ' + erroInsert?.message); return; }

    const nomeColaborador = funcionarios.find((f) => f.id === Number(funcionarioId))?.nome || '';

    // Mostra o recibo JÁ, garantido — o registro no log de auditoria vai
    // depois, isolado, e nunca pode travar nem atrasar o recibo aparecer.
    setReciboAberto({ ...salvo, _fotoPreview: fotoPreview, _nomeColaborador: nomeColaborador });
    if (mostrarAviso) mostrarAviso(`Atestado ${salvo.protocolo} registrado!`);
    if (recarregar) recarregar();

    // Limpa o formulário (guarda o valor da foto antes de limpar, para não
    // afetar o recibo que já está com sua própria cópia)
    setFuncionarioId(''); setBuscaFuncionario(''); setApresentadorTipo('PROPRIO'); setApresentadorNome(''); setApresentadorCpf('');
    setProfissionalNome(''); setProfissionalConselho(''); setDataEmissao(hoje()); setDiasAfastamento(''); setCid('');
    setFoto(null); setFotoPreview(null); setAvisoDuplicidade('');

    // Log de auditoria — melhor esforço; se falhar por qualquer motivo
    // (rede, etc.), não afeta em nada o que a pessoa já viu na tela.
    try {
      const ip = await meuIP();
      await supabase.from('atestados_log').insert({
        usuario_id: usuario.id, atestado_id: salvo.id, acao: 'INCLUSAO',
        detalhe: `Atestado ${salvo.protocolo} incluído para ${nomeColaborador}.`,
        ip_origem: ip, hotel_id: usuario.hotel_id,
      });
    } catch (e) {
      // Silencioso de propósito — não é motivo para incomodar quem está
      // atendendo o colaborador na recepção.
    }
  }

  return (
    <section style={soFormulario ? { maxWidth: 640, margin: '0 auto' } : undefined}>
      <form className="cartao" onSubmit={salvar}>
        <h2 style={{ fontSize: '1.15rem', marginBottom: 4 }}>Registrar atestado</h2>

        <label className="rotulo">Colaborador *</label>
        <input className="campo" type="text" value={buscaFuncionario}
          onChange={(e) => { setBuscaFuncionario(e.target.value); setFuncionarioId(''); }}
          placeholder="Busque por nome ou matrícula…" />
        {buscaFuncionario && !funcionarioId && (
          <div className="at-sugestoes">
            {funcionariosFiltrados.slice(0, 6).map((f) => (
              <button key={f.id} type="button" className="at-sugestao"
                onClick={() => { setFuncionarioId(String(f.id)); setBuscaFuncionario(f.nome); verificarDuplicidade(f.id, dataEmissao, diasAfastamento); }}>
                {f.nome} {f.matricula ? `· matrícula ${f.matricula}` : ''}
              </button>
            ))}
            {funcionariosFiltrados.length === 0 && <p className="texto-suave" style={{ fontSize: 13, padding: 8 }}>Nenhum colaborador encontrado.</p>}
          </div>
        )}
        {funcionarioId && <p className="at-selecionado">✓ Selecionado: {buscaFuncionario}</p>}

        <label className="rotulo">Quem apresentou o documento?</label>
        <div className="at-radio-linha">
          <label className="at-radio"><input type="radio" checked={apresentadorTipo === 'PROPRIO'} onChange={() => setApresentadorTipo('PROPRIO')} /> Próprio colaborador</label>
          <label className="at-radio"><input type="radio" checked={apresentadorTipo === 'TERCEIRO'} onChange={() => setApresentadorTipo('TERCEIRO')} /> Terceiro (familiar/representante)</label>
        </div>
        {apresentadorTipo === 'TERCEIRO' && (
          <div className="at-duas">
            <div>
              <label className="rotulo">Nome do terceiro *</label>
              <input className="campo" type="text" value={apresentadorNome} onChange={(e) => setApresentadorNome(e.target.value)} />
            </div>
            <div>
              <label className="rotulo">CPF do terceiro *</label>
              <input className="campo" type="text" inputMode="numeric" value={apresentadorCpf}
                onChange={(e) => setApresentadorCpf(formatarCPF(e.target.value))} placeholder="000.000.000-00" />
            </div>
          </div>
        )}

        <div className="at-divisor">Dados do profissional emissor</div>
        <div className="at-duas">
          <div>
            <label className="rotulo">Tipo</label>
            <select className="campo" value={profissionalTipo} onChange={(e) => setProfissionalTipo(e.target.value)}>
              <option value="MEDICO">Médico (CRM)</option>
              <option value="DENTISTA">Dentista (CRO)</option>
            </select>
          </div>
          <div>
            <label className="rotulo">Nome do profissional *</label>
            <input className="campo" type="text" value={profissionalNome} onChange={(e) => setProfissionalNome(e.target.value)} />
          </div>
        </div>
        <div className="at-duas">
          <div>
            <label className="rotulo">Número do conselho ({profissionalTipo === 'MEDICO' ? 'CRM' : 'CRO'}) *</label>
            <input className="campo" type="text" value={profissionalConselho} onChange={(e) => setProfissionalConselho(e.target.value)} />
          </div>
          <div>
            <label className="rotulo">UF do conselho</label>
            <select className="campo" value={profissionalUf} onChange={(e) => setProfissionalUf(e.target.value)}>
              {UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
            </select>
          </div>
        </div>

        <div className="at-divisor">Dados do atestado</div>
        <div className="at-duas">
          <div>
            <label className="rotulo">Data de emissão *</label>
            <input className="campo" type="date" value={dataEmissao} max={hoje()}
              onChange={(e) => { setDataEmissao(e.target.value); verificarDuplicidade(funcionarioId, e.target.value, diasAfastamento); }} />
            <p className="texto-suave" style={{ fontSize: 11, marginTop: 3 }}>Não é possível informar uma data futura.</p>
          </div>
          <div>
            <label className="rotulo">Dias de afastamento *</label>
            <input className="campo" type="number" min="0.5" step="0.5" value={diasAfastamento}
              onChange={(e) => { setDiasAfastamento(e.target.value); verificarDuplicidade(funcionarioId, dataEmissao, e.target.value); }} />
          </div>
        </div>
        <label className="rotulo">Código CID (opcional)</label>
        <input className="campo" type="text" value={cid} onChange={(e) => setCid(e.target.value)} placeholder="Ex.: J11" />

        {avisoDuplicidade && <div className="aviso-erro">{avisoDuplicidade}</div>}

        <div className="at-divisor">Foto do atestado</div>
        <input className="campo" type="file" accept="image/*" capture="environment" onChange={(e) => escolherFoto(e.target.files?.[0] || null)} />
        {fotoPreview && (
          <div className="at-preview">
            <img src={fotoPreview} alt="Prévia do atestado" />
            <p className="texto-suave" style={{ fontSize: 12 }}>Confira se dá para ler o documento antes de salvar.</p>
          </div>
        )}

        {erroForm && <div className="aviso-erro">{erroForm}</div>}

        <button type="submit" className="botao botao-principal" disabled={salvando} style={{ marginTop: 14, width: '100%' }}>
          {salvando ? 'Salvando…' : 'Registrar e Emitir Recibo'}
        </button>
      </form>

      {reciboAberto && (
        <ReciboAtestado atestado={reciboAberto} nomeHotel={nomeHotel} usuario={usuario} onFechar={() => setReciboAberto(null)} />
      )}
    </section>
  );
}

// ============================================================================
// RECIBO — 2 vias (colaborador sem foto / hotel com foto), com corte
// ============================================================================

function ReciboAtestado({ atestado, nomeHotel, usuario, onFechar }) {
  return (
    <div className="at-overlay" role="dialog" aria-modal="true">
      <div className="at-modal" style={{ maxWidth: 680 }}>
        <div className="at-modal-topo at-nao-imprimir">
          <h2 style={{ fontSize: '1.15rem', margin: 0 }}>Recibo — {atestado.protocolo}</h2>
          <button type="button" className="at-fechar" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>

        <div className="recibo-atestado">
          {/* VIA DO COLABORADOR — SEM FOTO */}
          <div className="at-via">
            <h3 className="at-via-titulo">RECIBO DE ENTREGA DE ATESTADO — VIA DO COLABORADOR</h3>
            <BlocoDadosRecibo atestado={atestado} usuario={usuario} nomeHotel={nomeHotel} />
            <p style={{ fontSize: 11, marginTop: 10 }}>
              Declaro ter entregue o documento original acima descrito para conferência da equipe de Recursos Humanos.
            </p>
            <LinhasAssinatura atestado={atestado} />
          </div>

          <div className="at-corte">✂ &nbsp;Corte aqui — — — — — — — — — — — — — — — — — — — — — — — — —</div>

          {/* VIA DO HOTEL — COM FOTO */}
          <div className="at-via">
            <h3 className="at-via-titulo">RECIBO DE ENTREGA DE ATESTADO — VIA DO HOTEL</h3>
            <BlocoDadosRecibo atestado={atestado} usuario={usuario} nomeHotel={nomeHotel} />
            {atestado._fotoPreview && (
              <div className="at-recibo-foto">
                <img src={atestado._fotoPreview} alt="Atestado" />
              </div>
            )}
            <LinhasAssinatura atestado={atestado} />
          </div>
        </div>

        <div className="at-modal-botoes at-nao-imprimir">
          <button type="button" className="botao botao-principal" onClick={() => window.print()}>🖨️ Imprimir (2 vias)</button>
          <button type="button" className="botao botao-suave" onClick={onFechar}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

function BlocoDadosRecibo({ atestado, usuario, nomeHotel }) {
  return (
    <div style={{ fontSize: 12, lineHeight: 1.7 }}>
      <div><strong>Protocolo:</strong> {atestado.protocolo} &nbsp;·&nbsp; <strong>Data/hora:</strong> {formatarDataHora(atestado.criado_em)}</div>
      <div><strong>Colaborador:</strong> {atestado._nomeColaborador}</div>
      {atestado.apresentador_tipo === 'TERCEIRO' && (
        <div><strong>Apresentado por:</strong> {atestado.apresentador_nome} (CPF {formatarCPF(atestado.apresentador_cpf)})</div>
      )}
      <div><strong>Profissional emissor:</strong> {atestado.profissional_nome} — {atestado.profissional_tipo === 'MEDICO' ? 'CRM' : 'CRO'} {atestado.profissional_conselho}/{atestado.profissional_uf}</div>
      <div><strong>Data de emissão:</strong> {formatarData(atestado.data_emissao)} &nbsp;·&nbsp; <strong>Dias de afastamento:</strong> {atestado.dias_afastamento}</div>
      {atestado.cid && <div><strong>CID:</strong> {atestado.cid}</div>}
      <div><strong>Registrado por:</strong> {usuario.nome} — {nomeHotel}</div>
    </div>
  );
}

function LinhasAssinatura({ atestado }) {
  return (
    <div className="at-assinaturas">
      <div><div className="at-linha-ass" /><span>{atestado._nomeColaborador || 'Colaborador'}</span></div>
      <div><div className="at-linha-ass" /><span>Responsável pelo RH</span></div>
    </div>
  );
}

// ============================================================================
// LISTAGEM (Admin: completa / Contador: só leitura)
// ============================================================================

function ListagemAtestados({ atestados, usuario, nomeHotel, nomeFuncionario, nomeUsuario, mostrarAviso, setErro, recarregar, souAdmin }) {
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('TODOS');
  const [fotoAberta, setFotoAberta] = useState(null); // { atestado, url }
  const [carregandoFoto, setCarregandoFoto] = useState(null);
  const [excluindoId, setExcluindoId] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [reciboReimpresso, setReciboReimpresso] = useState(null);
  const [carregandoRecibo, setCarregandoRecibo] = useState(null);

  async function registrarLog(atestadoId, acao, detalhe) {
    const ip = await meuIP();
    await supabase.from('atestados_log').insert({
      usuario_id: usuario.id, atestado_id: atestadoId, acao, detalhe, ip_origem: ip, hotel_id: usuario.hotel_id,
    });
  }

  async function verFoto(atestado) {
    setCarregandoFoto(atestado.id);
    const { data, error } = await supabase.storage.from('atestados').createSignedUrl(atestado.foto_caminho, 300);
    setCarregandoFoto(null);
    if (error) { setErro('Não foi possível carregar a foto. Detalhe técnico: ' + error.message); return; }
    await registrarLog(atestado.id, 'VISUALIZACAO_FOTO', `Foto do atestado ${atestado.protocolo} visualizada.`);
    setFotoAberta({ atestado, url: data.signedUrl });
  }

  async function reimprimirRecibo(atestado) {
    setCarregandoRecibo(atestado.id);
    const { data, error } = await supabase.storage.from('atestados').createSignedUrl(atestado.foto_caminho, 300);
    setCarregandoRecibo(null);
    if (error) { setErro('Não foi possível carregar a foto para o recibo. Detalhe técnico: ' + error.message); return; }
    await registrarLog(atestado.id, 'VISUALIZACAO_FOTO', `Recibo do atestado ${atestado.protocolo} reimpresso.`);
    // IMPORTANTE: usa o "criado_em" gravado no banco (relógio do servidor no
    // momento original do atendimento) — NUNCA a data/hora de agora, mesmo
    // sendo uma reimpressão feita dias depois.
    setReciboReimpresso({
      ...atestado,
      _fotoPreview: data.signedUrl,
      _nomeColaborador: nomeFuncionario(atestado.funcionario_id),
    });
  }

  async function mudarStatus(atestado, novoStatus) {
    if (!souAdmin || salvando) return;
    setSalvando(true);
    const { error } = await supabase.from('atestados').update({ status: novoStatus }).eq('id', atestado.id);
    setSalvando(false);
    if (error) { setErro('Não foi possível atualizar. Detalhe técnico: ' + error.message); return; }
    await registrarLog(atestado.id, 'ALTERACAO_STATUS', `Status do atestado ${atestado.protocolo} alterado para ${STATUS_LABEL[novoStatus]}.`);
    mostrarAviso('Status atualizado!');
    recarregar();
  }

  async function excluir(atestado) {
    setExcluindoId(null);
    await registrarLog(atestado.id, 'EXCLUSAO', `Atestado ${atestado.protocolo} excluído.`);
    await supabase.storage.from('atestados').remove([atestado.foto_caminho]);
    const { error } = await supabase.from('atestados').delete().eq('id', atestado.id);
    if (error) { setErro('Não foi possível excluir. Detalhe técnico: ' + error.message); return; }
    mostrarAviso('Atestado excluído.');
    recarregar();
  }

  const termo = busca.trim().toLowerCase();
  const filtrados = atestados
    .filter((a) => filtroStatus === 'TODOS' ? true : a.status === filtroStatus)
    .filter((a) => !termo || nomeFuncionario(a.funcionario_id).toLowerCase().includes(termo) || a.protocolo.toLowerCase().includes(termo));

  return (
    <section>
      <div className="at-barra">
        <input className="campo" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por colaborador ou protocolo…" />
        <select className="campo" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
          <option value="TODOS">Todos os status</option>
          {Object.entries(STATUS_LABEL).map(([chave, rotulo]) => <option key={chave} value={chave}>{rotulo}</option>)}
        </select>
      </div>

      {filtrados.length === 0 ? (
        <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>Nenhum atestado encontrado.</div>
      ) : (
        <div className="at-lista">
          {filtrados.map((a) => (
            <div key={a.id} className="cartao at-item">
              <div className="at-item-esq">
                <div className="at-item-topo">
                  <strong>{nomeFuncionario(a.funcionario_id)}</strong>
                  <span className="at-badge" style={{ background: STATUS_COR[a.status].fundo, color: STATUS_COR[a.status].texto }}>
                    {STATUS_LABEL[a.status]}
                  </span>
                </div>
                <div className="texto-suave" style={{ fontSize: 13 }}>
                  Protocolo {a.protocolo} · {a.dias_afastamento} dia(s) a partir de {formatarData(a.data_emissao)}
                </div>
                <div className="texto-suave" style={{ fontSize: 12 }}>
                  {a.profissional_nome} ({a.profissional_tipo === 'MEDICO' ? 'CRM' : 'CRO'} {a.profissional_conselho}/{a.profissional_uf})
                  {a.cid ? ` · CID ${a.cid}` : ''}
                </div>
                <div className="texto-suave" style={{ fontSize: 12 }}>
                  Registrado por {nomeUsuario(a.criado_por_id)} em {formatarDataHora(a.criado_em)}
                </div>
              </div>
              <div className="at-item-dir">
                <button type="button" className="botao botao-contorno" onClick={() => verFoto(a)} disabled={carregandoFoto === a.id}>
                  {carregandoFoto === a.id ? 'Abrindo…' : '📷 Ver foto'}
                </button>
                {souAdmin && (
                  <button type="button" className="botao botao-contorno" onClick={() => reimprimirRecibo(a)} disabled={carregandoRecibo === a.id}>
                    {carregandoRecibo === a.id ? 'Preparando…' : '🖨️ Reimprimir recibo'}
                  </button>
                )}
                {souAdmin && (
                  <select className="campo at-select-status" value={a.status} disabled={salvando} onChange={(e) => mudarStatus(a, e.target.value)}>
                    {Object.entries(STATUS_LABEL).map(([chave, rotulo]) => <option key={chave} value={chave}>{rotulo}</option>)}
                  </select>
                )}
                {souAdmin && (
                  excluindoId === a.id ? (
                    <span className="at-confirmar">
                      Excluir?
                      <button type="button" className="botao botao-perigo" onClick={() => excluir(a)}>Sim</button>
                      <button type="button" className="botao botao-suave" onClick={() => setExcluindoId(null)}>Não</button>
                    </span>
                  ) : (
                    <button type="button" className="botao botao-suave" onClick={() => setExcluindoId(a.id)}>Excluir</button>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {fotoAberta && (
        <div className="at-overlay" role="dialog" aria-modal="true" onClick={() => setFotoAberta(null)}>
          <div className="at-modal-foto" onClick={(e) => e.stopPropagation()}>
            <div className="at-modal-topo">
              <h2 style={{ fontSize: '1rem', margin: 0 }}>Atestado — {fotoAberta.atestado.protocolo}</h2>
              <button type="button" className="at-fechar" onClick={() => setFotoAberta(null)} aria-label="Fechar">✕</button>
            </div>
            <img src={fotoAberta.url} alt="Foto do atestado" style={{ width: '100%', borderRadius: 10 }} />
            <p className="texto-suave" style={{ fontSize: 11, marginTop: 6 }}>Link temporário — expira em alguns minutos por segurança.</p>
          </div>
        </div>
      )}

      {reciboReimpresso && (
        <ReciboAtestado atestado={reciboReimpresso} nomeHotel={nomeHotel} usuario={usuario} onFechar={() => setReciboReimpresso(null)} />
      )}
    </section>
  );
}

// ============================================================================
// LOG DE AUDITORIA (só admin)
// ============================================================================

function LogAuditoria({ logs, nomeUsuario }) {
  const ACAO_LABEL = { INCLUSAO: 'Inclusão', VISUALIZACAO_FOTO: 'Visualização de Foto', ALTERACAO_STATUS: 'Alteração de Status', EXCLUSAO: 'Exclusão' };
  return (
    <section className="at-lista">
      {logs.length === 0 ? (
        <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>Nenhum registro no log ainda.</div>
      ) : (
        logs.map((l) => (
          <div key={l.id} className="cartao" style={{ padding: '12px 16px' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
              <strong>{nomeUsuario(l.usuario_id)}</strong>
              <span className="at-log-acao">{ACAO_LABEL[l.acao] || l.acao}</span>
              <span className="texto-suave" style={{ fontSize: 12 }}>IP: {l.ip_origem || '—'}</span>
            </div>
            {l.detalhe && <div style={{ fontSize: 14, marginTop: 3 }}>{l.detalhe}</div>}
            <div className="texto-suave" style={{ fontSize: 12 }}>{formatarDataHora(l.data_hora)}</div>
          </div>
        ))
      )}
    </section>
  );
}

// ---- Estilos ------------------------------------------------------------

function EstilosAtestados() {
  return (
    <style>{`
      .at-abas { display: flex; gap: 6px; overflow-x: auto; margin: 14px 0 16px; padding-bottom: 4px; }
      .at-aba { border: 1px solid var(--borda); background: var(--branco); color: var(--tinta); border-radius: 999px; padding: 10px 16px; font-size: 14px; font-weight: 600; cursor: pointer; white-space: nowrap; min-height: 42px; }
      .at-aba-ativa { background: var(--marca); border-color: var(--marca); color: var(--branco); }

      .at-duas { display: grid; grid-template-columns: 1fr; gap: 0 14px; }
      .at-divisor { font-size: 13px; font-weight: 700; color: var(--texto-suave); margin: 16px 0 6px; border-top: 1px solid var(--borda); padding-top: 12px; }

      .at-sugestoes { border: 1px solid var(--borda); border-radius: 10px; margin-top: -4px; margin-bottom: 10px; overflow: hidden; }
      .at-sugestao { display: block; width: 100%; text-align: left; padding: 10px 12px; border: none; background: var(--branco); border-bottom: 1px solid var(--borda); cursor: pointer; font-family: inherit; font-size: 14px; }
      .at-sugestao:last-child { border-bottom: none; }
      .at-sugestao:hover { background: var(--marca-clara); }
      .at-selecionado { color: var(--sucesso-texto); font-weight: 700; font-size: 13px; margin: -4px 0 10px; }

      .at-radio-linha { display: flex; flex-direction: column; gap: 4px; margin-bottom: 6px; }
      .at-radio { display: flex; align-items: center; gap: 8px; font-size: 14px; padding: 6px 0; cursor: pointer; }
      .at-radio input { width: 18px; height: 18px; }

      .at-preview { margin-top: 10px; }
      .at-preview img { max-width: 100%; max-height: 240px; border-radius: 10px; border: 1px solid var(--borda); }

      .at-lista { display: flex; flex-direction: column; gap: 12px; }
      .at-item { display: flex; flex-direction: column; gap: 10px; padding: 16px; }
      .at-item-topo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .at-item-topo strong { font-size: 16px; }
      .at-badge { display: inline-block; font-size: 12px; font-weight: 700; border-radius: 999px; padding: 3px 10px; }
      .at-item-dir { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
      .at-select-status { width: auto; min-width: 200px; }
      .at-confirmar { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--erro-texto); flex-wrap: wrap; }
      .at-barra { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }

      .at-log-acao { font-size: 12px; font-weight: 700; color: var(--marca); background: var(--marca-clara); border-radius: 999px; padding: 2px 9px; }

      .at-overlay { position: fixed; inset: 0; background: rgba(15, 25, 22, 0.55); display: flex; align-items: flex-end; justify-content: center; z-index: 80; }
      .at-modal { background: var(--branco); width: 100%; max-height: 92vh; overflow-y: auto; border-radius: 18px 18px 0 0; padding: 18px; }
      .at-modal-foto { background: var(--branco); width: 100%; max-width: 480px; border-radius: 16px; padding: 16px; max-height: 90vh; overflow-y: auto; }
      .at-modal-topo { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
      .at-fechar { border: none; background: #E9ECE8; border-radius: 999px; width: 40px; height: 40px; font-size: 16px; cursor: pointer; flex-shrink: 0; }
      .at-modal-botoes { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }

      .recibo-atestado { background: #FFFFFF; color: #1a1a1a; }
      .at-via { border: 1px solid var(--borda); border-radius: 10px; padding: 16px; }
      .at-via-titulo { font-size: 13px; text-align: center; letter-spacing: 0.03em; margin: 0 0 10px; }
      .at-corte { text-align: center; color: #888; font-size: 12px; margin: 16px 0; border-top: 1px dashed #aaa; padding-top: 4px; }
      .at-recibo-foto { margin-top: 10px; }
      .at-recibo-foto img { max-width: 100%; max-height: 220px; border-radius: 8px; border: 1px solid #ccc; }
      .at-assinaturas { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 32px; text-align: center; font-size: 11px; }
      .at-linha-ass { border-top: 1px solid #333; margin-bottom: 4px; }

      @media (min-width: 640px) {
        .at-duas { grid-template-columns: 1fr 1fr; }
        .at-radio-linha { flex-direction: row; gap: 20px; }
        .at-item { flex-direction: row; justify-content: space-between; align-items: flex-start; }
        .at-item-dir { align-items: flex-end; }
        .at-barra { flex-direction: row; align-items: center; }
        .at-barra .campo { flex: 1; }
        .at-overlay { align-items: center; padding: 24px; }
        .at-modal { max-width: 700px; border-radius: 18px; padding: 24px; }
      }

      @media print {
        @page { size: A4 portrait; margin: 10mm; }
        body * { visibility: hidden; }
        .recibo-atestado, .recibo-atestado * { visibility: visible; }
        .recibo-atestado {
          position: fixed; top: 0; left: 0; width: 100%; height: 277mm;
          display: flex; flex-direction: column; overflow: hidden;
        }
        .at-via {
          flex: 1; overflow: hidden; page-break-inside: avoid; page-break-after: avoid;
          display: flex; flex-direction: column;
        }
        .at-corte { flex: none; margin: 6px 0; }
        .at-recibo-foto { flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; }
        .at-recibo-foto img { max-height: 55mm; max-width: 100%; object-fit: contain; }
        .at-assinaturas { margin-top: auto; padding-top: 10px; }
        .at-nao-imprimir { display: none !important; }
      }
    `}</style>
  );
}
