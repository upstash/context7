import { z } from "zod";

type Pattern = {
  name: string;
  regex: RegExp;
  severity: "high" | "medium" | "low";
  hint?: string;
};

const SENSITIVE_PATTERNS: Pattern[] = [
  // Secrets and tokens
  {
    name: "AWS Access Key",
    regex: /\bAKIA[0-9A-Z]{16}\b/,
    severity: "high",
    hint: "Looks like an AWS access key.",
  },
  {
    name: "GitHub Token",
    regex: /\bghp_[A-Za-z0-9]{36}\b/,
    severity: "high",
    hint: "Looks like a GitHub access token.",
  },
  {
    name: "OpenAI Secret Key",
    regex: /\bsk-proj-[A-Za-z0-9_-]{80,200}\b/,
    severity: "high",
    hint: "Looks like a OpenAI secret key.",
  },
  {
    name: "Stripe Secret Key",
    regex: /\bsk_(live|test)_[A-Za-z0-9]{20,}\b/,
    severity: "high",
    hint: "Looks like a Stripe secret key.",
  },
  {
    name: "JWT",
    regex: /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/,
    severity: "high",
    hint: "Looks like a JSON Web Token.",
  },
  {
    name: "Generic Long Token",
    regex: /\b[A-Za-z0-9_\-]{32,}\b/,
    severity: "medium",
    hint: "Looks like a token or hash.",
  },

  // PII
  {
    name: "Email Address",
    regex:
      /\b[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[A-Za-z]{2,63})+\b/,
    severity: "medium",
    hint: "Contains an email address.",
  },

  // Internal/confidential markers
  {
    name: "Confidential Marker",
    regex: /\b(confidential|internal\s+use|do\s+not\s+distribute|proprietary)\b/i,
    severity: "medium",
    hint: "Contains confidentiality markers.",
  },
];

export type SensitiveMatch = {
  name: string;
  value: string;
  index?: number;
  severity: "high" | "medium" | "low";
  hint?: string;
};

export type SensitiveScanResult = {
  flagged: boolean;
  matches: SensitiveMatch[];
};

// Scan a string for sensitive indicators.
export function scanStringForSensitiveIndicators(input: string): SensitiveScanResult {
  const matches: SensitiveMatch[] = [];
  if (!input) return { flagged: false, matches };

  for (const pattern of SENSITIVE_PATTERNS) {
    let m: RegExpExecArray | null;
    const re = new RegExp(
      pattern.regex.source,
      pattern.regex.flags.includes("g") ? pattern.regex.flags : pattern.regex.flags + "g"
    );
    while ((m = re.exec(input)) !== null) {
      matches.push({
        name: pattern.name,
        value: m[0],
        index: m.index,
        severity: pattern.severity,
        hint: pattern.hint,
      });
    }
  }

  return { flagged: matches.length > 0, matches };
}

// Recursively scan an object or array for sensitive indicators.
export function scanRecordForSensitiveIndicators(value: unknown): SensitiveScanResult {
  const aggregate: SensitiveScanResult = { flagged: false, matches: [] };

  const visit = (v: unknown) => {
    if (typeof v === "string") {
      const res = scanStringForSensitiveIndicators(v);
      if (res.flagged) {
        aggregate.flagged = true;
        aggregate.matches.push(...res.matches);
      }
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    if (v && typeof v === "object") {
      for (const item of Object.values(v as Record<string, unknown>)) {
        visit(item);
      }
    }
  };

  visit(value);
  return aggregate;
}

// Redact sensitive substrings from input. Useful for logs.
export function redactSensitiveSubstrings(input: string, replacement = "[REDACTED]"): string {
  if (!input) return input;
  let output = input;
  for (const pattern of SENSITIVE_PATTERNS) {
    output = output.replace(pattern.regex, replacement);
  }
  return output;
}

export function sanitizeInline(input: string): string {
  // Trim, collapse inner whitespace, strip newlines/tabs
  return input
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type JSONSchema = {
  type: "object";
  properties: Record<
    string,
    | {
        type: "string";
        title?: string;
        description?: string;
        minLength?: number;
        maxLength?: number;
        pattern?: string;
        enum?: string[];
        enumNames?: string[];
      }
    | {
        type: "number" | "integer" | "boolean";
        title?: string;
        description?: string;
        minimum?: number;
        maximum?: number;
      }
  >;
  required?: string[];
};

// Elicitation schema for resolve-library-id
export function buildResolveLibraryIdElicitationSchema(): JSONSchema {
  return {
    type: "object",
    properties: {
      libraryName: {
        type: "string",
        title: "Library name",
        description:
          "Enter the library or product name only. Do not include secrets, internal code, confidential project names, PII, or any proprietary information.",
        minLength: 1,
        maxLength: 80,
      },
    },
    required: ["libraryName"],
  };
}

const resolveLibraryNameSchema = z
  .string()
  .min(1, "Library name is required.")
  .max(80, "Library name must be at most 80 characters.")
  .transform((v) => sanitizeInline(v))
  .refine((v) => /^[A-Za-z0-9@._\-\s/]{1,80}$/.test(v), {
    message:
      "Library name contains unsupported characters. Use only letters, numbers, space, @ . _ - /",
  });

export type ValidationResult<T> = {
  ok: boolean;
  value?: T;
  errors?: string[];
  sensitive?: SensitiveScanResult;
};

// Validate and sanitize resolve-library-id input, with sensitive scan.
export function validateResolveLibraryIdInput(
  input: unknown
): ValidationResult<{ libraryName: string }> {
  const issues: string[] = [];

  const parsed = resolveLibraryNameSchema.safeParse(input);
  if (!parsed.success) {
    issues.push(...parsed.error.errors.map((e) => e.message));
    return { ok: false, errors: issues };
  }

  const sensitive = scanStringForSensitiveIndicators(parsed.data);
  if (sensitive.flagged) {
    issues.push(
      "Input may contain sensitive or confidential data. Please remove any secrets, internal identifiers, or code snippets."
    );
  }

  return issues.length > 0
    ? { ok: false, errors: issues, sensitive }
    : { ok: true, value: { libraryName: parsed.data }, sensitive };
}

// Convenience to assert safe input before forwarding upstream. Throws on failure.
export function assertSafe<T>(result: ValidationResult<T>): T {
  if (!result.ok || result.errors?.length) {
    const redactedErrors = (result.errors ?? []).map((e) => redactSensitiveSubstrings(e));
    const detail = redactedErrors.length ? `: ${redactedErrors.join("; ")}` : "";
    throw new Error(`Validation failed${detail}`);
  }
  if (result.sensitive?.flagged) {
    const hints = result.sensitive.matches
      .slice(0, 3)
      .map((m) => m.hint || m.name)
      .join(", ");
    throw new Error(
      `Potential sensitive content detected (${hints || "unknown indicators"}). Please revise the input to remove confidential data.`
    );
  }

  return result.value!;
}

// Warning block for MCP messages or logs.
export function buildSafeUsageNotice(): string {
  return [
    "Safety Notice:",
    "- Do not include secrets, internal code, or confidential project identifiers.",
    "- Use generic, publicly-known library names and topics.",
    "- Review your input before submitting.",
  ].join("\n");
}
