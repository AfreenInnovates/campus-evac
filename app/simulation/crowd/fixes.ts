/**
 * Changes a building can make to its evacuation plan, each one modelled in the simulation so an
 * audit can be rerun with it and the difference measured. Every fix here is something real
 * buildings install or adopt; `basis` says why it is expected to help.
 */

export type FixId = "ramp" | "strobes" | "text-alerts" | "low-signs" | "voice-alarm";

export interface Fix {
  id: FixId;
  title: string;
  /** what changes in the building or the plan */
  detail: string;
  /** who it is meant to protect */
  helps: string;
  basis: string;
}

export const FIXES: Fix[] = [
  {
    id: "ramp",
    title: "Ramp at the west fire exit",
    detail: "Replace the three steps outside the Library fire exit with a ramp.",
    helps: "wheelchair users",
    basis: "A stepped exit is no exit for a wheelchair: they have to go back through the building.",
  },
  {
    id: "strobes",
    title: "Flashing visual fire alarms",
    detail: "Strobe lights in every room flash with the alarm.",
    helps: "deaf people",
    basis: "Deaf occupants otherwise learn of a fire only from smoke or from other people leaving.",
  },
  {
    id: "text-alerts",
    title: "Text alerts for deaf occupants",
    detail: "Every announcement and order by name is also sent as a text message to registered deaf occupants.",
    helps: "deaf people",
    basis: "Orders by name over the PA never reach someone who cannot hear them.",
  },
  {
    id: "low-signs",
    title: "Low-level glow-in-the-dark exit signs",
    detail: "Photoluminescent way-finding strips and signs near the floor, readable under smoke.",
    helps: "everyone in thick smoke, visitors",
    basis: "Smoke collects at the ceiling and hides overhead signs first.",
  },
  {
    id: "voice-alarm",
    title: "Spoken evacuation alarm instead of a bell",
    detail: "The alarm is a recorded voice saying what is happening and to leave by the nearest exit.",
    helps: "people who panic or hesitate, people with headphones",
    basis: "Studies of real evacuations find spoken alarms shorten the delay before people start to move.",
  },
];

export const fixById = (id: FixId) => FIXES.find((fix) => fix.id === id)!;

export const hasFix = (fixes: readonly FixId[] | undefined, id: FixId) => !!fixes?.includes(id);
