// ============================================================================
// ROTA DE SERVIDOR: /api/meu-ip
// ============================================================================
// Devolve o IP de quem está chamando, lido dos cabeçalhos do servidor (mais
// confiável do que tentar descobrir isso pelo navegador). Usada só pelo
// log de auditoria do módulo de Atestados, para registrar de onde cada
// ação sensível foi feita.
// ============================================================================

export async function GET(request) {
  const ip =
    request.headers.get('x-nf-client-connection-ip') ||
    (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    'desconhecido';
  return Response.json({ ip: ip || 'desconhecido' });
}
