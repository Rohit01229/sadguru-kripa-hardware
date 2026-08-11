import { redirect } from "next/navigation";

// /sales has no screen of its own — the sidebar entry lands on estimates, which is the
// document a hardware shop writes most often. The sub-nav switches between the three.
export default function SalesIndexPage() {
  redirect("/sales/estimates");
}
