'use client';

// ============================================================================
// PÁGINA DE TESTE DO CHAT DO SITE: /chat-site/teste?hotel=4
// ============================================================================
// Mostra a janela do chat como ela aparece no site do hotel, sem precisar
// mexer no site. O endereço do próprio sistema é sempre liberado para o chat.
// As mensagens enviadas aqui chegam de verdade na Caixa de Entrada.
// ============================================================================

import { useEffect, useState } from 'react';

export default function TesteChatSite() {
  const [hotel, setHotel] = useState('');

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('hotel') || '';
    setHotel(id.replace(/\D/g, ''));
  }, []);

  useEffect(() => {
    if (!hotel || document.getElementById('script-chat-site')) return;
    const s = document.createElement('script');
    s.id = 'script-chat-site';
    s.src = `/chat-site.js?v=${Date.now()}`;
    s.defer = true;
    s.setAttribute('data-hotel', hotel);
    document.body.appendChild(s);
  }, [hotel]);

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '32px 16px 140px' }}>
      <span className="olho">Caixa de Entrada · Chat do site</span>
      <h1 style={{ margin: '4px 0 12px' }}>Página de teste do chat</h1>
      {!hotel ? (
        <p className="texto-suave">Abra esta página pelo botão “Testar o chat” em Caixa de Entrada → Canais → Chat do site.</p>
      ) : (
        <>
          <p className="texto-suave">É assim que o chat aparece no site do hotel: o balão fica no canto de baixo, à direita. Escreva como se fosse um cliente.</p>
          <p className="texto-suave">As mensagens chegam de verdade na Caixa de Entrada (canal 🌐 Chat do site). Se o robô estiver ligado para o chat do site, ele responde.</p>
          <button type="button" className="botao botao-principal" onClick={() => window.ChatHotel?.abrir()}>Abrir o chat</button>
        </>
      )}
    </main>
  );
}
