// Informa del estado de los datos legales del titular. Sale con error si
// faltan (bloqueo de publicacion legal). Uso: node tools/check-legal.mjs
import legal from "../src/_data/legal.js";

if (legal.complete) {
  console.log("Datos legales completos.");
} else {
  console.log("BLOQUEO DE PUBLICACION LEGAL. Faltan:");
  for (const m of legal.missing) console.log(" - " + m);
  console.log("\nDefinelos como variables de entorno en Netlify (Site configuration > Environment variables) o en src/_data/legal.js.");
  process.exit(1);
}
