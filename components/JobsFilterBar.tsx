import { IconAlert, IconGlobe, IconStar } from "@/components/icons";
import { FilterSelect } from "@/components/ui/FilterSelect";

/** Filter-bar row (template filter dropdowns), shown under the page head when "Filter" is on. */
export function JobsFilterBar({ searches }: { searches: { value: string; label: string }[] }) {
  return (
    <div id="job-filters" className="mb-5 flex flex-col gap-3 md:flex-row">
      <FilterSelect param="search" label="Search" icon={<IconGlobe size={20} />} options={searches} />
      <FilterSelect param="status" label="Status" icon={<IconAlert size={20} />} options={[
        { value: "new", label: "New" }, { value: "notified", label: "Notified" }, { value: "called", label: "Called" }, { value: "dismissed", label: "Dismissed" },
      ]} />
      <FilterSelect param="min" label="Score" icon={<IconStar size={20} />} options={[
        { value: "50", label: "50+" }, { value: "70", label: "70+" }, { value: "85", label: "85+" },
      ]} />
    </div>
  );
}
