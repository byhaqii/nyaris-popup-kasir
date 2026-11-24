export const rupiah = (n: number) => "Rp" + n.toLocaleString("id-ID");
export type Sale = {
  id: string;
  tenant: string;
  amount: number;
  method: string;
  created: string;
  updated: string;
  sid: number;
  status: string;
  version: number;
  cashier: string;
  proofId?: string;
};
export type Session = {
  id: number;
  uid: number;
  start: string;
  end: string | null;
  cashier: string;
};
export type State = {
  user: { id: number; name: string; role: string };
  events: { id: number; name: string; current: number }[];
  event: null | {
    id: number;
    name: string;
    start: string;
    finish: string;
    mode: string;
    current: number;
    active: boolean;
  };
  sales: Sale[];
  sessions: Session[];
  tenants: { name: string; enabled: number }[];
  audits: {
    subject: string;
    action: string;
    reason: string;
    before: string;
    after: string;
    time: string;
    actor: string;
  }[];
  sync: {
    kind: string;
    file: string;
    status: string;
    last: string;
    error: string;
  }[];
  today: string;
  refreshed: string;
  admin?: {
    users: { id: number; name: string; role: "cashier" | "developer"; enabled: number; email: string }[];
    tenantStaff: {tenant:string; uid:number}[];
    bps: number;
    sharing: { name: string; gross: number; share: number; net: number }[];
  };
};
