// Carga pdf.js solo cuando el usuario sube un PDF (import dinámico), para no
// aumentar el peso de la pantalla de login ni del resto de la app.
let promesa = null;

export function cargarPdfJs() {
  if (!promesa) {
    promesa = (async () => {
      const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    })().catch((e) => {
      promesa = null; // permite reintentar si falló la carga
      throw e;
    });
  }
  return promesa;
}
