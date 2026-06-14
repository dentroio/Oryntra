export type Device = {
  id: string;
  name: string;
  status: "online" | "offline" | "maintenance";
  site: string;
};

export const DEVICES: Device[] = [
  { id: "d1", name: "Core Switch A", status: "online", site: "NYC" },
  { id: "d2", name: "Edge Router 12", status: "offline", site: "SFO" },
  { id: "d3", name: "Access Point 4F", status: "maintenance", site: "NYC" },
  { id: "d4", name: "Firewall DMZ", status: "online", site: "LON" },
  { id: "d5", name: "Load Balancer 2", status: "online", site: "SFO" },
];
