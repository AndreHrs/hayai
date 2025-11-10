import * as bcrypt from "bcrypt";
import { config } from "../config/env";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, config.saltRounds);
}

export async function comparePassword(
  password: string,
  hashedPassword: string,
): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}
