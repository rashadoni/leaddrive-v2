// The implementation lives in an ordinary ESM module so production operator
// scripts executed directly by Node and Next.js routes use exactly one policy.
export {
  PASSWORD_MAX_UTF8_BYTES,
  PASSWORD_MIN_GRAPHEMES,
  generateStrongTemporaryPassword,
  passwordPolicyError,
} from "../../scripts/password-policy.mjs"
