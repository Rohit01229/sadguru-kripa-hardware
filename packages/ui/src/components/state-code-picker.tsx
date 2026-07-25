import * as React from "react";
import { Select, type SelectProps } from "./select";

/**
 * Canonical Indian GST state / UT codes (the 2-digit prefix of a GSTIN and the
 * "place of supply" key that decides the CGST+SGST vs IGST split). Source of truth
 * for the shared {@link StateCodePicker}. Display-only — the server stays
 * authoritative for the actual tax computation.
 *
 * Codes follow the current GST scheme: 25 (old Daman & Diu) is merged into 26;
 * 97 = Other Territory, 99 = Centre Jurisdiction are included for completeness.
 */
export const GST_STATE_CODES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "01", name: "Jammu & Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra & Nagar Haveli and Daman & Diu" },
  { code: "27", name: "Maharashtra" },
  { code: "28", name: "Andhra Pradesh (Old)" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman & Nicobar Islands" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
  { code: "97", name: "Other Territory" },
  { code: "99", name: "Centre Jurisdiction" },
];

export interface StateCodePickerProps
  extends Omit<SelectProps, "children"> {
  /**
   * Placeholder option label rendered first (with an empty value). When set, an
   * empty initial value shows this prompt instead of silently selecting the first
   * state. Omit to render only real codes.
   */
  placeholder?: string;
}

/**
 * Shared GST state-code `Select` for POS "Place of supply" and Settings home-state.
 * Replaces the free-text 2-digit inputs where a typo silently flips the displayed
 * CGST/SGST-vs-IGST split. Presentation / affordance only: it emits the same 2-digit
 * `code` string the inputs did (`value` / `name` / `onChange` pass straight through),
 * so payload contracts and server-side validation are unchanged.
 *
 * Each option label is "`<code>` — `<name>`" (e.g. "27 — Maharashtra") so the operator
 * sees both. Default it to the store's home state via the `defaultValue`/`value` props.
 */
export const StateCodePicker = React.forwardRef<HTMLSelectElement, StateCodePickerProps>(
  ({ placeholder, ...props }, ref) => (
    <Select ref={ref} {...props}>
      {placeholder ? (
        <option value="">{placeholder}</option>
      ) : null}
      {GST_STATE_CODES.map(({ code, name }) => (
        <option key={code} value={code}>
          {code} — {name}
        </option>
      ))}
    </Select>
  ),
);
StateCodePicker.displayName = "StateCodePicker";
