import express from "express";
import { setMonthlyFee } from "../controllers/settingscontrollers.js";
import { adminOnly, protect } from "../middleware/authmiddleware.js";

const router = express.Router();

router.post("/monthly-fee", protect, adminOnly, setMonthlyFee);

export default router;
