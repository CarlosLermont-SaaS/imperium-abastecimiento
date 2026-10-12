// =====================================================================
// IMPERIUM · Manual de uso paso a paso (pestaña "Manual" de la app)
// Cada paso: qué es, dónde se encuentra, qué tocar y un consejo.
// =====================================================================
import { h } from "./comun.js";
import { instalada, puedeInstalar, sistema, instalar, alCambiarInstalacion } from "./pwa.js";

const NICHOS = [
  ["Alimentos y bebidas", "lote y fecha de vencimiento obligatorios; la IA no pide más de lo que alcanza a venderse antes de vencer."],
  ["Moda y calzado", "talla y color obligatorios, colección y temporada; no repone colecciones que salen."],
  ["Farmacia y droguería", "lote, vencimiento y registro INVIMA obligatorios; marca si requiere cadena de frío."],
  ["Ferretería y construcción", "referencia del fabricante, medida y material."],
  ["Tecnología y electrónica", "marca, modelo, meses de garantía y si exige serial; cuida la obsolescencia."],
  ["Cosmética y belleza", "tono, vencimiento y registro sanitario."],
  ["Restaurantes y cocinas", "insumos de rotación diaria; compra para 7 días con entrega al día siguiente."],
  ["Hogar y decoración", "color, material, colección y dimensiones."],
  ["Mascotas", "especie, etapa, peso y vencimiento."],
  ["Autopartes y repuestos", "referencia OEM, marca, modelo y año del vehículo."],
  ["Comercio general", "plantilla libre para cualquier otro negocio."],
];

/** Pasos del manual. `ruta` lleva a la sección; `donde` dice cómo llegar a mano. */
export const PASOS = [
  {
    titulo: "Bienvenido a IMPERIUM",
    resumen: "Qué hace la plataforma y la regla que nunca se rompe.",
    bloques: [
      { p: "IMPERIUM vigila su inventario todo el día. Cuando un producto llega a su mínimo, la inteligencia artificial calcula cuánto conviene pedir y le avisa a la persona encargada por correo y WhatsApp." },
      { p: "La compra solo se hace si esa persona la firma. La IA sugiere; usted decide. Ni la IA, ni las automatizaciones, ni nadie fuera de su equipo puede crear una compra." },
      { lista: ["Su inventario baja con cada venta.", "Al tocar el mínimo se abre una alerta con 7 días de plazo.", "El encargado revisa y firma desde el celular.", "Al día 7 nace la orden de compra. Sin firma, no se compra nada."] },
      { consejo: "Siga este manual en orden la primera vez. En 15 minutos tendrá su negocio funcionando." },
    ],
  },
  {
    titulo: "Instale IMPERIUM en su celular",
    resumen: "Tenga IMPERIUM como una app más en su pantalla de inicio.",
    instalacion: true,
    bloques: [
      { p: "IMPERIUM no se descarga de Play Store ni de App Store. Se instala directo desde el navegador, ocupa muy poco espacio y se actualiza sola." },
      { subtitulo: "Celular Android (Samsung, Xiaomi, Motorola…)", lista: ["Abra IMPERIUM en Google Chrome.", "Toque los tres puntos (⋮) arriba a la derecha.", "Toque «Instalar app» o «Agregar a pantalla principal».", "Confirme con «Instalar». El ícono dorado aparece en su pantalla de inicio."] },
      { subtitulo: "iPhone", lista: ["Abra IMPERIUM en Safari.", "Toque el botón Compartir (el cuadro con la flecha hacia arriba).", "Baje y toque «Agregar a inicio».", "Toque «Agregar». El ícono queda junto a sus otras apps."] },
      { consejo: "Desde ahora abra IMPERIUM siempre desde ese ícono: se ve a pantalla completa y entra más rápido." },
    ],
  },
  {
    titulo: "Entre a su cuenta",
    resumen: "Sin contraseñas: entra con su correo.",
    bloques: [
      { lista: ["Escriba el correo con el que compró (o con el que lo invitaron).", "Toque «Enviarme el acceso».", "Abra el correo que le llega y toque «Iniciar sesión». Si el correo trae un código, puede escribirlo en la app.", "Si su celular pregunta con qué abrir el enlace, elija Chrome (o Safari en iPhone)."] },
      { p: "Su sesión queda guardada en ese celular. Solo tendrá que volver a entrar si cierra sesión o cambia de teléfono." },
      { consejo: "¿No llega el correo? Revise la carpeta de spam o promociones y espere un minuto antes de pedir otro." },
    ],
  },
  {
    titulo: "Conozca la pantalla",
    resumen: "Qué hay en cada pestaña de la barra inferior.",
    bloques: [
      { campos: [
        ["Panel", "Resumen del día: valor del inventario, productos bajos, compras por firmar y ventas recientes."],
        ["Inventario", "Todos sus productos con su stock. Aquí se crean productos y se registran ventas."],
        ["Alertas", "Las compras que la IA propone y esperan su firma. El número rojo indica cuántas hay."],
        ["Órdenes", "Las órdenes de compra ya creadas, para enviarlas al proveedor y recibir la mercancía."],
        ["Manual", "Esta guía, siempre a mano."],
        ["Más", "Su plan, nichos, proveedores, equipo, predicciones de la IA, datos de la empresa y soporte."],
      ] },
      { p: "Arriba ve el nombre de su empresa y su rol: Administrador, Encargado o Lector. Si maneja varias empresas, toque el nombre para cambiar de una a otra." },
    ],
  },
  {
    titulo: "Cree su nicho",
    resumen: "El nicho le dice a IMPERIUM qué tipo de productos maneja y qué reglas sigue la IA.",
    ruta: "mas", donde: "Más → Nichos del negocio → Agregar nicho",
    bloques: [
      { lista: ["Toque la pestaña «Más».", "Toque «Nichos del negocio».", "Toque «Agregar nicho».", "En «Tipo de negocio» elija la plantilla que más se parece al suyo.", "En «Nombre a mostrar» puede ponerle un nombre propio, por ejemplo «Bodega Centro» o «Línea de velas». Si lo deja vacío, usa el nombre de la plantilla.", "Toque «Crear nicho»."] },
      { p: "Cada plantilla trae listos los datos que pide cada producto, los días que suele tardar el proveedor en entregar y para cuántos días debe alcanzar cada compra. Estas son las plantillas:" },
      { campos: NICHOS },
      { p: "Si vende varias líneas distintas, cree un nicho para cada una. Por ejemplo, una tienda de ropa que también vende perfumes crea «Moda y calzado» y «Cosmética y belleza». Así cada encargado recibe solo las alertas de su línea." },
      { consejo: "Su plan define cuántos nichos puede tener: Esencial 1, Profesional 5 e Imperial ilimitados." },
    ],
  },
  {
    titulo: "Registre sus proveedores",
    resumen: "Para enviarles las órdenes por WhatsApp o correo con un toque.",
    ruta: "mas", donde: "Más → Proveedores → Agregar proveedor",
    bloques: [
      { lista: ["En «Más», toque «Proveedores».", "Toque «Agregar proveedor».", "Escriba el nombre, el correo y el WhatsApp con el indicativo del país (por ejemplo +573001234567).", "En «Días de entrega» ponga cuántos días suele tardar en llegar su pedido.", "Toque «Guardar»."] },
      { consejo: "Los días de entrega le ayudan a la IA a pedir a tiempo: si un proveedor tarda 10 días, IMPERIUM lo tiene en cuenta." },
    ],
  },
  {
    titulo: "Cree sus productos",
    resumen: "Cada producto con su stock y los límites que disparan las alertas.",
    ruta: "inventario", donde: "Inventario → Nuevo producto",
    bloques: [
      { lista: ["Toque la pestaña «Inventario».", "Toque «Nuevo producto».", "Llene los datos (abajo le explicamos cada uno).", "Al final aparecen los «Datos del nicho»: son los campos especiales de su tipo de negocio, como talla, lote o vencimiento.", "Toque «Crear producto»."] },
      { campos: [
        ["SKU", "El código único del producto, por ejemplo VELA-001. No se puede repetir ni cambiar después."],
        ["Unidad", "Cómo lo cuenta: unidad, caja, kg, litro, par…"],
        ["Stock inicial", "Cuántas unidades tiene hoy."],
        ["Stock mínimo", "Cuando el stock llega aquí, se abre la alerta de compra."],
        ["Stock crítico", "Por debajo de este número la alerta se marca en rojo como urgente. Debe ser menor que el mínimo."],
        ["Stock máximo", "Lo máximo que cabe o conviene tener. La IA no sugiere pasarse de este número; solo en temporada alta puede subirlo un poco."],
        ["Lote de compra", "De a cuánto le vende el proveedor. Si vende por cajas de 12, ponga 12 y la IA redondea a cajas completas."],
        ["Costo unitario", "Lo que le cuesta cada unidad. Sirve para calcular el valor de cada compra."],
        ["Proveedor", "A quién se le compra este producto."],
      ] },
      { ejemplo: "Vela aromática: stock inicial 60, mínimo 20, crítico 8, máximo 120, lote 12. Cuando quedan 20 velas, IMPERIUM propone una compra en múltiplos de 12 sin pasar de 120." },
    ],
  },
  {
    titulo: "Registre ventas y movimientos",
    resumen: "Así IMPERIUM sabe cuánto tiene y qué tan rápido se vende.",
    ruta: "inventario", donde: "Inventario → toque el producto → Registrar movimiento",
    bloques: [
      { lista: ["En «Inventario», toque el producto.", "Toque «Registrar movimiento».", "Elija el tipo de movimiento.", "Escriba la cantidad y, si quiere, el precio y una referencia (número de factura o pedido).", "Toque «Registrar». El stock se actualiza al instante."] },
      { campos: [
        ["Venta", "Resta del stock. Es el dato que más usa la IA para calcular la demanda."],
        ["Compra recibida", "Suma al stock mercancía que llegó fuera de una orden."],
        ["Merma o daño", "Resta lo que se perdió, venció o se dañó."],
        ["Ajuste (suma o resta)", "Corrige el stock después de un conteo físico."],
        ["Devoluciones", "De un cliente (suma) o a un proveedor (resta)."],
      ] },
      { p: "En la lista de inventario, la franja de color de cada producto le dice cómo va: verde es suficiente, dorado está bajo el mínimo y rojo está en nivel crítico. Use el filtro «Bajo el mínimo» para ver solo lo que falta." },
    ],
  },
  {
    titulo: "Cómo nace una alerta",
    resumen: "Lo que pasa automáticamente cuando algo se está acabando.",
    ruta: "alertas", donde: "Alertas → Por autorizar",
    bloques: [
      { lista: ["Una venta deja el producto en su stock mínimo o por debajo.", "IMPERIUM abre una alerta y empieza a contar 7 días.", "La IA revisa las ventas de las últimas semanas, la temporada, las reglas de su nicho, el lote del proveedor y el stock máximo, y calcula la cantidad.", "El encargado de ese nicho recibe un correo (y un WhatsApp en los planes Profesional e Imperial) con un enlace personal y firmado."] },
      { cita: "La IA ha detectado baja disponibilidad de mercancía. Se requiere su total atención y ejecución con eficiencia para verificar que lo solicitado sea lo que realmente falta. La ejecución automática se realizará en 7 días si cuenta con su autorización manual." },
      { p: "Ese es el mensaje exacto que recibe el encargado. Solo se abre una alerta por producto a la vez, así no le llegan avisos repetidos." },
    ],
  },
  {
    titulo: "Firme o rechace la compra",
    resumen: "El paso más importante: nada se compra sin su firma.",
    ruta: "alertas", donde: "Alertas → toque la alerta",
    bloques: [
      { lista: ["Toque «Alertas» y luego la alerta (o el enlace del correo o del WhatsApp).", "Revise la cantidad sugerida, el stock actual, el costo estimado y el análisis de la IA.", "Verifique físicamente que eso es lo que realmente falta.", "Marque la casilla «Verifiqué que lo solicitado es lo que realmente falta».", "Toque el botón dorado «Firmar y autorizar» y confirme."] },
      { p: "Al cumplirse los 7 días, la orden de compra se crea sola con la cantidad que usted firmó." },
      { campos: [
        ["¿No corresponde?", "Escriba el motivo (por ejemplo «hay mercancía en bodega 2») y toque «Rechazar solicitud»."],
        ["¿Cambió de opinión?", "En «Autorizadas» puede tocar «Revocar autorización» antes de que se cumplan los 7 días."],
        ["¿No firmó a tiempo?", "La compra queda bloqueada sola. Si el producto sigue bajo el mínimo, la siguiente venta abre una alerta nueva."],
      ] },
      { consejo: "Cada firma queda registrada con nombre, fecha y hora. Solo Administradores y Encargados pueden firmar; los Lectores solo consultan." },
    ],
  },
  {
    titulo: "Gestione las órdenes de compra",
    resumen: "Envíe la orden al proveedor y reciba la mercancía.",
    ruta: "ordenes", donde: "Órdenes → toque la orden",
    bloques: [
      { lista: ["Toque «Órdenes» y luego la orden.", "Toque «Enviar por WhatsApp» o «Enviar por correo»: el mensaje al proveedor sale escrito con productos, cantidades y total.", "Toque «Marcar como enviada al proveedor» y, cuando el proveedor responda, «Marcar como confirmada».", "Cuando llegue la mercancía, revise que esté completa y toque «Marcar como recibida». El stock se suma solo."] },
      { p: "Si necesita comprar algo urgente sin esperar los 7 días, vaya a Inventario, toque el producto y use «Orden manual». Esa orden la crea usted directamente." },
      { consejo: "Si una orden ya no sirve, ábrala y toque «Cancelar orden»." },
    ],
  },
  {
    titulo: "Invite a su equipo",
    resumen: "Cada encargado recibe solo las alertas de su nicho.",
    ruta: "mas", donde: "Más → Equipo y permisos → Invitar a alguien",
    bloques: [
      { lista: ["En «Más», toque «Equipo y permisos».", "Toque «Invitar a alguien».", "Escriba el nombre y el correo de la persona.", "Elija el rol y el nicho del que se encarga.", "Si quiere que reciba alertas por WhatsApp, escriba su número con +57.", "Toque «Invitar». La persona entra con su correo, igual que usted."] },
      { campos: [
        ["Administrador", "Control total: nichos, proveedores, equipo, datos de la empresa y firmas."],
        ["Encargado", "Recibe las alertas de su nicho, firma compras, crea productos y gestiona órdenes."],
        ["Lector", "Solo consulta. No puede firmar ni cambiar nada."],
      ] },
      { p: "Para quitarle el acceso a alguien, toque «Retirar» junto a su nombre. Puede devolvérselo con «Restaurar»." },
    ],
  },
  {
    titulo: "La IA y sus predicciones",
    resumen: "Cómo calcula y dónde ver lo que sugirió.",
    ruta: "mas", donde: "Más → Predicciones de la IA",
    bloques: [
      { p: "En los planes Profesional e Imperial, la IA analiza sus ventas, la temporada en Colombia (primas, temporada escolar, fin de año) y las reglas de su nicho para sugerir cuánto pedir y cuándo. En el plan Esencial se usa un cálculo base: completa el producto hasta su stock máximo (o el doble del mínimo si no tiene máximo), en lotes completos." },
      { p: "En «Predicciones de la IA» ve cada sugerencia con su explicación. La IA solo sugiere: nunca puede comprar." },
      { consejo: "Entre más ventas registre, más precisas son las sugerencias." },
    ],
  },
  {
    titulo: "Su plan, su empresa y el soporte",
    resumen: "Lo que encuentra en «Más» y una rutina diaria recomendada.",
    ruta: "mas", donde: "Más",
    bloques: [
      { campos: [
        ["Plan", "Su plan, el estado de la suscripción, la próxima renovación y cuánto ha usado de nichos, productos y usuarios."],
        ["Mejorar plan", "Pase a un plan mayor cuando necesite más nichos, IA o WhatsApp."],
        ["Datos de la empresa", "Nombre comercial, NIT y moneda (COP, USD y otras)."],
        ["Soporte por WhatsApp", "Escríbanos y le ayudamos."],
        ["Cerrar sesión", "Úselo si presta o cambia de celular."],
      ] },
      { subtitulo: "Rutina diaria recomendada", lista: ["Durante el día: registre cada venta.", "Cada mañana: revise «Alertas» y firme o rechace lo pendiente.", "Al llegar un pedido: márquelo como recibido en «Órdenes».", "Una vez al mes: haga un conteo físico y corrija con un ajuste."] },
      { consejo: "La Firma de la Herencia: cada compra de su negocio lleva su firma." },
    ],
  },
];

const CLAVE = "imperium_manual_paso";
const leer = () => { try { return Number(localStorage.getItem(CLAVE)) || 0; } catch { return 0; } };
const guardar = (i) => { try { localStorage.setItem(CLAVE, String(i)); } catch { /* sin almacenamiento */ } };

function bloque(b) {
  const partes = [];
  if (b.subtitulo) partes.push(h("h3", { class: "manual-sub" }, b.subtitulo));
  if (b.p) partes.push(h("p", { class: "suave" }, b.p));
  if (b.lista) partes.push(h("ol", { class: "manual-toques" }, ...b.lista.map((t) => h("li", {}, t))));
  if (b.campos) partes.push(h("dl", { class: "manual-campos" }, ...b.campos.flatMap(([t, d]) => [h("dt", {}, t), h("dd", {}, d)])));
  if (b.ejemplo) partes.push(h("p", { class: "manual-ejemplo" }, h("strong", {}, "Ejemplo. "), b.ejemplo));
  if (b.cita) partes.push(h("blockquote", { class: "aviso-oro" }, b.cita));
  if (b.consejo) partes.push(h("p", { class: "mensaje info" }, b.consejo));
  return partes;
}

function zonaInstalacion() {
  const zona = h("div", { class: "manual-instalar" });
  const pintar = () => {
    if (instalada()) return zona.replaceChildren(h("p", { class: "mensaje ok" }, "IMPERIUM ya está instalada en este celular."));
    if (puedeInstalar()) return zona.replaceChildren(h("button", { class: "boton oro ancho", onclick: () => instalar() }, "Instalar IMPERIUM ahora"));
    const s = sistema();
    zona.replaceChildren(h("p", { class: "mensaje info" },
      s === "ios" ? "Está en iPhone: siga las instrucciones de iPhone de abajo, desde Safari."
        : s === "android" ? "Está en Android: siga las instrucciones de Android de abajo, desde Chrome."
        : "Abra esta página en su celular para instalar IMPERIUM."));
  };
  pintar();
  alCambiarInstalacion(pintar);
  return zona;
}

/** Pinta el manual dentro de `vista`. `irA(ruta)` lleva a una sección de la app. */
export function vistaManual(vista, irA) {
  let actual = Math.min(leer(), PASOS.length - 1);
  const contenedor = h("div", { class: "pila" });

  const pintar = () => {
    guardar(actual);
    const paso = PASOS[actual];
    const progreso = h("div", { class: "manual-progreso", role: "progressbar", "aria-valuemin": "1", "aria-valuemax": String(PASOS.length), "aria-valuenow": String(actual + 1), "aria-label": "Avance del manual" },
      h("span", { style: `width:${((actual + 1) / PASOS.length) * 100}%` }));
    const indice = h("details", { class: "manual-indice" },
      h("summary", {}, "Ver todos los pasos"),
      h("ol", {}, ...PASOS.map((p, i) => h("li", {},
        h("button", { "aria-current": i === actual ? "step" : null, onclick: () => { actual = i; pintar(); } }, p.titulo)))));
    contenedor.replaceChildren(
      h("div", {}, h("h1", {}, "Manual de uso"), h("p", { class: "tenue" }, "Siga los pasos en orden. Puede volver a cualquiera cuando quiera.")),
      h("div", { class: "entre" }, h("span", { class: "chip oro num" }, `Paso ${actual + 1} de ${PASOS.length}`), paso.donde ? h("span", { class: "tenue" }, paso.donde) : null),
      progreso,
      h("article", { class: "panel manual-paso", "aria-live": "polite" },
        h("h2", { class: "dorado" }, paso.titulo),
        h("p", { class: "manual-resumen" }, paso.resumen),
        paso.instalacion ? zonaInstalacion() : null,
        ...paso.bloques.flatMap(bloque),
        paso.ruta ? h("button", { class: "boton ancho", style: "margin-top:16px", onclick: () => irA(paso.ruta) }, "Ir a esta sección") : null),
      h("div", { class: "manual-nav" },
        h("button", { class: "boton", disabled: actual === 0, onclick: () => { actual--; pintar(); window.scrollTo({ top: 0 }); } }, "Anterior"),
        actual < PASOS.length - 1
          ? h("button", { class: "boton oro", onclick: () => { actual++; pintar(); window.scrollTo({ top: 0 }); } }, "Siguiente")
          : h("button", { class: "boton oro", onclick: () => irA("panel") }, "Ir a mi panel")),
      indice,
    );
  };
  pintar();
  vista.replaceChildren(contenedor);
}
