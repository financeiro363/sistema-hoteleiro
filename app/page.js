'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import { bloquearSeNaoPermitido } from '../lib/restricaoAcesso';

// ============================================================================
// PÁGINA INICIAL
// Apresenta o sistema e dá acesso rápido aos módulos já disponíveis.
// ============================================================================

export default function PaginaInicial() {
  const router = useRouter();
  const [verificando, setVerificando] = useState(true);

  // Se quem está logado é Contador, manda direto para a Contabilidade —
  // ele não usa mais nada do resto do sistema.
  useEffect(() => {
    let ativo = true;
    async function verificar() {
      const { data: sessao } = await supabase.auth.getSession();
      if (!sessao?.session) { if (ativo) setVerificando(false); return; }
      const { data: perfil } = await supabase
        .from('usuarios').select('papel').eq('auth_id', sessao.session.user.id).single();
      if (!ativo) return;
      if (perfil?.papel === 'CONTADOR') { router.push('/contabilidade'); return; }
      if (bloquearSeNaoPermitido(perfil?.papel, router)) return;
      setVerificando(false);
    }
    verificar();
    return () => { ativo = false; };
  }, [router]);

  if (verificando) {
    return <main className="conteudo"><p className="texto-suave">Carregando…</p></main>;
  }

  return (
    <main className="conteudo">
      {/* Hero: apresentação principal */}
      <section className="hero">
        <span className="olho">Gestão hoteleira</span>
        <h1>A recepção, os bastidores e as contas do seu hotel — num só lugar.</h1>
        <p className="hero-sub">
          Um sistema simples, feito para o dia a dia da equipe: cada hotel enxerga
          apenas os próprios dados, com segurança garantida no banco de dados.
        </p>
        <div className="hero-botoes">
          <Link href="/login" className="botao botao-principal">
            Entrar no sistema
          </Link>
        </div>
      </section>

      {/* Imagem institucional, no lugar do antigo bloco de módulos */}
      <section id="modulos" aria-label="Chokmah System">
        <img
          src="/images/home-hero.jpg"
          alt="Chokmah System — sabedoria aplicada à gestão hoteleira"
          className="home-imagem-destaque"
        />
      </section>

      {/* Sistema completo */}
      <section aria-labelledby="titulo-completo" style={{ marginTop: 36 }}>
        <div className="cartao" style={{ textAlign: 'center', padding: '28px 20px' }}>
          <h2 id="titulo-completo" style={{ marginTop: 0 }}>🎉 Sistema completo</h2>
          <p className="texto-suave" style={{ maxWidth: 560, margin: '0 auto' }}>
            Todos os módulos planejados já estão em produção. Encontrou algo que precisa de ajuste?
            Fale com quem cuida do sistema.
          </p>
        </div>
      </section>
    </main>
  );
}
