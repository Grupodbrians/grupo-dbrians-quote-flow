// Función serverless (Vercel). Corre en el servidor, nunca en el navegador del
// usuario — por eso aquí SÍ es seguro usar la API key.
//
// Requiere una variable de entorno llamada ANTHROPIC_API_KEY con tu clave de
// https://console.anthropic.com. Configúrala en Vercel → Project → Settings →
// Environment Variables (ver README.md).

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Falta configurar ANTHROPIC_API_KEY en el servidor" });
    return;
  }

  try {
    const { contentBlock, prompt } = req.body || {};
    if (!contentBlock || !prompt) {
      res.status(400).json({ error: "Falta el documento o el prompt" });
      return;
    }

    const respuesta = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        messages: [{ role: "user", content: [contentBlock, { type: "text", text: prompt }] }],
      }),
    });

    if (!respuesta.ok) {
      const texto = await respuesta.text();
      console.error("Error de la API de Anthropic:", respuesta.status, texto);
      res.status(502).json({ error: "La IA no pudo procesar el documento" });
      return;
    }

    const data = await respuesta.json();
    const textPart = (data.content || []).map((b) => b.text || "").join("\n");
    const limpio = textPart.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(limpio);

    res.status(200).json(parsed);
  } catch (e) {
    console.error("Error en extraer-cotizacion:", e);
    res.status(500).json({ error: "No se pudo procesar el documento" });
  }
}
