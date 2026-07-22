"use client";

import { useEffect, useState } from "react";

// Toolbar toggle for the Projects grid: show or hide the "/actual" hours beside
// each quoted value. Toggles a body class the grid CSS keys off, persisted in
// localStorage. Quoted hours (the editable inputs) always stay visible; only the
// actual suffix is shown/hidden. The over/under cell coloring is unaffected.
export function ShowActualsToggle() {
  const [show, setShow] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("quoted-show-actuals");
    const v = saved === null ? true : saved === "1";
    setShow(v);
    document.body.classList.toggle("hide-actuals", !v);
  }, []);

  const toggle = () => {
    const v = !show;
    setShow(v);
    localStorage.setItem("quoted-show-actuals", v ? "1" : "0");
    document.body.classList.toggle("hide-actuals", !v);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      title="Show or hide actual hours next to quoted in each cell"
      className={`flex cursor-pointer select-none items-center gap-1.5 rounded-md border px-3.5 py-1.5 text-sm font-medium shadow-sm ${
        show ? "border-sdc-blue bg-sdc-blue-light text-sdc-blue-dark" : "border-sdc-border bg-white text-sdc-gray-600"
      }`}
    >
      {show ? "Actuals: On" : "Actuals: Off"}
    </button>
  );
}
