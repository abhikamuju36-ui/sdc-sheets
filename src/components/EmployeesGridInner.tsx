"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
} from "ag-grid-community";
import { updateEmployee, setEmployeeActive } from "@/lib/employee-actions";

ModuleRegistry.registerModules([AllCommunityModule]);

const sdcTheme = themeQuartz.withParams({
  accentColor: "#1574C4",
  headerBackgroundColor: "#061D39",
  headerTextColor: "#ffffff",
  headerFontWeight: 600,
  fontFamily: "inherit",
  fontSize: 12,
  headerFontSize: 12,
  rowHoverColor: "#e6f0fa",
  borderColor: "#e6e9ee",
  wrapperBorderRadius: 12,
  oddRowBackgroundColor: "#fafbfc",
});

const DASH = "—"; // display value for "no discipline / no supervisor"

export type EmployeeRow = {
  id: number;
  name: string;
  discipline: string; // label or DASH
  supervisor: string; // supervisor name or DASH
  department: string;
  active: boolean;
  billingGroup: string;
  paylocityId: string;
};

type GridContext = {
  onSave: (row: EmployeeRow) => void;
  onToggleActive: (row: EmployeeRow) => void;
  supByName: Map<string, number>;
};

function StatusRenderer(p: ICellRendererParams<EmployeeRow>) {
  const active = p.data?.active;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${active ? "bg-sdc-blue-light text-sdc-blue-dark" : "bg-sdc-gray-100 text-sdc-gray-500"}`}>
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function ActionsRenderer(p: ICellRendererParams<EmployeeRow>) {
  const ctx = p.context as GridContext;
  const row = p.data;
  if (!row) return null;
  return (
    <span className="flex items-center gap-2">
      <button type="button" onClick={() => ctx.onSave(row)} className="rounded-md border border-sdc-border px-2.5 py-0.5 text-[11px] font-semibold text-sdc-navy hover:bg-sdc-blue-light">
        Save
      </button>
      <button
        type="button"
        onClick={() => ctx.onToggleActive(row)}
        className={row.active
          ? "rounded-md border border-[#F0D6D6] px-2.5 py-0.5 text-[11px] font-semibold text-[#B03A3A] hover:bg-[#FBEDED]"
          : "rounded-md border border-sdc-border px-2.5 py-0.5 text-[11px] font-semibold text-sdc-navy hover:bg-sdc-blue-light"}
      >
        {row.active ? "Deactivate" : "Reactivate"}
      </button>
    </span>
  );
}

export default function EmployeesGridInner({
  rows,
  disciplines,
  supervisors,
  quickFilter,
}: {
  rows: EmployeeRow[];
  disciplines: string[];
  supervisors: { id: number; name: string }[];
  quickFilter?: string;
}) {
  const router = useRouter();
  const supByName = useMemo(() => new Map(supervisors.map((s) => [s.name, s.id])), [supervisors]);

  const context: GridContext = {
    supByName,
    onSave: (row) => {
      const fd = new FormData();
      fd.set("name", row.name ?? "");
      fd.set("department", row.department ?? "");
      fd.set("billingGroup", row.billingGroup ?? "");
      fd.set("paylocityId", row.paylocityId ?? "");
      fd.set("discipline", row.discipline && row.discipline !== DASH ? row.discipline : "");
      const supId = row.supervisor && row.supervisor !== DASH ? supByName.get(row.supervisor) : undefined;
      fd.set("supervisorId", supId != null ? String(supId) : "");
      void updateEmployee(row.id, fd).then(() => router.refresh());
    },
    onToggleActive: (row) => {
      void setEmployeeActive(row.id, !row.active, new FormData()).then(() => router.refresh());
    },
  };

  const columnDefs: ColDef<EmployeeRow>[] = [
    { headerName: "#", width: 64, valueGetter: (p) => (p.node?.rowIndex ?? 0) + 1, sortable: false, filter: false, resizable: false },
    { field: "name", headerName: "Name", editable: true, minWidth: 180, flex: 1 },
    { field: "discipline", headerName: "Discipline", editable: true, width: 200, sort: "asc", cellEditor: "agSelectCellEditor", cellEditorParams: { values: [DASH, ...disciplines] } },
    { field: "supervisor", headerName: "Supervisor", editable: true, width: 200, cellEditor: "agSelectCellEditor", cellEditorParams: { values: [DASH, ...supervisors.map((s) => s.name)] } },
    { field: "department", headerName: "Department", editable: true, width: 200 },
    { field: "active", headerName: "Status", width: 120, editable: false, cellRenderer: StatusRenderer, valueGetter: (p) => (p.data?.active ? "Active" : "Inactive") },
    { headerName: "Actions", width: 190, editable: false, sortable: false, filter: false, cellRenderer: ActionsRenderer },
  ];

  return (
    <div style={{ height: "78vh", width: "100%" }}>
      <AgGridReact<EmployeeRow>
        theme={sdcTheme}
        rowData={rows}
        columnDefs={columnDefs}
        context={context}
        defaultColDef={{ sortable: true, filter: true, resizable: true, floatingFilter: true }}
        suppressMenuHide
        quickFilterText={quickFilter}
        stopEditingWhenCellsLoseFocus
        animateRows
        pagination
        paginationPageSize={50}
        paginationPageSizeSelector={[25, 50, 100, 200]}
      />
    </div>
  );
}
