// Constructor de prompts: estilo de marca + escena por tipo + elementos permitidos + restricciones. Nunca incluye el titular, el CTA, el logotipo ni texto.
import path from "node:path";
import { MK_DIR, readJson, config } from "../paths.mjs";

export const style = () => readJson(path.join(MK_DIR, "bank", "visual-style.json"));

// Tipos que producen fotografia verosimil (se pueden confundir con una foto real) frente a ilustracion/grafico evidente.
export const isPhotoreal = (type) => style().photoreal.includes(type);

// Clasificacion de transparencia. Devuelve { aiGenerated, label, class }:
//  A/B foto real (compose/enhance): sin IA, sin etiqueta. B' foto real ampliada: IA, etiqueta "Ampliada con IA".
//  C infografia/ilustracion evidente: IA, sin etiqueta. D imagen generada que podria parecer fotografia: IA, etiqueta "Ilustración".
export function disclosureFor(brief, mode) {
  const d = config().imageEngine.disclosure;
  if (mode === "real") {
    return brief.edit?.operation === "extend_canvas" ? { aiGenerated: true, label: d.extended, class: "B-extended" } : { aiGenerated: false, label: null, class: "B-real" };
  }
  return isPhotoreal(brief.type) ? { aiGenerated: true, label: d.label, class: "D-photoreal" } : { aiGenerated: true, label: null, class: "C-illustration" };
}

const COMPOSITION = {
  "4:5": "encuadre vertical 4:5",
  "9:16": "encuadre vertical alto 9:16, con el tercio superior e inferior despejados",
  "1:1": "encuadre cuadrado",
  "4:3": "encuadre apaisado 4:3",
  "16:9": "encuadre panoramico 16:9",
  "3:2": "encuadre apaisado 3:2",
  "2:3": "encuadre vertical 2:3"
};

// variant: indice 0..n-1 -> una pista de composicion distinta para que las variantes no sean copias.
export function buildPrompt(brief, variant = 0) {
  const s = style();
  const photoreal = s.photoreal.includes(brief.type);
  const hints = s.variantHints;
  const scene = s.types[brief.type] || s.types.editorial;
  const elements = (brief.elements || []).map((e) => s.elements[e]).filter(Boolean);
  const constraints = [...s.constraintsAlways, ...(photoreal ? s.constraintsPhotoreal : s.constraintsIllustrated)];
  const parts = [
    photoreal ? s.base : s.baseIllustrated,
    `Escena: ${scene}`,
    elements.length ? `Elementos que ayudan a explicar el servicio: ${elements.join("; ")}.` : "",
    `Tema de la campana: ${brief.campaign.replace(/[_-]+/g, " ")}.`,
    brief.location ? `Ambiente propio de la zona de ${brief.location} (Mediterraneo, Tarragona).` : "",
    brief.style_notes ? `Notas: ${brief.style_notes}` : "",
    `Composicion: ${COMPOSITION[brief.aspect_ratio]}; ${hints[variant % hints.length]}; reservar espacio vacio para texto superpuesto despues.`,
    `Restricciones: ${constraints.join("; ")}.`
  ];
  return parts.filter(Boolean).join("\n");
}

// Edicion de ampliacion de lienzo de una foto real: solo rellenar los margenes transparentes.
export function buildExtendPrompt() {
  const s = style();
  return [
    "Amplia el lienzo rellenando UNICAMENTE las zonas transparentes de los bordes, continuando con coherencia el cielo, el terreno y la vegetacion ya visibles.",
    "No modifiques, no retoques ni reinterpretes nada de la parte existente de la fotografia.",
    "No anadas objetos, personas, edificios, herramientas, carteles ni vegetacion nueva destacada: solo continuidad natural de lo que ya hay.",
    `Restricciones: ${s.constraintsAlways.join("; ")}.`
  ].join("\n");
}

// Critico visual. stage: "background" (fondo sin texto) | "final" (pieza ya compuesta con texto/CTA/logotipo por codigo).
export const criticPrompt = (criteria, stage = "background") => `Eres director de arte y revisor de calidad de las publicaciones de Aitor Soluciones, una empresa familiar de jardineria, desbroce y mantenimiento de propiedades en Alcanar y las Terres de l'Ebre (estilo sobrio, mediterraneo, cercano, de confianza; nada corporativo, tecnologico ni de postal perfecta).
Revisa la imagen adjunta (${stage === "final" ? "es la pieza FINAL ya compuesta: el titular, el boton CTA, la localidad y el logotipo los ha puesto el codigo, no el modelo; juzga su colocacion, no su redaccion" : "es solo el fondo generado, todavia sin texto ni logotipo"}).
Responde SOLO con JSON con esta forma exacta:
{"score": 0-100, "ai_look": 0-10, "brand_fit": 0-10, "commercial_appeal": 0-10, "visual_errors": [lista de errores concretos, vacia si no hay], "composition_breathes": true|false, ${stage === "final" ? '"text_placement_ok": true|false, "mobile_legible": true|false, ' : ""}"publishable": true|false, "flags": [subconjunto de: ${criteria.map((c) => `"${c}"`).join(", ")}], "notes": "una frase"}
ai_look: 0 = parece fotografia o ilustracion de oficio, 10 = tipica imagen de IA (piel o plantas plasticas, simetria rara, brillos, objetos fundidos).
visual_errors: deformaciones, objetos imposibles, texto basura, vegetacion imposible, maquinaria incoherente.
${stage === "final" ? "text_placement_ok: el texto no tapa lo importante, no se corta, tiene contraste y el CTA y el logotipo estan en zonas seguras. mobile_legible: se entiende de un vistazo en un movil." : ""}
publishable: true solo si la publicarias hoy sin retocar. Marca flags solo si lo ves claramente.`;
