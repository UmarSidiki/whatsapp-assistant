import { db } from "../db";
import { template } from "../db/schema";
import { eq } from "drizzle-orm";
import { ServiceError } from "./wa-socket";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Template {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Templates ────────────────────────────────────────────────────────────────

export async function getTemplates(): Promise<Template[]> {
  const rows = await db.select().from(template).all();
  return rows.map(r => ({
    ...r,
    createdAt: new Date(r.createdAt).toISOString(),
    updatedAt: new Date(r.updatedAt).toISOString(),
  }));
}

export async function createTemplate(name: string, content: string): Promise<Template> {
  const existing = await db.select().from(template).where(eq(template.name, name)).get();
  if (existing) throw new ServiceError("A template with this name already exists", 409);
  const now = new Date();
  const id = crypto.randomUUID();
  await db.insert(template).values({ id, name, content, createdAt: now, updatedAt: now });
  return { id, name, content, createdAt: now.toISOString(), updatedAt: now.toISOString() };
}

export async function deleteTemplate(id: string): Promise<void> {
  const existing = await db.select().from(template).where(eq(template.id, id)).get();
  if (!existing) throw new ServiceError("Template not found", 404);
  await db.delete(template).where(eq(template.id, id));
}
