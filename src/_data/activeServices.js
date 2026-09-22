import services from "./services.json" with { type: "json" };

export default services.filter((s) => s.status === "active" && (s.level === 1 || s.level === 2));
