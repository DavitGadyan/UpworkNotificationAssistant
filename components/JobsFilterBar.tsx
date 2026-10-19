import { IconAlert, IconGlobe } from "@/components/icons";
import { FilterSelect } from "@/components/ui/FilterSelect";

/** Filter-bar row (template filter dropdowns), shown under the page head when "Filter" is on. */
export function JobsFilterBar({ searches }: { searches: { value: string; label: string }[] }) {
  return (
    <div id="job-filters" className="mb-5 flex flex-col gap-3 md:flex-row">
      <FilterSelect param="search" label="Search" icon={<IconGlobe size={20} />} options={searches} />
      <FilterSelect param="status" label="Status" icon={<IconAlert size={20} />} options={[
        { value: "new", label: "New" }, { value: "awaiting_ai", label: "Waiting for AI" }, { value: "awaiting_payment", label: "Waiting for payment" }, { value: "notified", label: "Notified" }, { value: "called", label: "Called" },
        { value: "dismissed", label: "Dismissed" }, { value: "off", label: "Not my field" },
      ]} />
    </div>
  );
}
