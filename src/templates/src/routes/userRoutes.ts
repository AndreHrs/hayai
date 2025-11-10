import { Hono } from "hono";
import {
  signup,
  login,
  getMe,
  updateMe,
  deleteMe,
  getAllUsers,
  getUserById,
  updateUserById,
  deleteUserById,
} from "../controllers";
import { validateSchema } from "../core/validator";
import {
  signupSchema,
  loginSchema,
  updateUserSchema,
  adminUpdateUserSchema,
} from "../schemas";
import { authMiddleware } from "../middlewares/auth";
import { onlyAdminAccess } from "../middlewares/onlyAdminAccess";

const userRoutes = new Hono();

// Public routes
userRoutes.post("/signup", validateSchema(signupSchema), signup);
userRoutes.post("/login", validateSchema(loginSchema), login);

// Protected user routes - require authentication
userRoutes.use("/me/*", authMiddleware);
userRoutes.get("/me", getMe);
userRoutes.put("/me", validateSchema(updateUserSchema), updateMe);
userRoutes.delete("/me", deleteMe);

// Admin routes - require authentication and admin role
userRoutes.use("/users/*", authMiddleware);
userRoutes.use("/users/*", onlyAdminAccess);
userRoutes.get("/users", getAllUsers);
userRoutes.get("/users/:id", getUserById);
userRoutes.put(
  "/users/:id",
  validateSchema(adminUpdateUserSchema),
  updateUserById,
);
userRoutes.delete("/users/:id", deleteUserById);

export default userRoutes;
