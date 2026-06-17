export const successResponse = (res, data = {}, status = 200) =>
  res.status(status).json({ success: true, data, ...data });

export const errorResponse = (res, message = "Request failed.", status = 500) =>
  res.status(status).json({ success: false, message, error: message });
