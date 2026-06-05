import prisma from "../prisma/client.js";
import {
  buildClassSchoolGroupWriteData,
  getMissingClassSchoolCombinationsForAdmin,
} from "../services/classSchoolGroupService.js";

const jsonError = (res, status, message) =>
  res.status(status).json({
    success: false,
    error: message,
    message,
  });

const jsonSuccess = (res, payload = {}, status = 200) =>
  res.status(status).json({
    success: true,
    ...payload,
  });

const isUniqueConstraintError = (error) => error?.code === "P2002";
const isMissingGroupSchemaError = (error) =>
  error?.code === "P2021" ||
  error?.code === "P2022" ||
  /ClassSchoolGroup|classSchoolGroup|does not exist/i.test(String(error?.message || ""));

const serializeGroup = (group) => ({
  id: group.id,
  className: group.className,
  schoolName: group.schoolName,
  whatsappGroupLink: group.whatsappGroupLink,
  createdAt: group.createdAt instanceof Date ? group.createdAt.toISOString() : group.createdAt,
  updatedAt: group.updatedAt instanceof Date ? group.updatedAt.toISOString() : group.updatedAt,
});

const findGroupForAdmin = async ({ adminId, groupId }) =>
  prisma.classSchoolGroup.findFirst({
    where: {
      id: String(groupId || ""),
      adminId: Number(adminId),
    },
  });

export const listClassSchoolGroups = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return jsonError(res, 403, "Forbidden: Admins only");
    }

    const adminId = Number(req.user?.id);
    const groups = await prisma.classSchoolGroup.findMany({
      where: { adminId },
      orderBy: [
        { className: "asc" },
        { schoolName: "asc" },
      ],
    });

    return jsonSuccess(res, {
      groups: groups.map(serializeGroup),
    });
  } catch (error) {
    if (isMissingGroupSchemaError(error)) {
      console.warn("listClassSchoolGroups schema unavailable:", error?.message || error);
      return jsonSuccess(res, { groups: [] });
    }
    console.error("listClassSchoolGroups error:", error);
    return jsonError(res, 500, "Failed to fetch WhatsApp group links.");
  }
};

export const createClassSchoolGroup = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return jsonError(res, 403, "Forbidden: Admins only");
    }

    const adminId = Number(req.user?.id);
    const groupData = buildClassSchoolGroupWriteData(req.body);

    let group;
    try {
      group = await prisma.classSchoolGroup.create({
        data: {
          adminId,
          ...groupData,
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return jsonError(
          res,
          409,
          "A WhatsApp group link already exists for this class and school."
        );
      }
      throw error;
    }

    return jsonSuccess(
      res,
      {
        message: "WhatsApp group link created successfully.",
        group: serializeGroup(group),
      },
      201
    );
  } catch (error) {
    console.error("createClassSchoolGroup error:", error);
    return jsonError(res, 500, "Failed to create WhatsApp group link.");
  }
};

export const updateClassSchoolGroup = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return jsonError(res, 403, "Forbidden: Admins only");
    }

    const adminId = Number(req.user?.id);
    const existingGroup = await findGroupForAdmin({
      adminId,
      groupId: req.params.id,
    });

    if (!existingGroup) {
      return jsonError(res, 404, "WhatsApp group link not found.");
    }

    const groupData = buildClassSchoolGroupWriteData(req.body);

    let group;
    try {
      group = await prisma.classSchoolGroup.update({
        where: { id: existingGroup.id },
        data: groupData,
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return jsonError(
          res,
          409,
          "A WhatsApp group link already exists for this class and school."
        );
      }
      throw error;
    }

    return jsonSuccess(res, {
      message: "WhatsApp group link updated successfully.",
      group: serializeGroup(group),
    });
  } catch (error) {
    console.error("updateClassSchoolGroup error:", error);
    return jsonError(res, 500, "Failed to update WhatsApp group link.");
  }
};

export const deleteClassSchoolGroup = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return jsonError(res, 403, "Forbidden: Admins only");
    }

    const adminId = Number(req.user?.id);
    const existingGroup = await findGroupForAdmin({
      adminId,
      groupId: req.params.id,
    });

    if (!existingGroup) {
      return jsonError(res, 404, "WhatsApp group link not found.");
    }

    await prisma.classSchoolGroup.delete({
      where: { id: existingGroup.id },
    });

    return jsonSuccess(res, {
      message: "WhatsApp group link deleted successfully.",
    });
  } catch (error) {
    console.error("deleteClassSchoolGroup error:", error);
    return jsonError(res, 500, "Failed to delete WhatsApp group link.");
  }
};

export const listMissingClassSchoolGroups = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return jsonError(res, 403, "Forbidden: Admins only");
    }

    const adminId = Number(req.user?.id);
    const missing = await getMissingClassSchoolCombinationsForAdmin(adminId);

    return jsonSuccess(res, {
      missing,
    });
  } catch (error) {
    if (isMissingGroupSchemaError(error)) {
      console.warn("listMissingClassSchoolGroups schema unavailable:", error?.message || error);
      return jsonSuccess(res, { missing: [] });
    }
    console.error("listMissingClassSchoolGroups error:", error);
    return jsonError(res, 500, "Failed to fetch missing group links.");
  }
};
