import { Suspense } from "react";
import PaymentSuccessContent from "./PaymentSuccessContent.jsx";
import PremiumLoader from "../components/ui/PremiumLoader.jsx";

export const dynamic = "force-dynamic";

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={<PremiumLoader fullScreen label="Loading payment status" />}>
      <PaymentSuccessContent />
    </Suspense>
  );
}
