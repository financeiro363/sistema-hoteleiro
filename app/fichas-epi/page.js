'use client';

// As Fichas de EPI agora são uma aba de Administração → Documentos dos
// Colaboradores. Este endereço antigo só leva para lá.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function FichasEpiEnderecoAntigo() {
  const router = useRouter();
  useEffect(() => { router.replace('/documentos-colaboradores?aba=epi'); }, [router]);
  return (
    <main className="conteudo">
      <p className="texto-suave">Abrindo Documentos dos Colaboradores…</p>
    </main>
  );
}
