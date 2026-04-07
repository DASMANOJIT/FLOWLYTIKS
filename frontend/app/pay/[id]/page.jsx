"use client";
import { useRouter } from "next/navigation";
import { useParams, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";

import "./pay.css";
import PremiumLoader from "../../components/ui/PremiumLoader.jsx";
import { MotionButton, MotionCard } from "../../components/motion/primitives.jsx";
import { readApiResponse } from "../../../lib/api.js";
import { openCashfreeCheckout } from "../../../lib/cashfree.js";

export default function PayPage() {
  const { id: studentId } = useParams();

  const searchParams = useSearchParams();
  const month = searchParams.get("month");
  const amount = searchParams.get("amount");
  const router = useRouter();


  const [method, setMethod] = useState("upi");
  const [selectedUpiApp, setSelectedUpiApp] = useState(null);
  const [customUpiId, setCustomUpiId] = useState("");
  const [student, setStudent] = useState(null);
  const [isPaying, setIsPaying] = useState(false);


  useEffect(() => {
    if (!studentId) return;

    const fetchStudent = async () => {
      try {
        const token = localStorage.getItem("token");
        if (!token) {
          router.push("/login");
          return;
        }

        const res = await fetch(
          `/api/students/me`,
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (!res.ok) {
          const errorText = await res.text();
          console.error("Fetch failed:", res.status, errorText);
          throw new Error("Student fetch failed");
        }


        const data = await res.json();
        setStudent(data);
      } catch (err) {
        console.error("Failed to fetch student details", err);
      }
    };

    fetchStudent();
  }, [studentId, router]);




  const handleCashfreePay = async () => {
    try {
      if (!month || !amount) {
        alert("Invalid payment details.");
        return;
      }

      const token = localStorage.getItem("token");
      if (!token) {
        router.push("/login");
        return;
      }

      setIsPaying(true);

      const res = await fetch(
        `/api/payments/cashfree/create-order`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            studentId: student?.id || studentId,
            amount,
            month,
            preferredMethod: method,
            upiApp: selectedUpiApp,
            upiId: customUpiId.trim() || null,
          }),
        }
      );

      const { ok, data, error } = await readApiResponse(
        res,
        "Unable to initialize checkout right now."
      );

      if (!ok || !data.paymentSessionId) {
        alert(error || data.message || "Payment initiation failed");
        return;
      }

      await openCashfreeCheckout({
        paymentSessionId: data.paymentSessionId,
        environment: data.environment,
      });
    } catch (err) {
      console.error(err);
      alert(err?.message || "Something went wrong");
    } finally {
      setIsPaying(false);
    }
  };



  return (
    <motion.div
      className="pay-wrapper"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
     
  <MotionButton
  className="back-btn"
  onClick={() => router.back()}
>
  ← Back
</MotionButton>


 




      <h1 className="pay-heading">Fee Payment</h1>

      <MotionCard className="pay-card" hover={false}>
        <h2 className="student-title">Student ID: {studentId}</h2>
        {student ? (
          <div className="student-info">
            <p><strong>Name:</strong> {student.name}</p>
            <p><strong>Class:</strong> {student.class}</p>
            <p><strong>School:</strong> {student.school}</p>
          </div>
        ) : (
          <PremiumLoader label="Loading student details" />
        )}



        <p className="pay-row"><strong>Month:</strong> {month}</p>
        <p className="pay-row"><strong>Amount:</strong> ₹{amount}</p>
        <p className="method-note" style={{ marginTop: "18px", textAlign: "center" }}>
          You will be redirected to complete payment securely.
        </p>

        {/* PAYMENT BUTTON */}
        <MotionButton className="final-pay-btn" onClick={handleCashfreePay} disabled={isPaying}>
          {isPaying ? (
            <span className="button-loading-content">
              <PremiumLoader inline compact />
              <span>Opening Secure Checkout</span>
            </span>
          ) : (
            `Pay ₹${amount}`
          )}
        </MotionButton>

      </MotionCard>
    </motion.div>
  );
}
