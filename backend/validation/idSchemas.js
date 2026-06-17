import { z } from "zod";

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export const prismaStringId = (message = "Id must be valid.") =>
  z
    .string()
    .trim()
    .min(10, message)
    .max(64, message)
    .regex(ID_PATTERN, message);
