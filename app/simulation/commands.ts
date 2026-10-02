export type CommandCode =
  | "VERIFY_EAST_ROUTE"
  | "SEND_WEST_ROUTE"
  | "MARK_EAST_UNSAFE"
  | "APPLY_VENTILATION";

export interface CommandDef {
  code: CommandCode;
  label: string;
  detail: string;
  color: string;
  target: string;
}

export const COMMANDS: CommandDef[] = [
  {
    code: "VERIFY_EAST_ROUTE",
    label: "Verify east route",
    detail: "confirm the route evidence before messaging",
    target: "east route",
    color: "#facc15",
  },
  {
    code: "SEND_WEST_ROUTE",
    label: "Send west route",
    detail: "send a verified alternate route with an expiry",
    target: "west route",
    color: "#10b981",
  },
  {
    code: "MARK_EAST_UNSAFE",
    label: "Mark east unsafe",
    detail: "share the confirmed route block",
    target: "east route",
    color: "#ef4444",
  },
  {
    code: "APPLY_VENTILATION",
    label: "Apply ventilation",
    detail: "change the panel state for one bounded intervention",
    target: "ventilation panel",
    color: "#38bdf8",
  },
];

export const commandByCode = (code: CommandCode) =>
  COMMANDS.find((command) => command.code === code)!;
