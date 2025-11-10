import { Context } from "hono";
import { prisma } from "../db";
import { hashPassword, comparePassword, signJWT } from "../utils";
import { clearCachedRole } from "../utils/userRoleCache";
import { BaseController } from "../core/BaseController";
import { AuthContext } from "../middlewares/auth";
import type { z } from "zod";
import type {
  signupSchema,
  loginSchema,
  updateUserSchema,
  adminUpdateUserSchema,
} from "../schemas/userSchema";

type SignupInput = z.infer<typeof signupSchema>;
type LoginInput = z.infer<typeof loginSchema>;
type UpdateUserInput = z.infer<typeof updateUserSchema>;
type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>;

class UserController extends BaseController {
  async signup(c: Context) {
    const body = this.getValidJson<SignupInput>(c);
    const { email, username, password } = body;

    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email }, { username }],
      },
    });

    if (existingUser) {
      if (existingUser.email === email) {
        return this.validationFail(
          c,
          {
            email: ["ALREADY_EXISTS"],
          },
          "User with this email already exists",
        );
      }
      return this.validationFail(
        c,
        {
          username: ["ALREADY_EXISTS"],
        },
        "User with this username already exists",
      );
    }

    return this.execute(
      c,
      async () => {
        // Hash password
        const hashedPassword = await hashPassword(password);

        // Create user
        const user = await prisma.user.create({
          data: {
            email,
            username,
            password: hashedPassword,
            role: "USER",
          },
          select: {
            id: true,
            email: true,
            username: true,
            role: true,
            createdAt: true,
          },
        });

        // Generate JWT
        const token = await signJWT({
          userId: user.id,
          email: user.email,
          role: user.role,
        });

        return { user, token };
      },
      "User created successfully",
      201,
    );
  }

  async login(c: Context) {
    const body = this.getValidJson<LoginInput>(c);
    const { email, password } = body;

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return this.fail(c, "Invalid credentials", 401);
    }

    // Verify password
    const isValidPassword = await comparePassword(password, user.password);

    if (!isValidPassword) {
      return this.fail(c, "Invalid credentials", 401);
    }

    return this.execute(
      c,
      async () => {
        // Generate JWT
        const token = await signJWT({
          userId: user.id,
          email: user.email,
          role: user.role,
        });

        return {
          user: {
            id: user.id,
            email: user.email,
            username: user.username,
            role: user.role,
          },
          token,
        };
      },
      "Login successful",
    );
  }

  async getMe(c: AuthContext) {
    return this.execute(c, async () => {
      const user = await prisma.user.findUnique({
        where: { id: c.userId },
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!user) {
        return this.fail(c, "User not found", 404);
      }

      return { user };
    });
  }

  async updateMe(c: AuthContext) {
    const body = this.getValidJson<UpdateUserInput>(c);

    return this.execute(
      c,
      async () => {
        // Check if email or username is being changed and already exists
        if (body.email || body.username) {
          const existingUser = await prisma.user.findFirst({
            where: {
              AND: [
                { id: { not: c.userId } },
                {
                  OR: [
                    ...(body.email ? [{ email: body.email }] : []),
                    ...(body.username ? [{ username: body.username }] : []),
                  ],
                },
              ],
            },
          });

          if (existingUser) {
            if (existingUser.email === body.email) {
              return this.validationFail(
                c,
                { email: ["ALREADY_EXISTS"] },
                "User with this email already exists",
              );
            }
            if (existingUser.username === body.username) {
              return this.validationFail(
                c,
                { username: ["ALREADY_EXISTS"] },
                "User with this username already exists",
              );
            }
          }
        }

        const updateData: any = {};
        if (body.email) updateData.email = body.email;
        if (body.username) updateData.username = body.username;
        if (body.password) {
          updateData.password = await hashPassword(body.password);
        }

        const user = await prisma.user.update({
          where: { id: c.userId },
          data: updateData,
          select: {
            id: true,
            email: true,
            username: true,
            role: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        // Clear role cache when user is updated
        if (c.userId) {
          clearCachedRole(c.userId);
        }

        return { user };
      },
      "User updated successfully",
    );
  }

  async deleteMe(c: AuthContext) {
    return this.execute(
      c,
      async () => {
        await prisma.user.delete({
          where: { id: c.userId },
        });

        // Clear role cache when user is deleted
        clearCachedRole(c.userId!);

        return { message: "User deleted successfully" };
      },
      "User deleted successfully",
    );
  }

  async getAllUsers(c: AuthContext) {
    return this.execute(c, async () => {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      return { users };
    });
  }

  async getUserById(c: AuthContext) {
    const id = c.req.param("id");

    return this.execute(c, async () => {
      const user = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!user) {
        return this.fail(c, "User not found", 404);
      }

      return { user };
    });
  }

  async updateUserById(c: AuthContext) {
    const id = c.req.param("id");
    const body = this.getValidJson<AdminUpdateUserInput>(c);

    return this.execute(
      c,
      async () => {
        // Check if user exists
        const existingUser = await prisma.user.findUnique({
          where: { id },
        });

        if (!existingUser) {
          return this.fail(c, "User not found", 404);
        }

        // Check if email or username is being changed and already exists
        if (body.email || body.username) {
          const conflictUser = await prisma.user.findFirst({
            where: {
              AND: [
                { id: { not: id } },
                {
                  OR: [
                    ...(body.email ? [{ email: body.email }] : []),
                    ...(body.username ? [{ username: body.username }] : []),
                  ],
                },
              ],
            },
          });

          if (conflictUser) {
            if (conflictUser.email === body.email) {
              return this.validationFail(
                c,
                { email: ["ALREADY_EXISTS"] },
                "User with this email already exists",
              );
            }
            if (conflictUser.username === body.username) {
              return this.validationFail(
                c,
                { username: ["ALREADY_EXISTS"] },
                "User with this username already exists",
              );
            }
          }
        }

        const updateData: any = {};
        if (body.email) updateData.email = body.email;
        if (body.username) updateData.username = body.username;
        if (body.password) {
          updateData.password = await hashPassword(body.password);
        }
        if (body.role) updateData.role = body.role;

        const user = await prisma.user.update({
          where: { id },
          data: updateData,
          select: {
            id: true,
            email: true,
            username: true,
            role: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        // Clear role cache when user is updated
        clearCachedRole(id);

        return { user };
      },
      "User updated successfully",
    );
  }

  async deleteUserById(c: AuthContext) {
    const id = c.req.param("id");

    return this.execute(
      c,
      async () => {
        const existingUser = await prisma.user.findUnique({
          where: { id },
        });

        if (!existingUser) {
          return this.fail(c, "User not found", 404);
        }

        await prisma.user.delete({
          where: { id },
        });

        // Clear role cache when user is deleted
        clearCachedRole(id);

        return { message: "User deleted successfully" };
      },
      "User deleted successfully",
    );
  }
}

const userController = new UserController();
export const signup = (c: Context) => userController.signup(c);
export const login = (c: Context) => userController.login(c);
export const getMe = (c: AuthContext) => userController.getMe(c);
export const updateMe = (c: AuthContext) => userController.updateMe(c);
export const deleteMe = (c: AuthContext) => userController.deleteMe(c);
export const getAllUsers = (c: AuthContext) => userController.getAllUsers(c);
export const getUserById = (c: AuthContext) => userController.getUserById(c);
export const updateUserById = (c: AuthContext) =>
  userController.updateUserById(c);
export const deleteUserById = (c: AuthContext) =>
  userController.deleteUserById(c);
