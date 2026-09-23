// Datos legales del titular (LSSI art. 10 y RGPD art. 13).
// NO se deducen ni se inventan: los debe facilitar/verificar Aitor.
// Se pueden rellenar aqui o, mejor, como variables de entorno de Netlify
// (LEGAL_HOLDER_NAME, LEGAL_TAX_ID, LEGAL_POSTAL_ADDRESS) para no guardarlos
// en el repositorio (que es publico).
const holderName = process.env.LEGAL_HOLDER_NAME || "";
const taxId = process.env.LEGAL_TAX_ID || "";
const postalAddress = process.env.LEGAL_POSTAL_ADDRESS || "";

const missing = [];
if (!holderName.trim()) missing.push("nombre y apellidos legales completos (LEGAL_HOLDER_NAME)");
if (!taxId.trim()) missing.push("NIF (LEGAL_TAX_ID)");
if (!postalAddress.trim()) missing.push("dirección postal o profesional válida (LEGAL_POSTAL_ADDRESS)");

const complete = missing.length === 0;

// Bloqueo de publicacion legal: una build de PRODUCCION no se genera si faltan
// datos. Los Deploy Previews y el desarrollo local siguen funcionando.
if (!complete && process.env.CONTEXT === "production") {
  throw new Error(
    "BLOQUEO DE PUBLICACION LEGAL: faltan datos del titular para el Aviso legal y la Politica de privacidad: " +
      missing.join("; ")
  );
}

export default {
  tradeName: "Aitor Soluciones",
  holderName: holderName.trim(),
  taxId: taxId.trim(),
  postalAddress: postalAddress.trim(),
  email: "aitorsoluciones@gmail.com",
  phone: "603 207 780",
  base: "Les Cases d'Alcanar (Tarragona)",
  complete,
  missing,
};
