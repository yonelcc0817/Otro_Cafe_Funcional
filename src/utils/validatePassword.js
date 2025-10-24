export const validatePassword = (password) => {
  const minLength = 8;
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

  if (
    password.length < minLength ||
    !hasUpperCase ||
    !hasLowerCase ||
    !hasNumber ||
    !hasSpecialChar
  ) {
    return {
      valid: false,
      message: `La contraseña debe tener al menos ${minLength} caracteres, incluyendo mayúsculas, minúsculas, números y caracteres especiales.`,
    };
  }

  return { valid: true };
};
