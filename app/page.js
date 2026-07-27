export default function Home() {
  return (
    <main style={{ padding: 40, maxWidth: 640, margin: "0 auto" }}>
      <h1 style={{ color: "#0E7C66" }}>Sistema Hoteleiro</h1>
      <p style={{ color: "#374151", lineHeight: 1.6 }}>
        Esta é a primeira versão real do sistema, já conectada ao banco de dados de verdade.
      </p>
      <a
        href="/agenda"
        style={{
          display: "inline-block",
          marginTop: 16,
          padding: "12px 20px",
          background: "#0E7C66",
          color: "#fff",
          borderRadius: 8,
          textDecoration: "none",
          fontWeight: 600,
        }}
      >
        Abrir Agenda Telefônica →
      </a>
    </main>
  );
}
