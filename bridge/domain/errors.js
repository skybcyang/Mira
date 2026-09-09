export function typed(code, message, details, cause) {
  const error = new Error(message, cause ? { cause } : undefined)
  error.code = code
  if (details) error.details = details
  return error
}
