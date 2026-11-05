// ============================================================================
// LINK DA FICHA DE HÓSPEDE POR RESERVA:  /f/<hotel>-<assinatura>
// ============================================================================
// Vai nas mensagens automáticas (confirmação da reserva e véspera). Abre a
// ficha do hotel com o código da reserva, para o sistema saber quem já
// preencheu (lib/atendimento/fichaLink.js). Não precisa de login e não mostra
// nenhum dado da reserva.
// ============================================================================

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const m = /^(\d{1,9})-([A-Za-z0-9_-]{10})$/.exec(String(params?.codigo || ''));
  const destino = new URL('/ficha-hospede', request.url);
  if (m) {
    destino.searchParams.set('hotel_id', m[1]);
    destino.searchParams.set('r', m[0]);
  }
  return Response.redirect(destino.toString(), 302);
}
