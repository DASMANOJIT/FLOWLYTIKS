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
  plugins: {
    legend: {
      position: "bottom",
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

  return <Pie data={data} options={chartOptions} />;
}
