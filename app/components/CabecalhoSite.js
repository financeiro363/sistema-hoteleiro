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

const LINKS_DO_MENU = [
  { href: '/', rotulo: 'Início' },
  { href: '/agenda', rotulo: 'Agenda Telefônica' },
  { href: '/solicitacoes', rotulo: 'Solicitações' },
  { href: '/lista-espera', rotulo: 'Lista de Espera' },
  { href: '/creditos', rotulo: 'Créditos e Devoluções' },
  { href: '/achados-perdidos', rotulo: 'Achados e Perdidos' },
  { href: '/depositos', rotulo: 'Depósitos Bancários' },
  { href: '/recibos', rotulo: 'Recibos' },
  { href: '/sala-reuniao', rotulo: 'Sala de Reunião' },
];

export default function CabecalhoSite() {
  const caminhoAtual = usePathname();
  const router = useRouter();

  const [menuAberto, setMenuAberto] = useState(false);
  const [logado, setLogado] = useState(false);
  const [nomeUsuario, setNomeUsuario] = useState('');

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
          .select('nome')
          .eq('auth_id', data.session.user.id)
          .single();
        if (ativo && perfil?.nome) setNomeUsuario(perfil.nome.split(' ')[0]);
      }
    }
    carregarSessao();

    const { data: escuta } = supabase.auth.onAuthStateChange((_evento, sessao) => {
      setLogado(!!sessao);
      if (!sessao) setNomeUsuario('');
      else carregarSessao();
    });

    return () => {
      ativo = false;
      escuta?.subscription?.unsubscribe();
    };
  }, []);

  // Fecha o menu hambúrguer sempre que muda de página
  useEffect(() => {
    setMenuAberto(false);
  }, [caminhoAtual]);

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
          {LINKS_DO_MENU.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={caminhoAtual === link.href ? 'ativa' : ''}
            >
              {link.rotulo}
            </Link>
          ))}
        </nav>

        {/* Ações do lado direito */}
        <div className="cabecalho-acoes">
          {logado ? (
            <>
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
