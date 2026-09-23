// Datos legales del titular (LSSI art. 10 y RGPD art. 13).
// NO se deducen ni se inventan: los facilita Aitor como variables de entorno
// de Netlify (LEGAL_HOLDER_NAME, LEGAL_TAX_ID, LEGAL_POSTAL_ADDRESS) para no
// guardarlos en el repositorio, que es publico.
const clean = (v) => String(v || "").replace(/\s+/g, " ").trim();

const holderName = clean(process.env.LEGAL_HOLDER_NAME);
const postalAddress = clean(process.env.LEGAL_POSTAL_ADDRESS);
const taxIdRaw = clean(process.env.LEGAL_TAX_ID);
const taxId = taxIdRaw.replace(/[\s.\-]/g, "").toUpperCase();

// Valida DNI/NIE (persona fisica) con su letra de control, para no publicar
// un NIF con una errata. Se puede omitir con LEGAL_SKIP_NIF_VALIDATION=1.
function validNif(value) {
  const letters = "TRWAGMYFPDXBNJZSQVHLCKE";
  const dni = value.match(/^(\d{8})([A-Z])$/);
  if (dni) return letters[Number(dni[1]) % 23] === dni[2];
  const nie = value.match(/^([XYZ])(\d{7})([A-Z])$/);
  if (nie) return letters[Number("XYZ".indexOf(nie[1]) + nie[2]) % 23] === nie[3];
  return false;
}

const missing = [];
const invalid = [];
if (!holderName) missing.push("nombre y apellidos legales completos (LEGAL_HOLDER_NAME)");
if (!taxId) missing.push("NIF (LEGAL_TAX_ID)");
else if (process.env.LEGAL_SKIP_NIF_VALIDATION !== "1" && !validNif(taxId)) {
  invalid.push("NIF con formato o letra de control no válidos (LEGAL_TAX_ID)");
}
if (!postalAddress) missing.push("dirección postal o profesional válida (LEGAL_POSTAL_ADDRESS)");

const complete = missing.length === 0 && invalid.length === 0;

// Bloqueo de publicacion legal: una build de PRODUCCION (Netlify CONTEXT=production)
// no se genera si falta o es invalido algun dato. Deploy Previews y desarrollo
// local siguen funcionando y muestran el campo como pendiente.
if (!complete && process.env.CONTEXT === "production") {
  throw new Error(
    "BLOQUEO DE PUBLICACION LEGAL: datos del titular incompletos o invalidos para el Aviso legal y la Politica de privacidad: " +
      [...missing, ...invalid].join("; ")
  );
}

export default {
  tradeName: "Aitor Soluciones",
  holderName,
  taxId: taxId || "",
  postalAddress,
  email: "aitorsoluciones@gmail.com",
  phone: "603 207 780",
  base: "Les Cases d'Alcanar (Tarragona)",
  complete,
  missing: [...missing, ...invalid],
};
