import { z } from "zod";

export const signupSchema = z.object({
  email: z.email({ message: "INVALID_EMAIL" }),
  username: z.string().min(3).max(50),
  password: z
    .string()
    .min(8, "TOO_SHORT")
    .regex(/[0-9]/, "MUST_CONTAIN_NUMBER")
    .regex(/[!@#$%^&*]/, "MUST_CONTAIN_SYMBOL"),
});

export const loginSchema = z.object({
  email: z.email({ message: "INVALID_EMAIL" }),
  password: z.string().min(1, "REQUIRED"),
});

export const updateUserSchema = z.object({
  email: z.email({ message: "INVALID_EMAIL" }).optional(),
  username: z.string().min(3).max(50).optional(),
  password: z
    .string()
    .min(8, "TOO_SHORT")
    .regex(/[0-9]/, "MUST_CONTAIN_NUMBER")
    .regex(/[!@#$%^&*]/, "MUST_CONTAIN_SYMBOL")
    .optional(),
});

export const adminUpdateUserSchema = z.object({
  email: z.email({ message: "INVALID_EMAIL" }).optional(),
  username: z.string().min(3).max(50).optional(),
  password: z
    .string()
    .min(8, "TOO_SHORT")
    .regex(/[0-9]/, "MUST_CONTAIN_NUMBER")
    .regex(/[!@#$%^&*]/, "MUST_CONTAIN_SYMBOL")
    .optional(),
  role: z.enum(["USER", "ADMIN"]).optional(),
});
