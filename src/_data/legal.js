// Datos legales del titular (LSSI art. 10 y RGPD art. 13).
// NO se deducen ni se inventan: los facilita Aitor como variables de entorno
// de Netlify (LEGAL_HOLDER_NAME, LEGAL_TAX_ID, LEGAL_POSTAL_ADDRESS) para no
// guardarlos en el repositorio, que es publico. El titular debe ser quien presta
// el servicio y gestiona las consultas: persona fisica (DNI/NIE) o, si la
// actividad la ejerce una sociedad, esa sociedad (CIF).
const clean = (v) => String(v || "").replace(/\s+/g, " ").trim();

const holderName = clean(process.env.LEGAL_HOLDER_NAME);
const postalAddress = clean(process.env.LEGAL_POSTAL_ADDRESS);
const taxIdRaw = clean(process.env.LEGAL_TAX_ID);
const taxId = taxIdRaw.replace(/[\s.\-]/g, "").toUpperCase();

const LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

function validDniNie(value) {
  const dni = value.match(/^(\d{8})([A-Z])$/);
  if (dni) return LETTERS[Number(dni[1]) % 23] === dni[2];
  const nie = value.match(/^([XYZ])(\d{7})([A-Z])$/);
  if (nie) return LETTERS[Number("XYZ".indexOf(nie[1]) + nie[2]) % 23] === nie[3];
  return false;
}

function validCif(value) {
  const m = value.match(/^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/);
  if (!m) return false;
  const [, org, digits, control] = m;
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const d = Number(digits[i]);
    if (i % 2 === 0) {
      const x = d * 2;
      sum += Math.floor(x / 10) + (x % 10);
    } else {
      sum += d;
    }
  }
  const digit = (10 - (sum % 10)) % 10;
  const letter = "JABCDEFGHI"[digit];
  if ("PQRSNW".includes(org)) return control === letter;
  if ("ABEH".includes(org)) return control === String(digit);
  return control === String(digit) || control === letter;
}

const isPerson = validDniNie(taxId);
const isCompany = !isPerson && validCif(taxId);

const missing = [];
const invalid = [];
if (!holderName) missing.push("nombre y apellidos o razón social del titular (LEGAL_HOLDER_NAME)");
if (!taxId) missing.push("NIF/CIF (LEGAL_TAX_ID)");
else if (process.env.LEGAL_SKIP_NIF_VALIDATION !== "1" && !isPerson && !isCompany) {
  invalid.push("NIF/CIF con formato o letra de control no válidos (LEGAL_TAX_ID)");
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
  taxIdLabel: isCompany ? "CIF" : "NIF",
  holderKind: isPerson ? "persona física" : isCompany ? "persona jurídica" : "",
  postalAddress,
  email: "aitorsoluciones@gmail.com",
  phone: "603 207 780",
  base: "Les Cases d'Alcanar (Tarragona)",
  complete,
  missing: [...missing, ...invalid],
};
