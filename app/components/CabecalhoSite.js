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
function linkVisivelPara(link, papelUsuario, podeAcessarDepositos) {
  if (papelUsuario === 'CONTADOR') return !!link.contadorVe;
  if (link.soAdmin) return papelUsuario === 'ADMIN';
  if (link.soAdminOuContador) return papelUsuario === 'ADMIN';
  if (link.href === '/depositos' && papelUsuario === 'COLABORADOR') return !!podeAcessarDepositos;
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
  const [meusHoteis, setMeusHoteis] = useState([]); // [{hotel_id, papel, nome}]
  const [hotelIdAtual, setHotelIdAtual] = useState(null);
  const [trocandoHotel, setTrocandoHotel] = useState(false);

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
          .select('nome, papel, super_admin, pode_incluir_atestado, pode_acessar_depositos, hotel_id')
          .eq('auth_id', data.session.user.id)
          .single();
        if (ativo && perfil?.nome) setNomeUsuario(perfil.nome.split(' ')[0]);
        if (ativo) setPapelUsuario(perfil?.papel || '');
        if (ativo) setSouSuperAdmin(perfil?.super_admin === true);
        if (ativo) setPodeIncluirAtestado(perfil?.pode_incluir_atestado === true);
        if (ativo) setPodeAcessarDepositos(perfil?.pode_acessar_depositos === true);
        if (ativo) setHotelIdAtual(perfil?.hotel_id || null);
        if (perfil?.hotel_id) {
          const { data: hotel } = await supabase.from('hoteis').select('nome_fantasia').eq('id', perfil.hotel_id).single();
          if (ativo && hotel?.nome_fantasia) setNomeHotel(hotel.nome_fantasia);
        }
        // Só busca a lista de vínculos se realmente puder ter mais de um —
        // é uma consulta a mais, então evita rodar à toa pra quem só tem 1 hotel.
        const { data: vinculos } = await supabase
          .from('vinculos_usuario_hotel')
          .select('hotel_id, papel, hoteis(nome_fantasia)')
          .eq('ativo', true);
        if (ativo) setMeusHoteis((vinculos || []).map((v) => ({ hotel_id: v.hotel_id, papel: v.papel, nome: v.hoteis?.nome_fantasia || `Hotel #${v.hotel_id}` })));
      }
    }
    carregarSessao();

    const { data: escuta } = supabase.auth.onAuthStateChange((_evento, sessao) => {
      setLogado(!!sessao);
      if (!sessao) { setNomeUsuario(''); setPapelUsuario(''); setSouSuperAdmin(false); setPodeIncluirAtestado(false); setPodeAcessarDepositos(false); setNomeHotel(''); setMeusHoteis([]); setHotelIdAtual(null); }
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

  // Fecha o menu hambúrguer e o dropdown de categoria sempre que muda de página
  useEffect(() => {
    setMenuAberto(false);
    setCategoriaAberta(null);
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
                const linksVisiveis = categoria.links.filter((link) => linkVisivelPara(link, papelUsuario, podeAcessarDepositos));
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
                        {linksVisiveis.map((link) => (
                          <Link key={link.href} href={link.href} className={caminhoAtual === link.href ? 'ativa' : ''}>
                            {link.rotulo}
                          </Link>
                        ))}
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
