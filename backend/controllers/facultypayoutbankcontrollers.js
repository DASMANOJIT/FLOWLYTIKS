import prisma from "../prisma/client.js";
import * as payoutService from "../services/facultyPayoutService.js";

const maskAccountNumber = (value) => {
  const text = String(value || "");
  if (!text) return null;
  return `XXXX${text.slice(-4)}`;
};

const serializeBankAccount = (account, { includeFullAccount = false } = {}) => {
  if (!account) return null;
  return {
    ...account,
    maskedBankAccountNumber: maskAccountNumber(account.accountNumber),
    accountNumber: includeFullAccount ? account.accountNumber : undefined,
  };
};

const normalizeAdminBankData = (body, actor) => {
  const verificationStatus = body.verificationStatus || "PENDING";
  return {
    ...body,
    payoutMode: body.payoutMode || "NONE",
    verificationStatus,
    payoutEligible:
      verificationStatus === "VERIFIED" ? Boolean(body.payoutEligible) : false,
    payoutDetailsUpdatedBy: actor,
    payoutDetailsUpdatedAt: new Date(),
  };
};

const normalizeFacultyBankData = (body, facultyId) => ({
  ...body,
  facultyId,
  payoutMode: body.payoutMode || "NONE",
  verificationStatus: "PENDING",
  payoutEligible: false,
  payoutBlockedReason: null,
  payoutDetailsUpdatedBy: `faculty:${facultyId}`,
  payoutDetailsUpdatedAt: new Date(),
});

export const createBankAccount = async (req, res) => {
  try {
    const data = normalizeAdminBankData(req.body, `admin:${req.user?.id || "unknown"}`);
    const record = await payoutService.createFacultyBankAccount(data);
    return res.status(201).json({
      success: true,
      bankAccount: serializeBankAccount(record, { includeFullAccount: true }),
    });
  } catch (err) {
    console.error("Create bank account error:", err?.message || err);
    return res.status(500).json({
      success: false,
      message: "Failed to create bank account.",
    });
  }
};

export const updateBankAccount = async (req, res) => {
  try {
    const data = normalizeAdminBankData(req.body, `admin:${req.user?.id || "unknown"}`);
    const record = await payoutService.updateFacultyBankAccount(req.params.id, data);
    return res.json({
      success: true,
      bankAccount: serializeBankAccount(record, { includeFullAccount: true }),
    });
  } catch (err) {
    console.error("Update bank account error:", err?.message || err);
    return res.status(500).json({
      success: false,
      message: "Failed to update bank account.",
    });
  }
};

export const getBankAccountByFaculty = async (req, res) => {
  try {
    const facultyId = req.params.facultyId || req.user?.id;
    if (req.userRole === "faculty" && String(facultyId) !== String(req.user?.id)) {
      return res.status(403).json({
        success: false,
        message: "Faculty members can only view their own bank details.",
      });
    }

    const account = await payoutService.getFacultyBankAccount(facultyId);
    return res.json({
      success: true,
      bankAccount: serializeBankAccount(account, {
        includeFullAccount:
          req.userRole === "admin" || String(facultyId) === String(req.user?.id),
      }),
    });
  } catch (err) {
    console.error("Get bank account error:", err?.message || err);
    return res.status(500).json({
      success: false,
      message: "Failed to get bank account.",
    });
  }
};

export const verifyBankAccount = async (req, res) => {
  try {
    const account = await prisma.facultyBankAccount.update({
      where: { id: req.params.id },
      data: {
        verificationStatus: "VERIFIED",
        payoutEligible: true,
        payoutDetailsUpdatedBy: `admin:${req.user?.id || "unknown"}`,
        payoutDetailsUpdatedAt: new Date(),
      },
    });
    return res.json({
      success: true,
      bankAccount: serializeBankAccount(account, { includeFullAccount: true }),
    });
  } catch (err) {
    console.error("Verify bank account error:", err?.message || err);
    return res.status(500).json({
      success: false,
      message: "Failed to verify bank account.",
    });
  }
};

export const updateMyBankAccount = async (req, res) => {
  try {
    if (req.userRole !== "faculty") {
      return res.status(403).json({ success: false, message: "Faculty access only." });
    }

    const record = await payoutService.createFacultyBankAccount(
      normalizeFacultyBankData(req.body, req.user.id)
    );
    return res.json({
      success: true,
      message: "Your payout details were updated and are pending admin verification.",
      bankAccount: serializeBankAccount(record, { includeFullAccount: true }),
    });
  } catch (err) {
    console.error("Update own bank account error:", err?.message || err);
    return res.status(500).json({
      success: false,
      message: "Failed to update payout details.",
    });
  }
};
