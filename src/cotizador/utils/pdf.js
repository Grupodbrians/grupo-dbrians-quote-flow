// Lógica de generación del PDF del cliente.
// Movida de Cotizador.jsx (Fase 1 — Sub-paso 3).
//
// fileToBase64, cargarScript y cargarLibreriasPDF son puras (no dependen del
// estado de React) y se movieron tal cual. generarPDFCliente sí dependía del
// estado del componente (clienteDocRef, numeroCotizacion, y los setters de
// pdfError/pdfGenerado/generandoPDF), así que aquí queda como una función
// que recibe esos mismos valores como parámetros — mismo patrón usado en
// whatsapp.js (Sub-paso 2). El método de generación (html2canvas + jsPDF por
// CDN, recorte multipágina, entrega como data: URI) NO cambió: se moverá a
// PDF estructurado con texto real en una fase posterior, no en esta.

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
}

export function cargarScript(src, yaCargado) {
  return new Promise((resolve, reject) => {
    if (yaCargado()) { resolve(); return; }
    const existente = document.querySelector(`script[data-cot-src="${src}"]`);
    if (existente) {
      existente.addEventListener("load", () => resolve());
      existente.addEventListener("error", () => reject(new Error("No se pudo cargar " + src)));
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.dataset.cotSrc = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("No se pudo cargar " + src));
    document.body.appendChild(s);
  });
}

export function cargarLibreriasPDF() {
  return Promise.all([
    cargarScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js", () => !!window.html2canvas),
    cargarScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js", () => !!(window.jspdf && window.jspdf.jsPDF)),
  ]);
}

export async function generarPDFCliente({ nodo, numeroCotizacion, setPdfError, setPdfGenerado, setGenerandoPDF }) {
  setPdfError("");
  setPdfGenerado(false);
  setGenerandoPDF(true);
  try {
    await cargarLibreriasPDF();
    const { jsPDF } = window.jspdf;

    const canvas = await window.html2canvas(nodo, { scale: 3, useCORS: true, backgroundColor: "#ffffff" });
    const imgData = canvas.toDataURL("image/png");

    const pdf = new jsPDF({ unit: "pt", format: "letter", orientation: "portrait" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margen = 24;
    const imgWidth = pageWidth - margen * 2;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    const alturaUtil = pageHeight - margen * 2;

    let restante = imgHeight;
    let offset = 0;
    pdf.addImage(imgData, "PNG", margen, margen, imgWidth, imgHeight);
    restante -= alturaUtil;
    while (restante > 0) {
      offset -= alturaUtil;
      pdf.addPage();
      pdf.addImage(imgData, "PNG", margen, offset + margen, imgWidth, imgHeight);
      restante -= alturaUtil;
    }

    // Se entrega como data: URI (no blob:) para no chocar con el mismo CSP que bloqueó html2pdf.
    const dataUri = pdf.output("datauristring");
    const nombreArchivo = `Cotizacion-${numeroCotizacion}.pdf`;
    const enlace = document.createElement("a");
    enlace.href = dataUri;
    enlace.download = nombreArchivo;
    document.body.appendChild(enlace);
    enlace.click();
    document.body.removeChild(enlace);

    setPdfGenerado(true);
    setGenerandoPDF(false);
    return true;
  } catch (e) {
    console.error("Error generando PDF:", e);
    setPdfGenerado(false);
    setGenerandoPDF(false);
    setPdfError("El entorno de la aplicación está bloqueando la descarga automática del PDF. Usa \"Imprimir\" → Guardar como PDF como alternativa.");
    return false;
  }
}
