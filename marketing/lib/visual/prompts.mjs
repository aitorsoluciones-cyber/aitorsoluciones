// Constructor de prompts: estilo de marca + escena por tipo + restricciones. Nunca incluye el titular, el CTA, el logotipo ni texto.
import path from "node:path";
import { MK_DIR, readJson } from "../paths.mjs";

export const style = () => readJson(path.join(MK_DIR, "bank", "visual-style.json"));

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
  const hints = s.variantHints;
  const scene = s.types[brief.type] || s.types.editorial;
  const parts = [
    s.base,
    `Escena: ${scene}`,
    `Tema de la campana: ${brief.campaign.replace(/[_-]+/g, " ")}.`,
    brief.location ? `Ambiente propio de la zona de ${brief.location} (Mediterraneo, Tarragona).` : "",
    brief.style_notes ? `Notas: ${brief.style_notes}` : "",
    `Composicion: ${COMPOSITION[brief.aspect_ratio]}; ${hints[variant % hints.length]}; reservar espacio vacio para texto superpuesto despues.`,
    `Restricciones: ${s.constraints.join("; ")}.`
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
    `Restricciones: ${s.constraints.join("; ")}.`
  ].join("\n");
}

export const criticPrompt = (criteria) => `Eres revisor de calidad de imagenes de marketing de una empresa de jardineria y mantenimiento de propiedades en Alcanar (Tarragona).
Evalua la imagen adjunta. Responde SOLO con JSON con esta forma exacta:
{"score": numero 0-100, "flags": [subconjunto de: ${criteria.map((c) => `"${c}"`).join(", ")}], "notes": "una frase"}
Marca un flag solo si lo ves claramente. score alto = imagen natural, creible, sobria y util como fondo editorial.`;
