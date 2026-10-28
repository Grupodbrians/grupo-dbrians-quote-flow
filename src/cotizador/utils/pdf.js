// Lógica de generación del PDF del cliente.
// Movida de Cotizador.jsx (Fase 1 — Sub-paso 3).
//
// fileToBase64, cargarScript y cargarLibreriasPDF son puras (no dependen del
// estado de React) y se movieron tal cual. generarPDFCliente sí dependía del
// estado del componente (clienteDocRef, numeroCotizacion, y los setters de
// pdfError/pdfGenerado/generandoPDF), así que aquí queda como una función
// que recibe esos mismos valores como parámetros — mismo patrón usado en
// whatsapp.js (Sub-paso 2). El método de generación sigue siendo html2canvas +
// jsPDF por CDN con entrega como data: URI; para cotizaciones largas la
// captura se hace página por página (ver calcularCortesDePagina).

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

// Los navegadores no dibujan un canvas de más de ~32.000 px de alto (en iPhone
// el límite es mucho menor), así que una cotización larga (cientos de
// renglones) no cabe en una sola imagen. Se arma el PDF página por página:
// la primera lleva membrete, datos del cliente y los primeros renglones; las
// siguientes repiten el encabezado de la tabla; la última cierra con totales y
// condiciones. Ningún renglón queda partido entre dos páginas.
export function paginarDocumento(nodo, altoPagina) {
  const caja = nodo.getBoundingClientRect();
  const filas = Array.from(nodo.querySelectorAll("tbody tr")).map((tr) => tr.getBoundingClientRect());
  const tabla = nodo.querySelector("table");
  if (!filas.length || !tabla || caja.height <= altoPagina) return [{ primera: true, ultima: true, desde: 0, hasta: filas.length }];

  const estilo = getComputedStyle(nodo);
  const padArriba = parseFloat(estilo.paddingTop) || 0;
  const padAbajo = parseFloat(estilo.paddingBottom) || 0;
  const seccion = seccionDeTabla(nodo, tabla).getBoundingClientRect();
  const altoCabecera = filas[0].top - caja.top; // membrete + cliente + encabezado de tabla
  const altoCabeceraTabla = padArriba + (filas[0].top - seccion.top); // título "Detalle" + encabezado de tabla
  const altoCierre = caja.bottom - filas[filas.length - 1].bottom; // totales + condiciones
  const holgura = 24; // margen inferior de la sección y bordes

  const paginas = [];
  let desde = 0;
  let usado = altoCabecera;
  for (let i = 0; i < filas.length; i++) {
    const alto = filas[i].height;
    if (usado + alto + padAbajo + holgura > altoPagina && i > desde) {
      paginas.push({ primera: paginas.length === 0, ultima: false, desde, hasta: i });
      desde = i;
      usado = altoCabeceraTabla;
    }
    usado += alto;
  }
  if (usado + altoCierre + holgura <= altoPagina) {
    paginas.push({ primera: paginas.length === 0, ultima: true, desde, hasta: filas.length });
  } else {
    // Los totales no caben con los últimos renglones: van en una página aparte.
    paginas.push({ primera: paginas.length === 0, ultima: false, desde, hasta: filas.length });
    paginas.push({ primera: false, ultima: true, desde: filas.length, hasta: filas.length });
  }
  return paginas;
}

// Hijo directo del documento que contiene la tabla de renglones.
function seccionDeTabla(raiz, tabla) {
  let el = tabla;
  while (el.parentElement && el.parentElement !== raiz) el = el.parentElement;
  return el;
}

// Copia del documento con solo lo que va en una página.
function copiaDePagina(nodo, { primera, ultima, desde, hasta }) {
  const copia = nodo.cloneNode(true);
  copia.removeAttribute("id");
  copia.querySelectorAll("tbody tr").forEach((tr, i) => {
    if (i < desde || i >= hasta) tr.remove();
  });
  const tabla = copia.querySelector("table");
  if (tabla) {
    const seccion = seccionDeTabla(copia, tabla);
    if (!primera) while (seccion.previousElementSibling) seccion.previousElementSibling.remove();
    if (!ultima) while (seccion.nextElementSibling) seccion.nextElementSibling.remove();
    if (hasta <= desde) seccion.remove();
  }
  return copia;
}

export async function generarPDFCliente({ nodo, numeroCotizacion, setPdfError, setPdfGenerado, setGenerandoPDF }) {
  setPdfError("");
  setPdfGenerado(false);
  setGenerandoPDF(true);
  let contenedor = null;
  try {
    await cargarLibreriasPDF();
    const { jsPDF } = window.jspdf;

    const pdf = new jsPDF({ unit: "pt", format: "letter", orientation: "portrait", compress: true });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margen = 24;
    const imgWidth = pageWidth - margen * 2;
    const alturaUtil = pageHeight - margen * 2;

    const anchoDoc = Math.ceil(nodo.getBoundingClientRect().width);
    const ptPorPx = imgWidth / anchoDoc;
    const paginas = paginarDocumento(nodo, alturaUtil / ptPorPx);
    // Una o dos páginas: PNG a escala 3 (máxima nitidez, como siempre).
    // Documentos largos: JPEG a escala 2, para que el archivo no pese decenas de MB.
    const largo = paginas.length > 2;

    // Cada página se dibuja desde una copia fuera de pantalla. Se mantiene dentro
    // de un contenedor con la clase de la app (colores y tipografía) y con una
    // copia de las hojas de estilo, para que se vea igual que en pantalla.
    const claseApp = nodo.closest(".cot-app") ? "cot-app" : "";
    contenedor = document.createElement("div");
    contenedor.className = claseApp;
    contenedor.style.cssText = `position:absolute;left:-100000px;top:0;width:${anchoDoc}px;padding:0;margin:0;border:0;min-height:0;background:#fff;`;
    document.querySelectorAll("style").forEach((st) => contenedor.appendChild(st.cloneNode(true)));
    document.body.appendChild(contenedor);
    // html2canvas copia todo el documento en cada captura; se le indica que solo
    // copie el contenedor, así una cotización de cientos de renglones no se
    // vuelve lenta.
    const soloContenedor = (el) =>
      !(contenedor.contains(el) || el.contains(contenedor) || el === document.head || document.head.contains(el));

    for (let i = 0; i < paginas.length; i++) {
      const copia = copiaDePagina(nodo, paginas[i]);
      copia.style.width = `${anchoDoc}px`;
      copia.style.maxWidth = "none";
      copia.style.margin = "0";
      contenedor.appendChild(copia);

      const canvas = await window.html2canvas(copia, {
        scale: largo ? 2 : 3,
        useCORS: true,
        backgroundColor: "#ffffff",
        ignoreElements: soloContenedor,
      });
      const imgData = largo ? canvas.toDataURL("image/jpeg", 0.8) : canvas.toDataURL("image/png");
      let ancho = imgWidth;
      let alto = (canvas.height * imgWidth) / canvas.width;
      if (alto > alturaUtil) {
        // Por seguridad: si la página quedó más alta de lo calculado, se ajusta sin cortarla.
        ancho = (ancho * alturaUtil) / alto;
        alto = alturaUtil;
      }
      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, largo ? "JPEG" : "PNG", margen, margen, ancho, alto);
      canvas.width = 0; // libera la memoria del canvas antes de la siguiente página
      canvas.height = 0;
      copia.remove();
    }
    contenedor.remove();
    contenedor = null;

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
    if (contenedor) contenedor.remove();
    console.error("Error generando PDF:", e);
    setPdfGenerado(false);
    setGenerandoPDF(false);
    setPdfError("El entorno de la aplicación está bloqueando la descarga automática del PDF. Usa \"Imprimir\" → Guardar como PDF como alternativa.");
    return false;
  }
}
