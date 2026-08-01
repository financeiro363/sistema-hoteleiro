'use client';

// ============================================================================
// ESQUECI MINHA SENHA
// A pessoa digita o e-mail; o Supabase manda um link por e-mail que leva
// para a tela de "Redefinir Senha". Por segurança, a mensagem de sucesso é
// sempre a mesma, exista ou não aquele e-mail no sistema (não dá pista de
// quais e-mails estão cadastrados).
// ============================================================================

import { useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';

export default function EsqueciSenha() {
  const [email, setEmail] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState('');

  async function enviar(evento) {
    evento.preventDefault();
    if (enviando) return;
    setErro('');

    if (!email.trim()) {
      setErro('Preencha o e-mail.');
      return;
    }

    setEnviando(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    });
    setEnviando(false);

    // Por segurança, não revelamos se o e-mail existe ou não — sempre
    // mostramos a mesma mensagem de sucesso, a não ser que seja um
    // problema de conexão de verdade.
    if (error && /network|fetch/i.test(error.message)) {
      setErro('Falha de conexão. Verifique sua internet e tente novamente.');
      return;
    }
    setEnviado(true);
  }

  return (
    <main className="conteudo">
      <div className="caixa-login">
        <div className="cartao">
          <span className="olho">Acesso restrito</span>
          <h1 style={{ fontSize: '1.5rem' }}>Esqueci minha senha</h1>

          {enviado ? (
            <>
              <div className="aviso-sucesso">
                Se esse e-mail estiver cadastrado no sistema, você vai receber uma mensagem com um
                link para criar uma nova senha em instantes. Confira também a caixa de spam/lixo
                eletrônico.
              </div>
              <Link href="/login" className="botao botao-suave" style={{ display: 'block', textAlign: 'center', marginTop: 16 }}>
                Voltar para o login
              </Link>
            </>
          ) : (
            <>
              <p className="texto-suave">
                Digite o e-mail que você usa para entrar no sistema. Vamos enviar um link para
                você criar uma senha nova.
              </p>

              <form onSubmit={enviar}>
                <label className="rotulo" htmlFor="campo-email">E-mail</label>
                <input
                  id="campo-email"
                  className="campo"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@seuhotel.com.br"
                />

                {erro && <div className="aviso-erro">{erro}</div>}

                <button type="submit" className="botao botao-principal" disabled={enviando} style={{ width: '100%', marginTop: 18 }}>
                  {enviando ? 'Enviando…' : 'Enviar link de recuperação'}
                </button>
              </form>

              <p className="texto-suave" style={{ fontSize: 13, marginTop: 16, marginBottom: 0 }}>
                <Link href="/login" style={{ color: 'var(--marca)', fontWeight: 600 }}>
                  ← Voltar para o login
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
