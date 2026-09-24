import workCases from "./workCases.json" with { type: "json" };

export default workCases.filter((c) => c.status === "active" && c.hasPage);
