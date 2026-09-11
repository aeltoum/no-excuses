export const memberDestinations = [
  { label: "Home", route: "/home" },
  { label: "Group", route: "/group" },
  { label: "You", route: "/you" },
] as const;

export const operatorDestinations = [
  { label: "Work queue", route: "/operator/work" },
  { label: "Service health", route: "/operator/health" },
  { label: "Procedures", route: "/operator/procedures" },
  { label: "Audit", route: "/operator/audit" },
] as const;
