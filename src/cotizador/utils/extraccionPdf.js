// Extracción de cotizaciones de proveedores desde PDF SIN inteligencia artificial.
//
// Funciona en dos pasos:
//   1) leerLineasPDF: usa pdf.js para sacar el texto del PDF con su posición
//      (x, y) y lo reconstruye en líneas y celdas, como se ve en pantalla.
//   2) analizarLineas: detecta moneda, proveedor y la tabla de renglones
//      (descripción, cantidad, precio unitario) usando los encabezados de la
//      tabla y la posición de las columnas.
//
// Este módulo es puro (no toca el DOM ni React) para poder probarlo en Node.
// Solo funciona con PDFs que tengan texto seleccionable. Un PDF escaneado
// (imagen) no tiene texto que leer: en ese caso devuelve sinTexto = true.

// ---------------------------------------------------------------------------
// Utilidades de texto y números
// ---------------------------------------------------------------------------

const sinAcentos = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const norm = (s) => sinAcentos(String(s || "")).toLowerCase().replace(/\s+/g, " ").trim();

const SIMBOLOS_MONEDA = /(?:RD\s?\$|US\s?\$|U\$S|\$|€|¥|£|\bUSD\b|\bDOP\b|\bEUR\b|\bMXN\b|\bRD\b)/gi;
const RE_SOLO_SIMBOLO = /^(?:RD\s?\$|US\s?\$|U\$S|\$|€|¥|£|USD|DOP|EUR|MXN|RD)$/i;

// Convierte un texto numérico a número. Acepta "1,234.56", "1.234,56",
// "1234,56", "RD$ 1,250.00", "(150.00)". Devuelve null si no es un número.
//
// Regla para un solo separador de miles/decimales ambiguo:
//   "1,234"   -> 1234   (coma + 3 dígitos = miles; es el formato de RD y EE. UU.)
//   "12,5"    -> 12.5   (coma + 1-2 dígitos = decimal)
//   "1.234"   -> 1.234  (punto + 3 dígitos = decimal; los documentos locales usan punto decimal)
//   "1.234.567" -> 1234567 (varios grupos de punto = miles)
export function parseNumero(texto) {
  if (texto === null || texto === undefined) return null;
  let t = String(texto).replace(SIMBOLOS_MONEDA, "").replace(/\s/g, "");
  if (!t) return null;
  let negativo = false;
  if (/^\(.*\)$/.test(t)) {
    negativo = true;
    t = t.slice(1, -1);
  }
  if (t.startsWith("-")) {
    negativo = true;
    t = t.slice(1);
  }
  if (!/^\d[\d.,]*$/.test(t)) return null;
  if (/[.,]$/.test(t)) return null;

  const ultimaComa = t.lastIndexOf(",");
  const ultimoPunto = t.lastIndexOf(".");
  let limpio;
  if (ultimaComa !== -1 && ultimoPunto !== -1) {
    // El separador que aparece más a la derecha es el decimal.
    if (ultimaComa > ultimoPunto) limpio = t.replace(/\./g, "").replace(",", ".");
    else limpio = t.replace(/,/g, "");
  } else if (ultimaComa !== -1) {
    const grupos = t.split(",");
    const ultimo = grupos[grupos.length - 1];
    if (grupos.length > 2 || ultimo.length === 3) limpio = t.replace(/,/g, "");
    else limpio = t.replace(",", ".");
  } else if (ultimoPunto !== -1) {
    const grupos = t.split(".");
    if (grupos.length > 2) limpio = t.replace(/\./g, "");
    else limpio = t;
  } else {
    limpio = t;
  }
  const n = Number(limpio);
  if (!Number.isFinite(n)) return null;
  return negativo ? -n : n;
}

// pdf.js a veces entrega columnas pegadas como un solo texto
// ("1,602.00 RD$ 48,500.00"). Si una celda contiene solo cifras (con o sin
// símbolo de moneda) y claramente son varias, se separa en una celda por cifra.
// La posición de cada parte se estima por su lugar dentro del texto.
function separarCifras(celda) {
  const tokens = celda.texto.split(" ");
  if (tokens.length < 2) return [celda];

  const grupos = []; // { texto, ini, fin, conSimbolo }
  let pos = 0;
  let simboloPendiente = null;
  for (const tk of tokens) {
    const ini = pos;
    pos += tk.length + 1;
    if (RE_SOLO_SIMBOLO.test(tk)) {
      simboloPendiente = { ini, tk };
      continue;
    }
    if (parseNumero(tk) === null) return [celda]; // hay texto: no es solo cifras
    if (simboloPendiente) {
      grupos.push({ texto: `${simboloPendiente.tk} ${tk}`, ini: simboloPendiente.ini, fin: ini + tk.length, conSimbolo: true });
      simboloPendiente = null;
    } else {
      grupos.push({ texto: tk, ini, fin: ini + tk.length, conSimbolo: false });
    }
  }
  if (simboloPendiente || grupos.length < 2) return [celda];

  const conDecimales = grupos.every((g) => /[.,]\d{1,2}$/.test(g.texto));
  const hayPrefijoEnAlguna = grupos.some((g) => g.conSimbolo);
  if (!conDecimales && !hayPrefijoEnAlguna) return [celda];

  const largo = celda.texto.length;
  const ancho = celda.right - celda.x;
  return grupos.map((g) => ({
    texto: g.texto,
    x: celda.x + (ancho * g.ini) / largo,
    right: celda.x + (ancho * g.fin) / largo,
    ultimaPieza: g.texto,
  }));
}

// ---------------------------------------------------------------------------
// Paso 1: PDF -> líneas con celdas
// ---------------------------------------------------------------------------

// pdfjsLib es el módulo pdfjs-dist ya cargado (lo inyecta quien llama, así este
// archivo funciona igual en el navegador que en Node).
export async function leerLineasPDF(pdfjsLib, datos) {
  const doc = await pdfjsLib.getDocument({ data: datos, useSystemFonts: true }).promise;
  const lineas = [];

  for (let numPag = 1; numPag <= doc.numPages; numPag++) {
    const pagina = await doc.getPage(numPag);
    const contenido = await pagina.getTextContent();

    const piezas = contenido.items
      .filter((it) => typeof it.str === "string" && it.str.trim() !== "")
      .map((it) => ({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
        w: it.width || 0,
        h: Math.abs(it.height || it.transform[3] || 10),
      }));

    // Agrupar por línea (misma altura, con tolerancia).
    piezas.sort((a, b) => b.y - a.y || a.x - b.x);
    const grupos = [];
    for (const p of piezas) {
      const g = grupos.find((gr) => Math.abs(gr.y - p.y) <= Math.max(2.5, p.h * 0.4));
      if (g) g.piezas.push(p);
      else grupos.push({ y: p.y, piezas: [p] });
    }
    grupos.sort((a, b) => b.y - a.y);

    for (const g of grupos) {
      g.piezas.sort((a, b) => a.x - b.x);
      // Unir piezas cercanas en "celdas"; una separación grande = otra columna.
      const celdas = [];
      for (let idx = 0; idx < g.piezas.length; idx++) {
        const p = g.piezas[idx];
        const sig = g.piezas[idx + 1];
        const ult = celdas[celdas.length - 1];
        const hueco = ult ? p.x - ult.right : Infinity;
        const umbral = Math.max(6, p.h * 1.1);
        // Dos números seguidos son casi siempre columnas distintas aunque estén
        // muy pegadas (p. ej. ITBIS y Total): no se funden en una sola celda.
        const dosNumeros = ult && parseNumero(ult.ultimaPieza) !== null && parseNumero(p.str) !== null;
        // Un símbolo de moneda ("RD$") seguido de una cifra es el prefijo de esa
        // cifra, no el sufijo del número anterior.
        const prefijoDeSiguiente =
          ult &&
          parseNumero(ult.ultimaPieza) !== null &&
          RE_SOLO_SIMBOLO.test(p.str.trim()) &&
          sig &&
          parseNumero(sig.str) !== null &&
          sig.x - (p.x + p.w) < umbral;
        // Una marca de una sola letra en la columna de ITBIS ("E" exento,
        // "G" gravado) seguida del total no forma parte de esa cifra.
        const marcaAntesDeCifra =
          ult && /^[A-Za-z*]$/.test(ult.texto.trim()) && parseNumero(p.str) !== null;
        if (ult && hueco < umbral && !dosNumeros && !prefijoDeSiguiente && !marcaAntesDeCifra) {
          ult.texto += (hueco > p.h * 0.15 ? " " : "") + p.str;
          ult.right = Math.max(ult.right, p.x + p.w);
          ult.ultimaPieza = p.str;
        } else {
          celdas.push({ texto: p.str, x: p.x, right: p.x + p.w, ultimaPieza: p.str });
        }
      }
      const celdasFinal = [];
      for (const c of celdas) {
        c.texto = c.texto.replace(/\s+/g, " ").trim();
        for (const sub of separarCifras(c)) {
          sub.cx = (sub.x + sub.right) / 2;
          celdasFinal.push(sub);
        }
      }
      lineas.push({
        pagina: numPag,
        y: g.y,
        celdas: celdasFinal,
        texto: celdasFinal.map((c) => c.texto).join("  "),
      });
    }
  }
  return lineas;
}

// ---------------------------------------------------------------------------
// Paso 2: líneas -> datos de la cotización
// ---------------------------------------------------------------------------

const TIPOS_COLUMNA = [
  // El orden importa: se toma el primer tipo que coincide.
  { tipo: "precio", re: /(precio|p\.?\s?unit|unitario|price|valor unit|costo unit|p\/u|\bp\.u\b|rate)/ },
  { tipo: "cantidad", re: /^(cant|qty|quantity|cantidad|ctd|uds?\b|und?s?\b|unid(ad|ades)?\b)/ },
  { tipo: "total", re: /^(total|importe|monto|amount|valor\b|subtotal|sub-total|line total)/ },
  // Presentación y concentración (medicamentos) se suman a la descripción.
  { tipo: "desc", re: /^(descripcion|description|concepto|articulo|producto|detalle|item\b|servicio|material|mercancia|nombre|presentacion|concentracion|forma farm)/ },
];

function clasificarEncabezado(texto) {
  const t = norm(texto);
  for (const { tipo, re } of TIPOS_COLUMNA) if (re.test(t)) return tipo;
  return "otro";
}

// Una línea es el encabezado de la tabla si trae un precio y además cantidad o
// descripción.
function detectarEncabezado(linea) {
  if (linea.celdas.length < 3) return null;
  const columnas = linea.celdas.map((c) => ({ ...c, tipo: clasificarEncabezado(c.texto) }));
  const tipos = new Set(columnas.map((c) => c.tipo));
  if (!tipos.has("precio")) return null;
  if (!tipos.has("cantidad") && !tipos.has("desc")) return null;
  // Si hay dos columnas "precio" (p. ej. "Precio" y "Precio con ITBIS"), se queda con la primera.
  return columnas;
}

const RE_PIE = /^(sub\s?-?total|total\b|itbis|i\.t\.b\.i\.s|impuesto|iva\b|descuento|neto|gran total|monto total|total a pagar|balance|condiciones|observacion|nota[s]?\b|forma de pago|metodo de pago|firma|gracias|validez|vigencia|banco|cuenta|son:|subtotal)/;

// Líneas de paginación ("Página 2 de 35", "Van", "Vienen"…). No cierran la
// tabla: en documentos largos la tabla sigue en la página siguiente, a veces
// sin repetir el encabezado.
const RE_PAGINACION = /\b(p[aá]gina|page|p[aá]g\.?)\s*\d+\s*(de|of|\/)\s*\d+\b|^(p[aá]gina|page|p[aá]g\.?)\s*\d+$|^(van|vienen|pasan|vienen de|van a|transporte|a la vuelta|continua(cion)?|continued)\b/i;

function esPaginacion(linea) {
  return RE_PAGINACION.test(norm(linea.texto)) || RE_PAGINACION.test(linea.texto.trim());
}

// Datos de encabezado de página (empresa, RNC, teléfono, fecha, dirección) que
// se repiten arriba de cada página. Solo se filtran al retomar la tabla en una
// página nueva, antes del primer renglón válido.
const RE_RUIDO = /(rnc|ncf|tel[eé]fono|\btel\b|fecha|date|www\.|@|c\/|calle|av\.|avenida|p[aá]gina|no\.\s?\d)/i;

function esPie(linea) {
  const primera = linea.celdas[0] ? norm(linea.celdas[0].texto) : "";
  if (RE_PIE.test(primera)) return true;
  // Pie con la etiqueta en una celda y el monto a la derecha: "Subtotal   12,000.00"
  return linea.celdas.length <= 3 && RE_PIE.test(norm(linea.texto));
}

const RE_UNIDAD_CANT = /^(\d+(?:[.,]\d+)?)\s*(und|unds|uds|ud|unid|unidad|unidades|pza|pzas|pieza|piezas|pcs|pc|caja|cajas|kg|lb|gl|gal|lt|lts|m2|m3|ml|mt|mts|m)\.?$/i;

function valorNumericoCelda(celda, esCantidad) {
  const t = celda.texto.trim();
  if (/%$/.test(t)) return null;
  if (esCantidad) {
    const m = t.match(RE_UNIDAD_CANT);
    if (m) return parseNumero(m[1]);
  }
  return parseNumero(t);
}

function columnaMasCercana(celda, columnas) {
  let mejor = null;
  let mejorDist = Infinity;
  for (const col of columnas) {
    const d = Math.min(Math.abs(celda.cx - col.cx), Math.abs(celda.right - col.right), Math.abs(celda.x - col.x));
    if (d < mejorDist) {
      mejorDist = d;
      mejor = col;
    }
  }
  return mejor;
}

function cuadra(q, p, t) {
  if (!(q > 0) || !(p > 0) || !(t > 0)) return false;
  return Math.abs(q * p - t) <= Math.max(0.02, t * 0.01);
}

// Interpreta un renglón usando las columnas del encabezado.
function leerRenglon(linea, columnas) {
  const partesDesc = [];
  const valores = { cantidad: null, precio: null, total: null };
  const numerosSueltos = [];
  // Si la tabla tiene una columna de descripción identificada, el texto de las
  // demás columnas (código, unidad, etc.) no se mezcla con la descripción.
  const hayColumnaDesc = columnas.some((c) => c.tipo === "desc");

  for (const celda of linea.celdas) {
    const col = columnaMasCercana(celda, columnas);
    const tipoCol = col ? col.tipo : "otro";
    const valor = valorNumericoCelda(celda, tipoCol === "cantidad");

    if (valor !== null && tipoCol !== "desc") {
      numerosSueltos.push(valor);
      if (tipoCol === "cantidad" && valores.cantidad === null) valores.cantidad = valor;
      else if (tipoCol === "precio" && valores.precio === null) valores.precio = valor;
      else if (tipoCol === "total" && valores.total === null) valores.total = valor;
      continue;
    }
    if (tipoCol === "desc") {
      partesDesc.push(celda.texto);
    } else if (valor === null && !hayColumnaDesc) {
      // Sin columna de descripción identificada: se usa todo el texto de la izquierda.
      const primeraNumerica = columnas.find((c) => c.tipo === "cantidad" || c.tipo === "precio");
      if (!primeraNumerica || celda.cx < primeraNumerica.x) partesDesc.push(celda.texto);
    }
  }

  return { descripcion: partesDesc.join(" ").replace(/\s+/g, " ").trim(), ...valores, numerosSueltos };
}

function detectarMoneda(texto) {
  const cuentas = {
    DOP: (texto.match(/RD\s?\$|\bDOP\b|pesos? dominicanos?|\bRD\b/gi) || []).length,
    USD: (texto.match(/US\s?\$|\bUSD\b|U\$S|d[oó]lares?/gi) || []).length,
    EUR: (texto.match(/€|\bEUR\b|\beuros?\b/gi) || []).length,
    MXN: (texto.match(/\bMXN\b|pesos? mexicanos?/gi) || []).length,
    CNY: (texto.match(/\bRMB\b|\bCNY\b|¥|yuan/gi) || []).length,
  };
  const ordenadas = Object.entries(cuentas).sort((a, b) => b[1] - a[1]);
  if (ordenadas[0][1] > 0) {
    return { moneda: ordenadas[0][0], seguro: true };
  }
  const soloDolar = (texto.match(/\$/g) || []).length;
  return { moneda: "DOP", seguro: false, vioDolar: soloDolar > 0 };
}

const RE_EMPRESA = /\b(s\.?\s?r\.?\s?l\.?|s\.?\s?a\.?\s?s?\.?|e\.?\s?i\.?\s?r\.?\s?l\.?|c\.?\s?por\s?a\.?|ltd\.?|ltda|inc\.?|corp\.?|llc|gmbh|co\.|company|sociedad)\b/i;
const RE_DOCUMENTO = /^(factura|cotizacion|cotización|proforma|pro-forma|invoice|quotation|quote|presupuesto|orden|pedido|nota|comprobante|recibo|pagina|page|fecha|date|no\.|numero|n°|ncf|rnc|tel|telefono|cliente|customer|bill|ship|para:|vendedor)/i;

function detectarProveedor(lineas) {
  const arriba = lineas.filter((l) => l.pagina === 1).slice(0, 18);

  // 1) Etiqueta explícita: "Proveedor: ACME SRL", "Razón social: ..."
  for (const l of arriba.concat(lineas.slice(0, 60))) {
    const m = l.texto.match(/(?:proveedor|raz[oó]n social|empresa|supplier|vendor|from)\s*[:\-]\s*(.{3,80})/i);
    if (m) return limpiarNombre(m[1]);
  }
  // 2) Primera línea de arriba con aspecto de nombre de empresa (S.R.L., S.A., Inc…).
  for (const l of arriba) {
    const primera = l.celdas[0] ? l.celdas[0].texto : "";
    if (RE_EMPRESA.test(primera) && !RE_DOCUMENTO.test(norm(primera))) return limpiarNombre(primera);
  }
  for (const l of arriba) {
    if (RE_EMPRESA.test(l.texto) && !RE_DOCUMENTO.test(norm(l.texto))) {
      const c = l.celdas.find((x) => RE_EMPRESA.test(x.texto));
      return limpiarNombre(c ? c.texto : l.texto);
    }
  }
  // 3) Primera línea que no sea una palabra de documento y tenga letras.
  for (const l of arriba) {
    const primera = l.celdas[0] ? l.celdas[0].texto : "";
    if (/[A-Za-zÁÉÍÓÚÑáéíóúñ]{4,}/.test(primera) && !RE_DOCUMENTO.test(norm(primera))) return limpiarNombre(primera);
  }
  return "";
}

function limpiarNombre(s) {
  return s
    .replace(/\s*(rnc|r\.n\.c|nit|tel|tel[eé]fono|ruc|cif)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function detectarTipoProveedor(texto) {
  const t = norm(texto);
  if (/\bmayorista/.test(t)) return "Mayorista";
  if (/\bdistribuidor|\bdistribuciones|\bdistributor/.test(t)) return "Distribuidor";
  if (/\bbroker|\bagente\b|\bagencia/.test(t)) return "Agente / Broker";
  if (/\bfabrica|\bfabricante|\bmanufactur|\bindustrias?\b/.test(t)) return "Fabricante";
  return "Fabricante";
}

function numeroDeLinea(linea) {
  const nums = linea.celdas.map((c) => parseNumero(c.texto)).filter((n) => n !== null);
  return nums.length ? nums[nums.length - 1] : null;
}

export function analizarLineas(lineas) {
  const avisos = [];
  const textoTotal = lineas.map((l) => l.texto).join("\n");

  if (!textoTotal.trim()) {
    return { sinTexto: true, items: [], avisos: [], proveedor_nombre: "", proveedor_tipo: "Fabricante", moneda: "DOP" };
  }

  const { moneda, seguro, vioDolar } = detectarMoneda(textoTotal);
  if (!seguro) {
    avisos.push(
      vioDolar
        ? 'El documento solo usa el símbolo "$" sin aclarar la moneda: se asumió RD$ (DOP). Cámbiala si es dólar.'
        : "No se encontró la moneda en el documento: se asumió RD$ (DOP). Verifícala."
    );
  }

  // --- Tabla de renglones con encabezados --------------------------------
  let columnas = null; // columnas del encabezado vigente
  let enTabla = false;
  let tablaEncontrada = false;
  const items = [];
  let desajustes = 0;
  let subtotalDoc = null;
  let paginaActual = null;
  // "tentativo": la tabla se retomó en una página nueva sin encabezado. Hasta el
  // primer renglón válido se descartan los datos de encabezado de página y solo
  // se aceptan renglones que cuadran, para no confundir texto con productos.
  let tentativo = false;

  for (const linea of lineas) {
    if (linea.pagina !== paginaActual) {
      paginaActual = linea.pagina;
      if (columnas) {
        enTabla = true;
        tentativo = true;
      }
    }

    // Subtotal / total del documento (para cuadrar al final). Se queda con el
    // último: en documentos de varias páginas el subtotal final va al cierre.
    const etiqueta = linea.celdas[0] ? norm(linea.celdas[0].texto) : "";
    if (/^sub\s?-?total/.test(etiqueta) || /^sub\s?-?total/.test(norm(linea.texto))) {
      const n = numeroDeLinea(linea);
      if (n !== null) subtotalDoc = n;
    }

    const encabezado = detectarEncabezado(linea);
    if (encabezado) {
      columnas = encabezado;
      enTabla = true;
      tentativo = false;
      tablaEncontrada = true;
      continue;
    }
    if (!enTabla || !columnas) continue;
    if (esPaginacion(linea)) continue;

    if (esPie(linea)) {
      enTabla = false;
      continue;
    }
    if (tentativo && RE_RUIDO.test(linea.texto)) continue;

    const r = leerRenglon(linea, columnas);

    // Línea de continuación de la descripción (sin números).
    if (r.numerosSueltos.length === 0 && r.descripcion && items.length && !tentativo) {
      const ult = items[items.length - 1];
      if (ult.pagina === linea.pagina && ult.y - linea.y < 40) {
        ult.descripcion = `${ult.descripcion} ${r.descripcion}`.replace(/\s+/g, " ").trim();
      }
      continue;
    }

    let { cantidad, precio, total } = r;

    // Si faltan datos, se deducen: total = cantidad × precio.
    if (precio === null && cantidad > 0 && total > 0) precio = total / cantidad;
    if (cantidad === null && precio > 0 && total > 0) {
      const q = total / precio;
      if (Math.abs(q - Math.round(q)) < 0.01) cantidad = Math.round(q);
    }
    if (cantidad === null && precio > 0) cantidad = 1;

    if (!r.descripcion || !(precio > 0) || !(cantidad > 0)) continue;
    if (tentativo) {
      const confiable =
        total !== null ? cuadra(cantidad, precio, total) : r.cantidad !== null && r.precio !== null;
      if (!confiable) continue;
      tentativo = false;
    }
    if (total !== null && !cuadra(cantidad, precio, total)) {
      // Puede que las columnas estén corridas: se prueba con los números del renglón.
      let corregido = false;
      const n = r.numerosSueltos;
      for (let i = 0; i < n.length && !corregido; i++)
        for (let j = 0; j < n.length && !corregido; j++)
          for (let k = 0; k < n.length && !corregido; k++) {
            if (i !== j && j !== k && i !== k && cuadra(n[i], n[j], n[k])) {
              cantidad = n[i];
              precio = n[j];
              total = n[k];
              corregido = true;
            }
          }
      if (!corregido) desajustes++;
    }

    items.push({
      descripcion: r.descripcion,
      cantidad,
      precioUnitario: Math.round(precio * 10000) / 10000,
      total,
      pagina: linea.pagina,
      y: linea.y,
    });
  }

  // --- Respaldo: sin encabezado, se detectan renglones por su formato ------
  let modoRespaldo = false;
  if (items.length === 0) {
    for (const linea of lineas) {
      if (esPie(linea) || esPaginacion(linea) || RE_RUIDO.test(linea.texto)) continue;
      const celdas = linea.celdas;
      let i = celdas.length;
      const nums = [];
      while (i > 0) {
        const v = valorNumericoCelda(celdas[i - 1], false);
        if (v === null) break;
        nums.unshift(v);
        i--;
      }
      const descripcion = celdas
        .slice(0, i)
        .map((c) => c.texto)
        .join(" ")
        .trim();
      if (nums.length < 3 || !/[A-Za-zÁÉÍÓÚÑáéíóúñ]{3,}/.test(descripcion)) continue;
      const ult3 = nums.slice(-3);
      if (cuadra(ult3[0], ult3[1], ult3[2])) {
        items.push({ descripcion, cantidad: ult3[0], precioUnitario: ult3[1], total: ult3[2], pagina: linea.pagina, y: linea.y });
      }
    }
    if (items.length) {
      modoRespaldo = true;
      avisos.push("No se encontró una tabla con encabezados; los renglones se detectaron por su formato. Revísalos con cuidado.");
    }
  }

  if (!items.length) {
    avisos.push(
      tablaEncontrada
        ? "Se encontró la tabla pero no se pudieron leer los renglones."
        : "No se encontró una tabla de productos con cantidad y precio."
    );
  } else {
    if (desajustes > 0) {
      avisos.push(`${desajustes} renglón(es) no cuadran (cantidad × precio ≠ total del renglón). Revísalos.`);
    }
    // Comparar con el subtotal impreso en el documento.
    const sumaRenglones = items.reduce((s, it) => s + (it.total > 0 ? it.total : it.cantidad * it.precioUnitario), 0);
    if (subtotalDoc !== null && subtotalDoc > 0) {
      const dif = Math.abs(sumaRenglones - subtotalDoc);
      if (dif <= Math.max(0.05, subtotalDoc * 0.005)) {
        avisos.push(`✓ La suma de los renglones coincide con el subtotal del documento (${subtotalDoc.toLocaleString("en-US", { minimumFractionDigits: 2 })}).`);
      } else {
        avisos.push(
          `La suma de los renglones (${sumaRenglones.toLocaleString("en-US", { minimumFractionDigits: 2 })}) no coincide con el subtotal del documento (${subtotalDoc.toLocaleString("en-US", { minimumFractionDigits: 2 })}). Puede faltar o sobrar algún renglón, o el documento incluye descuentos.`
        );
      }
    }
  }

  const proveedor_nombre = detectarProveedor(lineas);
  if (!proveedor_nombre) avisos.push("No se pudo identificar el nombre del proveedor: escríbelo manualmente.");

  return {
    sinTexto: false,
    proveedor_nombre,
    proveedor_tipo: detectarTipoProveedor(textoTotal.slice(0, 1500)),
    moneda,
    monedaSegura: seguro,
    modoRespaldo,
    items: items.map(({ descripcion, cantidad, precioUnitario, total }) => ({ descripcion, cantidad, precioUnitario, total })),
    avisos,
  };
}

// Función de conveniencia: PDF (ArrayBuffer/Uint8Array) -> datos de cotización.
export async function extraerCotizacionDePDF(pdfjsLib, datos) {
  const lineas = await leerLineasPDF(pdfjsLib, datos);
  return analizarLineas(lineas);
}
