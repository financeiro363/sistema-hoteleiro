// ============================================================================
// ESTOQUE — alertas de mínimo (usado no Estoque e no Painel da Governança)
// ============================================================================
// Um produto entra no alerta quando:
//   - o total está no mínimo padrão ou abaixo (só se o mínimo for maior que 0), ou
//   - num depósito ativo, o saldo está no mínimo daquele depósito ou abaixo.
// Enxoval (lençol, toalha, fronha...) vem primeiro; depois os zerados.
// ============================================================================

export function alertasDeEstoque(produtos, saldos = [], depositos = []) {
  const ativos = new Map((depositos || []).filter((d) => d.ativo !== false).map((d) => [d.id, d.nome]));
  const lista = [];
  for (const p of produtos || []) {
    const enxoval = !!p.enxoval;
    const minimo = Number(p.qtd_minima || 0);
    const total = Number(p.quantidade || 0);
    if (minimo > 0 && total <= minimo) {
      lista.push({ chave: `${p.id}-total`, produto: p, onde: null, quantidade: total, minimo, zerado: total <= 0, enxoval });
    }
    for (const s of saldos || []) {
      if (s.produto_id !== p.id || !ativos.has(s.deposito_id)) continue;
      const m = Number(s.estoque_minimo || 0);
      if (s.estoque_minimo === null || s.estoque_minimo === undefined || m <= 0) continue;
      const q = Number(s.quantidade || 0);
      if (q <= m) lista.push({ chave: `${p.id}-${s.deposito_id}`, produto: p, onde: ativos.get(s.deposito_id), quantidade: q, minimo: m, zerado: q <= 0, enxoval });
    }
  }
  return lista.sort((a, b) => (Number(b.enxoval) - Number(a.enxoval)) || (Number(b.zerado) - Number(a.zerado))
    || String(a.produto.nome).localeCompare(String(b.produto.nome), 'pt-BR'));
}

function numero(n) {
  const v = Number(n || 0);
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',');
}

export function textoDoAlerta(a) {
  return `${a.produto.nome}${a.onde ? ` (${a.onde})` : ''}: ${numero(a.quantidade)} — mínimo ${numero(a.minimo)}`;
}
