// Fixed section-code column order and names, confirmed from the "Estimated Hours",
// "Function Hierarchy", and "Function Department" tabs of Project Planner Data
// Control.xlsx. Code = {phase}-{function}; phase groups the columns, function names
// them within the group. Shared by the Quoted page and the Monthly ETC grid so both
// use the identical column layout.
export const SECTIONS: { code: string; name: string; phase: string }[] = [
  { code: "10-111", name: "PM", phase: "Complete Design & Build" },
  { code: "10-211", name: "ME General", phase: "Complete Design & Build" },
  { code: "10-312", name: "CE Design & Drawings", phase: "Complete Design & Build" },
  { code: "10-313", name: "CE Software", phase: "Complete Design & Build" },
  { code: "10-515", name: "HMI", phase: "Complete Design & Build" },
  { code: "10-516", name: "Robot", phase: "Complete Design & Build" },
  { code: "10-517", name: "Vision", phase: "Complete Design & Build" },
  { code: "10-518", name: "Database & Device", phase: "Complete Design & Build" },
  { code: "10-411", name: "Mechanical Build", phase: "Complete Design & Build" },
  { code: "10-412", name: "Electrical Build", phase: "Complete Design & Build" },
  { code: "10-413", name: "Manufacturing", phase: "Complete Design & Build" },
  { code: "40-211", name: "Engineering", phase: "Machine Testing" },
  { code: "40-411", name: "Shop", phase: "Machine Testing" },
  { code: "50-211", name: "Engineering", phase: "Teardown & Install" },
  { code: "50-411", name: "Shop", phase: "Teardown & Install" },
  { code: "70-211", name: "Engineering", phase: "Warranty" },
  { code: "70-411", name: "Shop", phase: "Warranty" },
];

// Consecutive runs of the same phase, for a grouped header row's colSpans.
export const PHASE_GROUPS = SECTIONS.reduce<{ phase: string; count: number }[]>((groups, s) => {
  const last = groups[groups.length - 1];
  if (last && last.phase === s.phase) {
    last.count += 1;
  } else {
    groups.push({ phase: s.phase, count: 1 });
  }
  return groups;
}, []);

// The Monthly ETC grid tracks a narrower set than Quoted/Estimated Hours —
// confirmed by decoding the real "Managers Fill Out" sheet's header rows
// (End Of Month ETC Sheet.xlsx): it has no PM (10-111) or Manufacturing
// (10-413) column, and no Warranty phase at all. Quoted/EstimatedHours keep
// using the full SECTIONS/PHASE_GROUPS above; only the ETC page uses this.
const ETC_EXCLUDED_CODES = new Set(["10-111", "10-413", "70-211", "70-411"]);

// Billing group per section — matches the sheet's own "Total (New ETC)"
// rollup, which is a pure formula (SUM of the Engineering blocks' columns,
// separately SUM of the Shop blocks') rather than a manager-entered value.
const ENGINEERING_CODES = new Set(["10-211", "10-312", "10-313", "10-515", "10-516", "10-517", "10-518", "40-211", "50-211"]);

export const ETC_SECTIONS: { code: string; name: string; phase: string; billingGroup: "Engineering" | "Shop" }[] =
  SECTIONS.filter((s) => !ETC_EXCLUDED_CODES.has(s.code)).map((s) => ({
    ...s,
    billingGroup: ENGINEERING_CODES.has(s.code) ? "Engineering" : "Shop",
  }));

export const ETC_PHASE_GROUPS = ETC_SECTIONS.reduce<{ phase: string; count: number }[]>((groups, s) => {
  const last = groups[groups.length - 1];
  if (last && last.phase === s.phase) {
    last.count += 1;
  } else {
    groups.push({ phase: s.phase, count: 1 });
  }
  return groups;
}, []);

export const ETC_TRACKED_CODES = new Set(ETC_SECTIONS.map((s) => s.code));

// "Parts Cost" is a real block in the real sheet — same 5-column shape
// (Prior ETC / Money Spent Month / Money Left / New ETC / Diff) as every
// department, just in dollars instead of hours, and with no Engineering/Shop
// split (a single "Total"). Modeled as an EtcEntry row with this sentinel
// section value rather than a new table, since the shape is identical.
export const PARTS_COST_SECTION = "PARTS_COST";
