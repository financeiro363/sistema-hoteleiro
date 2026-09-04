'use client';

// ============================================================================
// CABEÇALHO DO SITE (aparece em todas as páginas)
// - Logo à esquerda
// - Menu de navegação (vira hambúrguer ☰ no celular)
// - Botão de ação: "Entrar" (deslogado) ou nome + "Sair" (logado)
// ============================================================================

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { PAPEIS_RESTRITOS } from '../../lib/restricaoAcesso';

const CATEGORIAS_MENU = [
  {
    chave: 'atendimento',
    nome: 'Atendimento',
    links: [
      { href: '/agenda', rotulo: 'Agenda Telefônica' },
      { href: '/solicitacoes', rotulo: 'Solicitações' },
      { href: '/lista-espera', rotulo: 'Lista de Espera' },
      { href: '/creditos', rotulo: 'Créditos e Devoluções' },
      { href: '/achados-perdidos', rotulo: 'Achados e Perdidos' },
      { href: '/recibos', rotulo: 'Recibos' },
      { href: '/fichas-hospedes', rotulo: 'Fichas de Hóspedes' },
    ],
  },
  {
    chave: 'operacoes',
    nome: 'Operações',
    links: [
      { href: '/depositos', rotulo: 'Depósitos Bancários' },
      { href: '/planejador-arrumacao', rotulo: 'Gerenciador de Tarefas' },
      { href: '/sala-reuniao', rotulo: 'Sala de Reunião' },
      { href: '/lavanderia', rotulo: 'Lavanderia' },
      { href: '/ocorrencias', rotulo: 'Ocorrências' },
      { href: '/manutencao', rotulo: 'Manutenção' },
      { href: '/estoque', rotulo: 'Estoque' },
      { href: '/governanca', rotulo: 'Governança' },
      { href: '/pdv', rotulo: 'PDV — Conveniência' },
    ],
  },
  {
    chave: 'administracao',
    nome: 'Administração',
    links: [
      { href: '/financeiro', rotulo: 'Financeiro', soAdmin: true },
      { href: '/ponto', rotulo: 'Ponto', soAdmin: true },
      { href: '/contabilidade', rotulo: 'Contabilidade', soAdminOuContador: true, contadorVe: true },
      { href: '/usuarios', rotulo: 'Usuários', soAdmin: true },
      { href: '/atestados', rotulo: 'Atestados', soAdminOuContador: true, contadorVe: true },
    ],
  },
];

// Decide se um link específico pode aparecer para o papel atual
function linkVisivelPara(link, papelUsuario, podeAcessarDepositos, podeVerTarefasDoDia) {
  if (papelUsuario === 'CONTADOR') return !!link.contadorVe;
  if (link.soAdmin) return papelUsuario === 'ADMIN';
  if (link.soAdminOuContador) return papelUsuario === 'ADMIN';
  if (link.href === '/depositos' && papelUsuario === 'COLABORADOR') return !!podeAcessarDepositos;
  if (link.href === '/planejador-arrumacao' && papelUsuario === 'COLABORADOR') return !!podeVerTarefasDoDia;
  return true;
}

// Rótulo de cada página usada por um papel restrito (Manutenção/Camareira),
// pra montar o link certo no menu enxuto deles.
const ROTULO_PAGINA_RESTRITA = {
  '/manutencao': '🔧 Manutenção',
  '/governanca': '🧹 Governança',
  '/lavanderia': '🧺 Lavanderia',
};

export default function CabecalhoSite() {
  const caminhoAtual = usePathname();
  const router = useRouter();

  const [menuAberto, setMenuAberto] = useState(false);
  const [categoriaAberta, setCategoriaAberta] = useState(null);
  const [logado, setLogado] = useState(false);
  const [nomeUsuario, setNomeUsuario] = useState('');
  const [papelUsuario, setPapelUsuario] = useState('');
  const [nomeHotel, setNomeHotel] = useState('');
  const [souSuperAdmin, setSouSuperAdmin] = useState(false);
  const [podeIncluirAtestado, setPodeIncluirAtestado] = useState(false);
  const [podeAcessarDepositos, setPodeAcessarDepositos] = useState(false);
  const [podeVerTarefasDoDia, setPodeVerTarefasDoDia] = useState(false);
  const [meusHoteis, setMeusHoteis] = useState([]); // [{hotel_id, papel, nome}]
  const [hotelIdAtual, setHotelIdAtual] = useState(null);
  const [trocandoHotel, setTrocandoHotel] = useState(false);
  const [usuarioIdAtual, setUsuarioIdAtual] = useState(null);
  const [contadorSolicitacoes, setContadorSolicitacoes] = useState(0);
  const [contadorFichasPendentes, setContadorFichasPendentes] = useState(0);

  // Observa o login: mostra "Entrar" ou "Sair" conforme a sessão
  useEffect(() => {
    let ativo = true;

    async function carregarSessao() {
      const { data } = await supabase.auth.getSession();
      if (!ativo) return;
      setLogado(!!data?.session);
      if (data?.session) {
        const { data: perfil } = await supabase
          .from('usuarios')
          .select('id, nome, papel, super_admin, pode_incluir_atestado, pode_acessar_depositos, pode_ver_tarefas_do_dia, hotel_id')
          .eq('auth_id', data.session.user.id)
          .single();
        if (ativo) setUsuarioIdAtual(perfil?.id || null);
        if (ativo && perfil?.nome) setNomeUsuario(perfil.nome.split(' ')[0]);
        if (ativo) setPapelUsuario(perfil?.papel || '');
        if (ativo) setSouSuperAdmin(perfil?.super_admin === true);
        if (ativo) setPodeIncluirAtestado(perfil?.pode_incluir_atestado === true);
        if (ativo) setPodeAcessarDepositos(perfil?.pode_acessar_depositos === true);
        if (ativo) setPodeVerTarefasDoDia(perfil?.pode_ver_tarefas_do_dia === true);
        if (ativo) setHotelIdAtual(perfil?.hotel_id || null);
        if (perfil?.hotel_id) {
          const { data: hotel } = await supabase.from('hoteis').select('nome_fantasia').eq('id', perfil.hotel_id).single();
          if (ativo && hotel?.nome_fantasia) setNomeHotel(hotel.nome_fantasia);
        }
        // Só busca a lista de vínculos se realmente puder ter mais de um —
        // é uma consulta a mais, então evita rodar à toa pra quem só tem 1 hotel.
        // Filtra explicitamente pelo próprio auth_id — não depende só da
        // regra do banco pra isso, já que agora outras pessoas do mesmo
        // hotel também podem aparecer nessa tabela pra outros fins (lista
        // de destinatários em Solicitações).
        const { data: vinculos } = await supabase
          .from('vinculos_usuario_hotel')
          .select('hotel_id, papel')
          .eq('auth_id', data.session.user.id)
          .eq('ativo', true);

        if (vinculos && vinculos.length > 0) {
          const idsHoteis = vinculos.map((v) => v.hotel_id);
          const { data: hoteisEncontrados } = await supabase
            .from('hoteis').select('id, nome_fantasia').in('id', idsHoteis);
          const mapaNomeHotel = Object.fromEntries((hoteisEncontrados || []).map((h) => [h.id, h.nome_fantasia]));
          if (ativo) setMeusHoteis(vinculos.map((v) => ({
            hotel_id: v.hotel_id, papel: v.papel, nome: mapaNomeHotel[v.hotel_id] || `Hotel #${v.hotel_id}`,
          })));
        } else if (ativo) {
          setMeusHoteis([]);
        }

        // Contadores só fazem sentido pra quem realmente vê essas duas
        // páginas no menu (Admin/Colaborador) — evita gastar consulta à toa
        // pros papéis restritos ou pro Contador, que nem veem esses links.
        if (perfil?.id && (perfil.papel === 'ADMIN' || perfil.papel === 'COLABORADOR')) {
          atualizarContadores(perfil.id, perfil.hotel_id, perfil.papel);
        } else if (ativo) {
          setContadorSolicitacoes(0);
          setContadorFichasPendentes(0);
        }
      }
    }
    carregarSessao();

    const { data: escuta } = supabase.auth.onAuthStateChange((_evento, sessao) => {
      setLogado(!!sessao);
      if (!sessao) { setNomeUsuario(''); setPapelUsuario(''); setSouSuperAdmin(false); setPodeIncluirAtestado(false); setPodeAcessarDepositos(false); setPodeVerTarefasDoDia(false); setNomeHotel(''); setMeusHoteis([]); setHotelIdAtual(null); setContadorSolicitacoes(0); setContadorFichasPendentes(0); }
      else carregarSessao();
    });

    return () => {
      ativo = false;
      escuta?.subscription?.unsubscribe();
    };
  }, []);

  async function trocarHotel(novoHotelId) {
    if (!novoHotelId || Number(novoHotelId) === hotelIdAtual || trocandoHotel) return;
    setTrocandoHotel(true);
    const { data: sessao } = await supabase.auth.getSession();
    try {
      const resposta = await fetch('/api/hotel-trocar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.session.access_token}` },
        body: JSON.stringify({ hotelId: Number(novoHotelId) }),
      });
      const resultado = await resposta.json();
      if (!resposta.ok || resultado.erro) {
        alert(resultado.erro || 'Não foi possível trocar de hotel.');
        setTrocandoHotel(false);
        return;
      }
      // Recarrega a página inteira — garante que toda tela (e não só o
      // cabeçalho) volte a buscar os dados já com o hotel novo.
      window.location.href = '/';
    } catch (e) {
      alert('Falha de conexão ao trocar de hotel.');
      setTrocandoHotel(false);
    }
  }

  // Solicitações pendentes destinadas a mim + fichas aguardando exportação
  // (contagem do hotel inteiro, não só minha) — reutilizada na carga
  // inicial, no polling periódico e sempre que a pessoa navega de página.
  async function atualizarContadores(usuarioId, hotelId, papel) {
    if (!usuarioId || !hotelId || (papel !== 'ADMIN' && papel !== 'COLABORADOR')) {
      setContadorSolicitacoes(0);
      setContadorFichasPendentes(0);
      return;
    }
    const { count } = await supabase
      .from('tarefas')
      .select('id', { count: 'exact', head: true })
      .eq('responsavel_atual_id', usuarioId)
      .eq('hotel_id', hotelId)
      .neq('status', 'Concluído')
      .neq('status', 'Cancelado');
    setContadorSolicitacoes(count || 0);

    try {
      const { data: sessaoAtual } = await supabase.auth.getSession();
      if (!sessaoAtual?.session) return;
      const resposta = await fetch('/api/fichas-listar', {
        headers: { Authorization: `Bearer ${sessaoAtual.session.access_token}` },
      });
      const resultado = await resposta.json();
      const pendentes = (resultado.fichas || []).filter((f) => f.status === 'PENDENTE').length;
      setContadorFichasPendentes(pendentes);
    } catch (e) {
      setContadorFichasPendentes(0);
    }
  }

  // Atualiza os contadores periodicamente (a cada 60s) — como o menu não
  // sabe quando algo muda em outra tela, é o jeito mais simples de manter
  // os números razoavelmente em dia sem precisar mexer em cada página.
  useEffect(() => {
    if (!usuarioIdAtual || !hotelIdAtual) return;
    const id = setInterval(() => {
      atualizarContadores(usuarioIdAtual, hotelIdAtual, papelUsuario);
    }, 60000);
    return () => clearInterval(id);
  }, [usuarioIdAtual, hotelIdAtual, papelUsuario]);

  // Fecha o menu hambúrguer e o dropdown de categoria sempre que muda de
  // página — e aproveita pra atualizar os contadores também, já que trocar
  // de página é o momento mais comum de algo ter mudado (ex.: acabou de
  // resolver uma solicitação).
  useEffect(() => {
    setMenuAberto(false);
    setCategoriaAberta(null);
    if (usuarioIdAtual && hotelIdAtual) {
      atualizarContadores(usuarioIdAtual, hotelIdAtual, papelUsuario);
    }
  }, [caminhoAtual]);

  // Fecha o dropdown de categoria se a pessoa clicar fora dele
  useEffect(() => {
    if (!categoriaAberta) return;
    function aoClicarFora(evento) {
      if (!evento.target.closest('.menu-categoria')) setCategoriaAberta(null);
    }
    document.addEventListener('click', aoClicarFora);
    return () => document.removeEventListener('click', aoClicarFora);
  }, [categoriaAberta]);

  async function sair() {
    await supabase.auth.signOut();
    router.push('/');
  }

  // A ficha do hóspede é uma página PÚBLICA (sem login) — não faz
  // sentido mostrar o menu do sistema nem o botão "Entrar" ali, já que
  // quem preenche é o hóspede, não a equipe do hotel. Isso vem DEPOIS de
  // todos os hooks acima, porque o React exige que os hooks sempre sejam
  // chamados na mesma ordem, mesmo quando vamos retornar nada.
  if (caminhoAtual?.startsWith('/ficha-hospede')) return null;

  return (
    <header className="cabecalho">
      <div className="cabecalho-interno">
        {/* Logo */}
        <Link href="/" className="logo" aria-label="Sistema Hoteleiro — Início">
          <span className="logo-simbolo" aria-hidden="true">⌂</span>
          <span>
            Sistema Hoteleiro
            {meusHoteis.length > 1 ? (
              <select className="cabecalho-seletor-hotel" value={hotelIdAtual || ''} disabled={trocandoHotel}
                onChange={(e) => trocarHotel(e.target.value)} aria-label="Trocar de hotel">
                {meusHoteis.map((h) => <option key={h.hotel_id} value={h.hotel_id}>{h.nome}</option>)}
              </select>
            ) : (
              nomeHotel && <span className="cabecalho-nome-hotel">{nomeHotel}</span>
            )}
          </span>
        </Link>

        {/* Menu de navegação — escondido só na Home pra visitante (ainda
            não logado, vendo a página de apresentação). Quem já está
            logado sempre vê o menu, mesmo na Home, senão fica sem jeito
            de navegar pra lugar nenhum depois de entrar. */}
        {(caminhoAtual !== '/' || logado) && (
        <nav
          id="menu-principal"
          className={menuAberto ? 'navegacao aberta' : 'navegacao'}
          aria-label="Menu principal"
        >
          {papelUsuario !== 'CONTADOR' && !PAPEIS_RESTRITOS[papelUsuario] && (
            <Link href="/" className={caminhoAtual === '/' ? 'ativa' : ''}>
              Início
            </Link>
          )}

          <Link href="/tarefas-pessoais" className={caminhoAtual === '/tarefas-pessoais' ? 'ativa' : ''}>
            📝 Minhas Tarefas
          </Link>

          {PAPEIS_RESTRITOS[papelUsuario] ? (
            // Perfil com acesso restrito (Manutenção, Camareira): só a
            // segunda página permitida pra esse papel aparece — nada mais.
            <>
              {PAPEIS_RESTRITOS[papelUsuario].paginas
                .filter((pagina) => pagina !== '/tarefas-pessoais')
                .map((pagina) => (
                  <Link key={pagina} href={pagina} className={caminhoAtual === pagina ? 'ativa' : ''}>
                    {ROTULO_PAGINA_RESTRITA[pagina] || pagina}
                  </Link>
                ))}
            </>
          ) : papelUsuario === 'CONTADOR' ? (
            // Visão restrita do Contador: só os destinos que ele pode acessar
            <>
              <Link href="/contabilidade" className={caminhoAtual === '/contabilidade' ? 'ativa' : ''}>
                Contabilidade
              </Link>
              <Link href="/atestados" className={caminhoAtual === '/atestados' ? 'ativa' : ''}>
                Atestados
              </Link>
              <Link href="/fichas-hospedes" className={caminhoAtual === '/fichas-hospedes' ? 'ativa' : ''}>
                Fichas de Hóspedes
              </Link>
            </>
          ) : (
            <>
              {CATEGORIAS_MENU.map((categoria) => {
                const linksVisiveis = categoria.links.filter((link) => linkVisivelPara(link, papelUsuario, podeAcessarDepositos, podeVerTarefasDoDia));
                if (linksVisiveis.length === 0) return null; // esconde a categoria inteira se ninguém dentro dela é visível
                const temPaginaAtiva = linksVisiveis.some((link) => link.href === caminhoAtual);
                return (
                  <div key={categoria.chave} className="menu-categoria">
                    <button
                      type="button"
                      className={temPaginaAtiva ? 'menu-categoria-botao ativa' : 'menu-categoria-botao'}
                      aria-expanded={categoriaAberta === categoria.chave}
                      onClick={() => setCategoriaAberta(categoriaAberta === categoria.chave ? null : categoria.chave)}
                    >
                      {categoria.nome}
                      <span className="menu-seta" aria-hidden="true">{categoriaAberta === categoria.chave ? '▲' : '▼'}</span>
                    </button>
                    {categoriaAberta === categoria.chave && (
                      <div className="menu-dropdown">
                        {linksVisiveis.map((link) => {
                          const contador = link.href === '/solicitacoes' ? contadorSolicitacoes
                            : link.href === '/fichas-hospedes' ? contadorFichasPendentes : 0;
                          return (
                            <Link key={link.href} href={link.href} className={caminhoAtual === link.href ? 'ativa' : ''}>
                              {link.rotulo}
                              {contador > 0 && <span className="cabecalho-badge">{contador > 99 ? '99+' : contador}</span>}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              {/* Permissão avulsa: alguém que não é admin/contador mas pode
                  registrar atestados (ex.: recepção) — link extra, fora das
                  categorias normais, já que essa permissão não segue o papel. */}
              {papelUsuario !== 'ADMIN' && podeIncluirAtestado && (
                <Link href="/atestados" className={caminhoAtual === '/atestados' ? 'ativa' : ''}>
                  Atestados
                </Link>
              )}
            </>
          )}
        </nav>
        )}

        {/* Ações do lado direito */}
        <div className="cabecalho-acoes">
          {logado ? (
            <>
              {souSuperAdmin && (
                <Link href="/propriedades" className={caminhoAtual === '/propriedades' ? 'botao botao-principal' : 'botao botao-contorno'}>
                  🏢 Propriedades
                </Link>
              )}
              {nomeUsuario && <span className="cabecalho-usuario">Olá, {nomeUsuario}</span>}
              <button type="button" className="botao botao-suave" onClick={sair}>
                Sair
              </button>
            </>
          ) : (
            <Link href="/login" className="botao botao-principal">
              Entrar
            </Link>
          )}
          {(caminhoAtual !== '/' || logado) && (
            <button
              type="button"
              className="botao-menu"
              aria-label={menuAberto ? 'Fechar menu' : 'Abrir menu'}
              aria-expanded={menuAberto}
              aria-controls="menu-principal"
              onClick={() => setMenuAberto(!menuAberto)}
            >
              {menuAberto ? '✕' : '☰'}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
