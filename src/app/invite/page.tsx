import { Brand, Footer, LocalBanner } from "@/components/ui/primitives";
import { ReviewFlow } from "@/components/client/review-flow";
import { signingConfig } from "@/features/signing/config";
export const dynamic = "force-dynamic";
export default function InvitationPage() {
  let enabled = false; try { signingConfig(process.env); enabled = true; } catch { /* Default deny. */ }
  return <>{enabled && <LocalBanner />}<header className="public-header"><Brand /><span className="eyebrow">PRIVATE AGREEMENT REVIEW</span></header><main id="main" className="review-workspace"><ReviewFlow enabled={enabled} /></main><Footer /></>;
}
