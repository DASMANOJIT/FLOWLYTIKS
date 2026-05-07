"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Pie } from "react-chartjs-2";

ChartJS.register(ArcElement, Tooltip, Legend);

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  layout: {
    padding: {
      top: 6,
      right: 8,
      bottom: 6,
      left: 8,
    },
  },
  plugins: {
    legend: {
      position: "bottom",
      labels: {
        usePointStyle: true,
        boxWidth: 10,
        boxHeight: 10,
        padding: 18,
        font: {
          size: 12,
        },
      },
    },
  },
};

export default function AdminFeeStatusChart({ paid = 0, unpaid = 0 }) {
  const data = useMemo(
    () => ({
      labels: ["Paid", "Unpaid"],
      datasets: [
        {
          data: [paid, unpaid],
          backgroundColor: ["#16a34a", "#dc2626"],
          borderWidth: 0,
        },
      ],
    }),
    [paid, unpaid]
  );

  return (
    <div className="admin-fee-chart">
      <Pie data={data} options={chartOptions} />
    </div>
  );
}
