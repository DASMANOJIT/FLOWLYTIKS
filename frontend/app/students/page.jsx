import { Suspense } from "react";
import StudentsContent from "./StudentsContent";
import PremiumLoader from "../components/ui/PremiumLoader.jsx";

export default function StudentsPage() {
  return (
    <Suspense fallback={<PremiumLoader fullScreen label="Loading students" />}>
      <StudentsContent />
    </Suspense>
  );
}
