import { ZodError } from "zod";

const formatZodMessage = (error) => {
  if (!(error instanceof ZodError) || !error.issues.length) {
    return "Invalid request data.";
  }

  const [issue] = error.issues;
  const path = issue.path?.length ? issue.path.join(".") : "request";
  return `${path}: ${issue.message}`;
};

const createValidator = (schema, source) => {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: formatZodMessage(result.error),
        message: formatZodMessage(result.error),
      });
    }

    req[source] = result.data;
    return next();
  };
};

export const validateBody = (schema) => createValidator(schema, "body");
export const validateQuery = (schema) => createValidator(schema, "query");
export const validateParams = (schema) => createValidator(schema, "params");
