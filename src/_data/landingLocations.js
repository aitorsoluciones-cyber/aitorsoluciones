import locations from "./locations.json" with { type: "json" };

export default locations.filter((l) => l.hasLandingPage);
