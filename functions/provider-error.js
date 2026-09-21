// Keep provider availability failures distinct from unreadable label data.
function providerErrorResponse(error) {
  const status = Number(error?.status);
  if (status === 503 || status === 502 || status === 504) {
    return { status: 503, body: {
      code: "AI_TEMPORARILY_UNAVAILABLE",
      message: "The AI service is temporarily busy or unavailable. Please try again shortly. You can keep the same label photos.",
    } };
  }
  if (status === 429) {
    return { status: 503, body: {
      code: "AI_CAPACITY_LIMIT",
      message: "The AI service has reached a usage or capacity limit. Please try again later. If this continues, the app administrator needs to check the AI account quota.",
    } };
  }
  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    return { status: 502, body: {
      code: "AI_REQUEST_FAILED",
      message: "The AI service could not complete this request. Please try again later.",
    } };
  }
  return null;
}

module.exports = { providerErrorResponse };
