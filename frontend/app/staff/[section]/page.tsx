import { notFound } from "next/navigation";
import StaffScreens from "../StaffScreens";

const sections = ["dashboard", "students", "cash-payments", "follow-ups", "admission-enquiries", "profile"];
export default async function StaffPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!sections.includes(section)) notFound();
  return <StaffScreens section={section} />;
}
