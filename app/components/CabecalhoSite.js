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
function linkVisivelPara(link, papelUsuario) {
  if (papelUsuario === 'CONTADOR') return !!link.contadorVe;
  if (link.soAdmin) return papelUsuario === 'ADMIN';
  if (link.soAdminOuContador) return papelUsuario === 'ADMIN';
  return true;
}

export default function CabecalhoSite() {
  const caminhoAtual = usePathname();
  const router = useRouter();

  const [menuAberto, setMenuAberto] = useState(false);
  const [categoriaAberta, setCategoriaAberta] = useState(null);
  const [logado, setLogado] = useState(false);
  const [nomeUsuario, setNomeUsuario] = useState('');
  const [papelUsuario, setPapelUsuario] = useState('');
  const [souSuperAdmin, setSouSuperAdmin] = useState(false);
  const [podeIncluirAtestado, setPodeIncluirAtestado] = useState(false);

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
          .select('nome, papel, super_admin, pode_incluir_atestado')
          .eq('auth_id', data.session.user.id)
          .single();
        if (ativo && perfil?.nome) setNomeUsuario(perfil.nome.split(' ')[0]);
        if (ativo) setPapelUsuario(perfil?.papel || '');
        if (ativo) setSouSuperAdmin(perfil?.super_admin === true);
        if (ativo) setPodeIncluirAtestado(perfil?.pode_incluir_atestado === true);
      }
    }
    carregarSessao();

    const { data: escuta } = supabase.auth.onAuthStateChange((_evento, sessao) => {
      setLogado(!!sessao);
      if (!sessao) { setNomeUsuario(''); setPapelUsuario(''); setSouSuperAdmin(false); setPodeIncluirAtestado(false); }
      else carregarSessao();
    });

    return () => {
      ativo = false;
      escuta?.subscription?.unsubscribe();
    };
  }, []);

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

  return (
    <header className="cabecalho">
      <div className="cabecalho-interno">
        {/* Logo */}
        <Link href="/" className="logo" aria-label="Sistema Hoteleiro — Início">
          <span className="logo-simbolo" aria-hidden="true">⌂</span>
          Sistema Hoteleiro
        </Link>

        {/* Menu de navegação */}
        <nav
          id="menu-principal"
          className={menuAberto ? 'navegacao aberta' : 'navegacao'}
          aria-label="Menu principal"
        >
          {papelUsuario !== 'CONTADOR' && (
            <Link href="/" className={caminhoAtual === '/' ? 'ativa' : ''}>
              Início
            </Link>
          )}

          {papelUsuario === 'CONTADOR' ? (
            // Visão restrita do Contador: só os destinos que ele pode acessar
            <>
              <Link href="/contabilidade" className={caminhoAtual === '/contabilidade' ? 'ativa' : ''}>
                Contabilidade
              </Link>
              <Link href="/atestados" className={caminhoAtual === '/atestados' ? 'ativa' : ''}>
                Atestados
              </Link>
            </>
          ) : (
            <>
              {CATEGORIAS_MENU.map((categoria) => {
                const linksVisiveis = categoria.links.filter((link) => linkVisivelPara(link, papelUsuario));
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
        </div>
      </div>
    </header>
  );
}
