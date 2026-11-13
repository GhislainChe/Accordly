import { notFound } from "next/navigation";
import { providerAgreement } from "@/features/agreements/provider";
import { AgreementDetail } from "@/components/provider/agreement-detail";
import { GatewayError } from "@/lib/security/errors";
export default async function DetailPage({ params }: { params: Promise<{ agreementId: string }> }) {
  let data;
  try { data = await providerAgreement((await params).agreementId); }
  catch (e) { if ((e instanceof GatewayError && e.status === 404) || (typeof e === "object" && e && "code" in e && e.code === "P4040")) notFound(); throw e; }
  return <AgreementDetail initial={data} />;
}
