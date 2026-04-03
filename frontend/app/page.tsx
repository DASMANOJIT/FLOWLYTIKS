"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import PremiumLoader from "./components/ui/PremiumLoader.jsx";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/login");
  }, [router]);

  return <PremiumLoader fullScreen label="Launching Flowlytiks" />;
}
