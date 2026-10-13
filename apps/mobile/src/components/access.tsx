import { useAuth } from "../lib/auth";
import { Banner } from "./ui";

/** RLS returns empty results for anyone but the owner - say so instead of showing a blank app. */
export function NoAccessBanner({ show }: { show: boolean }) {
  const { email } = useAuth();
  if (!show) return null;
  return (
    <Banner tone="bad" title="This account can't see any data">
      {`You're signed in as ${email ?? "an unknown account"}, but only the owner account can read jobs, proposals and settings. Sign out (More → Sign out) and use the owner email.`}
    </Banner>
  );
}
